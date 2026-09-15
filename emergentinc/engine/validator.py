from .utils import neighbors6
class RuleValidator:
    def __init__(self,storage): self.s=storage; self.cfg=self.s.config()['resource']; self.ext=self.s.config()['external']
    def action_cost(self,action):
        key={'WORK':'work_cost','CREATE_PROBLEM':'create_problem_cost','OFFER':'offer_cost','BID':'bid_cost','ACCEPT_BID':'accept_bid_cost','ACCEPT':'accept_cost','REJECT':'reject_cost','TRANSFER':'transfer_cost','SPAWN':'spawn_cost','REQUEST_CLOSE':'request_close_cost','ABANDON':'abandon_cost','REQUEST_CAPABILITY':'request_capability_cost','USE_CAPABILITY':'use_capability_cost','WAIT_EXTERNAL':'wait_external_cost','IDLE':None}.get(action)
        return 0.0 if key is None else float(self.cfg.get(key,0))
    def validate(self,pixel_id,a,local_view):
        st=self.s.pixel_state(pixel_id); act=a.get('action'); cur=st.get('current_problem')
        if not st.get('active'): return False,'inactive'
        if act not in local_view['allowed_actions']: return False,'action not allowed'
        if float(st['resource'])<self.action_cost(act): return False,'insufficient resource'
        target=a.get('target_pixel')
        if target and target not in neighbors6(pixel_id): return False,'target not neighbor'
        if act=='WORK':
            pid=a.get('problem_id') or cur
            if not pid or pid!=cur: return False,'WORK must target held problem'
            if not isinstance(a.get('work_output'),dict) or not a['work_output']: return False,'WORK requires work_output'
        if act in ('OFFER','TRANSFER','REQUEST_CLOSE','ABANDON','REQUEST_CAPABILITY','USE_CAPABILITY','WAIT_EXTERNAL'):
            pid=a.get('problem_id') or cur
            if not pid or pid!=cur: return False,f'{act} requires held problem'
        if act=='ACCEPT' and cur: return False,'already holds problem'
        if act=='BID' and cur: return False,'busy pixel cannot bid'
        if act=='REQUEST_CAPABILITY':
            req=a.get('capability_request')
            if not isinstance(req,dict): return False,'missing capability_request'
            if st.get('waiting_external_request'): return False,'already has pending external request'
            text=(str(req.get('capability_type',''))+' '+str(req.get('purpose',''))).lower()
            bad=['owner_as_customer','owner_payment','老板付款','老板购买','老板帮我找客户','老板选择渠道','business_decision']
            if any(x.lower() in text for x in bad): return False,'owner cannot be customer/manager/marketing decision maker'
        if act=='USE_CAPABILITY':
            use=a.get('capability_use')
            if not isinstance(use,dict): return False,'missing capability_use'
            cid=use.get('capability_id'); available={c['id']:c for c in local_view.get('external',{}).get('capabilities',[])}
            if cid not in available: return False,'capability not visible/owned'
            if use.get('operation') not in available[cid].get('allowed_operations',[]): return False,'operation not permitted'
        if act=='WAIT_EXTERNAL':
            w=a.get('wait_external')
            if not isinstance(w,dict): return False,'missing wait_external'
            m=int(w.get('max_sleep_rounds',0)); mx=int(self.ext.get('wait_external_max_rounds',20))
            if m<1 or m>mx: return False,'invalid max_sleep_rounds'
        if act=='SPAWN':
            sp=a.get('spawn_proposal')
            if not sp: return False,'missing spawn_proposal'
            tgt=sp.get('target_pixel')
            if tgt not in neighbors6(pixel_id): return False,'spawn target not neighbor'
            if tgt in self.s.pixel_ids(): return False,'spawn target occupied'
            if float(st['resource'])<self.action_cost('SPAWN')+float(self.cfg['default_birth_grant']): return False,'insufficient spawn resource'
            if not isinstance(sp.get('mutation'),dict) or len(sp['mutation'])!=1: return False,'mutation must change exactly one field'
        if act=='CREATE_PROBLEM':
            np=a.get('new_problem')
            if not isinstance(np,dict): return False,'missing new_problem'
            for k in ('current_state','desired_state','acceptance','reward_offer'):
                if k not in np: return False,f'new_problem missing {k}'
            if float(np['reward_offer'])<=0: return False,'child reward must be >0'
            if float(st['resource'])<self.action_cost(act)+float(np['reward_offer']): return False,'insufficient resource for child escrow'
        return True,'VALID'
