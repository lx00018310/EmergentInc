import pytest
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_reproduction_energy_conservation(tmp_path):
    p_storage = PixelStorage(tmp_path / "0_0_0")
    c_storage = PixelStorage(tmp_path / "1_0_0")
    p_storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=10000))

    mgr = EnergyManager(tmp_path / "ledger.jsonl")

    # 划拨 4000 繁殖子代
    ok, err = mgr.allocate_reproduction(
        parent_storage=p_storage,
        child_storage=c_storage,
        child_energy=4000,
        child_pos=[1, 0, 0],
        child_pixel_md="Initial child mind",
        current_round=1,
    )
    assert ok is True
    parent_st = p_storage.load_state()
    child_st = c_storage.load_state()

    assert parent_st.energy == 6000
    assert child_st.energy == 4000
    assert parent_st.energy + child_st.energy == 10000
    assert child_st.parent == "0_0_0"
    assert child_st.generation == 1
    assert c_storage.load_pixel_md() == "Initial child mind"


def test_reproduction_cannot_exceed_parent_energy(tmp_path):
    p_storage = PixelStorage(tmp_path / "0_0_0")
    c_storage = PixelStorage(tmp_path / "1_0_0")
    p_storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=2000))

    mgr = EnergyManager(tmp_path / "ledger.jsonl")

    ok, err = mgr.allocate_reproduction(
        parent_storage=p_storage,
        child_storage=c_storage,
        child_energy=3000,
        child_pos=[1, 0, 0],
        child_pixel_md="Initial child mind",
        current_round=1,
    )
    assert ok is False
    assert "insufficient energy" in err
    assert p_storage.load_state().energy == 2000
