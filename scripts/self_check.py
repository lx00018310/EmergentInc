import sys
from .storage import Storage
from .context_sandbox import ContextSandbox,ContextViolation
from .invariants import check_invariants

def run(base='.'):
    s=Storage(base); s.ensure_v5_defaults(); cfg=s.config(); source='\n'.join(p.read_text(encoding='utf-8') for p in (s.base/'scripts').glob('*.py') if p.name!='self_check.py')
    sandbox=ContextSandbox(cfg); blocked=False
    try: sandbox._assert_no_forbidden_keys({'world_state':{'x':1}})
    except ContextViolation: blocked=True
    checks=[('V5 config',cfg.get('version')=='5.0.0'),('runtime api_sandbox',cfg.get('runtime',{}).get('mode')=='api_sandbox'),('agent runtime disabled',cfg.get('runtime',{}).get('allow_agent_runtime') is False),('no AgentResponseRequired runtime','AgentResponseRequired' not in source),('no random_action','random_action' not in source),('no evidence_progress','evidence_progress' not in source),('sandbox blocks global key',blocked),('owner_private gitignored','owner_private/' in (s.base/'.gitignore').read_text(encoding='utf-8')),('runtime invariants',not check_invariants(s))]
    ok=all(v for _,v in checks)
    for n,v in checks: print(('[PASS] ' if v else '[FAIL] ')+n)
    print('RESULT:','PASS' if ok else 'EXPERIMENT_INVALID'); return ok
if __name__=='__main__': sys.exit(0 if run('.') else 1)
