"""针对 V9.5 单一事实源 CoreStore 事务原子性与故障注入回滚测试.

验收规则:
1. 任何跨账户转账、繁殖或结算过程中注入异常，事务全部回滚;
2. 杜绝中间态、不丢能量、不增发能量.
"""

import pytest
from pathlib import Path
from emergentinc.engine.core_store import CoreStore, CoreStoreError


def test_transfer_atomicity_and_rollback_on_failure(tmp_path):
    db_path = tmp_path / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(100000)

    store.upsert_pixel_account("alice", initial_energy=1000)
    store.upsert_pixel_account("bob", initial_energy=500)

    # 1. 尝试向一个非活跃或不存在的元胞转账，或者金额不足
    with pytest.raises(CoreStoreError):
        store.transfer_energy("alice", "non_existent", amount=300)

    # 验证 alice 的余额没有被扣除
    alice_acc = store.get_pixel_account("alice")
    assert alice_acc["energy"] == 1000

    # 2. 尝试转账金额超出余额
    with pytest.raises(CoreStoreError):
        store.transfer_energy("alice", "bob", amount=1500)

    alice_acc = store.get_pixel_account("alice")
    bob_acc = store.get_pixel_account("bob")
    assert alice_acc["energy"] == 1000
    assert bob_acc["energy"] == 500


def test_reproduction_atomicity_and_rollback(tmp_path):
    db_path = tmp_path / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(100000)

    store.upsert_pixel_account("parent", initial_energy=1000)

    # 尝试繁殖超过父级能量
    with pytest.raises(CoreStoreError):
        store.reproduce_pixel("parent", "child_1", child_energy=1500)

    parent_acc = store.get_pixel_account("parent")
    assert parent_acc["energy"] == 1000
    assert store.get_pixel_account("child_1") is None

    # 成功繁殖 400
    store.reproduce_pixel("parent", "child_1", child_energy=400)
    parent_acc = store.get_pixel_account("parent")
    child_acc = store.get_pixel_account("child_1")
    assert parent_acc["energy"] == 600
    assert child_acc["energy"] == 400

    # 尝试繁殖一个已存在的同名元胞 (触发主键冲突 IntegrityError)
    with pytest.raises(CoreStoreError):
        store.reproduce_pixel("parent", "child_1", child_energy=200)

    # 父元胞能量必须回滚保持 600，不得扣除 200
    parent_acc = store.get_pixel_account("parent")
    assert parent_acc["energy"] == 600


def test_reservation_and_settlement_atomicity(tmp_path):
    db_path = tmp_path / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(100000)

    store.upsert_pixel_account("p1", initial_energy=1000)
    store.create_run("run_1", rounds=1, run_budget_tokens=10000, global_budget_tokens=100000)

    # 预留 500
    store.reserve_call_budget("call_1", "run_1", "p1", 500, run_limit=10000, global_limit=100000)
    p1 = store.get_pixel_account("p1")
    assert p1["energy"] == 500  # 预留即扣减

    # 尝试重复预留相同 call_id (触发唯一键冲突)
    with pytest.raises(CoreStoreError):
        store.reserve_call_budget("call_1", "run_1", "p1", 200, run_limit=10000, global_limit=100000)

    # 余额必须维持 500
    p1 = store.get_pixel_account("p1")
    assert p1["energy"] == 500

    # 结算：实际消耗 300，返还 200 差额
    store.settle_call("call_1", actual_tokens=300, cost_cny=0.0003, outcome="SUCCESS")
    p1 = store.get_pixel_account("p1")
    assert p1["energy"] == 700  # 500 + 200 返还

    # 重复结算相同 call_id 必须抛出 CoreStoreError 并回滚
    with pytest.raises(CoreStoreError):
        store.settle_call("call_1", actual_tokens=300, cost_cny=0.0003, outcome="SUCCESS")
    p1 = store.get_pixel_account("p1")
    assert p1["energy"] == 700
