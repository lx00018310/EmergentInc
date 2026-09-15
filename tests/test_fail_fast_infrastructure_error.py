import pytest
from pathlib import Path
from emergentinc.engine.llm import V9LLMClient, LLMInfrastructureError
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.ui.run_controller import RunController
from emergentinc.paths import ProjectPaths


def test_scheduler_fail_fast_on_infrastructure_error(tmp_path):
    """验证遇到基础设施故障时：全额退还能量、不推进轮次、消息不丢、立即向上熔断."""
    workspace = tmp_path / "workspace"
    workspace.mkdir(parents=True, exist_ok=True)
    live = workspace / "live"
    live.mkdir(parents=True, exist_ok=True)
    pixels_dir = live / "pixels"
    pixels_dir.mkdir(parents=True, exist_ok=True)

    # 初始化 0_0_0
    from emergentinc.engine.world import World
    w = World(pixels_dir)
    storage = w.init_genesis(initial_energy=100_000_000, initial_pixel_md="# Genesis")

    # 模拟一个会抛出基础设施故障的 handler
    def mock_infra_fail(payload):
        raise LLMInfrastructureError("API_INFRASTRUCTURE_FAILURE: Proxy service is currently disabled")

    scheduler = V9RoundScheduler(workspace, mock_handler=mock_infra_fail)

    # 注入一条待处理消息以触发调度调用
    msg = scheduler.router.create_message("ENGINE", "0_0_0", "Init ping", 1, 0)
    scheduler.router.enqueue([msg])

    # 验证执行 run_round 必须抛出 LLMInfrastructureError
    with pytest.raises(LLMInfrastructureError) as exc_info:
        scheduler.run_round()

    assert "Proxy service is currently disabled" in str(exc_info.value)

    # 验证元胞能量全额退还，0 扣除！
    state = storage.load_state()
    assert state.energy == 100_000_000, f"Expected 100,000,000, got {state.energy}"

    # 验证世界轮次没有被空转推进
    world_state = scheduler.load_world_state()
    assert world_state.get("round", 0) == 0


def test_run_controller_halts_on_infrastructure_error(tmp_path):
    """验证 RunController 在 API 故障时立即终止并报告 ERROR，绝不空转推进后续轮次."""
    from emergentinc.paths import get_paths
    project_root = tmp_path / "proj"
    project_root.mkdir(parents=True, exist_ok=True)
    paths = get_paths(project_root)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.loops_root.mkdir(parents=True, exist_ok=True)
    paths.ui_state_root.mkdir(parents=True, exist_ok=True)
    (paths.workspace_root / "ledger").mkdir(parents=True, exist_ok=True)

    from emergentinc.engine.world import World
    w = World(paths.live_root / "pixels")
    w.init_genesis(initial_energy=100_000_000, initial_pixel_md="# Genesis")

    ctrl = RunController(paths)

    # Monkeypatch V9RoundScheduler 的 step 为抛出 LLMInfrastructureError
    from emergentinc.engine.scheduler import V9RoundScheduler
    orig_init = V9RoundScheduler.__init__

    def patched_init(self, ws, *args, **kwargs):
        def bad_mock(p):
            raise LLMInfrastructureError("Proxy service is currently disabled")
        orig_init(self, ws, mock_handler=bad_mock)
        # 注入一条待处理消息
        msg = self.router.create_message("ENGINE", "0_0_0", "Init ping", 1, 0)
        self.router.enqueue([msg])

    monkey = pytest.MonkeyPatch()
    monkey.setattr("emergentinc.engine.scheduler.V9RoundScheduler", type("PatchedScheduler", (V9RoundScheduler,), {"__init__": patched_init}))

    try:
        ctrl.start(rounds=10, command_text="RUN 10")
        if ctrl._worker_thread:
            ctrl._worker_thread.join(timeout=5.0)

        st = ctrl.status()
        assert st["running"] is False
        assert st["completed_rounds"] == 0, f"Completed rounds should be 0, got {st['completed_rounds']}"
        assert "Proxy service is currently disabled" in (st["last_error"] or "")
    finally:
        monkey.undo()
