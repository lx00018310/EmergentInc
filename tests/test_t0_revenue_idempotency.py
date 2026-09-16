import pytest
import threading
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_credit_external_revenue_idempotent_replay(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    pixel_dir = tmp_path / "pixels" / "0_0_0"
    storage = PixelStorage(pixel_dir)
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=1000))

    mgr = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)

    # 1. 首次入账
    res1 = mgr.credit_external_revenue(storage, net_amount=2.5, external_tx_id="tx_test_001")
    assert res1.ok is True
    assert res1.tokens == 2_500_000
    assert res1.status == "CREDITED"
    # 支持元组解包
    ok, tokens = res1
    assert ok is True
    assert tokens == 2_500_000

    current_energy = storage.load_state().energy
    assert current_energy == 1000 + 2_500_000

    # 2. 连续重放 100 次
    for _ in range(100):
        replay_res = mgr.credit_external_revenue(storage, net_amount=2.5, external_tx_id="tx_test_001")
        assert replay_res.ok is True
        assert replay_res.tokens == 2_500_000
        assert replay_res.status == "ALREADY_CREDITED"

    # 验证最终余额没有发生任何重复增加
    assert storage.load_state().energy == current_energy

    # 验证账本只有 1 条记录
    lines = [line for line in ledger_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(lines) == 1


def test_credit_external_revenue_conflict_rejection(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    storage1 = PixelStorage(tmp_path / "pixels" / "0_0_0")
    storage2 = PixelStorage(tmp_path / "pixels" / "1_0_0")
    storage1.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=1000))
    storage2.save_state(PixelState(id="1_0_0", position=[1, 0, 0], active=True, energy=1000))

    mgr = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)

    # 首次入账
    res = mgr.credit_external_revenue(storage1, net_amount=5.0, external_tx_id="tx_conflict_test")
    assert res.ok is True
    assert res.status == "CREDITED"

    # 相同 tx_id 但金额不同 -> 冲突拦截
    res_diff_amt = mgr.credit_external_revenue(storage1, net_amount=10.0, external_tx_id="tx_conflict_test")
    assert res_diff_amt.ok is False
    assert res_diff_amt.status == "CONFLICT_TX_MISMATCH"

    # 相同 tx_id 但 pixel_id 不同 -> 冲突拦截
    res_diff_px = mgr.credit_external_revenue(storage2, net_amount=5.0, external_tx_id="tx_conflict_test")
    assert res_diff_px.ok is False
    assert res_diff_px.status == "CONFLICT_TX_MISMATCH"

    # 验证账本仍只有 1 条记录
    lines = [line for line in ledger_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert len(lines) == 1


def test_credit_reloads_from_ledger_across_instances(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    storage = PixelStorage(tmp_path / "pixels" / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=5000))

    mgr1 = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)
    res = mgr1.credit_external_revenue(storage, net_amount=3.0, external_tx_id="tx_restart_test")
    assert res.ok is True

    # 进程重启模拟：实例化全新 manager
    mgr2 = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)
    # 再次提交同一交易
    res_replay = mgr2.credit_external_revenue(storage, net_amount=3.0, external_tx_id="tx_restart_test")
    assert res_replay.ok is True
    assert res_replay.status == "ALREADY_CREDITED"

    # 冲突校验在重启后依然生效
    res_conflict = mgr2.credit_external_revenue(storage, net_amount=99.0, external_tx_id="tx_restart_test")
    assert res_conflict.ok is False
    assert res_conflict.status == "CONFLICT_TX_MISMATCH"


def test_refund_external_revenue_full_and_partial(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    storage = PixelStorage(tmp_path / "pixels" / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=10_000_000))

    mgr = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)
    mgr.credit_external_revenue(storage, net_amount=10.0, external_tx_id="tx_refund_flow")
    assert storage.load_state().energy == 20_000_000

    # 部分退款 4.0 元
    ok, deducted, err = mgr.refund_external_revenue(storage, external_tx_id="tx_refund_flow", refund_amount=4.0)
    assert ok is True
    assert deducted == 4_000_000
    assert storage.load_state().energy == 16_000_000

    # 再次退款 6.0 元 (达到上限 10.0 元)
    ok, deducted, err = mgr.refund_external_revenue(storage, external_tx_id="tx_refund_flow", refund_amount=6.0)
    assert ok is True
    assert deducted == 6_000_000
    assert storage.load_state().energy == 10_000_000

    # 超额退款拒绝
    ok, deducted, err = mgr.refund_external_revenue(storage, external_tx_id="tx_refund_flow", refund_amount=1.0)
    assert ok is False
    assert err == "ALREADY_FULLY_REFUNDED"


def test_refund_deficit_handling_when_energy_spent(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    storage = PixelStorage(tmp_path / "pixels" / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=0))

    mgr = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)
    mgr.credit_external_revenue(storage, net_amount=5.0, external_tx_id="tx_spent")
    assert storage.load_state().energy == 5_000_000

    # 模拟能量已被消耗，只剩下 500,000
    s = storage.load_state()
    s.energy = 500_000
    storage.save_state(s)

    # 申请全额退款 5.0 元（折合 5,000,000 tokens）
    ok, deducted, err = mgr.refund_external_revenue(storage, external_tx_id="tx_spent")
    assert ok is True
    assert deducted == 500_000  # 扣除了全部剩余 500,000
    end_state = storage.load_state()
    assert end_state.energy == 0
    assert end_state.active is False  # 能量归零失活


def test_api_revenue_credit_and_refund(tmp_path):
    from fastapi.testclient import TestClient
    from emergentinc.ui.app import create_app
    from emergentinc.paths import get_paths

    paths = get_paths(tmp_path)

    # 初始化一个 pixel
    px = paths.live_root / "pixels" / "0_0_0"
    px.mkdir(parents=True, exist_ok=True)
    s = PixelStorage(px)
    s.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=500))

    app = create_app(paths)
    client = TestClient(app)

    # 1. 验证 HTTP 写端点已断开 (404/405)
    resp_credit = client.post("/api/revenue/credit", json={"pixel_id": "0_0_0", "net_amount": 2.0, "tx_id": "api_tx_100"})
    assert resp_credit.status_code in (404, 405)
    resp_refund = client.post("/api/revenue/refund", json={"pixel_id": "0_0_0", "tx_id": "api_tx_100", "refund_amount": 1.0})
    assert resp_refund.status_code in (404, 405)

    # 2. 验证底层 EnergyManager 核心充值与退款功能完整可用
    mgr = EnergyManager(paths.workspace_root / "ledger" / "energy_ledger.jsonl")
    res1 = mgr.credit_external_revenue(s, 2.0, "api_tx_100")
    assert res1.ok is True
    assert res1.status == "CREDITED"
    assert res1.tokens == 2_000_000

    # 幂等重放
    res2 = mgr.credit_external_revenue(s, 2.0, "api_tx_100")
    assert res2.ok is True
    assert res2.status == "ALREADY_CREDITED"

    # 退款
    ok_ref, tok_ded, err_ref = mgr.refund_external_revenue(s, "api_tx_100", 1.0, "user_cancelled")
    assert ok_ref is True
    assert tok_ded == 1_000_000
