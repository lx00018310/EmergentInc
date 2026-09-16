import json
from pathlib import Path
import tempfile
import time
from unittest.mock import MagicMock, patch

from emergentinc.engine.storage import Storage
from emergentinc.ui.run_controller import RunController


def test_run_controller_stop(tmp_path):
    base = Path(tmp_path)
    live = base / "live"
    live.mkdir(parents=True)
    (live / "world_state.json").write_text(
        json.dumps({
            "round": 0,
            "counters": {},
            "llm_accounting": {},
            "accounting": {},
        }),
        encoding="utf-8",
    )
    (live / "pixels").mkdir(parents=True)

    storage = Storage(base)
    storage.ensure_v5_defaults()

    controller = RunController(base)

    mock_scheduler = MagicMock()

    def mock_step(**kwargs):
        stop_req = kwargs.get("stop_requested")
        if stop_req and stop_req():
            return {"round": int(storage.world().get("round", 0)), "stop_reason": "USER_STOPPED"}
        time.sleep(0.04)
        w = storage.world()
        w["round"] = int(w.get("round", 0)) + 1
        storage.save_world(w)
        return {"round": w["round"], "messages_processed": 1, "model_calls_completed": 1}

    mock_scheduler.run_round.side_effect = mock_step

    with patch.object(controller, "_get_scheduler", return_value=mock_scheduler):
        controller.start(rounds=10, command_text="run 10")
        assert controller.status()["running"] is True

        time.sleep(0.06)
        controller.request_stop()

        # Wait for worker thread to finish
        for _ in range(40):
            if not controller.status()["running"]:
                break
            time.sleep(0.05)

        st = controller.status()
        assert st["running"] is False
        assert st["stop_requested"] is True
        assert st["stop_reason"] == "USER_STOPPED"
        assert st["completed_rounds"] < 10


def test_start_failure_during_log_command_sets_error_in_db_and_controller(tmp_path):
    """验证 create_run 后若启动步骤失败，状态被原子收尾为 ERROR，不留假死 RUNNING."""
    import pytest
    from emergentinc.engine.core_store import CoreStore
    base = Path(tmp_path)
    (base / "live" / "pixels").mkdir(parents=True)
    (base / "live" / "world_state.json").write_text(json.dumps({"round": 0}), encoding="utf-8")
    controller = RunController(base)

    # 模拟 _log_command 写入失败
    def fail_log(*args, **kwargs):
        raise OSError("disk full during log_command")

    controller._log_command = fail_log

    with pytest.raises(OSError, match="disk full during log_command"):
        controller.start(1)

    status = controller.status()
    assert status["running"] is False
    assert status["result_status"] == "ERROR"
    assert "START_FAILED" in status["last_error"]
    assert "disk full" in status["last_error"]

    # 验证数据库中该 run 状态已被收尾为 ERROR，而非残留 RUNNING
    run_id = status["run_id"]
    db_path = base / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)
    db_run = store.get_run(run_id)
    assert db_run["status"] == "ERROR"
    assert "START_FAILED" in db_run["stop_reason"]

