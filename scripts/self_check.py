import sys
from .storage import Storage
from .invariants import check_invariants

def run(base="."):
    s=Storage(base)
    s.ensure_v4_defaults()
    cfg=s.config()
    source="\n".join(
      p.read_text(encoding="utf-8")
      for p in (s.base/"scripts").glob("*.py")
      if p.name!="self_check.py"
    )
    checks=[
      ("v4 config",cfg.get("version")=="4.0.0"),
      ("runtime mode valid",cfg.get("runtime",{}).get("mode") in ("api","agent_queue")),
      ("no random_action","random_action" not in source),
      ("no evidence_progress","evidence_progress" not in source),
      ("owner_private gitignored","owner_private/" in (s.base/".gitignore").read_text(encoding="utf-8")),
      ("external accounting exists","external_accounting" in s.world()),
      ("runtime invariants",not check_invariants(s))
    ]
    ok=all(v for _,v in checks)
    for n,v in checks:
        print(("[PASS] " if v else "[FAIL] ")+n)
    print("RESULT:","PASS" if ok else "EXPERIMENT_INVALID")
    return ok

if __name__=="__main__":
    sys.exit(0 if run(".") else 1)
