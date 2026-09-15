import pytest
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_immutable_ledger_revenue_and_audit(tmp_path):
    ledger_path = tmp_path / "energy_ledger.jsonl"
    storage = PixelStorage(tmp_path / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=10000))

    mgr = EnergyManager(ledger_path=ledger_path, cost_per_million_equivalent_tokens=1.0)

    # 外部净回款 10.0 CNY，换算 10,000,000 等效 Token
    ok, tokens = mgr.credit_external_revenue(
        storage, net_amount=10.0, external_tx_id="tx_alipay_123456"
    )
    assert ok is True
    assert tokens == 10_000_000
    assert storage.load_state().energy == 10_010_000

    # 验证账本文件中存在该记录
    content = ledger_path.read_text(encoding="utf-8")
    assert "tx_alipay_123456" in content
    assert "revenue" in content
