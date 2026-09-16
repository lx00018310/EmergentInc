import pytest
from pathlib import Path
from unittest.mock import MagicMock
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.pixel import PixelStorage, PixelState
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.llm import V9LLMClient


def test_model_pricing_calculation(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    mgr = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)

    # 1. 默认计价: input 1.5, cached 0.75, output 6.0
    # 1000 prompt (包含 200 cached), 500 completion
    # regular_input = 800, cached = 200, output = 500
    # cost = (800 * 1.5 + 200 * 0.75 + 500 * 6.0) / 1,000,000 = (1200 + 150 + 3000) / 1,000,000 = 4350 / 1,000,000 = 0.00435 CNY
    # 等效 tokens = 0.00435 / 1.0 * 1,000,000 = 4350
    tokens, details = mgr.calculate_call_energy(
        model="default",
        prompt_tokens=1000,
        completion_tokens=500,
        cached_tokens=200,
    )
    assert tokens == 4350
    assert details["regular_input_tokens"] == 800
    assert details["cached_input_tokens"] == 200
    assert details["completion_tokens"] == 500

    # 2. 发生少量消耗时，保证至少扣 1 token，防止 0 穿透
    tokens_min, _ = mgr.calculate_call_energy(
        model="default",
        prompt_tokens=1,
        completion_tokens=0,
        cached_tokens=0,
    )
    assert tokens_min >= 1


def test_estimate_call_reserve(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    mgr = EnergyManager(ledger_path, cost_per_million_equivalent_tokens=1.0)

    # 当 prompt 极小，返回最低保底 100
    res_min = mgr.estimate_call_reserve("default", estimated_prompt_tokens=10, max_output_tokens=10)
    assert res_min >= 100

    # 当 prompt 较大时，根据价格按比例提高预留
    res_large = mgr.estimate_call_reserve("gpt-4o", estimated_prompt_tokens=5000, max_output_tokens=2000)
    assert res_large > res_min


def test_glm_53_flash_coding_plan_uses_amortized_package_cost(tmp_path):
    ledger_path = tmp_path / "ledger" / "energy_ledger.jsonl"
    project_root = Path(__file__).resolve().parents[1]
    pricing_path = project_root / "resources" / "config" / "model_pricing.json"
    mgr = EnergyManager(
        ledger_path,
        cost_per_million_equivalent_tokens=1.0,
        pricing_config_path=pricing_path,
    )

    # 50 CNY / 2,000M tokens = 0.025 CNY / 1M tokens.
    # 未提供输入、缓存输入、输出的额度权重，因此三类 token 按同价摊销。
    tokens, details = mgr.calculate_call_energy(
        model="glm-5.3-flash",
        prompt_tokens=1_500_000_000,
        completion_tokens=500_000_000,
        cached_tokens=500_000_000,
    )

    assert details["cost_cny"] == pytest.approx(50.0)
    assert tokens == 50_000_000
    assert details["billing_mode"] == "subscription_quota_amortized"
    assert details["plan_price_cny"] == 50.0
    assert details["plan_quota_tokens"] == 2_000_000_000

    reserve = mgr.estimate_call_reserve(
        "glm-5.3-flash",
        estimated_prompt_tokens=1_000_000_000,
        max_output_tokens=1_000_000_000,
    )
    assert reserve == 50_000_000

    # 覆盖此前的真实异常路径：非 mock 模型必须能命中精确的 pricing 配置。
    client = V9LLMClient(base_dir=project_root)
    client.model_name = "glm-5.3-flash"
    prepared = client.prepare_prompt(
        state_dict={"id": "0_0_0"},
        pixel_md="# Pixel",
        message_md="hello",
    )
    assert prepared.pricing_revision == "2026-09-16T00:00:00+08:00"


def test_inbox_call_budget_per_round_deferred(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    live = ws / "live"
    live.mkdir()
    pixels_dir = live / "pixels"
    pixels_dir.mkdir()

    # 创建一个 inbox_call_budget_per_round 极低的元胞 (例如 50 tokens)
    px = pixels_dir / "0_0_0"
    px.mkdir()
    storage = PixelStorage(px)
    storage.save_state(PixelState(
        id="0_0_0",
        position=[0, 0, 0],
        active=True,
        energy=100_000,
        inbox_call_budget_per_round=50,  # 低于最低预留 (>=100)
    ))
    storage.save_pixel_md("# Genesis Pixel\n")

    scheduler = V9RoundScheduler(ws)
    # 投递一条普通消息
    msg = scheduler.router.create_message(
        sender="0_0_0",
        recipient="0_0_0",
        content="hello self",
        hop=1,
        round_num=1,
    )
    scheduler.router.enqueue([msg])

    # 运行 1 轮调度
    res = scheduler.run_round()
    assert res["round"] == 1

    # 验证元胞未被执行与扣款，消息因超额被延迟并roll到下轮队列
    state_after = storage.load_state()
    assert state_after.energy == 100_000  # 没有扣费
    assert len(scheduler.router.queue) == 1
    assert scheduler.router.queue[0].content == "hello self"


def test_run_budget_tokens_limit(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    live = ws / "live"
    live.mkdir()
    pixels_dir = live / "pixels"
    pixels_dir.mkdir()

    px = pixels_dir / "0_0_0"
    px.mkdir()
    storage = PixelStorage(px)
    storage.save_state(PixelState(
        id="0_0_0",
        position=[0, 0, 0],
        active=True,
        energy=100_000,
        inbox_call_budget_per_round=100_000,
    ))
    storage.save_pixel_md("# Genesis Pixel\n")

    scheduler = V9RoundScheduler(ws)
    msg = scheduler.router.create_message(
        sender="0_0_0",
        recipient="0_0_0",
        content="msg under budget test",
        hop=1,
        round_num=1,
    )
    scheduler.router.enqueue([msg])

    # 设置 run_budget_tokens 极低 (例如 10 tokens)，低于任何一次预留
    scheduler.run_round(run_budget_tokens=10)

    # 验证消息未被消耗并被 revert 放回队列，元胞未扣费
    assert storage.load_state().energy == 100_000
    assert len(scheduler.router.queue) == 1


def test_stop_requested_fine_grained_interruption(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    live = ws / "live"
    live.mkdir()
    pixels_dir = live / "pixels"
    pixels_dir.mkdir()

    px = pixels_dir / "0_0_0"
    px.mkdir()
    storage = PixelStorage(px)
    storage.save_state(PixelState(
        id="0_0_0",
        position=[0, 0, 0],
        active=True,
        energy=100_000,
    ))
    storage.save_pixel_md("# Genesis Pixel\n")

    scheduler = V9RoundScheduler(ws)
    msg = scheduler.router.create_message(
        sender="0_0_0",
        recipient="0_0_0",
        content="msg to stop",
        hop=1,
        round_num=1,
    )
    scheduler.router.enqueue([msg])

    # 停止信号始终为 True
    scheduler.run_round(stop_requested=lambda: True)

    # 循环应立即退出，消息不应被消费或丢失
    assert storage.load_state().energy == 100_000
    assert len(scheduler.router.queue) == 1
