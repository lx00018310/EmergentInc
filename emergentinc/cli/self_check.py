import argparse
import sys
from emergentinc.engine.storage import Storage
from emergentinc.engine.context_sandbox import ContextSandbox, ContextViolation
from emergentinc.engine.invariants import check_invariants


def run(base=None):
    s = Storage(base)
    s.ensure_v5_defaults()
    cfg = s.config()
    engine_dir = s.paths.project_root / "emergentinc" / "engine"
    source = "\n".join(
        p.read_text(encoding="utf-8")
        for p in engine_dir.glob("*.py")
    )
    sandbox = ContextSandbox(cfg)
    blocked = False
    try:
        sandbox._assert_no_forbidden_keys({"world_state": {"x": 1}})
    except ContextViolation:
        blocked = True

    gitignore_text = (s.paths.project_root / ".gitignore").read_text(encoding="utf-8")
    checks = [
        ("V5 config", cfg.get("version") == "5.0.0"),
        ("runtime api_sandbox", cfg.get("runtime", {}).get("mode") == "api_sandbox"),
        ("agent runtime disabled", cfg.get("runtime", {}).get("allow_agent_runtime") is False),
        ("no AgentResponseRequired runtime", "AgentResponseRequired" not in source),
        ("no random_action", "random_action" not in source),
        ("no evidence_progress", "evidence_progress" not in source),
        ("sandbox blocks global key", blocked),
        ("workspace gitignored", "workspace/" in gitignore_text),
        ("owner_private gitignored", "owner_private/" in gitignore_text or "workspace/" in gitignore_text),
        ("runtime invariants", not check_invariants(s)),
    ]
    ok = all(v for _, v in checks)
    for n, v in checks:
        print(("[PASS] " if v else "[FAIL] ") + n)
    print("RESULT:", "PASS" if ok else "EXPERIMENT_INVALID")
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", default=None, help="工作区路径")
    args = ap.parse_args()
    sys.exit(0 if run(args.workspace) else 1)
