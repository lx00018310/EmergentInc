import pytest
from pathlib import Path
from emergentinc.engine.persistence import SnapshotManager
from emergentinc.engine.pixel import PixelStorage, PixelState


def test_loop_snapshot_and_rollback_budget_protection(tmp_path):
    live = tmp_path / "live"
    p0_dir = live / "pixels" / "0_0_0"
    p0_storage = PixelStorage(p0_dir)
    p0_storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=10000))
    p0_storage.save_pixel_md("Round 1 Idea")

    env_file = live / "environment.md"
    env_file.parent.mkdir(parents=True, exist_ok=True)
    env_file.write_text("Env Version 1", encoding="utf-8")

    mgr = SnapshotManager(tmp_path)

    # 1. 创建快照
    snap_dir = mgr.create_snapshot(round_num=1, tag="r1")
    snap_id = snap_dir.name

    # 2. 状态发生演变 (花掉 6000 能量，改写心智和环境)
    p0_storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=4000))
    p0_storage.save_pixel_md("Round 2 Failed Idea")
    env_file.write_text("Env Version 2", encoding="utf-8")

    # 3. 回滚认知状态
    mgr.restore_cognitive_state(snap_id)

    # 4. 验证心智和环境恢复至快照，但已消耗的能量不可凭空恢复
    assert p0_storage.load_pixel_md() == "Round 1 Idea"
    assert env_file.read_text(encoding="utf-8") == "Env Version 1"
    # 能量仍为 4000，不可撤销实际支出！
    assert p0_storage.load_state().energy == 4000
