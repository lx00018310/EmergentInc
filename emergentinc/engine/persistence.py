"""快照与持久化管理 (V9 Persistence & Loop Snapshot).

核心规则:
1. Snapshot 保存: all state.json, all pixel.md, environment.md, pending messages, artifacts versions。
2. 回退保护: 真实费用账本不可回滚。回退可恢复元胞心智与空间认知，但已花费的实际费用不得重置。
3. 从旧快照分叉时，必须基于当前尚未花费的实际存量预算显式划拨，不得凭空复制历史余额。
"""

import shutil
import json
import time
from pathlib import Path
from typing import Dict, Any, List, Optional
from .utils import read_json, write_json


class SnapshotManager:
    """管理系统快照保存与安全恢复."""

    def __init__(self, workspace_dir: Path):
        self.workspace = Path(workspace_dir)
        self.live_dir = self.workspace / "live"
        self.loops_dir = self.workspace / "loops"
        self.ledger_file = self.workspace / "ledger" / "energy_ledger.jsonl"
        self.loops_dir.mkdir(parents=True, exist_ok=True)

    def create_snapshot(self, round_num: int, tag: Optional[str] = None) -> Path:
        """为当前 live 状态创建快照 (不含不可回滚账本)."""
        snap_id = f"snapshot_r{round_num:04d}_{tag}" if tag else f"snapshot_r{round_num:04d}_{int(time.time())}"
        target_dir = self.loops_dir / snap_id
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        # 1. 复制 pixels (只复制 state.json 与 pixel.md)
        src_pixels = self.live_dir / "pixels"
        dst_pixels = target_dir / "pixels"
        if src_pixels.exists():
            for p in src_pixels.iterdir():
                if p.is_dir():
                    dst_p = dst_pixels / p.name
                    dst_p.mkdir(parents=True, exist_ok=True)
                    if (p / "state.json").exists():
                        shutil.copy2(p / "state.json", dst_p / "state.json")
                    if (p / "pixel.md").exists():
                        shutil.copy2(p / "pixel.md", dst_p / "pixel.md")

        # 2. 复制 environment.md
        src_env = self.live_dir / "environment.md"
        if src_env.exists():
            shutil.copy2(src_env, target_dir / "environment.md")

        # 3. 复制 world_state.json
        src_ws = self.live_dir / "world_state.json"
        if src_ws.exists():
            shutil.copy2(src_ws, target_dir / "world_state.json")

        # 4. 记录快照元数据
        meta = {
            "snapshot_id": snap_id,
            "round": round_num,
            "created_at": time.time(),
            "tag": tag,
        }
        write_json(target_dir / "snapshot_meta.json", meta)
        return target_dir

    def restore_cognitive_state(self, snapshot_id: str):
        """恢复认知与空间状态 (保留当前实际剩余预算与不可回滚账本)."""
        snap_dir = self.loops_dir / snapshot_id
        if not snap_dir.exists():
            raise FileNotFoundError(f"Snapshot directory not found: {snap_dir}")

        # 读取快照中的状态，但需保留现存 live 中元胞的实际 energy，防止回滚撤销实际费用
        current_energies: Dict[str, int] = {}
        src_live_pixels = self.live_dir / "pixels"
        if src_live_pixels.exists():
            for p in src_live_pixels.iterdir():
                st_file = p / "state.json"
                if st_file.exists():
                    try:
                        st = read_json(st_file)
                        current_energies[p.name] = st.get("energy", 0)
                    except Exception:
                        pass

        # 恢复 pixels
        snap_pixels = snap_dir / "pixels"
        if snap_pixels.exists():
            for p in snap_pixels.iterdir():
                dst_p = src_live_pixels / p.name
                dst_p.mkdir(parents=True, exist_ok=True)
                if (p / "pixel.md").exists():
                    shutil.copy2(p / "pixel.md", dst_p / "pixel.md")
                if (p / "state.json").exists():
                    snap_st = read_json(p / "state.json")
                    # 保留实际当前能量，禁止回退凭空恢复能量
                    if p.name in current_energies:
                        snap_st["energy"] = current_energies[p.name]
                        if snap_st["energy"] <= 0:
                            snap_st["active"] = False
                    write_json(dst_p / "state.json", snap_st)

        # 恢复 environment.md
        snap_env = snap_dir / "environment.md"
        if snap_env.exists():
            shutil.copy2(snap_env, self.live_dir / "environment.md")
