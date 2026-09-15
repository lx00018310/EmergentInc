"""CLI 迁移脚本: 将当前工作区迁移为 V9 规范."""

import argparse
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.migration import V9Migrator


def main():
    parser = argparse.ArgumentParser(description="Migrate workspace to V9 specifications")
    parser.add_argument("--workspace", type=str, default=None, help="Path to workspace directory")
    args = parser.parse_args()

    paths = get_paths(args.workspace)
    migrator = V9Migrator(paths.workspace_root)
    report = migrator.migrate()

    print("=== V9 Migration Finished ===")
    print(f"Migrated Pixels: {len(report['migrated_pixels'])}")
    for p in report["migrated_pixels"]:
        print(f"  - {p}")
    print(f"Archived Workspaces: {len(report['archived_workspaces'])}")
    for a in report["archived_workspaces"]:
        print(f"  - {a}")
    print(f"Environment Initialized: {report['environment_created']}")


if __name__ == "__main__":
    main()
