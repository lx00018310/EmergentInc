"""针对 V9.5 规范的 Run 级硬预算端到端测试.

验收规则:
1. 生产 API 未提供预算或预算 <= 0 时强行拦截 (422 Unprocessable Entity);
2. Run 预算跨多个 Round 严格累计;
3. 达到或超额时必须安全停机 (BUDGET_EXHAUSTED)，状态持久化.
"""

import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from emergentinc.paths import get_paths
from emergentinc.engine.pixel import PixelStorage, PixelState
from emergentinc.engine.core_store import CoreStore
from emergentinc.ui.app import create_app
from emergentinc.engine.scheduler import V9RoundScheduler


def setup_pixel(ws: Path, pixel_id: str, energy: int = 50000):
    p_dir = ws / "live" / "pixels" / pixel_id
    storage = PixelStorage(p_dir)
    storage.save_state(PixelState(id=pixel_id, position=[0, 0, 0], active=True, energy=energy))
    storage.save_pixel_md(f"# Mind of {pixel_id}")
    db_path = ws / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.upsert_pixel_account(pixel_id, initial_energy=energy)


@pytest.fixture
def workspace_app(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    setup_pixel(paths.workspace_root, "0_0_0", energy=10000)

    app = create_app(paths)
    client = TestClient(app)
    return {
        "ws": paths.workspace_root,
        "paths": paths,
        "client": client,
    }


def test_run_start_requires_budget_and_validates_gt_zero(workspace_app):
    client = workspace_app["client"]

    # 1. 未提供预算字段
    res = client.post("/api/run/start", json={"rounds": 1})
    assert res.status_code == 422

    # 2. 预算提供 0
    res = client.post("/api/run/start", json={"rounds": 1, "run_budget_tokens": 0, "global_budget_tokens": 1000})
    assert res.status_code == 422

    # 3. 负数预算
    res = client.post("/api/run/start", json={"rounds": 1, "run_budget_tokens": -50, "global_budget_tokens": 1000})
    assert res.status_code == 422

    # 4. 正确提供预算
    res = client.post("/api/run/start", json={"rounds": 1, "run_budget_tokens": 10000, "global_budget_tokens": 50000})
    assert res.status_code == 200
    data = res.json()
    assert data["running"] is True


def test_run_budget_accumulates_across_rounds_and_halts_on_exhaustion(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    setup_pixel(paths.workspace_root, "0_0_0", energy=50000)

    scheduler = V9RoundScheduler(paths.workspace_root)
    
    # 模拟每次调用消耗 300 tokens
    class MockLLM:
        def __init__(self):
            self.model = "gemini-1.5-flash"
        def step(self, state, pixel_md, message_md, prepared_prompt=None):
            return {
                "pixel_md": pixel_md,
                "actions": [],
                "actual_tokens": 300,
                "prompt_tokens": 200,
                "completion_tokens": 100,
                "cost_cny": 0.0003,
            }
    scheduler.llm = MockLLM()

    # 初始发一封消息
    scheduler.router.send_message("0_0_0", "0_0_0", "hello round 1", hop=1)

    # 限制 run 预算为 500 tokens (只够跑 1 次 300 tokens，第 2 次预留或执行就会耗尽)
    run_id = "test_run_budget_exhaust"
    scheduler.core_store.create_run(run_id, rounds=5, run_budget_tokens=500, global_budget_tokens=100000)

    # 第 1 轮
    res1 = scheduler.run_round(run_budget_tokens=500, global_budget_tokens=100000, run_id=run_id)
    assert res1["round"] == 1

    # 准备第 2 轮消息
    scheduler.router.send_message("0_0_0", "0_0_0", "hello round 2", hop=1)

    # 第 2 轮：由于前一轮已花费 300 tokens，剩余 200 tokens，无法满足预留 -> 触发 BUDGET_EXHAUSTED
    res2 = scheduler.run_round(run_budget_tokens=500, global_budget_tokens=100000, run_id=run_id)
    assert res2.get("stop_reason") == "BUDGET_EXHAUSTED"
