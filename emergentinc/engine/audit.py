"""只读工作区与主链可靠性审计工具 (V9.5 Core Reliability Audit).

Phase 6 审计核心规范:
1. Run/global limit、spent、reserved、remaining；
2. Pixel balance 和 refund deficit；
3. open reservations、unknown calls、未完成 message/effect；
4. snapshot manifest 完整性；
5. Genesis 和 pricing revision；
6. 是否允许启动 Run (allowed_to_start / block_reasons)；
7. 只读 Run 报告生成 (generate_run_report)。
"""

import json
import sqlite3
import time
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
    
    # Phase 6 扩展字段
    budget_state: Dict[str, Any] = field(default_factory=dict)
    pixel_deficits: List[Dict[str, Any]] = field(default_factory=list)
    unknown_calls: List[Dict[str, Any]] = field(default_factory=list)
    pending_messages: List[Dict[str, Any]] = field(default_factory=list)
    manifest_issues: List[Dict[str, Any]] = field(default_factory=list)
    genesis_revision: str = ""
    pricing_revision: str = ""
    allowed_to_start: bool = True
    block_reasons: List[str] = field(default_factory=list)
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
            "budget_state": self.budget_state,
            "pixel_deficits": self.pixel_deficits,
            "unknown_calls": self.unknown_calls,
            "pending_messages": self.pending_messages,
            "manifest_issues": self.manifest_issues,
            "genesis_revision": self.genesis_revision,
            "pricing_revision": self.pricing_revision,
            "allowed_to_start": self.allowed_to_start,
            "block_reasons": self.block_reasons,
            "details": self.details,
        }

    def summary_markdown(self) -> str:
        status = "RECOVERY_REQUIRED" if self.recovery_required else "HEALTHY"
        start_status = "ALLOWED" if self.allowed_to_start else "BLOCKED"
        lines = [
            f"# Workspace Audit Report: {status} (Start: {start_status})",
            f"- **Workspace**: `{self.workspace}`",
            f"- **World Round**: {self.world_round}",
            f"- **Active / Total Pixels**: {self.active_pixels_count} / {self.total_pixels_count}",
            f"- **Total Pixel Energy**: {self.total_pixel_energy}",
            f"- **Ledger Net Energy**: {self.ledger_net_energy}",
            f"- **Energy Discrepancy**: {self.energy_difference}",
            f"- **Genesis Revision**: `{self.genesis_revision or 'NONE'}`",
            f"- **Pricing Revision**: `{self.pricing_revision or 'NONE'}`",
            "",
            "## 核心状态",
            f"- 未结算预留 (Open Reservations): {len(self.unsettled_reservations)} 笔",
            f"- 未知调用 (Unknown Calls): {len(self.unknown_calls)} 笔",
            f"- 退款赤字元胞 (Deficit Pixels): {len(self.pixel_deficits)} 个",
            f"- 待处理/挂起消息: {len(self.pending_messages)} 条",
            f"- 假死 RUNNING Loop: {len(self.stale_running_loops)} 个",
            f"- 重复账本条目: {len(self.duplicate_ledger_entry_ids)} 个",
            f"- 快照 Manifest 异常: {len(self.manifest_issues)} 个",
        ]
        if self.block_reasons:
            lines.append("")
            lines.append("## 阻断启动原因")
            for r in self.block_reasons:
                lines.append(f"- ❌ {r}")
        return "\n".join(lines)


def audit_workspace(workspace_dir: Union[str, Path], run_id: Optional[str] = None) -> AuditReport:
    ws = Path(workspace_dir).resolve()
    live_dir = ws / "live"
    pixels_dir = live_dir / "pixels"
    ledger_file = ws / "ledger" / "energy_ledger.jsonl"
    world_state_file = live_dir / "world_state.json"
    loops_dir = ws / "loops" / "checkpoints"
    sqlite_db_path = ws / "ledger" / "v9_core.sqlite3"
    if not sqlite_db_path.exists() and (ws / "core_store.sqlite3").exists():
        sqlite_db_path = ws / "core_store.sqlite3"
    pricing_file = ws.parent / "resources" / "config" / "model_pricing.json"
    if not pricing_file.exists():
        pricing_file = ws / "resources" / "config" / "model_pricing.json"

    # 1. 检查世界状态
    world_round = 0
    if world_state_file.exists():
        try:
            ws_data = json.loads(world_state_file.read_text(encoding="utf-8"))
            world_round = int(ws_data.get("round", 0))
        except Exception:
            pass

    # 2. 检查 Genesis 与 Pricing revision
    genesis_revision = ""
    genesis_file = ws / "genesis_prompt.json"
    if genesis_file.exists():
        try:
            g_data = json.loads(genesis_file.read_text(encoding="utf-8"))
            genesis_revision = str(g_data.get("revision", ""))
        except Exception:
            pass

    pricing_revision = ""
    if pricing_file.exists():
        try:
            p_data = json.loads(pricing_file.read_text(encoding="utf-8"))
            pricing_revision = str(p_data.get("revision", ""))
        except Exception:
            pass

    # 3. 检查元胞完整性与状态
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

    # 4. 检查账本条目重复性与文件账本预留
    duplicate_entry_ids = []
    seen_entry_ids: Set[str] = set()
    open_reservations_file: Dict[str, Dict[str, Any]] = {}
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
                            open_reservations_file[eid] = entry
                        elif etype == "settle":
                            call_id = entry.get("details", {}).get("call_id")
                            if call_id:
                                settled_call_ids.add(call_id)
                    except Exception:
                        pass
        except Exception:
            pass

    # 5. CoreStore SQLite 深度审计
    unsettled_reservations = []
    unknown_calls = []
    pixel_deficits = []
    pending_messages = []
    budget_state: Dict[str, Any] = {}

    if sqlite_db_path.exists():
        try:
            conn = sqlite3.connect(str(sqlite_db_path))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            # (1) 未结预留
            cur.execute("SELECT * FROM reservations WHERE status = 'OPEN'")
            unsettled_reservations = [dict(r) for r in cur.fetchall()]

            # (2) 未知模型调用
            cur.execute("SELECT * FROM model_calls WHERE outcome = 'CALL_OUTCOME_UNKNOWN'")
            unknown_calls = [dict(r) for r in cur.fetchall()]

            # (3) 赤字与受阻元胞
            cur.execute("SELECT pixel_id, energy, active, refund_deficit_tokens, spend_blocked_reason FROM pixel_accounts WHERE refund_deficit_tokens > 0 OR spend_blocked_reason IS NOT NULL")
            pixel_deficits = [dict(r) for r in cur.fetchall()]

            # (4) 待处理或异常卡顿消息
            cur.execute("SELECT message_id, run_id, sender, recipient, status FROM messages WHERE status NOT IN ('COMMITTED', 'DEAD_LETTER')")
            pending_messages = [dict(r) for r in cur.fetchall()]

            # (5) 预算状态
            from emergentinc.engine.core_store import CoreStore
            cs = CoreStore(sqlite_db_path)
            budget_state = cs.get_budget_state(run_id)
            conn.close()
        except Exception as e:
            incomplete_pixels.append({"issue": f"SQLITE_AUDIT_ERROR: {e}"})
    else:
        # 回退到旧账本文件扫描结果
        unsettled_reservations = [
            res for cid, res in open_reservations_file.items() if cid not in settled_call_ids
        ]

    # 6. 检查长期卡死在 RUNNING 的 Loops
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

    # 7. 检查快照 Manifest 完整性
    manifest_issues = []
    snapshots_dir = ws / "snapshots"
    all_snap_dirs = []
    if snapshots_dir.exists():
        all_snap_dirs.extend([d for d in snapshots_dir.iterdir() if d.is_dir()])
    if loops_dir.exists():
        all_snap_dirs.extend([d for d in loops_dir.iterdir() if d.is_dir()])

    for sd in all_snap_dirs:
        man_path = sd / "snapshot_manifest.json"
        if not man_path.exists():
            manifest_issues.append({"snapshot_id": sd.name, "issue": "MISSING_MANIFEST"})
        else:
            try:
                json.loads(man_path.read_text(encoding="utf-8"))
            except Exception as e:
                manifest_issues.append({"snapshot_id": sd.name, "issue": f"CORRUPT_MANIFEST: {e}"})

    # 8. 判定是否需要恢复与是否允许启动 Run (Fail-Closed)
    energy_diff = total_pixel_energy - ledger_net_energy
    recovery_required = (
        len(unsettled_reservations) > 0
        or len(unknown_calls) > 0
        or len(duplicate_entry_ids) > 0
        or len(round_inconsistencies) > 0
        or len(stale_running_loops) > 0
        or len(incomplete_pixels) > 0
        or energy_diff != 0
    )

    block_reasons = []
    if len(unsettled_reservations) > 0:
        block_reasons.append(f"存在 {len(unsettled_reservations)} 笔未结算预算预留 (OPEN_RESERVATIONS)")
    if len(unknown_calls) > 0:
        block_reasons.append(f"存在 {len(unknown_calls)} 笔未决未知调用 (CALL_OUTCOME_UNKNOWN)")
    if len(duplicate_entry_ids) > 0:
        block_reasons.append(f"账本存在 {len(duplicate_entry_ids)} 个重复条目 ID")
    if len(stale_running_loops) > 0:
        block_reasons.append(f"存在 {len(stale_running_loops)} 个卡死的 RUNNING 快照 Loop")
    if len(incomplete_pixels) > 0:
        block_reasons.append(f"存在 {len(incomplete_pixels)} 个残缺或破损元胞")
    if budget_state.get("global_remaining_tokens", 1) <= 0:
        block_reasons.append("全局预算已耗尽 (GLOBAL_BUDGET_EXHAUSTED)")

    allowed_to_start = (len(block_reasons) == 0)

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
        budget_state=budget_state,
        pixel_deficits=pixel_deficits,
        unknown_calls=unknown_calls,
        pending_messages=pending_messages,
        manifest_issues=manifest_issues,
        genesis_revision=genesis_revision,
        pricing_revision=pricing_revision,
        allowed_to_start=allowed_to_start,
        block_reasons=block_reasons,
    )


def generate_run_report(workspace_dir: Union[str, Path], run_id: str) -> Dict[str, Any]:
    """生成并固化指定 Run 的只读审计与运行报告."""
    ws = Path(workspace_dir).resolve()
    runs_dir = ws / "runs" / run_id
    runs_dir.mkdir(parents=True, exist_ok=True)
    report_file = runs_dir / "run_report.json"

    audit_rep = audit_workspace(ws, run_id=run_id)
    sqlite_db_path = ws / "core_store.sqlite3"

    run_meta: Dict[str, Any] = {}
    calls_count = 0
    unknown_calls_count = 0
    effects_count = 0
    messages_count = 0

    if sqlite_db_path.exists():
        try:
            conn = sqlite3.connect(str(sqlite_db_path))
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()

            cur.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,))
            row = cur.fetchone()
            if row:
                run_meta = dict(row)

            cur.execute("SELECT count(*) as c FROM model_calls WHERE run_id = ?", (run_id,))
            calls_count = cur.fetchone()["c"]

            cur.execute("SELECT count(*) as c FROM model_calls WHERE run_id = ? AND outcome = 'CALL_OUTCOME_UNKNOWN'", (run_id,))
            unknown_calls_count = cur.fetchone()["c"]

            cur.execute("SELECT count(*) as c FROM messages WHERE run_id = ?", (run_id,))
            messages_count = cur.fetchone()["c"]

            cur.execute("""
                SELECT count(e.effect_id) as c 
                FROM effects e
                JOIN messages m ON e.message_id = m.message_id
                WHERE m.run_id = ?
            """, (run_id,))
            effects_count = cur.fetchone()["c"]
            conn.close()
        except Exception:
            pass

    report = {
        "run_id": run_id,
        "status": run_meta.get("status", "UNKNOWN"),
        "stop_reason": run_meta.get("stop_reason", ""),
        "rounds": run_meta.get("rounds", 0),
        "run_budget_tokens": run_meta.get("run_budget_tokens", 0),
        "global_budget_tokens": run_meta.get("global_budget_tokens", 0),
        "spent_tokens": run_meta.get("spent_tokens", 0),
        "genesis_revision": audit_rep.genesis_revision,
        "pricing_revision": audit_rep.pricing_revision,
        "calls_count": calls_count,
        "unknown_calls_count": unknown_calls_count,
        "messages_count": messages_count,
        "effects_count": effects_count,
        "audit": audit_rep.to_dict(),
        "generated_at": time.time(),
    }

    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report
