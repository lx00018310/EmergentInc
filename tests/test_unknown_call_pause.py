"""针对 V9.5 规范的未知结果调用 (CALL_OUTCOME_UNKNOWN) 挂起与阻断测试.

验收规则:
1. 模型调用异常/超时时记录 CALL_OUTCOME_UNKNOWN;
2. 预留额度严格保留，不自动退款，不自动重试;
3. Run 挂起为 PAUSED_RECOVERY_REQUIRED 并阻止开启新 Run.
"""

import pytest
from pathlib import Path
from types import SimpleNamespace
from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.core_store import CoreStore
from emergentinc.engine.audit import audit_workspace
from emergentinc.engine.llm import LLMResponseError


def test_unknown_call_leaves_reservation_open_and_pauses_run(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    ws = paths.workspace_root

    from emergentinc.engine.pixel import PixelStorage, PixelState
    ps = PixelStorage(paths.live_root / "pixels" / "0_0_0")
    ps.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=50000, born_round=0, last_active_round=0))
    ps.save_pixel_md("# 0_0_0")

    db_path = ws / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(1000000)
    store.ensure_pixel_account("0_0_0", 50000)

    class TimeoutLLM:
        def __init__(self):
            self.model = "gemini-1.5-flash"
        def step(self, state, pixel_md, message_md, prepared_prompt=None):
            # 模拟网络超时
            raise TimeoutError("LLM provider read timeout after 30s")

    scheduler = V9RoundScheduler(ws)
    scheduler.llm = TimeoutLLM()

    # 发送消息
    msg_id = scheduler.router.send_message("0_0_0", "0_0_0", "trigger timeout", hop=1)

    run_id = "test_timeout_run"
    store.create_run(run_id, rounds=1, run_budget_tokens=50000, global_budget_tokens=100000)

    # 运行 Round，必须捕获并处理未知调用异常
    res = scheduler.run_round(run_budget_tokens=50000, global_budget_tokens=100000, run_id=run_id)

    # 1. 验证 Run 状态被挂起为 PAUSED_RECOVERY_REQUIRED
    assert res.get("stop_reason") == "PAUSED_RECOVERY_REQUIRED"

    # 2. 验证 model_calls 表中记录了 CALL_OUTCOME_UNKNOWN
    unknown_calls = store.get_unknown_calls()
    assert len(unknown_calls) == 1
    assert unknown_calls[0]["outcome"] == "CALL_OUTCOME_UNKNOWN"

    # 3. 验证预留没有被释放 (status 依然是 OPEN)，且没有自动退还给元胞
    open_reservations = store.get_unresolved_reservations()
    assert len(open_reservations) == 1
    assert open_reservations[0]["status"] == "OPEN"

    # 4. 验证审计门禁拦截：系统进入 RECOVERY_REQUIRED，严禁开启新 Run
    audit_rep = audit_workspace(ws)
    assert not audit_rep.allowed_to_start
    assert audit_rep.recovery_required
    assert any("CALL_OUTCOME_UNKNOWN" in r for r in audit_rep.block_reasons)

    # Owner 明确确认未计费后，退款、解除 unknown 状态并重新排队必须在同一事务完成。
    account_before_reset = store.get_pixel_account("0_0_0")
    resolution = store.resolve_unknown_call_no_charge(
        open_reservations[0]["call_id"],
        reason="TEST_OWNER_RESET_NO_CHARGE",
    )
    account_after_reset = store.get_pixel_account("0_0_0")
    assert resolution["refunded_tokens"] == open_reservations[0]["amount"]
    assert account_after_reset["energy"] == account_before_reset["energy"] + open_reservations[0]["amount"]
    assert store.get_unresolved_reservations() == []
    assert store.get_unknown_calls() == []
    assert store.get_message(msg_id)["status"] == "QUEUED"
    store.sync_account_to_storage("0_0_0", ps)

    audit_after_reset = audit_workspace(ws)
    assert audit_after_reset.allowed_to_start


def test_invalid_model_response_is_settled_and_does_not_require_recovery(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    ws = paths.workspace_root

    from emergentinc.engine.pixel import PixelStorage, PixelState
    ps = PixelStorage(paths.live_root / "pixels" / "0_0_0")
    ps.save_state(PixelState(
        id="0_0_0",
        position=[0, 0, 0],
        active=True,
        energy=50_000,
        born_round=0,
        last_active_round=0,
    ))
    ps.save_pixel_md("# 0_0_0")

    store = CoreStore(ws / "ledger" / "v9_core.sqlite3")
    store.ensure_global_budget(100_000)
    store.ensure_pixel_account("0_0_0", 50_000)
    store.create_run("invalid_response_run", rounds=1, run_budget_tokens=50_000, global_budget_tokens=100_000)

    scheduler = V9RoundScheduler(ws)
    prep = SimpleNamespace(
        model_name="glm-5.3-flash",
        pricing_revision="2026-09-16T00:00:00+08:00",
        estimated_prompt_tokens=1200,
        max_output_tokens=100,
        prompt_hash="prompt_hash",
    )
    scheduler.llm.prepare_prompt = lambda **kwargs: prep

    def invalid_step(**kwargs):
        raise LLMResponseError(
            "CALL_FAILED: V9_STEP: invalid JSON response",
            raw_response="",
            token_usage={
                "prompt_tokens": 1200,
                "completion_tokens": 25,
                "cached_tokens": 100,
                "total_tokens": 1225,
            },
            model="glm-5.3-flash",
            pricing_revision=prep.pricing_revision,
        )

    scheduler.llm.step = invalid_step
    msg_id = scheduler.router.send_message("0_0_0", "0_0_0", "invalid response", hop=1)

    result = scheduler.run_round(
        run_budget_tokens=50_000,
        global_budget_tokens=100_000,
        run_id="invalid_response_run",
    )

    assert result["stop_reason"] == "MODEL_RESPONSE_INVALID"
    assert store.get_unresolved_reservations() == []
    assert store.get_unknown_calls() == []
    assert store.get_message(msg_id)["status"] == "QUEUED"
    call = store.get_model_call_by_message(msg_id)
    assert call["outcome"] == "FAILED_RESPONSE"
    assert call["prompt_tokens"] == 1200
    assert call["completion_tokens"] == 25
    assert audit_workspace(ws).allowed_to_start
