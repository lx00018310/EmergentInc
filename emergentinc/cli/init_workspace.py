"""初始化新工作区 CLI (Workspace Initializer)."""

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Optional

from emergentinc.paths import ProjectPaths, get_paths


def init_workspace(
    target_workspace: Optional[str | Path] = None,
    paths: Optional[ProjectPaths] = None,
) -> Path:
    """从 resources/bootstrap 初始化一个全新工作区.

    若目标工作区已存在且非空，则直接抛出异常拒绝覆盖。
    """
    if paths is None:
        paths = get_paths(target_workspace)
    elif target_workspace is not None:
        paths = paths.with_workspace(target_workspace)

    ws_dir = paths.workspace_root
    bootstrap_dir = paths.bootstrap_dir

    if not bootstrap_dir.exists():
        raise FileNotFoundError(f"Bootstrap 模板目录不存在: {bootstrap_dir}")

    # 校验目标目录是否非空
    if ws_dir.exists():
        contents = [p for p in ws_dir.iterdir() if p.name not in {".gitkeep", ".gitignore"}]
        if contents:
            raise FileExistsError(
                f"目标工作区已存在且非空: {ws_dir} (包含 {len(contents)} 项)。初始化已中止以防覆盖数据。"
            )

    # 建立目录骨架
    for sub in [
        paths.live_root,
        paths.loops_root / "branches",
        paths.loops_root / "checkpoints",
        paths.runtime_root,
        paths.cache_root,
        paths.ui_state_root,
        paths.scratch_root,
        paths.private_root / "capabilities",
    ]:
        sub.mkdir(parents=True, exist_ok=True)

    # 复制 live 初始状态
    live_items = [
        "world_state.json",
        "world_state.md",
        "pixels",
        "problems",
        "rounds",
        "reports",
        "capabilities",
        "external_events",
        "external_requests",
        "external_transactions",
    ]
    for item in live_items:
        src = bootstrap_dir / item
        dst = paths.live_root / item
        if src.is_file():
            shutil.copy2(src, dst)
        elif src.is_dir():
            shutil.copytree(src, dst, dirs_exist_ok=True)

    # 复制 loops 初始状态
    loops_src = bootstrap_dir / "loops"
    if loops_src.exists():
        for src_f in loops_src.glob("*.json"):
            shutil.copy2(src_f, paths.loops_root / src_f.name)
        branches_src = loops_src / "branches"
        if branches_src.exists():
            for b_f in branches_src.glob("*.json"):
                shutil.copy2(b_f, paths.loops_root / "branches" / b_f.name)

    # 校验已复制的 JSON 可解析性
    test_json_paths = [
        paths.live_root / "world_state.json",
        paths.live_root / "pixels" / "0_0_0" / "state.json",
        paths.loops_root / "manifest.json",
        paths.loops_root / "branches" / "main.json",
    ]
    for jp in test_json_paths:
        if jp.exists():
            try:
                json.loads(jp.read_text(encoding="utf-8"))
            except Exception as e:
                raise ValueError(f"初始 JSON 校验失败: {jp}: {e}") from e

    print(f"[OK] 工作区初始化成功: {ws_dir}")
    return ws_dir


def main() -> int:
    parser = argparse.ArgumentParser(description="初始化 EmergentInc 工作区")
    parser.add_argument(
        "--workspace",
        type=str,
        default=None,
        help="目标工作区路径 (默认为项目根目录下的 workspace/)",
    )
    args = parser.parse_args()

    try:
        init_workspace(args.workspace)
        return 0
    except Exception as e:
        print(f"[ERROR] 初始化失败: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
