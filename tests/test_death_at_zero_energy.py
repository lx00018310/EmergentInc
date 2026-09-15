import pytest
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_death_at_zero_energy(tmp_path):
    storage = PixelStorage(tmp_path / "0_0_0")
    storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=1000))
    storage.save_pixel_md("Memory before death")

    mgr = EnergyManager(tmp_path / "ledger.jsonl")

    # 预留 1000
    ok, call_id = mgr.reserve_budget(storage, 1000)
    assert ok is True

    # 实际结算 1500 (透支/超额扣款，导致余额变为 -500 <= 0)
    mgr.settle_budget(storage, call_id, 1500)

    st = storage.load_state()
    assert st.energy <= 0
    assert st.active is False

    # 验证目录、状态文件和心智文件依然完整保留
    assert storage.state_file.exists()
    assert storage.pixel_file.exists()
    assert storage.load_pixel_md() == "Memory before death"
