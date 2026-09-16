import argparse
from emergentinc.engine.storage import Storage


def main(base=None):
    s = Storage(base)
    w = s.world()
    print("Round:", w["round"])
    print("Active pixels:", len(s.pixel_ids(active_only=True)))
    print("Problems:", len(s.problem_ids()))
    print("Closed:", sum(1 for p in s.problem_ids() if s.problem(p)["status"] == "CLOSED"))
    try:
        from emergentinc.engine.audit import audit_workspace
        ws_path = s.paths.workspace_root
        rep = audit_workspace(ws_path)
        print("\n--- V9 Core Reliability Audit ---")
        print(rep.summary_markdown())
    except Exception as e:
        print("V9 audit warning:", e)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", default=None, help="工作区路径")
    args = ap.parse_args()
    main(args.workspace)
