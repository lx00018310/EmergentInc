import argparse, json
from pathlib import Path
from .storage import Storage
from .model_adapter import LLMClient
from .visibility import VisibilityService
from .local_view import LocalViewBuilder
from .environment import EnvironmentScheduler
from .validator import RuleValidator
from .ledger import ResourceLedger
from .evidence import EvidenceService
from .spawn import SpawnService
from .actions import ActionExecutor
from .memory import MemoryService
from .utils import seeded_order
from .invariants import check_invariants
from .render_state import render

class RoundRunner:
    def __init__(self, base="."):
        self.s=Storage(base)
        self.cfg=self.s.config()
        self.llm=LLMClient(base)
        self.visibility=VisibilityService(self.s)
        self.lv=LocalViewBuilder(self.s,self.visibility)
        self.env=EnvironmentScheduler(self.s)
        self.validator=RuleValidator(self.s)
        self.ledger=ResourceLedger(self.s)
        self.evidence=EvidenceService(self.s,self.llm)
        self.spawn=SpawnService(self.s)
        self.executor=ActionExecutor(self.s,self.validator,self.ledger,self.evidence,self.spawn)
        self.memory=MemoryService(self.s,self.llm)

    def _audit(self,pid,round_num,audit,action):
        log=self.s.base/f"pixels/{pid}/llm_log.md"
        usage=audit["token_usage"]
        self.s.append_text(f"pixels/{pid}/llm_log.md",
            f"\n## Round {round_num}\n- kind: {audit['kind']}\n- model: {audit['model']}\n- action: {action}\n- prompt_hash: {audit['prompt_hash']}\n- local_view_hash: {audit.get('local_view_hash','')}\n- tokens: {usage['total_tokens']}\n")
        w=self.s.world()
        k="decision_calls" if audit["kind"]=="decision" else ("validator_calls" if audit["kind"]=="evidence_validator" else "memory_calls")
        w["llm_accounting"][k]+=1
        w["llm_accounting"]["prompt_tokens"]+=usage["prompt_tokens"]
        w["llm_accounting"]["completion_tokens"]+=usage["completion_tokens"]
        self.s.save_world(w)

    def run_one(self):
        w=self.s.world()
        round_num=int(w["round"])+1
        w["round"]=round_num; self.s.save_world(w)

        env_events,created=self.env.inject(round_num)
        if created:
            w=self.s.world(); w["counters"]["problems_created"]+=len(created); self.s.save_world(w)

        active=self.s.pixel_ids(active_only=True)
        views={}
        awakened=[]
        skipped=[]
        for pid in active:
            v=self.lv.build(pid,round_num,env_events.get(pid,[]))
            views[pid]=v
            if self.lv.should_wake(v): awakened.append(pid)
            else: skipped.append(pid)

        order=seeded_order(awakened, int(self.cfg["experiment_seed"])+round_num)
        decisions={}
        audits={}
        for pid in order:
            a,audit=self.llm.decide(pid,round_num,views[pid])
            decisions[pid]=a; audits[pid]=audit
            self._audit(pid,round_num,audit,a["action"])

        applied=[]
        close_requests=[]
        rejected=[]
        significant=[]
        for pid in order:
            a=decisions[pid]
            ok,reason=self.validator.validate(pid,a,views[pid])
            if not ok:
                self.ledger.charge_action(pid,float(self.cfg["resource"]["invalid_action_cost"]))
                rejected.append({"pixel":pid,"action":a,"reason":reason})
                continue
            try:
                res=self.executor.execute(pid,a,round_num,views[pid])
                applied.append({"pixel":pid,"action":a,"result":res})
                if res.get("request_close"): close_requests.append((pid,res["problem_id"]))
                if a["action"]=="SPAWN": significant.append((pid,{"type":"SPAWN","result":res}))
            except Exception as e:
                rejected.append({"pixel":pid,"action":a,"reason":f"EXECUTION_ERROR: {e}"})

        close_results=[]
        for pid,problem_id in close_requests:
            verdict,audit=self.evidence.request_close(problem_id)
            if audit: self._audit(pid,round_num,audit,"EVIDENCE_VALIDATE")
            item={"pixel":pid,"problem_id":problem_id,"verdict":verdict}
            if verdict["verdict"]=="PASS":
                p=self.s.problem(problem_id); p["status"]="CLOSED"; self.s.save_problem(p)
                dist=self.ledger.settle_closed(p)
                st=self.s.pixel_state(pid)
                if st.get("current_problem")==problem_id:
                    st["current_problem"]=None; self.s.save_pixel_state(pid,st)
                w=self.s.world(); w["counters"]["problems_closed"]+=1; self.s.save_world(w)
                item["distribution"]=dist
                significant.append((pid,{"type":"CLOSED","problem_id":problem_id,"distribution":dist}))
            else:
                significant.append((pid,{"type":"FAILED_CLOSE","problem_id":problem_id,"verdict":verdict}))
            close_results.append(item)

        deaths=self.ledger.maintenance_all()

        # memory updates only for significant events
        memory_updates=[]
        for pid,event in significant:
            if pid in self.s.pixel_ids() and self.s.pixel_state(pid).get("active"):
                try:
                    delta,audit=self.memory.update(pid,event)
                    self._audit(pid,round_num,audit,"MEMORY_UPDATE")
                    memory_updates.append({"pixel":pid,"delta":delta})
                except Exception as e:
                    # memory update is LLM-required; fail fast to protect experiment integrity
                    raise

        inv=check_invariants(self.s,views,audits)
        if inv:
            raise RuntimeError("EXPERIMENT_INVALID invariants: "+"; ".join(inv))

        log={
          "round":round_num,"environment_created":created,
          "active_at_start":active,"awakened":awakened,"skipped_idle":skipped,
          "decision_order":order,"decisions":decisions,"applied":applied,
          "rejected":rejected,"close_results":close_results,"deaths":deaths,
          "memory_updates":memory_updates
        }
        (self.s.base/f"rounds/round_{round_num:04d}.json").write_text(json.dumps(log,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
        md=[
          f"# Round {round_num:04d}",
          f"\nAwakened: {awakened}",
          f"\nDecision order: {order}",
          "\n## Applied"
        ]
        for x in applied: md.append(f"- {x['pixel']}: {x['action']['action']} — {x['action'].get('reasoning_summary','')}")
        md+=["\n## Rejected"]
        for x in rejected: md.append(f"- {x['pixel']}: {x['reason']}")
        md+=["\n## Close Results"]
        for x in close_results: md.append(f"- {x['problem_id']}: {x['verdict']['verdict']}")
        md+=["\n## Observed",f"- Active start: {len(active)}",f"- Deaths: {deaths}",f"- Environment problems: {created}",
             "\n## Inferred","- No automatic inference. Human review required.",
             "\n## Hypothesized","- None generated by runner."]
        (self.s.base/f"rounds/round_{round_num:04d}.md").write_text("\n".join(md)+"\n",encoding="utf-8")
        render(str(self.s.base))
        return log

    def run(self, rounds):
        out=[]
        for _ in range(rounds):
            out.append(self.run_one())
        return out

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--rounds",type=int,default=1)
    ap.add_argument("--base",default=".")
    args=ap.parse_args()
    RoundRunner(args.base).run(args.rounds)
