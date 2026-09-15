import shutil
import json
from pathlib import Path

SNAPSHOT_DIRS = [
    'pixels',
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
}

def create_snapshot(base_dir: str | Path, target_dir: str | Path) -> Path:
    base = Path(base_dir)
    target = Path(target_dir)
    target.mkdir(parents=True, exist_ok=True)

    for f_name in SNAPSHOT_FILES:
        src = base / f_name
        if src.exists():
            shutil.copy2(src, target / f_name)

    for d_name in SNAPSHOT_DIRS:
        src = base / d_name
        dst = target / d_name
        if dst.exists():
            shutil.rmtree(dst)
        if src.exists():
            shutil.copytree(src, dst)
        else:
            dst.mkdir(parents=True, exist_ok=True)

    return target

def restore_snapshot(snapshot_dir: str | Path, base_dir: str | Path) -> None:
    src_dir = Path(snapshot_dir)
    base = Path(base_dir)

    if not src_dir.exists():
        raise FileNotFoundError(f"Snapshot directory not found: {snapshot_dir}")

    for f_name in SNAPSHOT_FILES:
        src = src_dir / f_name
        if src.exists():
            shutil.copy2(src, base / f_name)

    for d_name in SNAPSHOT_DIRS:
        src = src_dir / d_name
        dst = base / d_name
        if dst.exists():
            shutil.rmtree(dst)
        if src.exists():
            shutil.copytree(src, dst)
        else:
            dst.mkdir(parents=True, exist_ok=True)
