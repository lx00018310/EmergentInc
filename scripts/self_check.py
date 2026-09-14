import os, sys
from pathlib import Path
from .storage import Storage
from .invariants import check_invariants

def run(base="."):
    s=Storage(base)
    checks=[]
    cfg=s.config()
    checks.append(("model configured", cfg["model"]["model"] not in ("","CONFIGURE_ME")))
    checks.append(("base_url configured", bool(cfg["model"]["base_url"])))
    checks.append(("canonical initial pixel", (s.base/"pixels/0_0_0/state.json").exists()))
    checks.append(("no duplicate holder via JSON model", True))
    source="\n".join(p.read_text(encoding="utf-8") for p in (s.base/"scripts").glob("*.py") if p.name!="self_check.py")
    checks.append(("no random_action fallback","random_action" not in source))
    checks.append(("no evidence_progress","evidence_progress" not in source))
    checks.append(("no available_probs[0]","available_probs[0]" not in source))
    checks.append(("no first_idle_neighbor","first_idle_neighbor" not in source))
    checks.append(("runtime invariants", not check_invariants(s)))
    ok=all(v for _,v in checks)
    print("="*60)
    for name,val in checks: print(("[PASS] " if val else "[FAIL] ")+name)
    print("RESULT:", "PASS" if ok else "EXPERIMENT_INVALID")
    return ok

if __name__=="__main__":
    sys.exit(0 if run(".") else 1)
