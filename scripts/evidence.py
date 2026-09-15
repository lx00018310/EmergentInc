class EvidenceService:
    def __init__(self,storage,llm): self.s=storage; self.llm=llm
    def add_model_artifact(self,problem_id,pixel_id,round_num,work_output):
        p=self.s.problem(problem_id); p['evidence'].append({'source':'MODEL_ARTIFACT','producer':pixel_id,'round':round_num,'content':work_output}); self.s.save_problem(p)
    def add_tool_verified(self,problem_id,pixel_id,round_num,content):
        p=self.s.problem(problem_id); p['evidence'].append({'source':'TOOL_VERIFIED','producer':pixel_id,'round':round_num,'content':content}); self.s.save_problem(p)
    def _real_world_gate(self,p,eligible):
        policy=p.get('real_world_policy') or {}
        if not policy.get('require_external_customer'): return None
        min_inflow=float(policy.get('min_inflow',0)); currency=str(policy.get('currency','CNY')).upper()
        for e in eligible:
            c=e.get('content') or {}
            if e.get('source')=='HUMAN_VERIFIED' and c.get('direction')=='INFLOW' and str(c.get('currency','')).upper()==currency and float(c.get('amount',0))>=min_inflow and c.get('payer_role')=='EXTERNAL_CUSTOMER': return None
        return {'verdict':'INSUFFICIENT','matched_acceptance':[],'missing_acceptance':[f'需要真实外部客户付款 >= {min_inflow} {currency}'],'reason':'real_world_policy gate failed: OWNER/TEST/self-payment cannot satisfy external-customer requirement'}
    def request_close(self,problem_id,round_num):
        p=self.s.problem(problem_id); policy=p.get('evidence_policy',{}); allowed=set(policy.get('allowed_sources',[])); min_items=int(policy.get('min_items',1)); eligible=[e for e in p.get('evidence',[]) if e.get('source') in allowed]
        if len(eligible)<min_items: return {'verdict':'INSUFFICIENT','matched_acceptance':[],'missing_acceptance':p['acceptance'],'reason':'evidence source gate not satisfied'},None
        hard=self._real_world_gate(p,eligible)
        if hard: return hard,None
        return self.llm.validate_evidence_semantics(p,eligible,round_num)
