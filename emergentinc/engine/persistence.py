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
from .utils import read_json, write_json, sha256_text


class SnapshotManager:
    """管理系统快照保存与安全恢复 (V9 Safe Persistence)."""

    def __init__(self, workspace_dir: Path):
        self.workspace = Path(workspace_dir)
        self.live_dir = self.workspace / "live"
        self.loops_dir = self.workspace / "loops"
        self.ledger_file = self.workspace / "ledger" / "energy_ledger.jsonl"
        self.loops_dir.mkdir(parents=True, exist_ok=True)

    def create_snapshot(self, round_num: int, tag: Optional[str] = None, branch_name: str = "main") -> Path:
        """为当前 live 状态创建快照，写入精细的 snapshot_manifest.json."""
        snap_id = f"snapshot_r{round_num:04d}_{tag}" if tag else f"snapshot_r{round_num:04d}_{int(time.time())}"
        target_dir = self.loops_dir / snap_id
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        pixel_ids = []
        pixel_hashes = {}

        # 1. 复制 pixels (只复制 state.json 与 pixel.md)
        src_pixels = self.live_dir / "pixels"
        dst_pixels = target_dir / "pixels"
        if src_pixels.exists():
            for p in sorted(src_pixels.iterdir()):
                if p.is_dir():
                    pid = p.name
                    pixel_ids.append(pid)
                    dst_p = dst_pixels / pid
                    dst_p.mkdir(parents=True, exist_ok=True)
                    p_hashes = {}
                    if (p / "state.json").exists():
                        st_content = (p / "state.json").read_text(encoding="utf-8")
                        (dst_p / "state.json").write_text(st_content, encoding="utf-8")
                        p_hashes["state.json"] = sha256_text(st_content)
                    if (p / "pixel.md").exists():
                        pm_content = (p / "pixel.md").read_text(encoding="utf-8")
                        (dst_p / "pixel.md").write_text(pm_content, encoding="utf-8")
                        p_hashes["pixel.md"] = sha256_text(pm_content)
                    pixel_hashes[pid] = p_hashes

        # 2. 复制 environment.md
        src_env = self.live_dir / "environment.md"
        env_hash = None
        if src_env.exists():
            env_content = src_env.read_text(encoding="utf-8")
            (target_dir / "environment.md").write_text(env_content, encoding="utf-8")
            env_hash = sha256_text(env_content)

        # 3. 复制 world_state.json
        src_ws = self.live_dir / "world_state.json"
        ws_hash = None
        if src_ws.exists():
            ws_content = src_ws.read_text(encoding="utf-8")
            (target_dir / "world_state.json").write_text(ws_content, encoding="utf-8")
            ws_hash = sha256_text(ws_content)

        # 4. 记录快照元数据与 Manifest (R-08 / T1)
        now = time.time()
        manifest = {
            "snapshot_id": snap_id,
            "branch_id": branch_name,
            "round": round_num,
            "pixel_ids": pixel_ids,
            "pixel_hashes": pixel_hashes,
            "environment_hash": env_hash,
            "world_state_hash": ws_hash,
            "created_at": now,
            "tag": tag,
        }
        write_json(target_dir / "snapshot_manifest.json", manifest)
        write_json(target_dir / "snapshot_meta.json", manifest)
        return target_dir

    @staticmethod
    def safe_restore_snapshot(snapshot_dir: Path, live_dir: Path) -> None:
        """核心安全恢复逻辑: 精确恢复 Pixel 集合，未来元胞归档，能量绝不回滚."""
        src_dir = Path(snapshot_dir).resolve()
        live = Path(live_dir).resolve()
        if not src_dir.exists():
            raise FileNotFoundError(f"Snapshot directory not found: {snapshot_dir}")

        src_live_pixels = live / "pixels"
        src_live_pixels.mkdir(parents=True, exist_ok=True)

        current_energies: Dict[str, int] = {}
        current_actives: Dict[str, bool] = {}
        current_pixel_ids = set()

        if src_live_pixels.exists():
            for p in src_live_pixels.iterdir():
                if p.is_dir():
                    current_pixel_ids.add(p.name)
                    st_file = p / "state.json"
                    if st_file.exists():
                        try:
                            st = read_json(st_file)
                            energy_val = st.get("energy", st.get("resource", 0))
                            current_energies[p.name] = int(energy_val)
                            current_actives[p.name] = bool(st.get("active", False))
                        except Exception:
                            pass

        total_energy_before = sum(current_energies.values())

        # 1. 精确对账元胞集合 (R-08 / T1): 快照中不存在的未来元胞移出并归档
        snap_pixels = src_dir / "pixels"
        snap_pixel_ids = set()
        if snap_pixels.exists():
            snap_pixel_ids = {p.name for p in snap_pixels.iterdir() if p.is_dir()}

        future_pixels = current_pixel_ids - snap_pixel_ids
        if future_pixels:
            archived_dir = live / "archived_future_pixels"
            archived_dir.mkdir(parents=True, exist_ok=True)
            for pid in future_pixels:
                p_dir = src_live_pixels / pid
                dst_arch = archived_dir / pid
                if dst_arch.exists():
                    shutil.rmtree(dst_arch)
                shutil.move(str(p_dir), str(dst_arch))

        # 2. 恢复 world_state.json (如果存在)
        src_ws = src_dir / "world_state.json"
        if src_ws.exists():
            shutil.copy2(src_ws, live / "world_state.json")

        # 3. 恢复 environment.md (如果存在)
        src_env = src_dir / "environment.md"
        if src_env.exists():
            shutil.copy2(src_env, live / "environment.md")

        # 4. 安全恢复 pixels
        if snap_pixels.exists():
            for p in snap_pixels.iterdir():
                if not p.is_dir():
                    continue
                dst_p = src_live_pixels / p.name
                dst_p.mkdir(parents=True, exist_ok=True)

                # 认知与工作区内容完整从快照恢复
                for item in p.iterdir():
                    if item.name == "state.json":
                        continue
                    dst_item = dst_p / item.name
                    if item.is_dir():
                        if dst_item.exists():
                            shutil.rmtree(dst_item)
                        shutil.copytree(item, dst_item)
                    else:
                        shutil.copy2(item, dst_item)

                if (p / "state.json").exists():
                    snap_st = read_json(p / "state.json")
                    if "energy" in snap_st:
                        if p.name in current_energies:
                            # 保持当前存量能量，已消耗的预算绝不可回滚恢复
                            cur_e = current_energies[p.name]
                            snap_st["energy"] = cur_e
                            snap_st["active"] = bool(cur_e > 0 and current_actives.get(p.name, False))
                        else:
                            # 快照中存在但当前 live 不存在的元胞，不得携带历史余额复活
                            snap_st["energy"] = 0
                            snap_st["active"] = False

                    write_json(dst_p / "state.json", snap_st)

        # 5. 验证能量不变量: total_energy_after <= total_energy_before
        total_energy_after = 0
        if src_live_pixels.exists():
            for p in src_live_pixels.iterdir():
                st_file = p / "state.json"
                if st_file.exists():
                    try:
                        st = read_json(st_file)
                        total_energy_after += int(st.get("energy", 0))
                    except Exception:
                        pass

        if total_energy_after > total_energy_before:
            raise RuntimeError(
                f"ENERGY_CONSERVATION_VIOLATION: Snapshot restore increased total energy from {total_energy_before} to {total_energy_after}"
            )

    def restore_cognitive_state(self, snapshot_id: str):
        """按快照 ID 恢复认知状态."""
        snap_dir = self.loops_dir / snapshot_id
        if not snap_dir.exists():
            raise FileNotFoundError(f"Snapshot directory not found: {snap_dir}")
        self.safe_restore_snapshot(snap_dir, self.live_dir)
