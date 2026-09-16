"""针对 V9.5 规范的 Refund Deficit 赤字挂账、支出阻断与优先填补测试.

验收规则:
1. 退款金额超过 Pixel 当前余额时，余额归零，差额计入 refund_deficit_tokens;
2. deficit > 0 时严格禁止预留、转账和繁殖 (SpendBlockedError);
3. 后续回款优先抵扣 deficit，清零后自动解除支出阻断.
"""

import pytest
from pathlib import Path
from emergentinc.engine.core_store import CoreStore, SpendBlockedError


def test_refund_deficit_blocks_spend_and_priority_repayment(tmp_path):
    db_path = tmp_path / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(1000000)

    # 1. 初始化元胞，余额 500
    store.upsert_pixel_account("pixel_deficit", initial_energy=500)
    acc = store.get_pixel_account("pixel_deficit")
    assert acc["energy"] == 500
    assert acc["refund_deficit_tokens"] == 0
    assert acc["spend_blocked_reason"] is None

    # 2. 外部发起退款 800 (超额 300)
    actual_deducted = store.deduct_pixel_refund("pixel_deficit", refund_tokens=800, refund_id="rf_001")
    assert actual_deducted == 500

    # 检查账户状态：余额为 0，赤字 300，支出被阻断
    acc = store.get_pixel_account("pixel_deficit")
    assert acc["energy"] == 0
    assert acc["refund_deficit_tokens"] == 300
    assert acc["spend_blocked_reason"] == "REFUND_DEFICIT"

    # 3. 验证支出阻断：禁止转账、预留与繁殖
    store.upsert_pixel_account("bob", initial_energy=100)
    with pytest.raises(SpendBlockedError):
        store.transfer_energy("pixel_deficit", "bob", amount=10)

    store.create_run("r1", rounds=1, run_budget_tokens=10000, global_budget_tokens=100000)
    with pytest.raises(SpendBlockedError):
        store.reserve_call_budget("c1", "r1", "pixel_deficit", 50, run_limit=10000, global_limit=100000)

    with pytest.raises(SpendBlockedError):
        store.reproduce_pixel("pixel_deficit", "child", child_energy=10)

    # 4. 后续入账 200 (不足以完全填补赤字 300)
    rem_credited = store.credit_pixel_revenue("pixel_deficit", revenue_tokens=200, tx_id="tx_part")
    assert rem_credited == 0  # 全部被用来填补赤字，0 流入 energy
    acc = store.get_pixel_account("pixel_deficit")
    assert acc["energy"] == 0
    assert acc["refund_deficit_tokens"] == 100
    assert acc["spend_blocked_reason"] == "REFUND_DEFICIT"  # 依然阻断

    # 5. 再入账 250 (足够填补剩余 100 赤字，并留存 150 能量)
    rem_credited = store.credit_pixel_revenue("pixel_deficit", revenue_tokens=250, tx_id="tx_full")
    assert rem_credited == 150
    acc = store.get_pixel_account("pixel_deficit")
    assert acc["energy"] == 150
    assert acc["refund_deficit_tokens"] == 0
    assert acc["spend_blocked_reason"] is None  # 赤字清零，支出阻断解除！

    # 6. 解除阻断后，恢复正常的转账能力
    store.transfer_energy("pixel_deficit", "bob", amount=50)
    acc = store.get_pixel_account("pixel_deficit")
    assert acc["energy"] == 100
    bob = store.get_pixel_account("bob")
    assert bob["energy"] == 150
