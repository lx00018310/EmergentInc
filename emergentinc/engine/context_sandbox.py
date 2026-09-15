import copy, json
from .utils import sha256_text

class ContextViolation(RuntimeError):
    pass

class ContextSandbox:
    def __init__(self, config):
        self.cfg=config['sandbox']
        self.max_chars=int(self.cfg.get('max_string_chars',5000))
        self.max_evidence=int(self.cfg.get('max_evidence_items_per_problem',8))
        self.forbidden=[x.lower() for x in self.cfg.get('forbidden_key_fragments',[])]
        self.external_label=self.cfg.get('external_content_label','UNTRUSTED_EXTERNAL_DATA')

    def _truncate(self,v):
        if isinstance(v,str):
            return v if len(v)<=self.max_chars else v[:self.max_chars]+'\n[TRUNCATED]'
        if isinstance(v,list): return [self._truncate(x) for x in v]
        if isinstance(v,dict): return {k:self._truncate(x) for k,x in v.items()}
        return v

    def _assert_no_forbidden_keys(self,obj,path='root'):
        if isinstance(obj,dict):
            for k,v in obj.items():
                kl=str(k).lower()
                if any(fragment in kl for fragment in self.forbidden):
                    raise ContextViolation(f'forbidden context key at {path}.{k}')
                self._assert_no_forbidden_keys(v,f'{path}.{k}')
        elif isinstance(obj,list):
            for i,v in enumerate(obj): self._assert_no_forbidden_keys(v,f'{path}[{i}]')

    def _sanitize_evidence(self,evidence):
        out=[]
        for e in list(evidence or [])[-self.max_evidence:]:
            x=copy.deepcopy(e)
            if x.get('source') in ('TOOL_VERIFIED','HUMAN_VERIFIED','ENVIRONMENT_VERIFIED'):
                x['trust_boundary']=self.external_label
            out.append(self._truncate(x))
        return out

    def _sanitize_problem(self,p):
        if not p: return None
        return self._truncate({
          'id':p.get('id'),'status':p.get('status'),'creator':p.get('creator'),
          'current_holder':p.get('current_holder'),'parent_problem':p.get('parent_problem'),
          'current_state':p.get('current_state'),'desired_state':p.get('desired_state'),
          'acceptance':p.get('acceptance',[]),'reward_offer':p.get('reward_offer'),
          'route':p.get('route',[]),'contracts':p.get('contracts',[]),
          'offers':p.get('offers',[]),'bids':p.get('bids',[]),
          'evidence':self._sanitize_evidence(p.get('evidence',[])),
          'evidence_policy':p.get('evidence_policy',{}),'real_world_policy':p.get('real_world_policy')
        })

    def _mark_external(self,items):
        out=[]
        for item in items or []:
            if isinstance(item,dict):
                x=self._truncate(copy.deepcopy(item)); x['trust_boundary']=self.external_label; out.append(x)
            else:
                out.append({'trust_boundary':self.external_label,'content':self._truncate(item)})
        return out

    def pixel_payload(self,local_view):
        st=local_view['self']['state']
        safe_state={k:st.get(k) for k in [
          'active','position','resource','current_problem','grace_remaining','parent','born_round',
          'waiting_external_request','waiting_for','sleep_until_round','capability_ids'
        ]}
        visible=[]
        for vp in local_view.get('visible_problems',[]):
            visible.append({'reason':vp.get('reason'),'problem':self._sanitize_problem(vp.get('problem'))})
        ext=local_view.get('external',{})
        payload={
          'round':local_view.get('round'),
          'self':{'pixel_id':local_view['self']['pixel_id'],'state':safe_state,
                  'genome':self._truncate(local_view['self'].get('genome',{})),
                  'memory':self._truncate(local_view['self'].get('memory',{}))},
          'neighbors':self._truncate(local_view.get('neighbors',[])),
          'visible_problems':visible,
          'visible_bids':self._truncate(local_view.get('visible_bids',[])),
          'environment_events':self._mark_external(local_view.get('environment_events',[])),
          'external':{'capabilities':self._truncate(ext.get('capabilities',[])),
                      'pending_requests':self._truncate(ext.get('pending_requests',[])),
                      'events':self._mark_external(ext.get('events',[]))},
          'allowed_actions':local_view.get('allowed_actions',[])
        }
        self._assert_no_forbidden_keys(payload)
        return payload

    def evidence_payload(self,problem,eligible):
        payload={'problem':{'id':problem.get('id'),'current_state':self._truncate(problem.get('current_state')),
                            'desired_state':self._truncate(problem.get('desired_state')),
                            'acceptance':self._truncate(problem.get('acceptance',[])),
                            'evidence_policy':self._truncate(problem.get('evidence_policy',{})),
                            'real_world_policy':self._truncate(problem.get('real_world_policy'))},
                 'eligible_evidence':self._sanitize_evidence(eligible)}
        self._assert_no_forbidden_keys(payload); return payload

    def memory_payload(self,old_memory,event):
        payload={'old_memory':self._truncate(old_memory),'significant_event':self._truncate(event)}
        self._assert_no_forbidden_keys(payload); return payload

    @staticmethod
    def audit(payload):
        raw=json.dumps(payload,ensure_ascii=False,sort_keys=True)
        return {'sandbox_hash':sha256_text(raw),'sandbox_top_keys':sorted(payload.keys()),'sandbox_chars':len(raw)}
