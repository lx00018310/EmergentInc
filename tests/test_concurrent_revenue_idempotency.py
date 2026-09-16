"""针对 V9.5 外部核验回款并发幂等与去重测试.

验收规则:
1. 多个并发线程使用相同的 tx_id 请求入账时，严格 Exactly-Once;
2. 账户余额与账本条目只增加一次，无竞态条件与重复记账.
"""

import concurrent.futures
from pathlib import Path
from emergentinc.engine.energy import EnergyManager
from emergentinc.engine.core_store import CoreStore


def test_concurrent_revenue_credit_idempotency(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir(parents=True)
    ledger_path = ws / "ledger" / "energy_ledger.jsonl"
    db_path = ws / "ledger" / "v9_core.sqlite3"

    from emergentinc.engine.pixel import PixelStorage, PixelState
    p_dir = ws / "live" / "pixels" / "pixel_target"
    p_dir.mkdir(parents=True)
    ps = PixelStorage(p_dir)
    ps.save_state(PixelState(id="pixel_target", position=[0, 0, 0], active=True, energy=1000, born_round=0, last_active_round=0))
    ps.save_pixel_md("# Target")

    em = EnergyManager(ledger_path, db_path=db_path)
    store = CoreStore(db_path)
    store.upsert_pixel_account("pixel_target", initial_energy=1000)

    tx_id = "concurrent_tx_9999"
    amount_cny = 100.0  # 折合 100,000,000 tokens
    
    # 模拟 10 个并发线程同时用相同 tx_id 入账
    num_threads = 10
    success_results = []

    def try_credit():
        # 每个线程重新实例化或共用实例
        local_em = EnergyManager(ledger_path, db_path=db_path)
        res = local_em.credit_external_revenue(
            pixel_storage=ps,
            net_amount=amount_cny,
            external_tx_id=tx_id,
            details={"source": "test_concurrent"}
        )
        return res.ok, res

    with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
        futures = [executor.submit(try_credit) for _ in range(num_threads)]
        for f in concurrent.futures.as_completed(futures):
            ok, res = f.result()
            if ok:
                success_results.append(res)

    # 10 个并发调用全部返回 True (因为幂等性应直接识别已处理交易并安全返回)，
    # 但核心账户余额只能增加一次对应的 tokens
    assert len(success_results) == num_threads

    target_acc = store.get_pixel_account("pixel_target")
    expected_tokens = 1000 + int(amount_cny * 1_000_000)
    assert target_acc["energy"] == expected_tokens

    # 验证数据库中 external_revenues 表中严格只有一条记录
    with store.get_connection() as conn:
        cur = conn.cursor()
        cur.execute("SELECT count(*) as c FROM external_revenues WHERE external_tx_id = ?", (tx_id,))
        count = cur.fetchone()["c"]
        assert count == 1
