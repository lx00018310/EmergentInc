import json

import pytest

from emergentinc.engine.world import World
from emergentinc.engine.audit import audit_workspace
from emergentinc.engine.core_store import CoreStore
from emergentinc.paths import get_paths
from emergentinc.ui.loop_store import LoopStore
from emergentinc.ui.run_controller import RunController


def _make_world(tmp_path, *, world_round: int = 0, last_active_round: int = 0):
    project_root = tmp_path / "project"
    paths = get_paths(project_root)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    paths.loops_root.mkdir(parents=True, exist_ok=True)
    paths.ui_state_root.mkdir(parents=True, exist_ok=True)
    (paths.workspace_root / "ledger").mkdir(parents=True, exist_ok=True)

    world = World(paths.live_root / "pixels")
    storage = world.init_genesis(initial_energy=100_000_000, initial_pixel_md="# Genesis")
    state = storage.load_state()
    state.last_active_round = last_active_round
    storage.save_state(state)
    (paths.live_root / "world_state.json").write_text(
        json.dumps({"round": world_round, "active_pixels": 1, "total_messages": 0}),
        encoding="utf-8",
    )
    return paths


def test_empty_round_is_reported_as_no_activity_not_normal_api_success(tmp_path):
    paths = _make_world(tmp_path, world_round=0, last_active_round=0)
    controller = RunController(paths)

    controller.start(
        rounds=1,
        command_text="run 1",
        run_budget_tokens=100_000,
        global_budget_tokens=1_000_000,
    )
    assert controller._worker_thread is not None
    controller._worker_thread.join(timeout=5)

    status = controller.status()
    assert status["running"] is False
    assert status["completed_rounds"] == 1
    assert status["messages_processed"] == 0
    assert status["model_calls_completed"] == 0
    assert status["idle_rounds"] == 1
    assert status["result_status"] == "COMPLETED_NO_ACTIVITY"

    loop = controller.loop_store.get_loop(status["current_loop"])
    assert loop is not None
    assert loop["status"] == "COMPLETED_NO_ACTIVITY"


def test_startup_audit_blocks_pixel_round_ahead_of_world(tmp_path):
    paths = _make_world(tmp_path, world_round=12, last_active_round=13)
    controller = RunController(paths)

    with pytest.raises(RuntimeError, match="Pixel round state is ahead of world round"):
        controller.start(
            rounds=1,
            command_text="run 1",
            run_budget_tokens=100_000,
            global_budget_tokens=1_000_000,
        )

    assert controller.status()["running"] is False
    assert controller.storage.world()["round"] == 12


def test_recovery_required_is_not_overwritten_as_no_activity(tmp_path, monkeypatch):
    paths = _make_world(tmp_path, world_round=0, last_active_round=0)

    class PausedScheduler:
        def __init__(self, workspace_root):
            self.workspace_root = workspace_root

        def run_round(self, **kwargs):
            return {
                "round": 1,
                "messages_processed": 1,
                "model_calls_completed": 0,
                "steps": [],
                "stop_reason": "PAUSED_RECOVERY_REQUIRED",
                "stop_detail": "CALL_OUTCOME_UNKNOWN: provider timeout",
            }

    import emergentinc.engine.scheduler as scheduler_module
    monkeypatch.setattr(scheduler_module, "V9RoundScheduler", PausedScheduler)

    controller = RunController(paths)
    controller.start(
        rounds=1,
        command_text="run 1",
        run_budget_tokens=100_000,
        global_budget_tokens=1_000_000,
    )
    assert controller._worker_thread is not None
    controller._worker_thread.join(timeout=5)

    status = controller.status()
    assert status["result_status"] == "PAUSED_RECOVERY_REQUIRED"
    assert status["last_error"] == "CALL_OUTCOME_UNKNOWN: provider timeout"
    loop = controller.loop_store.get_loop(status["current_loop"])
    assert loop["status"] == "PAUSED_RECOVERY_REQUIRED"
    assert loop["stop_reason"] == "CALL_OUTCOME_UNKNOWN: provider timeout"


def test_audit_does_not_treat_active_run_transaction_as_stale_recovery(tmp_path):
    paths = _make_world(tmp_path, world_round=0, last_active_round=0)
    loop = LoopStore(paths).start_loop(command_text="active run", start_round=0)
    run_id = loop["id"]

    store = CoreStore(paths.workspace_root / "ledger" / "v9_core.sqlite3")
    store.ensure_global_budget(1_000_000)
    store.ensure_pixel_account("0_0_0", initial_energy=100_000_000)
    store.create_run(
        run_id=run_id,
        run_limit=100_000,
        global_limit=1_000_000,
        loop_id=run_id,
        start_round=1,
    )
    ok, _, _ = store.reserve_call_budget(
        run_id=run_id,
        pixel_id="0_0_0",
        estimated_tokens=100,
        message_id="active_message",
    )
    assert ok
    store.sync_account_to_storage(
        "0_0_0",
        World(paths.live_root / "pixels").get_pixel_storage("0_0_0"),
    )

    active_audit = audit_workspace(
        paths.workspace_root,
        run_id=run_id,
        active_run_id=run_id,
    )
    assert active_audit.unsettled_reservations == []
    assert active_audit.stale_running_loops == []
    assert active_audit.energy_difference == 0
    assert active_audit.allowed_to_start

    inactive_audit = audit_workspace(paths.workspace_root, run_id=run_id)
    assert len(inactive_audit.unsettled_reservations) == 1
    assert len(inactive_audit.stale_running_loops) == 1
    assert not inactive_audit.allowed_to_start


def test_controller_stops_cleanly_after_committed_owner_request(tmp_path, monkeypatch):
    paths = _make_world(tmp_path, world_round=0, last_active_round=0)

    class OwnerRequestScheduler:
        def __init__(self, workspace_root):
            self.workspace_root = workspace_root

        def run_round(self, **kwargs):
            world_file = self.workspace_root / "live" / "world_state.json"
            world = json.loads(world_file.read_text(encoding="utf-8"))
            world["round"] = 1
            world_file.write_text(json.dumps(world), encoding="utf-8")
            return {
                "round": 1,
                "messages_processed": 1,
                "model_calls_completed": 1,
                "steps": [{"pixel_id": "0_0_0", "hop": 1, "send_to": []}],
                "stop_reason": "OWNER_ACTION_REQUIRED",
                "stop_detail": "Pending owner request: req_1_test",
                "owner_requests": ["req_1_test"],
            }

    import emergentinc.engine.scheduler as scheduler_module
    monkeypatch.setattr(scheduler_module, "V9RoundScheduler", OwnerRequestScheduler)

    controller = RunController(paths)
    controller.start(rounds=10, command_text="run 10")
    assert controller._worker_thread is not None
    controller._worker_thread.join(timeout=5)

    status = controller.status()
    assert status["result_status"] == "STOPPED"
    assert status["stop_reason"] == "OWNER_ACTION_REQUIRED"
    assert status["pending_owner_requests"] == ["req_1_test"]
    loop = controller.loop_store.get_loop(status["current_loop"])
    assert loop["status"] == "STOPPED"
    assert loop["end_round"] == 1
