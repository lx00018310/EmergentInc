"""针对 V9.5 规范的消息崩溃恢复与副作用 Exactly-Once 测试.

验收规则:
1. 响应已落盘 (RESPONSE_SAVED) 时系统崩溃重启，不重新调用 LLM;
2. 副作用执行中断后重启，已执行的副作用不重复执行 (Exactly-Once);
3. COMMITTED 消息永不重放.
"""

import json
from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.core_store import CoreStore


def test_response_saved_does_not_reinvoke_llm_and_effects_idempotent(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    ws = paths.workspace_root
    from emergentinc.engine.pixel import PixelStorage, PixelState
    for pid, e, pos in [("0_0_0", 50000, [0, 0, 0]), ("0_1_0", 10000, [0, 1, 0])]:
        ps = PixelStorage(paths.live_root / "pixels" / pid)
        ps.save_state(PixelState(id=pid, position=pos, active=True, energy=e, born_round=0, last_active_round=0))
        ps.save_pixel_md(f"# Mind of {pid}")

    db_path = ws / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(1000000)
    store.ensure_pixel_account("0_0_0", 50000)
    store.ensure_pixel_account("0_1_0", 10000)

    # 计数器：记录 LLM 被实际调用的次数
    llm_call_count = 0

    class MockLLM:
        def __init__(self):
            self.model = "gemini-1.5-flash"
        def step(self, state, pixel_md, message_md, prepared_prompt=None):
            nonlocal llm_call_count
            llm_call_count += 1
            return {
                "pixel_md": pixel_md + "\n<!-- updated -->",
                "actions": [
                    {"type": "TRANSFER_ENERGY", "target": "0_1_0", "amount": 200},
                    {"type": "ROUTE_MESSAGE", "to": "0_1_0", "content": "hello bob"}
                ],
                "actual_tokens": 150,
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "cost_cny": 0.00015,
            }

    scheduler1 = V9RoundScheduler(ws)
    scheduler1.llm = MockLLM()

    # 发送一封初始消息
    msg_id = scheduler1.router.send_message("0_0_0", "0_0_0", "do transfer", hop=1)

    # 模拟第 1 阶段：预留并完成 LLM 调用、将响应存入 model_calls，并将消息状态设置为 RESPONSE_STORED
    # 然后模拟崩溃退出 (不执行副作用，也不更新消息为 COMMITTED)
    run_id = "test_crash_run"
    store.create_run(run_id, rounds=1, run_budget_tokens=50000, global_budget_tokens=100000)
    store.reserve_call_budget("call_crash_1", run_id, "0_0_0", 1000, run_limit=50000, global_limit=100000)
    
    mock_resp = scheduler1.llm.step({}, "", "")
    assert llm_call_count == 1

    # 确保消息已在 CoreStore 登记
    store.enqueue_message(
        message_id=msg_id,
        sender="0_0_0",
        recipient="0_0_0",
        content="do transfer",
        round_num=1,
        hop=1,
        run_id=run_id,
    )

    # 响应落盘
    store.record_model_call(
        call_id="call_crash_1",
        run_id=run_id,
        pixel_id="0_0_0",
        message_id=msg_id,
        model="gemini-1.5-flash",
        prompt_hash="dummy_hash",
        raw_response=json.dumps(mock_resp),
        normalized_response=json.dumps(mock_resp),
        prompt_tokens=100,
        completion_tokens=50,
        cost_cny=0.00015,
        outcome="SUCCESS"
    )
    store.transition_message(msg_id, to_status="RESPONSE_STORED")

    # 预先记录第 1 个副作用 (TRANSFER_ENERGY) 已完成，模拟副作用执行到一半时崩溃！
    effect_id_0 = f"{msg_id}_eff_0"
    store.record_effect_once(
        effect_id=effect_id_0,
        message_id=msg_id,
        effect_type="TRANSFER_ENERGY",
        effect_index=0,
        payload_hash="dummy_eff_hash",
        details={"target": "0_1_0", "amount": 200}
    )
    # 手动将该转账应用一次
    store.transfer_energy("0_0_0", "0_1_0", amount=200)

    # 此时 0_0_0 扣减了预留 1000 和转账 200 -> 50000 - 1000 - 200 = 48800
    # 0_1_0 增加了 200 -> 10200
    acc_01 = store.get_pixel_account("0_1_0")
    assert acc_01["energy"] == 10200

    # 模拟系统崩溃与重启：创建全新调度器实例
    scheduler2 = V9RoundScheduler(ws)
    scheduler2.llm = MockLLM()

    # 运行该 Round
    res = scheduler2.run_round(run_budget_tokens=50000, global_budget_tokens=100000, run_id=run_id)

    # 验证：
    # 1. LLM 实际调用次数没有增加 (仍为 1，因为复用了已落盘响应)
    assert llm_call_count == 1

    # 2. 0_1_0 的余额不得重复增加 200 (依然是 10200)
    acc_01_after = store.get_pixel_account("0_1_0")
    assert acc_01_after["energy"] == 10200

    # 3. 消息状态最终推进为 COMMITTED
    with store.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status FROM messages WHERE message_id = ?", (msg_id,))
        status = cur.fetchone()["status"]
        assert status == "COMMITTED"
