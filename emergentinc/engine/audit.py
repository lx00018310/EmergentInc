"""只读工作区审计工具 (V9 Workspace Read-Only Audit).

审计核心项:
1. 未结算预算预留 (open reservations)
2. 账本条目 ID 重复 (duplicate ledger entry IDs)
3. 世界 Round 与元胞 last_active_round 乱序
4. 长期停留在 RUNNING 状态的 Loop (stale running loops)
5. 残缺元胞 (state-only 或 pixel.md-only)
6. 当前元胞总能量与不可回滚账本净额差异
"""

import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Set, Union


@dataclass
class AuditReport:
    workspace: str
    world_round: int
    total_pixels_count: int
    active_pixels_count: int
    total_pixel_energy: int
    ledger_net_energy: int
    energy_difference: int
    duplicate_ledger_entry_ids: List[str] = field(default_factory=list)
    unsettled_reservations: List[Dict[str, Any]] = field(default_factory=list)
    round_inconsistencies: List[Dict[str, Any]] = field(default_factory=list)
    stale_running_loops: List[Dict[str, Any]] = field(default_factory=list)
    incomplete_pixels: List[Dict[str, Any]] = field(default_factory=list)
    recovery_required: bool = False
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workspace": self.workspace,
            "world_round": self.world_round,
            "total_pixels_count": self.total_pixels_count,
            "active_pixels_count": self.active_pixels_count,
            "total_pixel_energy": self.total_pixel_energy,
            "ledger_net_energy": self.ledger_net_energy,
            "energy_difference": self.energy_difference,
            "duplicate_ledger_entry_ids": self.duplicate_ledger_entry_ids,
            "unsettled_reservations": self.unsettled_reservations,
            "round_inconsistencies": self.round_inconsistencies,
            "stale_running_loops": self.stale_running_loops,
            "incomplete_pixels": self.incomplete_pixels,
            "recovery_required": self.recovery_required,
            "details": self.details,
        }

    def summary_markdown(self) -> str:
        status = "RECOVERY_REQUIRED" if self.recovery_required else "HEALTHY"
        lines = [
            f"# Workspace Audit Report: {status}",
            f"- **Workspace**: `{self.workspace}`",
            f"- **World Round**: {self.world_round}",
            f"- **Active / Total Pixels**: {self.active_pixels_count} / {self.total_pixels_count}",
            f"- **Total Pixel Energy**: {self.total_pixel_energy}",
            f"- **Ledger Net Energy**: {self.ledger_net_energy}",
            f"- **Energy Discrepancy**: {self.energy_difference}",
            "",
            "## 异常清单",
            f"- 重复账本条目: {len(self.duplicate_ledger_entry_ids)} 个",
            f"- 未结算预留 (Open Reservations): {len(self.unsettled_reservations)} 笔",
            f"- 回合超前异常: {len(self.round_inconsistencies)} 个",
            f"- 假死 RUNNING Loop: {len(self.stale_running_loops)} 个",
            f"- 残缺 Pixel: {len(self.incomplete_pixels)} 个",
        ]
        return "\n".join(lines)


def audit_workspace(workspace_dir: Union[str, Path]) -> AuditReport:
    ws = Path(workspace_dir).resolve()
    live_dir = ws / "live"
    pixels_dir = live_dir / "pixels"
    ledger_file = ws / "ledger" / "energy_ledger.jsonl"
    world_state_file = live_dir / "world_state.json"
    loops_dir = ws / "loops" / "checkpoints"

    # 1. 检查世界状态
    world_round = 0
    if world_state_file.exists():
        try:
            ws_data = json.loads(world_state_file.read_text(encoding="utf-8"))
            world_round = int(ws_data.get("round", 0))
        except Exception:
            pass

    # 2. 检查元胞完整性与状态
    total_pixel_energy = 0
    total_pixels = 0
    active_pixels = 0
    incomplete_pixels = []
    round_inconsistencies = []

    if pixels_dir.exists():
        for p in sorted(pixels_dir.iterdir()):
            if not p.is_dir():
                continue
            total_pixels += 1
            has_state = (p / "state.json").exists()
            has_pixel_md = (p / "pixel.md").exists()

            if has_state and not has_pixel_md:
                incomplete_pixels.append({"pixel_id": p.name, "issue": "MISSING_PIXEL_MD"})
            elif has_pixel_md and not has_state:
                incomplete_pixels.append({"pixel_id": p.name, "issue": "MISSING_STATE_JSON"})

            if has_state:
                try:
                    st = json.loads((p / "state.json").read_text(encoding="utf-8"))
                    energy = int(st.get("energy", 0))
                    is_active = bool(st.get("active", False))
                    last_active = int(st.get("last_active_round", 0))
                    total_pixel_energy += energy
                    if is_active:
                        active_pixels += 1
                    if last_active > world_round:
                        round_inconsistencies.append({
                            "pixel_id": p.name,
                            "last_active_round": last_active,
                            "world_round": world_round,
                        })
                except Exception as e:
                    incomplete_pixels.append({"pixel_id": p.name, "issue": f"CORRUPT_STATE_JSON: {e}"})

    # 3. 检查账本条目重复性与未结算预留
    duplicate_entry_ids = []
    seen_entry_ids: Set[str] = set()
    open_reservations: Dict[str, Dict[str, Any]] = {}
    settled_call_ids: Set[str] = set()
    ledger_net_energy = 0

    if ledger_file.exists():
        try:
            with ledger_file.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        eid = entry.get("entry_id", "")
                        if eid in seen_entry_ids:
                            duplicate_entry_ids.append(eid)
                        seen_entry_ids.add(eid)

                        etype = entry.get("entry_type", "")
                        amt = int(entry.get("amount", 0))
                        ledger_net_energy += amt

                        if etype == "reserve":
                            open_reservations[eid] = entry
                        elif etype == "settle":
                            call_id = entry.get("details", {}).get("call_id")
                            if call_id:
                                settled_call_ids.add(call_id)
                    except Exception:
                        pass
        except Exception:
            pass

    # 过滤出未结算的 reservations
    unsettled_reservations = [
        res for cid, res in open_reservations.items() if cid not in settled_call_ids
    ]

    # 4. 检查长期卡死在 RUNNING 的 Loops
    stale_running_loops = []
    if loops_dir.exists():
        for d in sorted(loops_dir.iterdir()):
            meta_file = d / "meta.json"
            if d.is_dir() and meta_file.exists():
                try:
                    meta = json.loads(meta_file.read_text(encoding="utf-8"))
                    if meta.get("status") == "RUNNING":
                        stale_running_loops.append({
                            "loop_id": meta.get("id", d.name),
                            "command": meta.get("command"),
                            "start_round": meta.get("start_round"),
                            "created_at": meta.get("created_at"),
                        })
                except Exception:
                    pass

    energy_diff = total_pixel_energy - ledger_net_energy
    recovery_required = (
        len(unsettled_reservations) > 0
        or len(duplicate_entry_ids) > 0
        or len(round_inconsistencies) > 0
        or len(stale_running_loops) > 0
        or len(incomplete_pixels) > 0
        or energy_diff != 0
    )

    return AuditReport(
        workspace=str(ws),
        world_round=world_round,
        total_pixels_count=total_pixels,
        active_pixels_count=active_pixels,
        total_pixel_energy=total_pixel_energy,
        ledger_net_energy=ledger_net_energy,
        energy_difference=energy_diff,
        duplicate_ledger_entry_ids=duplicate_entry_ids,
        unsettled_reservations=unsettled_reservations,
        round_inconsistencies=round_inconsistencies,
        stale_running_loops=stale_running_loops,
        incomplete_pixels=incomplete_pixels,
        recovery_required=recovery_required,
    )
