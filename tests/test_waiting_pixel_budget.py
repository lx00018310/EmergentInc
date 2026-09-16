"""针对 V9.5 规范的预算不足挂起 (WAITING_PIXEL_BUDGET) 测试.

验收规则:
1. 当 Pixel 拥有正 Energy 但不足当前调用预留时:
   - Pixel.active 维持不变 (严禁死亡判定);
   - 消息转为 WAITING_PIXEL_BUDGET 挂起，不消费、不丢失;
   - 不产生费用扣除;
2. 待获得邻居转账或外部回款后，可恢复正常调度.
"""

from pathlib import Path
from emergentinc.paths import get_paths
from emergentinc.engine.storage import Storage
from emergentinc.engine.scheduler import V9RoundScheduler
from emergentinc.engine.core_store import CoreStore


def test_insufficient_budget_with_positive_energy_suspends_message_without_death(tmp_path):
    paths = get_paths(tmp_path)
    paths.live_root.mkdir(parents=True, exist_ok=True)
    paths.runtime_root.mkdir(parents=True, exist_ok=True)
    ws = paths.workspace_root

    from emergentinc.engine.pixel import PixelStorage, PixelState
    ps = PixelStorage(paths.live_root / "pixels" / "0_0_0")
    ps.save_state(PixelState(id="0_0_0", position=[0, 0, 0], active=True, energy=50, born_round=0, last_active_round=0))
    ps.save_pixel_md("# 0_0_0")

    db_path = ws / "ledger" / "v9_core.sqlite3"
    store = CoreStore(db_path)
    store.ensure_global_budget(1000000)

    scheduler = V9RoundScheduler(ws)
    
    class ExpensiveLLM:
        def __init__(self):
            self.model = "gemini-1.5-pro"
        def step(self, state, pixel_md, message_md, prepared_prompt=None):
            return {"pixel_md": pixel_md, "actions": []}

    scheduler.llm = ExpensiveLLM()

    # 发送消息给 0_0_0
    msg_id = scheduler.router.send_message("0_0_0", "0_0_0", "hello", hop=1)

    run_id = "test_waiting_budget_run"
    store.create_run(run_id, rounds=1, run_budget_tokens=10000, global_budget_tokens=100000)

    # 运行该轮
    res = scheduler.run_round(run_budget_tokens=10000, global_budget_tokens=100000, run_id=run_id)

    # 1. 验证元胞依然活跃 (active == True)，正余额绝不死亡！
    p_acc = store.get_pixel_account("0_0_0")
    assert p_acc["active"] == 1
    assert p_acc["energy"] == 50

    p_storage = scheduler.world.get_pixel_storage("0_0_0")
    p_state = p_storage.load_state()
    assert p_state.active is True
    assert p_state.energy == 50

    # 2. 验证消息状态变为 WAITING_PIXEL_BUDGET
    with store.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status FROM messages WHERE message_id = ?", (msg_id,))
        m_row = cur.fetchone()
        assert m_row["status"] == "WAITING_PIXEL_BUDGET"

    # 3. 验证未产生任何模型调用或费用记录
    with store.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT count(*) as c FROM model_calls WHERE pixel_id = '0_0_0'")
        assert cur.fetchone()["c"] == 0
