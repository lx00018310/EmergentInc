import pytest
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_energy_call_reserve_and_settle(tmp_path):
    storage = PixelStorage(tmp_path / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=10000))

    mgr = EnergyManager(tmp_path / "ledger.jsonl")

    # 预留 2000
    ok, call_id = mgr.reserve_budget(storage, 2000)
    assert ok is True
    assert storage.load_state().energy == 8000

    # 实际消耗 1500，退还 500
    mgr.settle_budget(storage, call_id, 1500)
    assert storage.load_state().energy == 8500


def test_insufficient_energy_cannot_reserve(tmp_path):
    storage = PixelStorage(tmp_path / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=500))

    mgr = EnergyManager(tmp_path / "ledger.jsonl")
    ok, err = mgr.reserve_budget(storage, 1000)
    assert ok is False
    assert "INSUFFICIENT_ENERGY" in err
    assert storage.load_state().energy == 500
