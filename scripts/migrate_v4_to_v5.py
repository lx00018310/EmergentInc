from .storage import Storage

def main(base='.'):
    s=Storage(base); s.ensure_v5_defaults(); pending=s.base/'runtime/pending_round.json'
    if pending.exists():
        legacy=s.base/'runtime/pending_round.v4_legacy.json'
        if not legacy.exists(): pending.rename(legacy)
    for pid in s.problem_ids():
        p=s.problem(pid); p.setdefault('external_requests',[]); p.setdefault('real_world_policy',None)
        text=' '.join([str(p.get('current_state','')),str(p.get('desired_state','')),' '.join(map(str,p.get('acceptance',[])))])
        if ('真实' in text or '客户' in text) and ('支付' in text or '收入' in text or '付款' in text) and not p.get('real_world_policy'):
            p['real_world_policy']={'require_external_customer':True,'min_inflow':1.0,'currency':'CNY'}
        s.save_problem(p)
    print('V4 -> V5 migration complete.'); print('Current round preserved:',s.world()['round']); print('Formal LLM runtime: api_sandbox only.')
if __name__=='__main__': main('.')
