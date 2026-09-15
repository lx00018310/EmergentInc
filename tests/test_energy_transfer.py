import pytest
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_energy_transfer_conservation(tmp_path):
    s1 = PixelStorage(tmp_path / "0_0_0")
    s2 = PixelStorage(tmp_path / "1_0_0")
    s1.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=5000))
    s2.save_state(PixelState(id="1_0_0", position=[1, 0, 0], active=True, energy=2000))

    mgr = EnergyManager(tmp_path / "ledger.jsonl")

    # 转账 1500
    ok, tx_id = mgr.transfer_energy(s1, s2, 1500, ref_message_id="msg_001")
    assert ok is True
    assert s1.load_state().energy == 3500
    assert s2.load_state().energy == 3500
    # 总额守恒
    assert s1.load_state().energy + s2.load_state().energy == 7000


def test_negative_or_insufficient_energy_transfer_rejected(tmp_path):
    s1 = PixelStorage(tmp_path / "0_0_0")
    s2 = PixelStorage(tmp_path / "1_0_0")
    s1.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=100))
    s2.save_state(PixelState(id="1_0_0", position=[1, 0, 0], active=True, energy=100))

    mgr = EnergyManager(tmp_path / "ledger.jsonl")

    # 负数转账拒绝
    ok, err = mgr.transfer_energy(s1, s2, -50)
    assert ok is False

    # 超额转账拒绝
    ok, err = mgr.transfer_energy(s1, s2, 500)
    assert ok is False
    assert "Insufficient energy" in err
