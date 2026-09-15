"""能量与计算预算管理系统 (V9 Energy & Ledger).

核心规则:
1. 初始全系统共有 100,000,000 等效 Token，全部归属创世元胞 (Genesis Pixel)。
2. Energy 是等效 Token 余额，正整数单位。
3. 严格取消固定 call/message/environment/birth/metabolism 虚拟扣费。只扣真实模型及工具计费折算的等效 Token。
4. 调用与执行前预留 (Reserve)，结算后释放差额 (Settle)。
5. 复制与邻居转账严格遵守能量守恒，禁止凭空增发。
6. 真实净回款按基准比率换算注入，退款冲回。
7. 账本记录不可回滚。
"""

import time
import uuid
import json
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Tuple
from .utils import write_json, read_json
from .pixel import PixelStorage, PixelState


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


class EnergyManager:
    """能量与预算记账管理器."""

    def __init__(
        self,
        ledger_path: Path,
        cost_per_million_equivalent_tokens: float = 1.0,  # 基准费用 P (如 1.0 元/100万等效token)
        budget_currency: str = "CNY",
    ):
        self.ledger_path = Path(ledger_path)
        self.ledger_path.parent.mkdir(parents=True, exist_ok=True)
        self.p_ratio = cost_per_million_equivalent_tokens
        self.currency = budget_currency
        self.reservations: Dict[str, int] = {}  # call_id -> reserved_tokens

    def _append_ledger(self, entry: LedgerEntry):
        with self.ledger_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry.to_dict(), ensure_ascii=False) + "\n")

    def reserve_budget(self, pixel_storage: PixelStorage, estimated_tokens: int) -> Tuple[bool, Optional[str]]:
        """在调用 LLM 或执行工具前预留预算."""
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
        reserved = self.reservations.pop(call_id, 0)
        state = pixel_storage.load_state()
        diff = reserved - actual_tokens  # 若实际消耗少于预留，diff > 0，退还到余额；若超支则多扣
        state.energy += diff
        if state.energy <= 0:
            state.active = False  # 能量耗尽死亡

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
        """邻居间显式转移 Energy."""
        if amount <= 0:
            return False, "Amount must be strictly positive"
        from_state = from_storage.load_state()
        to_state = to_storage.load_state()

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

        # 出账记录
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
        # 入账记录
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
        """元胞复制: 划拨母体能量，子代继承并初始化."""
        if child_energy <= 0:
            return False, "child_energy must be strictly positive"
        p_state = parent_storage.load_state()
        if p_state.energy < child_energy:
            return False, f"Parent insufficient energy: have {p_state.energy}, need {child_energy}"

        p_state.energy -= child_energy
        if p_state.energy <= 0:
            p_state.active = False
        parent_storage.save_state(p_state)

        child_id = f"{child_pos[0]}_{child_pos[1]}_{child_pos[2]}"
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

    def credit_external_revenue(
        self,
        pixel_storage: PixelStorage,
        net_amount: float,
        external_tx_id: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, int]:
        """核验外部真实净回款，按基准 P 换算等效 Token 回补."""
        if net_amount <= 0:
            return False, 0
        equivalent_tokens = int((net_amount / self.p_ratio) * 1_000_000)
        state = pixel_storage.load_state()
        state.energy += equivalent_tokens
        if not state.active and state.energy > 0:
            state.active = True  # 重新激活
        pixel_storage.save_state(state)

        self._append_ledger(
            LedgerEntry(
                entry_id=f"rev_{external_tx_id}",
                timestamp=time.time(),
                pixel_id=state.id,
                entry_type="revenue",
                amount=equivalent_tokens,
                balance_after=state.energy,
                details={"net_amount": net_amount, "currency": self.currency, **(details or {})},
            )
        )
        return True, equivalent_tokens
