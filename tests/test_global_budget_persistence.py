"""针对 V9.5 规范的全局持久化预算与跨 Run 累计测试.

验收规则:
1. 全局预算持久化在 SQLite 中，跨 Run 和实例重启严格累计;
2. 达到全局上限后，任何新的预留强行拦截 (BudgetExceededError);
3. 审计阻断启动.
"""

import pytest
from pathlib import Path
from emergentinc.engine.core_store import CoreStore, BudgetExceededError
from emergentinc.engine.audit import audit_workspace


def test_global_budget_accumulates_across_runs_and_restarts(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True)
    db_path = ws / "ledger" / "v9_core.sqlite3"

    # 实例 1: 初始化全局预算 1000 tokens
    store1 = CoreStore(db_path)
    store1.ensure_global_budget(total_limit=1000)
    store1.upsert_pixel_account("pixel_1", initial_energy=5000)

    # 启动 Run 1
    store1.create_run("run_1", rounds=1, run_budget_tokens=500, global_budget_tokens=1000)
    # 预留并结算 400 tokens
    store1.reserve_call_budget("call_1", "run_1", "pixel_1", 400, run_limit=500, global_limit=1000)
    store1.settle_call("call_1", actual_tokens=400, cost_cny=0.0004, outcome="SUCCESS")
    store1.update_run_status("run_1", status="COMPLETED", end_round=1)

    # 检查实例 1 状态
    st1 = store1.get_budget_state("run_1")
    assert st1["global_spent_tokens"] == 400
    assert st1["global_remaining_tokens"] == 600

    # 模拟重启服务：创建全新实例 store2 连接同一 DB
    store2 = CoreStore(db_path)
    st2 = store2.get_budget_state()
    assert st2["global_spent_tokens"] == 400
    assert st2["global_remaining_tokens"] == 600

    # 启动 Run 2
    store2.create_run("run_2", rounds=1, run_budget_tokens=500, global_budget_tokens=1000)
    # 再次预留并结算 400 tokens
    store2.reserve_call_budget("call_2", "run_2", "pixel_1", 400, run_limit=500, global_limit=1000)
    store2.settle_call("call_2", actual_tokens=400, cost_cny=0.0004, outcome="SUCCESS")
    store2.update_run_status("run_2", status="COMPLETED", end_round=2)

    st2_after = store2.get_budget_state("run_2")
    assert st2_after["global_spent_tokens"] == 800
    assert st2_after["global_remaining_tokens"] == 200

    # 启动 Run 3：尝试预留 300 tokens，但全局仅剩 200 tokens -> 必须抛出 BudgetExceededError
    store2.create_run("run_3", rounds=1, run_budget_tokens=500, global_budget_tokens=1000)
    with pytest.raises(BudgetExceededError) as exc_info:
        store2.reserve_call_budget("call_3", "run_3", "pixel_1", 300, run_limit=500, global_limit=1000)
    assert "GLOBAL_BUDGET_EXCEEDED" in str(exc_info.value)


def test_global_budget_exhaustion_blocks_audit(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True)
    db_path = ws / "ledger" / "v9_core.sqlite3"

    store = CoreStore(db_path)
    store.ensure_global_budget(total_limit=500)
    store.upsert_pixel_account("p1", initial_energy=1000)

    store.create_run("r1", rounds=1, run_budget_tokens=500, global_budget_tokens=500)
    store.reserve_call_budget("c1", "r1", "p1", 500, run_limit=500, global_limit=500)
    store.settle_call("c1", actual_tokens=500, cost_cny=0.0005, outcome="SUCCESS")
    store.update_run_status("r1", status="COMPLETED", end_round=1)

    # 审计检查
    rep = audit_workspace(ws)
    assert not rep.allowed_to_start
    assert any("GLOBAL_BUDGET_EXHAUSTED" in r for r in rep.block_reasons)
