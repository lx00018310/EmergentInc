import json
import tempfile
from pathlib import Path

import jsonschema
import pytest

from emergentinc.cli.init_workspace import init_workspace
from emergentinc.paths import get_paths
from emergentinc.ui.world_reader import WorldReader


def test_work_output_schema_rejects_empty_object():
    paths = get_paths()
    schema = json.loads(
        (paths.schemas_dir / "pixel_action.schema.json").read_text(encoding="utf-8")
    )
    action = {
        "pixel": "0_0_0",
        "round": 1,
        "action": "WORK",
        "reasoning_summary": "形成本轮成果",
        "problem_id": "P0001",
        "work_output": {},
    }

    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(action, schema)

    action["work_output"] = {
        "summary": "形成可审查的商业假设",
        "details": ["目标用户为小型独立开发团队"],
    }
    jsonschema.validate(action, schema)


def test_world_dto_exposes_latest_pixel_activity():
    with tempfile.TemporaryDirectory() as tmpdir:
        workspace = Path(tmpdir) / "workspace"
        init_workspace(workspace)
        paths = get_paths(workspace)

        world_path = paths.live_root / "world_state.json"
        world = json.loads(world_path.read_text(encoding="utf-8"))
        world["round"] = 3
        world_path.write_text(
            json.dumps(world, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        rounds_dir = paths.live_root / "rounds"
        rounds_dir.mkdir(parents=True, exist_ok=True)
        (rounds_dir / "round_0003.json").write_text(
            json.dumps(
                {
                    "round": 3,
                    "decisions": {
                        "0_0_0": {
                            "pixel": "0_0_0",
                            "round": 3,
                            "action": "WORK",
                            "reasoning_summary": "验证商业假设",
                            "problem_id": "P0001",
                            "work_output": {
                                "summary": "已形成假设",
                                "details": ["先访谈三名目标用户"],
                            },
                        }
                    },
                    "applied": [{"pixel": "0_0_0"}],
                    "rejected": [],
                    "skipped_idle": [],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        pixel = WorldReader(paths).get_world_dto()["pixels"][0]
        activity = pixel["latest_activity"]
        assert activity["round"] == 3
        assert activity["action"] == "WORK"
        assert activity["result"] == "APPLIED"
        assert activity["work_output"]["summary"] == "已形成假设"


def test_pixel_card_uses_nested_tendencies_and_auto_selects():
    paths = get_paths()
    source = (paths.project_root / "emergentinc" / "ui" / "static" / "pixel_map.js").read_text(
        encoding="utf-8"
    )
    assert "gn.tendencies || gn" in source
    assert "this.pixels.find(p => p.active) || this.pixels[0]" in source
    assert "hover-last-action" in source
