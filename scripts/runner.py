import argparse,sys
from .storage import Storage
from .model_adapter import LLMClient,AgentResponseRequired
from .visibility import VisibilityService
from .local_view import LocalViewBuilder
from .environment import EnvironmentScheduler
from .validator import RuleValidator
from .ledger import ResourceLedger
from .evidence import EvidenceService
from .spawn import SpawnService
from .actions import ActionExecutor
from .memory import MemoryService
from .capability import CapabilityGateway
from .utils import seeded_order,read_json,write_json
from .invariants import check_invariants
from .render_state import render

class RoundRunner:
    def __init__(self,base="."):
        self.s=Storage(base)
        self.s.ensure_v4_defaults()
        self.cfg=self.s.config()
        self.llm=LLMClient(base)
        self.visibility=VisibilityService(self.s)
        self.evidence=EvidenceService(self.s,self.llm)
        self.capability=CapabilityGateway(self.s,self.evidence)
        self.lv=LocalViewBuilder(self.s,self.visibility,self.capability)
        self.env=EnvironmentScheduler(self.s)
        self.validator=RuleValidator(self.s)
        self.ledger=ResourceLedger(self.s)
        self.spawn=SpawnService(self.s)
        self.executor=ActionExecutor(
          self.s,self.validator,self.ledger,self.evidence,self.spawn,self.capability
        )
        self.memory=MemoryService(self.s,self.llm)
        self.pending_path=self.s.base/self.cfg["runtime"]["agent_queue"]["pending_round_file"]

    def _save_pending(self,p):
        write_json(self.pending_path,p)

    def _load_pending(self):
        return read_json(self.pending_path) if self.pending_path.exists() else None

    def _clear_pending(self):
        if self.pending_path.exists():
            self.pending_path.unlink()

    def _audit(self,pid,round_num,audit,action):
        usage=audit["token_usage"]
        self.s.append_text(
          f"pixels/{pid}/llm_log.md",
          f"\n## Round {round_num}\n"
          f"- kind: {audit['kind']}\n"
          f"- model: {audit['model']}\n"
          f"- action: {action}\n"
          f"- request_id: {audit.get('request_id','api')}\n"
          f"- prompt_hash: {audit['prompt_hash']}\n"
          f"- local_view_hash: {audit.get('local_view_hash','')}\n"
          f"- tokens: {usage['total_tokens']}\n"
        )
        w=self.s.world()
        kind=audit["kind"]
        key="decision_calls" if kind=="PIXEL_DECISION" else (
            "validator_calls" if kind=="EVIDENCE_VALIDATION" else "memory_calls"
        )
        w["llm_accounting"][key]+=1
        w["llm_accounting"]["prompt_tokens"]+=int(usage["prompt_tokens"])
        w["llm_accounting"]["completion_tokens"]+=int(usage["completion_tokens"])
        self.s.save_world(w)

    def _new_pending(self):
        w=self.s.world()
        rn=int(w["round"])+1
        w["round"]=rn
        self.s.save_world(w)

        env_events,created=self.env.inject(rn)
        if created:
            w=self.s.world()
            w["counters"]["problems_created"]+=len(created)
            self.s.save_world(w)

        active=self.s.pixel_ids(active_only=True)
        views={}; awakened=[]; skipped=[]
        for pid in active:
            v=self.lv.build(pid,rn,env_events.get(pid,[]))
            views[pid]=v
            (awakened if self.lv.should_wake(v) else skipped).append(pid)

        order=seeded_order(awakened,int(self.cfg["experiment_seed"])+rn)

        p={
          "round":rn,"environment_created":created,"active":active,
          "views":views,"awakened":awakened,"skipped":skipped,
          "order":order,"decision_index":0,"decisions":{},"audits":{},
          "apply_index":0,"applied":[],"rejected":[],
          "close_requests":[],"significant":[],
          "close_index":0,"close_results":[],
          "maintenance_done":False,
          "memory_index":0,"memory_updates":[]
        }
        self._save_pending(p)
        return p

    def run_one(self):
        p=self._load_pending() or self._new_pending()
        rn=p["round"]

        # 1. Decisions
        while p["decision_index"]<len(p["order"]):
            pid=p["order"][p["decision_index"]]
            try:
                a,audit=self.llm.decide(pid,rn,p["views"][pid])
            except AgentResponseRequired:
                self._save_pending(p)
                raise
            p["decisions"][pid]=a
            p["audits"][pid]=audit
            self._audit(pid,rn,audit,a["action"])
            p["decision_index"]+=1
            self._save_pending(p)

        # 2. Apply actions exactly once
        while p["apply_index"]<len(p["order"]):
            pid=p["order"][p["apply_index"]]
            a=p["decisions"][pid]
            ok,reason=self.validator.validate(pid,a,p["views"][pid])
            if not ok:
                self.ledger.charge_action(
                  pid,float(self.cfg["resource"]["invalid_action_cost"])
                )
                p["rejected"].append({"pixel":pid,"action":a,"reason":reason})
            else:
                try:
                    res=self.executor.execute(pid,a,rn,p["views"][pid])
                    p["applied"].append({"pixel":pid,"action":a,"result":res})
                    if res.get("request_close"):
                        p["close_requests"].append([pid,res["problem_id"]])
                    if a["action"]=="SPAWN":
                        p["significant"].append([pid,{"type":"SPAWN","result":res}])
                    if res.get("significant_event"):
                        p["significant"].append([
                          pid,{"type":res["significant_event"],"result":res}
                        ])
                except Exception as e:
                    p["rejected"].append({
                      "pixel":pid,"action":a,"reason":f"EXECUTION_ERROR: {e}"
                    })
            p["apply_index"]+=1
            self._save_pending(p)

        # 3. Close validation
        while p["close_index"]<len(p["close_requests"]):
            pid,problem_id=p["close_requests"][p["close_index"]]
            try:
                verdict,audit=self.evidence.request_close(problem_id,rn)
            except AgentResponseRequired:
                self._save_pending(p)
                raise

            if audit:
                self._audit(pid,rn,audit,"EVIDENCE_VALIDATE")

            item={"pixel":pid,"problem_id":problem_id,"verdict":verdict}
            if verdict["verdict"]=="PASS":
                prob=self.s.problem(problem_id)
                prob["status"]="CLOSED"
                self.s.save_problem(prob)

                dist=self.ledger.settle_closed(prob)

                st=self.s.pixel_state(pid)
                if st.get("current_problem")==problem_id:
                    st["current_problem"]=None
                    st["waiting_for"]=[]
                    st["waiting_external_request"]=None
                    self.s.save_pixel_state(pid,st)

                w=self.s.world()
                w["counters"]["problems_closed"]+=1
                self.s.save_world(w)

                item["distribution"]=dist
                p["significant"].append([
                  pid,{"type":"CLOSED","problem_id":problem_id,"distribution":dist}
                ])
            else:
                p["significant"].append([
                  pid,{"type":"FAILED_CLOSE","problem_id":problem_id,"verdict":verdict}
                ])

            p["close_results"].append(item)
            p["close_index"]+=1
            self._save_pending(p)

        # 4. Maintenance exactly once
        if not p["maintenance_done"]:
            p["deaths"]=self.ledger.maintenance_all()
            p["maintenance_done"]=True
            self._save_pending(p)

        # 5. Memory
        while p["memory_index"]<len(p["significant"]):
            pid,event=p["significant"][p["memory_index"]]
            if pid in self.s.pixel_ids() and self.s.pixel_state(pid).get("active"):
                try:
                    delta,audit=self.memory.update(pid,rn,event)
                except AgentResponseRequired:
                    self._save_pending(p)
                    raise
                self._audit(pid,rn,audit,"MEMORY_UPDATE")
                p["memory_updates"].append({"pixel":pid,"delta":delta})
            p["memory_index"]+=1
            self._save_pending(p)

        # 6. Consume external events seen in this round
        for pid in p["awakened"]:
            event_ids=[
              e["id"] for e in p["views"][pid].get("external",{}).get("events",[])
            ]
            self.capability.consume_events(pid,event_ids)

        inv=check_invariants(self.s,p["views"],p["audits"])
        if inv:
            raise RuntimeError("EXPERIMENT_INVALID invariants: "+"; ".join(inv))

        log={
          "round":rn,
          "environment_created":p["environment_created"],
          "active_at_start":p["active"],
          "awakened":p["awakened"],
          "skipped_idle":p["skipped"],
          "decision_order":p["order"],
          "decisions":p["decisions"],
          "applied":p["applied"],
          "rejected":p["rejected"],
          "close_results":p["close_results"],
          "deaths":p.get("deaths",[]),
          "memory_updates":p["memory_updates"]
        }
        write_json(self.s.base/f"rounds/round_{rn:04d}.json",log)

        md=[
          f"# Round {rn:04d}",
          f"\nAwakened: {p['awakened']}",
          f"\nDecision order: {p['order']}",
          "\n## Applied"
        ]
        for x in p["applied"]:
            md.append(
              f"- {x['pixel']}: {x['action']['action']} — "
              f"{x['action'].get('reasoning_summary','')}"
            )
        md+=["\n## Rejected"]
        for x in p["rejected"]:
            md.append(f"- {x['pixel']}: {x['reason']}")
        md+=["\n## Close Results"]
        for x in p["close_results"]:
            md.append(f"- {x['problem_id']}: {x['verdict']['verdict']}")

        (self.s.base/f"rounds/round_{rn:04d}.md").write_text(
          "\n".join(md)+"\n",encoding="utf-8"
        )

        render(str(self.s.base))

        owner_requests=[
          x for x in p["applied"]
          if x["result"].get("owner_action_required")
        ]

        self._clear_pending()

        if owner_requests:
            print(
              "OWNER_ACTION_REQUIRED:",
              [x["result"]["external_request_id"] for x in owner_requests]
            )

        return log

    def run(self,rounds):
        out=[]
        for _ in range(rounds):
            out.append(self.run_one())
        return out

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--rounds",type=int,default=1)
    ap.add_argument("--base",default=".")
    args=ap.parse_args()
    try:
        RoundRunner(args.base).run(args.rounds)
    except AgentResponseRequired as e:
        print("AGENT_RESPONSE_REQUIRED")
        print(e.request_path)
        sys.exit(42)
