import argparse
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
from .capability import CapabilityGateway
from .utils import seeded_order,write_json
from .invariants import check_invariants
from .render_state import render

class OwnerActionRequired(RuntimeError):
    def __init__(self,request_ids): self.request_ids=request_ids; super().__init__('OWNER_ACTION_REQUIRED: '+','.join(request_ids))

class RoundRunner:
    def __init__(self,base='.'):
        self.s=Storage(base); self.s.ensure_v5_defaults(); self.cfg=self.s.config()
        if self.cfg.get('runtime',{}).get('mode')!='api_sandbox': raise RuntimeError('V5 EXPERIMENT_INVALID: runtime must be api_sandbox')
        self.llm=LLMClient(base); self.visibility=VisibilityService(self.s); self.evidence=EvidenceService(self.s,self.llm)
        self.capability=CapabilityGateway(self.s,self.evidence); self.lv=LocalViewBuilder(self.s,self.visibility,self.capability)
        self.env=EnvironmentScheduler(self.s); self.validator=RuleValidator(self.s); self.ledger=ResourceLedger(self.s); self.spawn=SpawnService(self.s)
        self.executor=ActionExecutor(self.s,self.validator,self.ledger,self.evidence,self.spawn,self.capability); self.memory=MemoryService(self.s,self.llm)

    def _audit(self,pid,rn,audit,action):
        u=audit['token_usage']; self.s.append_text(f'pixels/{pid}/llm_log.md',f"\n## Round {rn}\n- kind: {audit['kind']}\n- model: {audit['model']}\n- action: {action}\n- prompt_hash: {audit['prompt_hash']}\n- sandbox_hash: {audit.get('sandbox_hash','')}\n- sandbox_top_keys: {audit.get('sandbox_top_keys',[])}\n- sandbox_chars: {audit.get('sandbox_chars',0)}\n- tokens: {u['total_tokens']}\n")
        w=self.s.world(); kind=audit['kind']; key='decision_calls' if kind=='PIXEL_DECISION' else ('validator_calls' if kind=='EVIDENCE_VALIDATION' else 'memory_calls')
        w['llm_accounting'][key]+=1; w['llm_accounting']['prompt_tokens']+=int(u['prompt_tokens']); w['llm_accounting']['completion_tokens']+=int(u['completion_tokens']); self.s.save_world(w)

    def run_one(self):
        w=self.s.world(); rn=int(w['round'])+1; w['round']=rn; self.s.save_world(w)
        env_events,created=self.env.inject(rn)
        if created:
            w=self.s.world(); w['counters']['problems_created']+=len(created); self.s.save_world(w)
        active=self.s.pixel_ids(active_only=True); views={}; awakened=[]; skipped=[]
        for pid in active:
            v=self.lv.build(pid,rn,env_events.get(pid,[])); views[pid]=v; (awakened if self.lv.should_wake(v) else skipped).append(pid)
        order=seeded_order(awakened,int(self.cfg['experiment_seed'])+rn); decisions={}; audits={}
        for pid in order:
            a,audit=self.llm.decide(pid,rn,views[pid]); decisions[pid]=a; audits[pid]=audit; self._audit(pid,rn,audit,a['action'])
        applied=[]; rejected=[]; close_requests=[]; significant=[]; owner_requests=[]
        for pid in order:
            a=decisions[pid]; ok,reason=self.validator.validate(pid,a,views[pid])
            if not ok:
                self.ledger.charge_action(pid,float(self.cfg['resource']['invalid_action_cost'])); rejected.append({'pixel':pid,'action':a,'reason':reason}); continue
            try:
                res=self.executor.execute(pid,a,rn,views[pid]); applied.append({'pixel':pid,'action':a,'result':res})
                if res.get('request_close'): close_requests.append((pid,res['problem_id']))
                if a['action']=='SPAWN': significant.append((pid,{'type':'SPAWN','result':res}))
                if res.get('significant_event'): significant.append((pid,{'type':res['significant_event'],'result':res}))
                if res.get('owner_action_required'): owner_requests.append(res['external_request_id'])
            except Exception as e: rejected.append({'pixel':pid,'action':a,'reason':f'EXECUTION_ERROR: {e}'})
        close_results=[]
        for pid,problem_id in close_requests:
            verdict,audit=self.evidence.request_close(problem_id,rn)
            if audit: self._audit(pid,rn,audit,'EVIDENCE_VALIDATE')
            item={'pixel':pid,'problem_id':problem_id,'verdict':verdict}
            if verdict['verdict']=='PASS':
                p=self.s.problem(problem_id); p['status']='CLOSED'; self.s.save_problem(p); dist=self.ledger.settle_closed(p)
                st=self.s.pixel_state(pid)
                if st.get('current_problem')==problem_id:
                    st['current_problem']=None; st['waiting_for']=[]; st['waiting_external_request']=None; st['sleep_until_round']=None; self.s.save_pixel_state(pid,st)
                w=self.s.world(); w['counters']['problems_closed']+=1; self.s.save_world(w); item['distribution']=dist
                significant.append((pid,{'type':'CLOSED','problem_id':problem_id,'distribution':dist}))
            else: significant.append((pid,{'type':'FAILED_CLOSE','problem_id':problem_id,'verdict':verdict}))
            close_results.append(item)
        deaths=self.ledger.maintenance_all(); memory_updates=[]
        for pid,event in significant:
            if pid in self.s.pixel_ids() and self.s.pixel_state(pid).get('active'):
                delta,audit=self.memory.update(pid,rn,event); self._audit(pid,rn,audit,'MEMORY_UPDATE'); memory_updates.append({'pixel':pid,'delta':delta})
        for pid in awakened:
            self.capability.consume_events(pid,[e['id'] for e in views[pid].get('external',{}).get('events',[])])
        inv=check_invariants(self.s,views,audits)
        if inv: raise RuntimeError('EXPERIMENT_INVALID invariants: '+'; '.join(inv))
        log={'round':rn,'environment_created':created,'active_at_start':active,'awakened':awakened,'skipped_idle':skipped,'decision_order':order,'decisions':decisions,'applied':applied,'rejected':rejected,'close_results':close_results,'deaths':deaths,'memory_updates':memory_updates,'owner_requests':owner_requests}
        write_json(self.s.base/f'rounds/round_{rn:04d}.json',log)
        md=[f'# Round {rn:04d}','',f'Awakened: {awakened}',f'Decision order: {order}','','## Applied']
        for x in applied: md.append(f"- {x['pixel']}: {x['action']['action']} — {x['action'].get('reasoning_summary','')}")
        md+=['','## Rejected']; md += [f"- {x['pixel']}: {x['reason']}" for x in rejected]
        md+=['','## Close Results']; md += [f"- {x['problem_id']}: {x['verdict']['verdict']}" for x in close_results]
        if owner_requests: md+=['','## Owner Action Required']+[f'- {x}' for x in owner_requests]
        (self.s.base/f'rounds/round_{rn:04d}.md').write_text('\n'.join(md)+'\n',encoding='utf-8'); render(str(self.s.base))
        if owner_requests: raise OwnerActionRequired(owner_requests)
        return log

    def run(self,rounds):
        out=[]
        for _ in range(rounds): out.append(self.run_one())
        return out

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('--rounds',type=int,default=1); ap.add_argument('--base',default='.'); args=ap.parse_args()
    try: RoundRunner(args.base).run(args.rounds)
    except OwnerActionRequired as e: print('OWNER_ACTION_REQUIRED:',e.request_ids)
