"""能量与计算预算管理系统 (V9 Energy & Ledger).

核心规则:
1. 初始全系统共有 100,000,000 等效 Token，全部归属创世元胞 (Genesis Pixel)。
2. Energy 是等效 Token 余额，正整数单位。
3. 严格取消固定 call/message/environment/birth/metabolism 虚拟扣费。只扣真实模型及工具计费折算的等效 Token。
4. 调用与执行前预留 (Reserve)，结算后释放差额 (Settle)。
5. 复制与邻居转账严格遵守能量守恒，禁止凭空增发。
6. 真实净回款按基准比率换算注入，严格保证幂等性与退款冲回。
7. 账本记录不可回滚。
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


@dataclass
class LedgerEntry:
    entry_id: str
    timestamp: float
    pixel_id: str
    entry_type: str  # "initial" | "reserve" | "settle" | "transfer" | "reproduce" | "revenue" | "refund"
    amount: int  # 正为增加，负为扣除
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
    """能量与预算记账管理器 (具备崩溃恢复、回款幂等与模型计费折算)."""

    def __init__(
        self,
        ledger_path: Path,
        cost_per_million_equivalent_tokens: float = 1.0,  # 基准费用 P (1.0 元/100万等效token)
        budget_currency: str = "CNY",
        pricing_config_path: Optional[Path] = None,
    ):
        self.ledger_path = Path(ledger_path)
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        self.p_ratio = cost_per_million_equivalent_tokens
        self.currency = budget_currency
        self.lock = threading.RLock()

        self.reservations: Dict[str, int] = {}  # call_id -> reserved_tokens
        self.external_credits: Dict[str, Dict[str, Any]] = {}  # external_tx_id -> info
        self.external_refunds: Dict[str, float] = {}  # external_tx_id -> cumulative_cny_refunded

        # 加载模型定价配置
        self.pricing_config = self._load_pricing_config(pricing_config_path)

        # 从现有账本重建内存缓存状态 (防止崩溃丢失已处理事务与 reservation)
        self._init_from_ledger()

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

    def _init_from_ledger(self):
        """扫描不可回滚账本，恢复 open reservations 与已处理的 external transactions."""
        with self.lock:
            if not self.ledger_path.exists():
                return
            open_res: Dict[str, int] = {}
            with self.ledger_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        eid = data.get("entry_id", "")
                        etype = data.get("entry_type", "")
                        amt = int(data.get("amount", 0))
                        details = data.get("details", {})
                        if etype == "reserve":
                            open_res[eid] = abs(amt)
                        elif etype == "settle":
                            cid = details.get("call_id")
                            if cid and cid in open_res:
                                del open_res[cid]
                        elif etype == "revenue":
                            tx_id = details.get("external_tx_id") or eid.replace("rev_", "")
                            self.external_credits[tx_id] = {
                                "pixel_id": data.get("pixel_id"),
                                "net_amount": float(details.get("net_amount", 0.0)),
                                "amount_tokens": amt,
                                "timestamp": data.get("timestamp", 0.0),
                            }
                        elif etype == "refund":
                            tx_id = details.get("external_tx_id")
                            if tx_id:
                                ref_amt = float(details.get("refund_amount", 0.0))
                                self.external_refunds[tx_id] = self.external_refunds.get(tx_id, 0.0) + ref_amt
                    except Exception:
                        pass
            self.reservations.update(open_res)

    def _append_ledger(self, entry: LedgerEntry):
        with self.ledger_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")

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

        # 真实输入中剔除缓存命中的输入
        regular_in = max(0, prompt_tokens - cached_tokens)
        cost_cny = (regular_in * in_cost + cached_tokens * cached_cost + completion_tokens * out_cost) / 1_000_000.0

        # 按基准费用换算等效 Token
        equivalent_tokens = int((cost_cny / self.p_ratio) * 1_000_000.0)
        # 只要实际发生调用，至少计 1 token，防止零费用穿透
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

    def reserve_budget(self, pixel_storage: PixelStorage, estimated_tokens: int) -> Tuple[bool, Optional[str]]:
        """在调用 LLM 或执行工具前预留预算."""
        with self.lock:
            state = pixel_storage.load_state()
            if state.energy < estimated_tokens:
                return False, f"INSUFFICIENT_ENERGY: required {estimated_tokens}, current {state.energy}"
            call_id = f"res_{uuid.uuid4().hex[:8]}"
            state.energy -= estimated_tokens
            pixel_storage.save_state(state)
            self.reservations[call_id] = estimated_tokens

            entry = LedgerEntry(
                entry_id=call_id,
                timestamp=time.time(),
                pixel_id=state.id,
                entry_type="reserve",
                amount=-estimated_tokens,
                balance_after=state.energy,
                details={"reserved_for_call": True},
            )
            self._append_ledger(entry)
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
            reserved = self.reservations.pop(call_id, 0)
            state = pixel_storage.load_state()
            diff = reserved - actual_tokens
            state.energy += diff
            if state.energy <= 0:
                state.active = False

            pixel_storage.save_state(state)

            entry = LedgerEntry(
                entry_id=f"settle_{uuid.uuid4().hex[:8]}",
                timestamp=time.time(),
                pixel_id=state.id,
                entry_type="settle",
                amount=diff,
                balance_after=state.energy,
                details={
                    "reserved": reserved,
                    "actual_tokens": actual_tokens,
                    "call_id": call_id,
                    **(details or {}),
                },
            )
            self._append_ledger(entry)

    def transfer_energy(
        self,
        from_storage: PixelStorage,
        to_storage: PixelStorage,
        amount: int,
        ref_message_id: Optional[str] = None,
    ) -> Tuple[bool, Optional[str]]:
        """邻居间显式转移 Energy (具有完整前置条件验证与能量守恒)."""
        with self.lock:
            if amount <= 0:
                return False, "Amount must be strictly positive"
            if not from_storage.state_file.exists():
                return False, "Sender state does not exist"
            if not to_storage.state_file.exists():
                return False, "Recipient state does not exist"

            from_state = from_storage.load_state()
            to_state = to_storage.load_state()

            if not from_state.active:
                return False, f"Sender pixel '{from_state.id}' is not active"
            if not to_state.active:
                return False, f"Recipient pixel '{to_state.id}' is not active"
            if from_state.energy < amount:
                return False, f"Insufficient energy: have {from_state.energy}, requested {amount}"

            from_state.energy -= amount
            to_state.energy += amount
            if from_state.energy <= 0:
                from_state.active = False

            from_storage.save_state(from_state)
            to_storage.save_state(to_state)

            tx_id = f"tx_{uuid.uuid4().hex[:8]}"
            now = time.time()

            self._append_ledger(
                LedgerEntry(
                    entry_id=f"{tx_id}_out",
                    timestamp=now,
                    pixel_id=from_state.id,
                    entry_type="transfer",
                    amount=-amount,
                    balance_after=from_state.energy,
                    details={"to": to_state.id, "ref_message_id": ref_message_id},
                )
            )
            self._append_ledger(
                LedgerEntry(
                    entry_id=f"{tx_id}_in",
                    timestamp=now,
                    pixel_id=to_state.id,
                    entry_type="transfer",
                    amount=amount,
                    balance_after=to_state.energy,
                    details={"from": from_state.id, "ref_message_id": ref_message_id},
                )
            )
            return True, tx_id

    def allocate_reproduction(
        self,
        parent_storage: PixelStorage,
        child_storage: PixelStorage,
        child_energy: int,
        child_pos: List[int],
        child_pixel_md: str,
        current_round: int,
    ) -> Tuple[bool, Optional[str]]:
        """元胞复制原子事务: 全量预校验通过后再扣款与创建，失败完整回滚."""
        with self.lock:
            # 1. 基础参数检查
            if child_energy <= 0:
                return False, "child_energy must be strictly positive"

            # 2. 心智字数检查 (最大 2000 字)
            ok_md, md_err = validate_pixel_md(child_pixel_md)
            if not ok_md:
                return False, f"Reproduction rejected: {md_err}"

            # 3. 母体存在性与余额充足性检查
            if not parent_storage.state_file.exists():
                return False, "Parent state file does not exist"
            p_state = parent_storage.load_state()
            if not p_state.active:
                return False, "Parent pixel is not active"
            if p_state.energy < child_energy:
                return False, f"Parent insufficient energy: have {p_state.energy}, need {child_energy}"

            # 4. 子代物理占用与残留目录防卫检查
            child_id = f"{child_pos[0]}_{child_pos[1]}_{child_pos[2]}"
            if child_storage.dir.exists() and (child_storage.state_file.exists() or child_storage.pixel_file.exists()):
                return False, f"Target position for child '{child_id}' is already occupied"

            # 5. 原子执行
            original_parent_energy = p_state.energy
            original_parent_active = p_state.active
            try:
                # 扣减母体能量
                p_state.energy -= child_energy
                if p_state.energy <= 0:
                    p_state.active = False
                parent_storage.save_state(p_state)

                # 初始化子代目录与文件
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

                # 提交账本
                tx_id = f"reprod_{uuid.uuid4().hex[:8]}"
                now = time.time()
                self._append_ledger(
                    LedgerEntry(
                        entry_id=f"{tx_id}_parent",
                        timestamp=now,
                        pixel_id=p_state.id,
                        entry_type="reproduce",
                        amount=-child_energy,
                        balance_after=p_state.energy,
                        details={"child_id": child_id},
                    )
                )
                self._append_ledger(
                    LedgerEntry(
                        entry_id=f"{tx_id}_child",
                        timestamp=now,
                        pixel_id=child_id,
                        entry_type="reproduce",
                        amount=child_energy,
                        balance_after=c_state.energy,
                        details={"parent_id": p_state.id},
                    )
                )
                return True, None

            except Exception as e:
                # 发生异常立即完整回滚母体，清理子代残留
                p_state.energy = original_parent_energy
                p_state.active = original_parent_active
                try:
                    parent_storage.save_state(p_state)
                except Exception:
                    pass
                if child_storage.dir.exists():
                    shutil.rmtree(child_storage.dir, ignore_errors=True)
                return False, f"Reproduction transaction failed: {e}"

    def credit_external_revenue(
        self,
        pixel_storage: PixelStorage,
        net_amount: float,
        external_tx_id: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> CreditResult:
        """核验外部真实净回款 (具备全局严格幂等性防重复入账与冲突检测)."""
        with self.lock:
            tx_clean = str(external_tx_id).strip()
            if not tx_clean:
                return CreditResult(False, 0, "MISSING_TX_ID")
            if net_amount <= 0:
                return CreditResult(False, 0, "INVALID_AMOUNT")

            state = pixel_storage.load_state()

            # 幂等性校验
            if tx_clean in self.external_credits:
                existing = self.external_credits[tx_clean]
                if existing["pixel_id"] == state.id and abs(existing["net_amount"] - net_amount) < 1e-6:
                    return CreditResult(True, existing["amount_tokens"], "ALREADY_CREDITED")
                else:
                    return CreditResult(False, 0, "CONFLICT_TX_MISMATCH")

            equivalent_tokens = int((net_amount / self.p_ratio) * 1_000_000.0)
            state.energy += equivalent_tokens
            if not state.active and state.energy > 0:
                state.active = True
            pixel_storage.save_state(state)

            now = time.time()
            self._append_ledger(
                LedgerEntry(
                    entry_id=f"rev_{tx_clean}",
                    timestamp=now,
                    pixel_id=state.id,
                    entry_type="revenue",
                    amount=equivalent_tokens,
                    balance_after=state.energy,
                    details={
                        "external_tx_id": tx_clean,
                        "net_amount": net_amount,
                        "currency": self.currency,
                        **(details or {}),
                    },
                )
            )

            self.external_credits[tx_clean] = {
                "pixel_id": state.id,
                "net_amount": net_amount,
                "amount_tokens": equivalent_tokens,
                "timestamp": now,
            }
            return CreditResult(True, equivalent_tokens, "CREDITED")

    def refund_external_revenue(
        self,
        pixel_storage: PixelStorage,
        external_tx_id: str,
        refund_amount: Optional[float] = None,
        reason: str = "refund",
    ) -> Tuple[bool, int, Optional[str]]:
        """外部回款真实退款冲回: 扣除等效 Token，记录待偿缺口，不制造负转账."""
        with self.lock:
            tx_clean = str(external_tx_id).strip()
            if tx_clean not in self.external_credits:
                return False, 0, "TRANSACTION_NOT_FOUND"

            credit = self.external_credits[tx_clean]
            state = pixel_storage.load_state()
            if credit["pixel_id"] != state.id:
                return False, 0, f"PIXEL_MISMATCH: tx was credited to {credit['pixel_id']}"

            already_refunded = self.external_refunds.get(tx_clean, 0.0)
            available_for_refund = credit["net_amount"] - already_refunded
            if available_for_refund <= 1e-6:
                return False, 0, "ALREADY_FULLY_REFUNDED"

            actual_refund_cny = available_for_refund if refund_amount is None else min(refund_amount, available_for_refund)
            if actual_refund_cny <= 0:
                return False, 0, "INVALID_REFUND_AMOUNT"

            tokens_intended = int((actual_refund_cny / self.p_ratio) * 1_000_000.0)
            deficit = 0
            if state.energy < tokens_intended:
                deficit = tokens_intended - state.energy
                tokens_deducted = state.energy
                state.energy = 0
                state.active = False
            else:
                tokens_deducted = tokens_intended
                state.energy -= tokens_intended
                if state.energy <= 0:
                    state.active = False

            pixel_storage.save_state(state)

            now = time.time()
            self._append_ledger(
                LedgerEntry(
                    entry_id=f"refund_{tx_clean}_{uuid.uuid4().hex[:6]}",
                    timestamp=now,
                    pixel_id=state.id,
                    entry_type="refund",
                    amount=-tokens_deducted,
                    balance_after=state.energy,
                    details={
                        "external_tx_id": tx_clean,
                        "refund_amount": actual_refund_cny,
                        "tokens_intended": tokens_intended,
                        "tokens_deducted": tokens_deducted,
                        "deficit_tokens": deficit,
                        "reason": reason,
                    },
                )
            )

            self.external_refunds[tx_clean] = already_refunded + actual_refund_cny
            return True, tokens_deducted, None
