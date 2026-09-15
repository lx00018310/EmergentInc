import json
import os
import re
import tempfile
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from emergentinc.cli.init_workspace import init_workspace
from emergentinc.engine.runner import RoundRunner
from emergentinc.engine.storage import Storage
from emergentinc.paths import ProjectPaths, get_paths
from emergentinc.ui.loop_store import LoopStore


def test_paths_outside_cwd():
    """要求 1: 从仓库根目录之外启动，仍能正确定位 resources 和 workspace."""
    p = get_paths()
    assert p.project_root.exists()
    assert p.resources_root.exists()
    assert (p.resources_root / "config" / "world_config.json").exists()
    assert (p.resources_root / "schemas" / "pixel_action.schema.json").exists()
    assert (p.resources_root / "prompts" / "pixel_decision_prompt.md").exists()
    assert p.workspace_root.name == "workspace"


def test_custom_workspace_isolation():
    """要求 2: --workspace 指向临时目录时，不读写默认工作区."""
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_ws = Path(tmpdir) / "custom_ws"
        init_workspace(temp_ws)

        s = Storage(temp_ws)
        assert s.live.parent == temp_ws
        assert s.world()["round"] == 0

        # 修改自定义工作区状态
        w = s.world()
        w["round"] = 42
        s.save_world(w)

        # 验证默认工作区未被触碰
        default_s = Storage()
        assert default_s.world()["round"] != 42


def test_round_output_boundary():
    """要求 3: 一个 Round 的所有输出只出现在 workspace/live/ 或 workspace/runtime/."""
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_ws = Path(tmpdir) / "test_ws"
        init_workspace(temp_ws)

        runner = RoundRunner(temp_ws)

        # Mock LLMClient so it doesn't make real network calls
        mock_audit = {
            "kind": "PIXEL_DECISION",
            "model": "mock",
            "prompt_hash": "hash",
            "sandbox_hash": "sandbox_hash_123",
            "token_usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        mock_decision = {
            "pixel": "0_0_0",
            "round": 1,
            "action": "IDLE",
            "reasoning_summary": "test idle",
        }
        runner.llm.decide = MagicMock(return_value=(mock_decision, mock_audit))

        runner.run_one()

        # 检查输出文件
        assert (temp_ws / "live" / "world_state.json").exists()
        assert (temp_ws / "live" / "world_state.md").exists()
        assert (temp_ws / "live" / "rounds" / "round_0001.json").exists()
        assert (temp_ws / "live" / "rounds" / "round_0001.md").exists()

        # 检查除 live, loops, runtime, cache, ui_state, scratch, private 之外没有生成任何根下垃圾
        allowed_top_dirs = {"live", "loops", "runtime", "cache", "ui_state", "scratch", "private"}
        actual_dirs = {p.name for p in temp_ws.iterdir()}
        assert actual_dirs.issubset(allowed_top_dirs)


def test_loop_checkpoints_snapshot():
    """要求 4: start/finish Loop 在 workspace/loops/checkpoints/<Loop ID>/before|after 生成完整快照."""
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_ws = Path(tmpdir) / "loop_ws"
        init_workspace(temp_ws)

        store = LoopStore(temp_ws)
        meta = store.start_loop("跑1轮", start_round=0)
        loop_id = meta["id"]

        ckpt_dir = temp_ws / "loops" / "checkpoints" / loop_id
        assert (ckpt_dir / "before" / "world_state.json").exists()
        assert (ckpt_dir / "before" / "pixels" / "0_0_0" / "state.json").exists()

        # finish loop
        store.finish_loop(loop_id, end_round=1, status="COMPLETED")
        assert (ckpt_dir / "after" / "world_state.json").exists()
        assert (ckpt_dir / "after" / "pixels" / "0_0_0" / "state.json").exists()
        assert (ckpt_dir / "meta.json").exists()


def test_checkout_restores_live_preserves_private():
    """要求 5: checkout/branch 恢复 workspace/live/，且不修改 workspace/private/."""
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_ws = Path(tmpdir) / "ckpt_ws"
        init_workspace(temp_ws)

        # 放置私有凭据
        private_secret = temp_ws / "private" / "secret.key"
        private_secret.write_text("SUPER_SECRET_KEY", encoding="utf-8")

        store = LoopStore(temp_ws)
        l1 = store.start_loop("step 1", 0)
        s = Storage(temp_ws)
        w = s.world()
        w["round"] = 1
        s.save_world(w)
        store.finish_loop(l1["id"], 1, "COMPLETED")

        # 进一步修改 live
        w["round"] = 99
        s.save_world(w)

        # checkout 回到 l1
        store.checkout_loop(l1["id"], "branch_test")
        assert s.world()["round"] == 1

        # 私有凭据完好无损
        assert private_secret.exists()
        assert private_secret.read_text(encoding="utf-8") == "SUPER_SECRET_KEY"


def test_init_workspace_rejects_non_empty():
    """要求 9: 初始化非空工作区必须失败，不能覆盖已有实验."""
    with tempfile.TemporaryDirectory() as tmpdir:
        temp_ws = Path(tmpdir) / "non_empty_ws"
        temp_ws.mkdir()
        (temp_ws / "existing_file.txt").write_text("already here", encoding="utf-8")

        with pytest.raises(FileExistsError):
            init_workspace(temp_ws)


def test_no_hardcoded_legacy_paths():
    """要求 10: 扫描仓库代码，除 paths.py、测试和迁移工具外，不应再出现旧顶层运行路径的硬编码."""
    proj_paths = get_paths()
    engine_dir = proj_paths.project_root / "emergentinc" / "engine"
    ui_dir = proj_paths.project_root / "emergentinc" / "ui"

    pattern = re.compile(
        r"""Path\(['"]?(pixels|problems|rounds|loops|runtime|owner_private)['"]?\)"""
    )

    violations = []
    for search_dir in [engine_dir, ui_dir]:
        for py_file in search_dir.rglob("*.py"):
            text = py_file.read_text(encoding="utf-8")
            for line_no, line in enumerate(text.splitlines(), start=1):
                if pattern.search(line):
                    violations.append(f"{py_file.name}:{line_no}: {line.strip()}")

    assert not violations, f"发现遗留路径硬编码: {violations}"
