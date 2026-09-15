import shutil
import json
from pathlib import Path
from typing import Union

PathLike = Union[str, Path]

SNAPSHOT_DIRS = [
    'pixels',
    'market',
    'problems',
    'external_requests',
    'capabilities',
    'external_events',
    'external_transactions',
]

SNAPSHOT_FILES = [
    'world_state.json',
]

EXCLUDED_NAMES = {
    'private',
    'owner_private',
    '.env',
    '.git',
    'ui_state',
    'loops',
    'scripts',
    'ui',
    'config',
    'schemas',
    'templates',
    'prompts',
    'docs',
    'runtime',
    'cache',
    'scratch',
}

def create_snapshot(live_dir: PathLike, target_dir: PathLike) -> Path:
    """从 live 目录创建快照至目标 checkpoint 目录."""
    live = Path(live_dir).resolve()
    target = Path(target_dir).resolve()
    target.mkdir(parents=True, exist_ok=True)

    for f_name in SNAPSHOT_FILES:
        src = live / f_name
        if src.exists():
            shutil.copy2(src, target / f_name)

    for d_name in SNAPSHOT_DIRS:
        src = live / d_name
        dst = target / d_name
        if dst.exists():
            shutil.rmtree(dst)
        if src.exists():
            shutil.copytree(src, dst)
        else:
            dst.mkdir(parents=True, exist_ok=True)

    # 严密防卫: 确保绝不包含排除目录
    for ex in EXCLUDED_NAMES:
        if (target / ex).exists():
            shutil.rmtree(target / ex)

    return target

def restore_snapshot(snapshot_dir: PathLike, live_dir: PathLike) -> None:
    """将快照恢复至 live 目录."""
    src_dir = Path(snapshot_dir).resolve()
    live = Path(live_dir).resolve()

    if not src_dir.exists():
        raise FileNotFoundError(f"Snapshot directory not found: {snapshot_dir}")

    for f_name in SNAPSHOT_FILES:
        src = src_dir / f_name
        if src.exists():
            shutil.copy2(src, live / f_name)

    for d_name in SNAPSHOT_DIRS:
        src = src_dir / d_name
        dst = live / d_name
        if dst.exists():
            shutil.rmtree(dst)
        if src.exists():
            shutil.copytree(src, dst)
        else:
            dst.mkdir(parents=True, exist_ok=True)
