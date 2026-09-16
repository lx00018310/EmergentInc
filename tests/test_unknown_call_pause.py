"""针对 V9.5 规范的未知结果调用 (CALL_OUTCOME_UNKNOWN) 挂起与阻断测试.

验收规则:
1. 模型调用异常/超时时记录 CALL_OUTCOME_UNKNOWN;
2. 预留额度严格保留，不自动退款，不自动重试;
3. Run 挂起为 PAUSED_RECOVERY_REQUIRED 并阻止开启新 Run.
"""

import pytest
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.core_store import CoreStore
from emergentinc.engine.audit import audit_workspace


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
