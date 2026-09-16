from types import SimpleNamespace

import pytest

from emergentinc.engine.audit import audit_workspace, generate_run_report
from emergentinc.engine.core_store import CoreStoreError
from emergentinc.engine.llm import V9LLMClient, LLMInfrastructureError
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.utils import write_json
from emergentinc.engine.world import World
from emergentinc.ui.run_controller import RunController
from emergentinc.ui.workspace_lock import WorkspaceLock


def setup_world(tmp_path):
    World(tmp_path / "live/pixels").init_genesis()
    write_json(tmp_path / "live/world_state.json", {"round": 0})
    scheduler = V9RoundScheduler(tmp_path, mock_handler=lambda _: {"pixel_md": "alive", "send_to": ["STOP"]})
    scheduler.core_store.ensure_pixel_account("0_0_0", 100_000_000)
    return scheduler


def test_two_consecutive_runs_20_plus_10_are_auditable(tmp_path, monkeypatch):
    setup_world(tmp_path)

    class LocalScheduler(V9RoundScheduler):
        def __init__(self, ws):
            super().__init__(ws, mock_handler=lambda _: {"pixel_md": "alive", "send_to": ["STOP"]})

        def run_round(self, **kwargs):
            self.router.send_message("ENGINE", "0_0_0", "tick", hop=0)
            return super().run_round(**kwargs)

    monkeypatch.setattr("emergentinc.engine.scheduler.V9RoundScheduler", LocalScheduler)
    controller = RunController(tmp_path)
    for rounds in (20, 10):
        controller.start(rounds, run_budget_tokens=1_000_000, global_budget_tokens=10_000_000)
        controller._worker_thread.join(30)
        status = controller.status()
        assert not status["running"]
        assert status["result_status"] == "COMPLETED", status
        assert status["model_calls_completed"] == rounds
        report = generate_run_report(tmp_path, status["current_loop"])
        assert report["calls_count"] == rounds
        assert report["spent_tokens"] > 0
        assert report["audit"]["allowed_to_start"], report
    assert controller.status()["current_round"] == 30


def test_later_infra_failure_preserves_committed_round(tmp_path):
    scheduler = setup_world(tmp_path)
    calls = []

    def handler(_):
        calls.append(1)
        if len(calls) == 2:
            raise LLMInfrastructureError("rejected")
        return {"pixel_md": "first committed", "send_to": ["STOP"]}

    scheduler.llm.mock_handler = handler
    for _ in range(2):
        scheduler.router.send_message("ENGINE", "0_0_0", "tick", hop=0)
    with pytest.raises(LLMInfrastructureError):
        scheduler.run_round()
    assert scheduler.load_world_state()["round"] == 1
    assert audit_workspace(tmp_path).allowed_to_start
    assert len(scheduler.router.queue) == 1


def test_internal_type_error_never_retries_a_call(tmp_path):
    scheduler = setup_world(tmp_path)
    calls = []

    def handler(_):
        calls.append(1)
        raise TypeError("internal provider adapter bug")

    scheduler.llm.mock_handler = handler
    scheduler.router.send_message("ENGINE", "0_0_0", "tick", hop=0)
    assert scheduler.run_round()["stop_reason"] == "PAUSED_RECOVERY_REQUIRED"
    assert len(calls) == 1


def test_response_and_settlement_rollback_together(tmp_path, monkeypatch):
    scheduler = setup_world(tmp_path)
    store = scheduler.core_store
    store.create_run("run", run_limit=10000, global_limit=100000)
    ok, call_id, _ = store.reserve_call_budget("run", "0_0_0", 100)
    assert ok

    def fail(**kwargs):
        raise RuntimeError("record write failed")

    monkeypatch.setattr(store, "record_model_call", fail)
    with pytest.raises(CoreStoreError):
        store.settle_call_budget(call_id, 10, model_call={"call_id": call_id})
    assert len(store.get_unresolved_reservations()) == 1
    assert store.get_run("run")["run_spent"] == 0


def test_promote_repaired_response_is_atomic_and_one_time(tmp_path):
    scheduler = setup_world(tmp_path)
    store = scheduler.core_store
    store.create_run("run", run_limit=10000, global_limit=100000)
    message_id = scheduler.router.send_message("ENGINE", "0_0_0", "tick", hop=0)
    store.enqueue_message(message_id, "ENGINE", "0_0_0", "tick", 1, 0, run_id="run")
    ok, call_id, _ = store.reserve_call_budget("run", "0_0_0", 100, message_id=message_id)
    assert ok
    store.settle_call_budget(call_id, 10, outcome="FAILED_RESPONSE", model_call={
        "call_id": call_id, "run_id": "run", "pixel_id": "0_0_0",
        "message_id": message_id, "model": "mock", "prompt_hash": "hash",
        "raw_response": '{"send_to":["STOP"]}', "normalized_response": "",
        "outcome": "FAILED_RESPONSE",
    })
    store.transition_message(message_id, "QUEUED")
    normalized = '{"send_to":["STOP"]}'
    assert store.promote_repaired_response(call_id, normalized)
    assert store.get_message(message_id)["status"] == "RESPONSE_STORED"
    assert store.get_model_call_by_message(message_id)["outcome"] == "REPAIRED_RESPONSE"
    assert not store.promote_repaired_response(call_id, normalized)


def test_workspace_lock_rejects_second_instance_and_releases(tmp_path):
    with WorkspaceLock(tmp_path):
        with pytest.raises(RuntimeError, match="WORKSPACE_IN_USE"):
            with WorkspaceLock(tmp_path):
                pass
    with WorkspaceLock(tmp_path):
        pass


def test_run_server_reuses_verified_existing_instance(tmp_path, monkeypatch):
    from emergentinc.ui import app as app_module
    opened = []
    with WorkspaceLock(tmp_path):
        monkeypatch.setattr(app_module, "is_emergentinc_server", lambda url: True)
        monkeypatch.setattr(app_module.webbrowser, "open", opened.append)
        result = app_module.run_server(port=8765, workspace=tmp_path)
    assert result == "REUSED_EXISTING_SERVER"
    assert opened == ["http://127.0.0.1:8765"]


def test_run_server_does_not_reuse_unverified_port(tmp_path, monkeypatch):
    from emergentinc.ui import app as app_module
    with WorkspaceLock(tmp_path):
        monkeypatch.setattr(app_module, "is_emergentinc_server", lambda url: False)
        with pytest.raises(RuntimeError, match="WORKSPACE_IN_USE"):
            app_module.run_server(port=8765, workspace=tmp_path)


def test_audit_api_defers_during_run(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    from emergentinc.ui.app import create_app
    setup_world(tmp_path)
    controller = RunController(tmp_path)
    monkeypatch.setattr("emergentinc.ui.api.RunController", lambda _: controller)
    app = create_app(tmp_path)
    controller._running = True
    with TestClient(app) as client:
        result = client.get("/api/audit/workspace").json()
        assert result["audit_status"] == "DEFERRED_RUNNING"
        assert not result["recovery_required"]
        controller._running = False
        assert client.get("/api/audit/workspace").json()["allowed_to_start"]


def test_snapshot_failure_does_not_leave_worker_or_loop_running(tmp_path, monkeypatch):
    setup_world(tmp_path)
    controller = RunController(tmp_path)
    original = controller.loop_store.finish_loop

    def finish(*args, **kwargs):
        def fail(*a, **k):
            raise OSError("snapshot disk failure")
        with monkeypatch.context() as m:
            m.setattr("emergentinc.ui.loop_store.snapshot.create_snapshot", fail)
            return original(*args, **kwargs)

    monkeypatch.setattr(controller.loop_store, "finish_loop", finish)
    controller.start(1)
    controller._worker_thread.join(10)
    status = controller.status()
    assert not status["running"]
    assert status["result_status"] == "ERROR"
    assert "FINALIZATION_FAILED" in status["last_error"]
    assert controller.loop_store.get_loop(status["current_loop"])["status"] == "ERROR"


def test_missing_usage_is_not_invented_or_refunded(tmp_path):
    client = V9LLMClient()
    client.client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(
        create=lambda **_: SimpleNamespace(usage=None, choices=[]))))
    with pytest.raises(RuntimeError, match="CALL_USAGE_UNKNOWN"):
        client.step({"id": "0_0_0"}, "mind", "tick")


def test_deferred_message_not_duplicated_after_reload(tmp_path):
    from emergentinc.engine.router import MessageRouter
    scheduler = setup_world(tmp_path)
    scheduler.router.send_message("ENGINE", "0_0_0", "tick", hop=0)
    scheduler.router.pop_next()
    scheduler.router.defer_in_progress()
    restored = MessageRouter(scheduler.world, scheduler.queue_file)
    assert restored.current_in_progress is None
    assert len(restored.queue) + len(restored.delayed_queue) == 1


def test_start_db_failure_closes_snapshot_loop(tmp_path, monkeypatch):
    setup_world(tmp_path)
    controller = RunController(tmp_path)
    def fail(*args, **kwargs):
        raise RuntimeError("database failure")
    monkeypatch.setattr("emergentinc.engine.core_store.CoreStore.create_run", fail)
    with pytest.raises(RuntimeError, match="database failure"):
        controller.start(1)
    assert not controller.status()["running"]
    assert all(loop["status"] == "ERROR" for loop in controller.loop_store.list_loops())
