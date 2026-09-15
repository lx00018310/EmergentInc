import pytest
from pathlib import Path
from emergentinc.ui.world_reader import WorldReader
from emergentinc.engine.pixel import PixelStorage, PixelState
from emergentinc.paths import get_paths


def test_world_reader_v9_dto(tmp_path):
    live = tmp_path / "live"
    p0_dir = live / "pixels" / "0_0_0"
    p0_storage = PixelStorage(p0_dir)
    p0_storage.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=100000000))
    p0_storage.save_pixel_md("# Genesis Mind\nExploring.")

    env_file = live / "environment.md"
    env_file.parent.mkdir(parents=True, exist_ok=True)
    env_file.write_text("External Reality Target", encoding="utf-8")

    reader = WorldReader(tmp_path)
    dto = reader.get_world_dto()

    # 1. 验证顶层核心字段
    assert "round" in dto
    assert "pixels" in dto
    assert "environment_md" in dto
    assert "metrics" in dto
    assert "latest_message_flow" in dto

    # 2. 验证元胞数据纯净性
    assert len(dto["pixels"]) == 1
    p = dto["pixels"][0]
    assert p["id"] == "0_0_0"
    assert p["energy"] == 100000000
    assert p["pixel_md"] == "# Genesis Mind\nExploring."
    assert p["artifacts_count"] == 0

    # 严格确保废除的字段不在元胞 DTO 中
    for forbidden in ["genome", "memory", "current_problem", "grace_remaining"]:
        assert forbidden not in p

    # 3. 验证白名单文档获取
    state_doc = reader.get_pixel_document("0_0_0", "state")
    assert "0_0_0" in state_doc
    assert "100000000" in state_doc

    pixel_doc = reader.get_pixel_document("0_0_0", "pixel")
    assert pixel_doc == "# Genesis Mind\nExploring."

    env_doc = reader.get_pixel_document("0_0_0", "environment")
    assert env_doc == "External Reality Target"

    # 非法文档应当报错
    with pytest.raises(ValueError):
        reader.get_pixel_document("0_0_0", "unauthorized_doc")
    with pytest.raises(ValueError):
        reader.get_pixel_document("0_0_0", "../../private/secret")
