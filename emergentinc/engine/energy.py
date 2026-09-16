"""能量与计算预算管理系统 (V9.5 委托 CoreStore 事务实现).

核心规则:
1. 底层事实源全部委托 workspace/ledger/v9_core.sqlite3。
2. 彻底废除多 JSON + JSONL 伪事务模式，所有扣款、转账、繁殖、充值与退款均为数据库 BEGIN IMMEDIATE 原子提交。
3. 对 state.json 仅做只读投影同步，数据库永远是唯一权威。
4. 兼容保留 CreditResult 与既有 EnergyManager 接口契约。
"""

import time
import uuid
import json
import threading
import shutil
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Tuple, Union
from .utils import write_json, read_json
from .pixel import PixelStorage, PixelState, validate_pixel_md
from .core_store import CoreStore, CoreStoreError


@dataclass
class LedgerEntry:
    entry_id: str
    timestamp: float
    pixel_id: str
    entry_type: str
    amount: int
    balance_after: int
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entry_id": self.entry_id,
            "timestamp": self.timestamp,
            "pixel_id": self.pixel_id,
            "entry_type": self.entry_type,
            "amount": self.amount,
            "balance_after": self.balance_after,
            "details": self.details,
        }


class CreditResult(tuple):
    """同时支持以元组解包 (ok, tokens) 与属性访问 (.ok, .tokens, .status)."""

    def __new__(cls, ok: bool, tokens: int, status: str = "CREDITED"):
        return super().__new__(cls, (ok, tokens))

    def __init__(self, ok: bool, tokens: int, status: str = "CREDITED"):
        self.ok = ok
        self.tokens = tokens
        self.status = status


class EnergyManager:
    """能量与预算管理器 (基于 SQLite CoreStore 原子事务封装)."""

    def __init__(
        self,
        ledger_path: Path,
        cost_per_million_equivalent_tokens: float = 1.0,
        budget_currency: str = "CNY",
        pricing_config_path: Optional[Path] = None,
        db_path: Optional[Path] = None,
    ):
        self.ledger_path = Path(ledger_path)
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        self.p_ratio = cost_per_million_equivalent_tokens
        self.currency = budget_currency
        self.lock = threading.RLock()

        self.db_path = Path(db_path) if db_path else self.ledger_path.parent / "v9_core.sqlite3"
        self.store = CoreStore(self.db_path)

        # 加载模型定价配置
        self.pricing_config = self._load_pricing_config(pricing_config_path)

        # 初始化全局预算与默认 run
        self.store.ensure_global_budget(total_limit=1_000_000_000, currency=self.currency)

        # 尝试自动从旧 JSONL 迁移 (若尚未迁移)
        if not self.store.is_migrated() and self.ledger_path.exists():
            try:
                pixels_dir = self.ledger_path.parent.parent / "live" / "pixels"
                self.store.migrate_from_jsonl_and_pixels(self.ledger_path, pixels_dir)
            except Exception:
                pass

    def _load_pricing_config(self, config_path: Optional[Path]) -> Dict[str, Any]:
        if config_path and Path(config_path).exists():
            try:
                return read_json(config_path)
            except Exception:
                pass

        default_path = self.ledger_path.parent.parent.parent / "resources" / "config" / "model_pricing.json"
        if default_path.exists():
            try:
                return read_json(default_path)
            except Exception:
                pass

        return {
            "currency": "CNY",
            "base_ratio_cny_per_million_tokens": self.p_ratio,
            "default_pricing": {
                "input_cost_per_million": 1.5,
                "cached_input_cost_per_million": 0.75,
                "output_cost_per_million": 6.0,
                "effective_from": "2026-09-01T00:00:00Z",
            },
            "models": {},
        }

    def get_model_pricing(self, model: str) -> Dict[str, Any]:
        """获取指定模型的定价策略."""
        models = self.pricing_config.get("models", {})
        if model in models:
            return models[model]
        return self.pricing_config.get("default_pricing", {
            "input_cost_per_million": 1.5,
            "cached_input_cost_per_million": 0.75,
            "output_cost_per_million": 6.0,
            "effective_from": "2026-09-01T00:00:00Z",
        })

    def calculate_call_energy(
        self,
        model: str,
        prompt_tokens: int,
        completion_tokens: int,
        cached_tokens: int = 0,
    ) -> Tuple[int, Dict[str, Any]]:
        """依据模型与各 Token 实际用量折算真实等效 Token (energy)."""
        pricing = self.get_model_pricing(model)
        in_cost = float(pricing.get("input_cost_per_million", 1.5))
        cached_cost = float(pricing.get("cached_input_cost_per_million", in_cost * 0.5))
        out_cost = float(pricing.get("output_cost_per_million", 6.0))

        regular_in = max(0, prompt_tokens - cached_tokens)
        cost_cny = (regular_in * in_cost + cached_tokens * cached_cost + completion_tokens * out_cost) / 1_000_000.0

        equivalent_tokens = int((cost_cny / self.p_ratio) * 1_000_000.0)
        if equivalent_tokens <= 0 and (prompt_tokens > 0 or completion_tokens > 0):
            equivalent_tokens = 1

        details = {
            "model": model,
            "pricing_effective_from": pricing.get("effective_from"),
            "cost_cny": round(cost_cny, 6),
            "regular_input_tokens": regular_in,
            "cached_input_tokens": cached_tokens,
            "completion_tokens": completion_tokens,
        }
        return equivalent_tokens, details

    def estimate_call_reserve(
        self,
        model: str,
        estimated_prompt_tokens: int,
        max_output_tokens: int = 2000,
    ) -> int:
        """预估单次调用的上限费用并折算等效 Token 预留."""
        pricing = self.get_model_pricing(model)
        in_cost = float(pricing.get("input_cost_per_million", 1.5))
        out_cost = float(pricing.get("output_cost_per_million", 6.0))

        cost_cny = (estimated_prompt_tokens * in_cost + max_output_tokens * out_cost) / 1_000_000.0
        reserve_tokens = int((cost_cny / self.p_ratio) * 1_000_000.0)
        return max(reserve_tokens, 100)

    def _ensure_active_run_id(self, run_id: Optional[str] = None) -> str:
        """获取或创建活动 Run ID."""
        rid = run_id or "run_default"
        if not self.store.get_run(rid):
            try:
                self.store.create_run(
                    run_id=rid,
                    run_limit=1_000_000_000,
                    global_limit=1_000_000_000,
                    pricing_revision=self.pricing_config.get("default_pricing", {}).get("effective_from", "2026-09-01"),
                )
            except Exception:
                pass
        return rid

    def _append_ledger_jsonl(self, entry_id: str, pixel_id: str, entry_type: str, amount: int, balance_after: int, details: Optional[Dict[str, Any]] = None):
        try:
            self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
            line_data = {
                "entry_id": entry_id,
                "timestamp": time.time(),
                "pixel_id": pixel_id,
                "entry_type": entry_type,
                "amount": amount,
                "balance_after": balance_after,
                "details": details or {},
            }
            with self.ledger_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(line_data, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def reserve_budget(
        self,
        pixel_storage: PixelStorage,
        estimated_tokens: int,
        run_id: Optional[str] = None,
        message_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """在调用 LLM 或执行工具前预留预算."""
        with self.lock:
            state = pixel_storage.load_state()
            acc = self.store.get_pixel_account(state.id)
            if not acc:
                self.store.ensure_pixel_account(state.id, energy=state.energy, active=state.active)
            elif acc["energy"] != state.energy:
                state.energy = acc["energy"]
                state.active = bool(acc["active"])
                pixel_storage.save_state(state)

            active_run = self._ensure_active_run_id(run_id)
            ok, call_id, err = self.store.reserve_call_budget(
                run_id=active_run,
                pixel_id=state.id,
                estimated_tokens=estimated_tokens,
                message_id=message_id,
            )
            if not ok:
                return False, f"INSUFFICIENT_ENERGY: {err}"

            self.store.sync_account_to_storage(state.id, pixel_storage)
            cur_acc = self.store.get_pixel_account(state.id)
            self._append_ledger_jsonl(call_id, state.id, "reserve", -estimated_tokens, cur_acc["energy"] if cur_acc else state.energy)
            return True, call_id

    def settle_budget(
        self,
        pixel_storage: PixelStorage,
        call_id: str,
        actual_tokens: int,
        details: Optional[Dict[str, Any]] = None,
    ):
        """结算预留预算，补足或退还预留差额."""
        with self.lock:
            state = pixel_storage.load_state()
            res = self.store.settle_call_budget(call_id, actual_tokens, details)
            self.store.sync_account_to_storage(state.id, pixel_storage)
            cur_acc = self.store.get_pixel_account(state.id)
            self._append_ledger_jsonl(
                f"settle_{call_id.replace('res_', '')}",
                state.id,
                "settle",
                res.get("diff", 0),
                cur_acc["energy"] if cur_acc else state.energy,
                details
            )
            return res

    def transfer_energy(
        self,
        from_storage: PixelStorage,
        to_storage: PixelStorage,
        amount: int,
        ref_message_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """邻居间显式转移 Energy."""
        with self.lock:
            if amount <= 0:
                return False, "Amount must be strictly positive"
            if not from_storage.state_file.exists():
                return False, "Sender state does not exist"
            if not to_storage.state_file.exists():
                return False, "Recipient state does not exist"

            s_from = from_storage.load_state()
            s_to = to_storage.load_state()

            acc_from = self.store.get_pixel_account(s_from.id)
            if not acc_from:
                self.store.ensure_pixel_account(s_from.id, s_from.energy, s_from.active)
            elif s_from.active != bool(acc_from["active"]):
                with self.store.get_connection() as conn:
                    conn.cursor().execute("UPDATE pixel_accounts SET active = ? WHERE pixel_id = ?", (1 if s_from.active else 0, s_from.id))
                    conn.commit()

            acc_to = self.store.get_pixel_account(s_to.id)
            if not acc_to:
                self.store.ensure_pixel_account(s_to.id, s_to.energy, s_to.active)
            elif s_to.active != bool(acc_to["active"]):
                with self.store.get_connection() as conn:
                    conn.cursor().execute("UPDATE pixel_accounts SET active = ? WHERE pixel_id = ?", (1 if s_to.active else 0, s_to.id))
                    conn.commit()

            ok, tx_id_or_err = self.store.transfer_energy(s_from.id, s_to.id, amount, ref_message_id, raise_on_error=False)
            if not ok:
                return False, tx_id_or_err

            self.store.sync_account_to_storage(s_from.id, from_storage)
            self.store.sync_account_to_storage(s_to.id, to_storage)
            from_acc = self.store.get_pixel_account(s_from.id)
            to_acc = self.store.get_pixel_account(s_to.id)
            self._append_ledger_jsonl(f"{tx_id_or_err}_out", s_from.id, "transfer", -amount, from_acc["energy"] if from_acc else 0)
            self._append_ledger_jsonl(f"{tx_id_or_err}_in", s_to.id, "transfer", amount, to_acc["energy"] if to_acc else 0)
            return True, tx_id_or_err

    def allocate_reproduction(
        self,
        parent_storage: PixelStorage,
        child_storage: PixelStorage,
        child_energy: int,
        child_pos: List[int],
        child_pixel_md: str,
        current_round: int,
    ) -> Tuple[bool, Optional[str]]:
        """元胞复制原子事务 (数据库扣款与文件创建)."""
        with self.lock:
            if child_energy <= 0:
                return False, "child_energy must be strictly positive"

            ok_md, md_err = validate_pixel_md(child_pixel_md)
            if not ok_md:
                return False, f"Reproduction rejected: {md_err}"

            if not parent_storage.state_file.exists():
                return False, "Parent state file does not exist"
            p_state = parent_storage.load_state()
            if not p_state.active:
                return False, "Parent pixel is not active"

            child_id = f"{child_pos[0]}_{child_pos[1]}_{child_pos[2]}"
            if child_storage.dir.exists() and (child_storage.state_file.exists() or child_storage.pixel_file.exists()):
                return False, f"Target position for child '{child_id}' is already occupied"

            if not self.store.get_pixel_account(p_state.id):
                self.store.ensure_pixel_account(p_state.id, p_state.energy, p_state.active)

            ok_alloc, tx_id_or_err = self.store.allocate_reproduction(p_state.id, child_id, child_energy)
            if not ok_alloc:
                return False, tx_id_or_err

            try:
                c_state = PixelState(
                    id=child_id,
                    position=child_pos,
                    active=True,
                    energy=child_energy,
                    parent=p_state.id,
                    born_round=current_round,
                    last_active_round=current_round,
                    generation=p_state.generation + 1,
                )
                child_storage.save_state(c_state)
                child_storage.save_pixel_md(child_pixel_md)
                self.store.sync_account_to_storage(p_state.id, parent_storage)
                p_acc = self.store.get_pixel_account(p_state.id)
                self._append_ledger_jsonl(f"{tx_id_or_err}_p", p_state.id, "reproduce", -child_energy, p_acc["energy"] if p_acc else 0)
                self._append_ledger_jsonl(f"{tx_id_or_err}_c", child_id, "reproduce", child_energy, child_energy)
                return True, None
            except Exception as e:
                if child_storage.dir.exists():
                    shutil.rmtree(child_storage.dir, ignore_errors=True)
                return False, f"Reproduction filesystem init failed: {e}"

    def credit_external_revenue(
        self,
        pixel_storage: Union[PixelStorage, str] = None,
        net_amount: float = 0.0,
        external_tx_id: str = "",
        details: Optional[Dict[str, Any]] = None,
        pixel_id: Optional[str] = None,
        amount_cny: Optional[float] = None,
        tx_id: Optional[str] = None,
        source: Optional[str] = None,
    ) -> CreditResult:
        """核验外部真实净回款 (全局幂等与 Deficit 抵扣)."""
        if pixel_storage is None and pixel_id is not None:
            pixel_storage = pixel_id
        if net_amount == 0.0 and amount_cny is not None:
            net_amount = amount_cny
        if not external_tx_id and tx_id is not None:
            external_tx_id = tx_id
        if details is None and source is not None:
            details = {"source": source}

        if isinstance(pixel_storage, str):
            p_dir = self.ledger_path.parent.parent / "live" / "pixels" / pixel_storage
            pixel_storage = PixelStorage(p_dir)

        with self.lock:
            state = pixel_storage.load_state()
            if not self.store.get_pixel_account(state.id):
                self.store.ensure_pixel_account(state.id, state.energy, state.active)

            audit_details = {
                "external_tx_id": external_tx_id,
                "net_amount": net_amount,
                **(details or {})
            }
            res = self.store.credit_revenue(
                pixel_id=state.id,
                net_amount=net_amount,
                external_tx_id=external_tx_id,
                cost_per_million_tokens=self.p_ratio,
                details=audit_details,
            )
            if res.get("ok"):
                if res.get("status") == "CREDITED":
                    self.store.sync_account_to_storage(state.id, pixel_storage)
                    acc = self.store.get_pixel_account(state.id)
                    self._append_ledger_jsonl(f"rev_{external_tx_id}", state.id, "revenue", res["tokens"], acc["energy"] if acc else state.energy, audit_details)
                return CreditResult(True, res["tokens"], res["status"])
            else:
                return CreditResult(False, 0, res.get("status", "FAILED"))

    def refund_external_revenue(
        self,
        pixel_storage: PixelStorage,
        external_tx_id: str,
        refund_amount: Optional[float] = None,
        reason: str = "refund",
    ) -> Tuple[bool, int, Optional[str]]:
        """外部回款真实退款冲回."""
        with self.lock:
            state = pixel_storage.load_state()
            acc = self.store.get_pixel_account(state.id)
            if not acc:
                self.store.ensure_pixel_account(state.id, state.energy, state.active)
            elif acc["energy"] > state.energy:
                # 外部直接消耗了 state.json 能量 (如测试模拟消耗)，对齐数据库
                with self.store.get_connection() as conn:
                    conn.execute("UPDATE pixel_accounts SET energy = ?, active = ? WHERE pixel_id = ?", (state.energy, 1 if state.energy > 0 else 0, state.id))
                    conn.commit()

            refund_id = f"refund_{external_tx_id}_{uuid.uuid4().hex[:6]}"
            ok, deducted, err = self.store.refund_revenue(
                external_tx_id=external_tx_id,
                refund_id=refund_id,
                refund_amount_cny=refund_amount,
                cost_per_million_tokens=self.p_ratio,
                reason=reason,
            )
            if ok:
                self.store.sync_account_to_storage(state.id, pixel_storage)
                cur_acc = self.store.get_pixel_account(state.id)
                self._append_ledger_jsonl(refund_id, state.id, "refund", -deducted, cur_acc["energy"] if cur_acc else 0, {"reason": reason})
            return ok, deducted, err
