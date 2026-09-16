"""单一事务事实源与 SQLite 存储核心 (V9.5 Core Transaction Store).

规则与边界:
1. workspace/ledger/v9_core.sqlite3 是账户余额、预算、调用记录、消息状态机、副作用幂等记录和账本的唯一事实源。
2. state.json.energy 仅作为只读投影，发生差异时以数据库为准，禁止从 JSON 反写数据库。
3. 数据库事务使用 BEGIN IMMEDIATE 串行化写操作，确保断电/崩溃时不产生半提交。
4. 消息状态机严格按序推进，副作用依据 effect_id 保证 Exactly-Once。
5. 未知结果调用 (CALL_OUTCOME_UNKNOWN) 自动挂起 Run，禁止自动退款或自动重试。
"""

import os
import time
import json
import sqlite3
import hashlib
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple, Union
from dataclasses import dataclass


class CoreStoreError(Exception):
    """CoreStore 基础异常."""
    pass


class BudgetExceededError(CoreStoreError):
    """预算超限异常."""
    pass


class SpendBlockedError(CoreStoreError):
    """账户支出被阻断 (如因 Refund Deficit 未填补)."""
    pass


class QueueCorruptedError(CoreStoreError):
    """队列损坏异常."""
    pass


class _ClosingConnection:
    """包装 SQLite 连接，确保在上下文退出时自动提交/回滚并关闭文件句柄."""
    def __init__(self, conn: sqlite3.Connection):
        self._conn = conn

    def __enter__(self) -> sqlite3.Connection:
        self._conn.__enter__()
        return self._conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            return self._conn.__exit__(exc_type, exc_val, exc_tb)
        finally:
            self._conn.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


class CoreStore:
    """V9.5 SQLite 单一事务事实源核心."""

    def __init__(self, db_path: Union[str, Path]):
        self.db_path = Path(db_path).resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_tables()

    def get_connection(self):
        """获取 SQLite 连接，配置超时与 WAL 模式，退出上下文时自动释放."""
        conn = sqlite3.connect(str(self.db_path), timeout=30.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA foreign_keys=ON;")
        conn.execute("PRAGMA busy_timeout=30000;")
        return _ClosingConnection(conn)

    def _init_tables(self):
        """初始化核心表结构."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
            CREATE TABLE IF NOT EXISTS schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS global_budget (
                id TEXT PRIMARY KEY DEFAULT 'GLOBAL',
                total_limit INTEGER NOT NULL,
                total_spent INTEGER NOT NULL DEFAULT 0,
                total_reserved INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'CNY',
                updated_at REAL NOT NULL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                loop_id TEXT,
                branch_name TEXT,
                start_round INTEGER NOT NULL DEFAULT 1,
                end_round INTEGER,
                run_limit INTEGER NOT NULL,
                run_spent INTEGER NOT NULL DEFAULT 0,
                run_reserved INTEGER NOT NULL DEFAULT 0,
                global_limit INTEGER NOT NULL,
                global_spent INTEGER NOT NULL DEFAULT 0,
                global_reserved INTEGER NOT NULL DEFAULT 0,
                genesis_revision INTEGER NOT NULL DEFAULT 0,
                genesis_hash TEXT,
                pricing_revision TEXT,
                status TEXT NOT NULL DEFAULT 'RUNNING',
                stop_reason TEXT,
                created_at REAL NOT NULL,
                finished_at REAL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS pixel_accounts (
                pixel_id TEXT PRIMARY KEY,
                energy INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                refund_deficit_tokens INTEGER NOT NULL DEFAULT 0,
                spend_blocked_reason TEXT,
                updated_at REAL NOT NULL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS reservations (
                call_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                pixel_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN',
                created_at REAL NOT NULL,
                settled_at REAL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS model_calls (
                call_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                pixel_id TEXT NOT NULL,
                message_id TEXT,
                model TEXT NOT NULL,
                pricing_revision TEXT,
                prompt_hash TEXT,
                raw_response TEXT,
                normalized_response TEXT,
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens INTEGER NOT NULL DEFAULT 0,
                actual_tokens INTEGER NOT NULL DEFAULT 0,
                cost_cny REAL NOT NULL DEFAULT 0.0,
                outcome TEXT NOT NULL DEFAULT 'SUCCESS',
                created_at REAL NOT NULL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                message_id TEXT PRIMARY KEY,
                run_id TEXT,
                round_num INTEGER NOT NULL DEFAULT 0,
                hop INTEGER NOT NULL DEFAULT 1,
                sender TEXT NOT NULL,
                recipient TEXT NOT NULL,
                content TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'QUEUED',
                is_feedback INTEGER NOT NULL DEFAULT 0,
                source_type TEXT NOT NULL DEFAULT 'pixel',
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS effects (
                effect_id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                effect_type TEXT NOT NULL,
                effect_index INTEGER NOT NULL,
                payload_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'APPLIED',
                details TEXT,
                created_at REAL NOT NULL
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS ledger_entries (
                entry_id TEXT PRIMARY KEY,
                timestamp REAL NOT NULL,
                pixel_id TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                details TEXT
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS external_revenues (
                external_tx_id TEXT PRIMARY KEY,
                pixel_id TEXT NOT NULL,
                net_amount REAL NOT NULL,
                amount_tokens INTEGER NOT NULL,
                timestamp REAL NOT NULL,
                details TEXT
            );
            """)

            cur.execute("""
            CREATE TABLE IF NOT EXISTS external_refunds (
                refund_id TEXT PRIMARY KEY,
                external_tx_id TEXT NOT NULL,
                pixel_id TEXT NOT NULL,
                refund_amount_cny REAL NOT NULL,
                tokens_deducted INTEGER NOT NULL,
                deficit_tokens INTEGER NOT NULL,
                reason TEXT,
                timestamp REAL NOT NULL
            );
            """)
            conn.commit()

    # ==================== 迁移与初始装载 ====================

    def is_migrated(self) -> bool:
        """检查数据库是否已成功迁移."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT value FROM schema_meta WHERE key = 'migration_status'")
            row = cur.fetchone()
            return bool(row and row["value"] == "COMPLETED")

    def migrate_from_jsonl_and_pixels(self, ledger_jsonl_path: Path, pixels_dir: Path) -> Dict[str, Any]:
        """从旧的 energy_ledger.jsonl 与 pixels 状态只读对账并导入 SQLite (单一事务)."""
        if self.is_migrated():
            return {"status": "ALREADY_MIGRATED"}

        ledger_jsonl = Path(ledger_jsonl_path)
        pixels_path = Path(pixels_dir)

        entries = []
        if ledger_jsonl.exists():
            with ledger_jsonl.open("r", encoding="utf-8") as f:
                for idx, line in enumerate(f):
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        entries.append(data)
                    except Exception as e:
                        raise CoreStoreError(f"Corrupted ledger entry at line {idx+1}: {e}")

        # 检查 ledger entry_id 是否有重复
        seen_entry_ids = set()
        for e in entries:
            eid = e.get("entry_id")
            if not eid or eid in seen_entry_ids:
                raise CoreStoreError(f"Duplicate or invalid entry_id in ledger: {eid}")
            seen_entry_ids.add(eid)

        # 扫描现有 live pixels
        pixel_states = {}
        if pixels_path.exists():
            for pdir in pixels_path.iterdir():
                if pdir.is_dir():
                    st_file = pdir / "state.json"
                    if st_file.exists():
                        try:
                            st = json.loads(st_file.read_text(encoding="utf-8"))
                            pid = st.get("id", pdir.name)
                            pixel_states[pid] = st
                        except Exception as e:
                            raise CoreStoreError(f"Corrupted state.json in pixel {pdir.name}: {e}")

        # 在单一事务中执行导入
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                # 1. 导入 pixels
                for pid, st in pixel_states.items():
                    energy = int(st.get("energy", st.get("resource", 0)))
                    active = 1 if st.get("active", True) else 0
                    cur.execute("""
                        INSERT OR REPLACE INTO pixel_accounts (pixel_id, energy, active, refund_deficit_tokens, updated_at)
                        VALUES (?, ?, ?, 0, ?)
                    """, (pid, energy, active, now))

                # 2. 导入 ledger entries 与 external_revenues / refunds
                for e in entries:
                    eid = e.get("entry_id")
                    pid = e.get("pixel_id")
                    etype = e.get("entry_type")
                    amt = int(e.get("amount", 0))
                    bal_after = int(e.get("balance_after", 0))
                    ts = float(e.get("timestamp", now))
                    details = json.dumps(e.get("details", {}), ensure_ascii=False)

                    cur.execute("""
                        INSERT OR REPLACE INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (eid, ts, pid, etype, amt, bal_after, details))

                    # 提取 revenue
                    if etype == "revenue":
                        d_dict = e.get("details", {})
                        tx_id = d_dict.get("external_tx_id") or eid.replace("rev_", "")
                        net_amt = float(d_dict.get("net_amount", 0.0))
                        cur.execute("""
                            INSERT OR REPLACE INTO external_revenues (external_tx_id, pixel_id, net_amount, amount_tokens, timestamp, details)
                            VALUES (?, ?, ?, ?, ?, ?)
                        """, (tx_id, pid, net_amt, amt, ts, details))

                    # 提取 refund
                    elif etype == "refund":
                        d_dict = e.get("details", {})
                        tx_id = d_dict.get("external_tx_id", "")
                        ref_amt = float(d_dict.get("refund_amount", 0.0))
                        def_tok = int(d_dict.get("deficit_tokens", 0))
                        deducted = int(d_dict.get("tokens_deducted", abs(amt)))
                        reason = str(d_dict.get("reason", "refund"))
                        cur.execute("""
                            INSERT OR REPLACE INTO external_refunds (refund_id, external_tx_id, pixel_id, refund_amount_cny, tokens_deducted, deficit_tokens, reason, timestamp)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, (eid, tx_id, pid, ref_amt, deducted, def_tok, reason, ts))

                # 3. 标记迁移完成
                cur.execute("""
                    INSERT OR REPLACE INTO schema_meta (key, value, updated_at)
                    VALUES ('migration_status', 'COMPLETED', ?)
                """, (now,))
                cur.execute("""
                    INSERT OR REPLACE INTO schema_meta (key, value, updated_at)
                    VALUES ('schema_version', '1', ?)
                """, (now,))

                conn.commit()
                return {
                    "status": "MIGRATION_COMPLETED",
                    "pixels_imported": len(pixel_states),
                    "ledger_entries_imported": len(entries),
                }
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"Migration transaction failed: {e}")

    # ==================== 账户与余额操作 ====================

    def get_pixel_account(self, pixel_id: str) -> Optional[Dict[str, Any]]:
        """获取元胞当前账户信息."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
            row = cur.fetchone()
            if not row:
                return None
            return dict(row)

    def ensure_pixel_account(self, pixel_id: str, energy: int = 0, active: bool = True):
        """确保 Pixel 账户在数据库中存在."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT OR IGNORE INTO pixel_accounts (pixel_id, energy, active, refund_deficit_tokens, updated_at)
                VALUES (?, ?, ?, 0, ?)
            """, (pixel_id, energy, 1 if active else 0, now))
            conn.commit()

    def sync_account_to_storage(self, pixel_id: str, pixel_storage: Any):
        """将数据库中权威的 energy、active 投影更新到 state.json (只写投影)."""
        acc = self.get_pixel_account(pixel_id)
        if not acc:
            return
        if pixel_storage.state_file.exists():
            st = pixel_storage.load_state()
            st.energy = acc["energy"]
            st.active = bool(acc["active"])
            pixel_storage.save_state(st)

    # ==================== 全局与 Run 硬预算 ====================

    def ensure_global_budget(self, total_limit: int, currency: str = "CNY") -> Dict[str, Any]:
        """初始化或读取全局累计硬预算."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM global_budget WHERE id = 'GLOBAL'")
            row = cur.fetchone()
            if not row:
                cur.execute("""
                    INSERT INTO global_budget (id, total_limit, total_spent, total_reserved, currency, updated_at)
                    VALUES ('GLOBAL', ?, 0, 0, ?, ?)
                """, (total_limit, currency, now))
                conn.commit()
                return {
                    "total_limit": total_limit,
                    "total_spent": 0,
                    "total_reserved": 0,
                    "currency": currency,
                }
            return dict(row)

    def get_global_budget(self) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM global_budget WHERE id = 'GLOBAL'")
            row = cur.fetchone()
            return dict(row) if row else None

    def get_budget_state(self, run_id: Optional[str] = None) -> Dict[str, Any]:
        """获取全局与指定 Run 的硬预算状态."""
        gb = self.get_global_budget() or {}
        g_limit = gb.get("total_limit", 0)
        g_spent = gb.get("total_spent", 0)
        g_reserved = gb.get("total_reserved", 0)
        g_rem = max(0, g_limit - (g_spent + g_reserved))

        res = {
            "global_limit_tokens": g_limit,
            "global_spent_tokens": g_spent,
            "global_reserved_tokens": g_reserved,
            "global_remaining_tokens": g_rem,
        }

        if run_id:
            r_info = self.get_run(run_id)
            if r_info:
                r_limit = r_info.get("run_limit", 0)
                r_spent = r_info.get("run_spent", 0)
                r_reserved = r_info.get("run_reserved", 0)
                r_rem = max(0, r_limit - (r_spent + r_reserved))
                res.update({
                    "run_id": run_id,
                    "run_limit_tokens": r_limit,
                    "run_spent_tokens": r_spent,
                    "run_reserved_tokens": r_reserved,
                    "run_remaining_tokens": r_rem,
                })
        return res

    def create_run(
        self,
        run_id: str,
        run_limit: Optional[int] = None,
        global_limit: Optional[int] = None,
        loop_id: Optional[str] = None,
        branch_name: str = "main",
        genesis_revision: int = 0,
        genesis_hash: Optional[str] = None,
        pricing_revision: Optional[str] = None,
        start_round: int = 1,
        rounds: Optional[int] = None,
        run_budget_tokens: Optional[int] = None,
        global_budget_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        """在数据库中持久化创建 Run 上下文 (强约束：run_limit > 0, global_limit > 0)."""
        if run_limit is None:
            run_limit = run_budget_tokens or 100_000
        if global_limit is None:
            global_limit = global_budget_tokens or 1_000_000

        if run_limit <= 0 or global_limit <= 0:
            raise ValueError("run_limit and global_limit must be strictly positive")

        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                # 确保 global_budget 存在并同步 global_limit
                cur.execute("SELECT * FROM global_budget WHERE id = 'GLOBAL'")
                g_row = cur.fetchone()
                if not g_row:
                    cur.execute("""
                        INSERT INTO global_budget (id, total_limit, total_spent, total_reserved, currency, updated_at)
                        VALUES ('GLOBAL', ?, 0, 0, 'CNY', ?)
                    """, (global_limit, now))
                    g_spent, g_reserved = 0, 0
                else:
                    g_spent = g_row["total_spent"]
                    g_reserved = g_row["total_reserved"]
                    # 更新 global_limit 为当前设定的全局限额
                    cur.execute("UPDATE global_budget SET total_limit = ?, updated_at = ? WHERE id = 'GLOBAL'", (global_limit, now))

                # 插入 runs 记录
                cur.execute("""
                    INSERT INTO runs (
                        run_id, loop_id, branch_name, start_round, run_limit, run_spent, run_reserved,
                        global_limit, global_spent, global_reserved, genesis_revision, genesis_hash,
                        pricing_revision, status, created_at
                    ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, 'RUNNING', ?)
                """, (
                    run_id, loop_id, branch_name, start_round, run_limit,
                    global_limit, g_spent, g_reserved, genesis_revision, genesis_hash,
                    pricing_revision, now
                ))

                conn.commit()
                return {
                    "run_id": run_id,
                    "run_limit": run_limit,
                    "global_limit": global_limit,
                    "status": "RUNNING",
                }
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"Failed to create run: {e}")

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def update_run_status(self, run_id: str, status: str, stop_reason: Optional[str] = None, end_round: Optional[int] = None):
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE runs
                SET status = ?, stop_reason = ?, end_round = COALESCE(?, end_round), finished_at = ?
                WHERE run_id = ?
            """, (status, stop_reason, end_round, now, run_id))
            conn.commit()

    def recover_stale_runs(self) -> int:
        """修正处于 RUNNING 状态的遗留 Run 为 INTERRUPTED."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                UPDATE runs
                SET status = 'INTERRUPTED', stop_reason = 'PROCESS_RESTARTED', finished_at = ?
                WHERE status = 'RUNNING'
            """, (now,))
            conn.commit()
            return cur.rowcount

    # ==================== 模型调用预算原子预留与结算 ====================

    def reserve_call_budget(
        self,
        *args,
        run_id: Optional[str] = None,
        pixel_id: Optional[str] = None,
        estimated_tokens: Optional[int] = None,
        message_id: Optional[str] = None,
        call_id: Optional[str] = None,
        raise_on_error: bool = False,
        **kwargs,
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """原子三层硬预算预留 (校验 Pixel 余额、Deficit、Run 预算、全局预算).

        返回: (ok, call_id, failure_reason)
        """
        # 参数自适应解包
        if len(args) == 4 and isinstance(args[3], int):
            call_id = args[0]
            run_id = args[1]
            pixel_id = args[2]
            estimated_tokens = args[3]
            raise_on_error = True
        elif len(args) == 3:
            run_id = args[0]
            pixel_id = args[1]
            estimated_tokens = args[2]
        elif len(args) == 2 and isinstance(args[1], int):
            pixel_id = args[0]
            estimated_tokens = args[1]
        elif len(args) >= 1 and run_id is None:
            run_id = args[0]

        if estimated_tokens is None or estimated_tokens <= 0:
            if raise_on_error:
                raise CoreStoreError("ESTIMATED_TOKENS_MUST_BE_POSITIVE")
            return False, None, "ESTIMATED_TOKENS_MUST_BE_POSITIVE"

        now = time.time()
        if not call_id:
            call_id = f"res_{hashlib.sha256(f'{run_id}_{pixel_id}_{now}_{os.urandom(4).hex()}'.encode()).hexdigest()[:12]}"

        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                # 检查是否已存在同名 call_id (唯一性)
                cur.execute("SELECT call_id FROM reservations WHERE call_id = ?", (call_id,))
                if cur.fetchone():
                    conn.rollback()
                    if raise_on_error:
                        raise CoreStoreError(f"Reservation call_id '{call_id}' already exists")
                    return False, None, f"DUPLICATE_CALL_ID: {call_id}"

                # 1. 检查 Pixel 账户与 Deficit
                cur.execute("SELECT energy, active, refund_deficit_tokens, spend_blocked_reason FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                p_row = cur.fetchone()
                if not p_row:
                    conn.rollback()
                    if raise_on_error:
                        raise CoreStoreError(f"PIXEL_NOT_FOUND: {pixel_id}")
                    return False, None, "PIXEL_NOT_FOUND"

                if p_row["refund_deficit_tokens"] > 0 or p_row["spend_blocked_reason"]:
                    conn.rollback()
                    err = f"SPEND_BLOCKED_REFUND_DEFICIT: deficit={p_row['refund_deficit_tokens']}"
                    if raise_on_error:
                        raise SpendBlockedError(err)
                    return False, None, err

                if p_row["energy"] < estimated_tokens:
                    conn.rollback()
                    err = "INSUFFICIENT_PIXEL_ENERGY"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, None, err

                # 2. 检查 Run 预算
                cur.execute("SELECT run_limit, run_spent, run_reserved, status FROM runs WHERE run_id = ?", (run_id,))
                r_row = cur.fetchone()
                if not r_row:
                    conn.rollback()
                    if raise_on_error:
                        raise CoreStoreError(f"RUN_NOT_FOUND: {run_id}")
                    return False, None, "RUN_NOT_FOUND"

                if r_row["status"] != "RUNNING":
                    conn.rollback()
                    err = f"RUN_NOT_ACTIVE: status={r_row['status']}"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, None, err

                if r_row["run_spent"] + r_row["run_reserved"] + estimated_tokens > r_row["run_limit"]:
                    conn.rollback()
                    err = "RUN_BUDGET_EXCEEDED"
                    if raise_on_error:
                        raise BudgetExceededError(err)
                    return False, None, err

                # 3. 检查全局预算
                cur.execute("SELECT total_limit, total_spent, total_reserved FROM global_budget WHERE id = 'GLOBAL'")
                g_row = cur.fetchone()
                if not g_row:
                    conn.rollback()
                    if raise_on_error:
                        raise CoreStoreError("GLOBAL_BUDGET_NOT_FOUND")
                    return False, None, "GLOBAL_BUDGET_NOT_FOUND"

                if g_row["total_spent"] + g_row["total_reserved"] + estimated_tokens > g_row["total_limit"]:
                    conn.rollback()
                    err = "GLOBAL_BUDGET_EXCEEDED"
                    if raise_on_error:
                        raise BudgetExceededError(err)
                    return False, None, err

                # 4. 执行原子预留
                new_p_energy = p_row["energy"] - estimated_tokens
                cur.execute("UPDATE pixel_accounts SET energy = ?, updated_at = ? WHERE pixel_id = ?", (new_p_energy, now, pixel_id))
                cur.execute("UPDATE runs SET run_reserved = run_reserved + ? WHERE run_id = ?", (estimated_tokens, run_id))
                cur.execute("UPDATE global_budget SET total_reserved = total_reserved + ?, updated_at = ? WHERE id = 'GLOBAL'", (estimated_tokens, now))

                # 记录 reservation
                cur.execute("""
                    INSERT INTO reservations (call_id, run_id, pixel_id, amount, status, created_at)
                    VALUES (?, ?, ?, ?, 'OPEN', ?)
                """, (call_id, run_id, pixel_id, estimated_tokens, now))

                # 写入不可变账本 entry
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'reserve', ?, ?, ?)
                """, (call_id, now, pixel_id, -estimated_tokens, new_p_energy, json.dumps({"run_id": run_id, "message_id": message_id})))

                conn.commit()
                return True, call_id, None
            except (CoreStoreError, BudgetExceededError, SpendBlockedError):
                raise
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"reserve_call_budget transaction failed: {e}")

    def settle_call_budget(
        self,
        call_id: str,
        actual_tokens: int,
        cost_cny: float = 0.0,
        outcome: str = "SUCCESS",
        details: Optional[Dict[str, Any]] = None,
        model_call: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """原子结算预留: 扣减实际消耗，退还或补足差额，释放 Run 与全局预留."""
        """原子结算预留: 扣减实际消耗，退还或补足差额，释放 Run 与全局预留."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("SELECT * FROM reservations WHERE call_id = ?", (call_id,))
                res = cur.fetchone()
                if not res:
                    conn.rollback()
                    raise CoreStoreError(f"Reservation not found: {call_id}")

                if res["status"] != "OPEN":
                    conn.rollback()
                    raise CoreStoreError(f"Reservation already settled or invalid: status={res['status']}")

                run_id = res["run_id"]
                pixel_id = res["pixel_id"]
                reserved = res["amount"]

                # 差额 (正为预留有多退还给 Pixel，负为需补扣)
                diff = reserved - actual_tokens

                # 更新 Pixel 账户
                cur.execute("SELECT energy FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                p_row = cur.fetchone()
                new_energy = max(0, p_row["energy"] + diff)
                active = 1 if new_energy > 0 else 0
                cur.execute("UPDATE pixel_accounts SET energy = ?, active = ?, updated_at = ? WHERE pixel_id = ?", (new_energy, active, now, pixel_id))

                # 更新 Run 累计与预留
                cur.execute("""
                    UPDATE runs
                    SET run_spent = run_spent + ?, run_reserved = max(0, run_reserved - ?)
                    WHERE run_id = ?
                """, (actual_tokens, reserved, run_id))

                # 更新全局累计与预留
                cur.execute("""
                    UPDATE global_budget
                    SET total_spent = total_spent + ?, total_reserved = max(0, total_reserved - ?), updated_at = ?
                    WHERE id = 'GLOBAL'
                """, (actual_tokens, reserved, now))

                # 标记 reservation 状态
                cur.execute("UPDATE reservations SET status = 'SETTLED', settled_at = ? WHERE call_id = ?", (now, call_id))

                # 记入不可变账本
                settle_id = f"settle_{call_id.replace('res_', '')}"
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'settle', ?, ?, ?)
                """, (settle_id, now, pixel_id, diff, new_energy, json.dumps({
                    "call_id": call_id,
                    "reserved": reserved,
                    "actual_tokens": actual_tokens,
                    **(details or {})
                })))

                if model_call is not None:
                    self.record_model_call(**model_call, _connection=conn)
                    message_id = model_call.get("message_id")
                    if message_id:
                        status = "RESPONSE_STORED" if outcome == "SUCCESS" else "QUEUED"
                        cur.execute("UPDATE messages SET status = ? WHERE message_id = ?", (status, message_id))
                conn.commit()
                return {
                    "call_id": call_id,
                    "reserved": reserved,
                    "actual_tokens": actual_tokens,
                    "diff": diff,
                    "pixel_balance_after": new_energy,
                }
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"settle_call_budget transaction failed: {e}")

    def mark_call_unknown(
        self,
        call_id: str,
        run_id: str,
        pixel_id: str,
        message_id: Optional[str],
        error_msg: str,
        model: str = "UNKNOWN",
        pricing_revision: Optional[str] = None,
    ):
        """未知调用结果: 保留预留，进入 CALL_OUTCOME_UNKNOWN，挂起 Run 为 PAUSED_RECOVERY_REQUIRED."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                # 保持预留处于 OPEN 状态，严禁自动退款或取消
                cur.execute("UPDATE reservations SET status = 'OPEN' WHERE call_id = ?", (call_id,))
                cur.execute("""
                    INSERT OR REPLACE INTO model_calls (
                        call_id, run_id, pixel_id, message_id, model, pricing_revision,
                        raw_response, outcome, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'CALL_OUTCOME_UNKNOWN', ?)
                """, (
                    call_id,
                    run_id,
                    pixel_id,
                    message_id,
                    model,
                    pricing_revision,
                    json.dumps({"error": error_msg}, ensure_ascii=False),
                    now,
                ))

                if message_id:
                    cur.execute("UPDATE messages SET status = 'CALL_OUTCOME_UNKNOWN', updated_at = ? WHERE message_id = ?", (now, message_id))

                cur.execute("""
                    UPDATE runs
                    SET status = 'PAUSED_RECOVERY_REQUIRED', stop_reason = ?
                    WHERE run_id = ?
                """, (f"CALL_OUTCOME_UNKNOWN: {error_msg}", run_id))

                conn.commit()
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"mark_call_unknown transaction failed: {e}")

    def resolve_unknown_call_no_charge(
        self,
        call_id: str,
        reason: str = "OWNER_RESET_NO_CHARGE",
    ) -> Dict[str, Any]:
        """Owner 确认未计费后，原子退款预留、解除未知调用并将消息重新排队."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("SELECT * FROM model_calls WHERE call_id = ?", (call_id,))
                call = cur.fetchone()
                if not call or call["outcome"] != "CALL_OUTCOME_UNKNOWN":
                    raise CoreStoreError(f"Unknown call is not unresolved: {call_id}")

                cur.execute("SELECT * FROM reservations WHERE call_id = ?", (call_id,))
                reservation = cur.fetchone()
                if not reservation or reservation["status"] != "OPEN":
                    raise CoreStoreError(f"Open reservation not found: {call_id}")

                run_id = reservation["run_id"]
                pixel_id = reservation["pixel_id"]
                reserved = int(reservation["amount"])

                cur.execute("SELECT energy FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                account = cur.fetchone()
                if not account:
                    raise CoreStoreError(f"Pixel account not found: {pixel_id}")
                new_energy = int(account["energy"]) + reserved

                cur.execute(
                    "UPDATE pixel_accounts SET energy = ?, active = ?, updated_at = ? WHERE pixel_id = ?",
                    (new_energy, 1 if new_energy > 0 else 0, now, pixel_id),
                )
                cur.execute(
                    "UPDATE runs SET run_reserved = max(0, run_reserved - ?), status = ?, stop_reason = ?, finished_at = ? WHERE run_id = ?",
                    (reserved, "RECOVERED_NO_CHARGE", reason, now, run_id),
                )
                cur.execute(
                    "UPDATE global_budget SET total_reserved = max(0, total_reserved - ?), updated_at = ? WHERE id = 'GLOBAL'",
                    (reserved, now),
                )
                cur.execute(
                    "UPDATE reservations SET status = 'SETTLED', settled_at = ? WHERE call_id = ?",
                    (now, call_id),
                )
                cur.execute(
                    "UPDATE model_calls SET outcome = 'RESET_NO_CHARGE', actual_tokens = 0, cost_cny = 0.0 WHERE call_id = ?",
                    (call_id,),
                )

                message_id = call["message_id"]
                if message_id:
                    cur.execute(
                        "UPDATE messages SET status = 'QUEUED', updated_at = ? WHERE message_id = ?",
                        (now, message_id),
                    )

                settle_id = f"settle_{call_id.replace('res_', '')}"
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'settle', ?, ?, ?)
                """, (
                    settle_id,
                    now,
                    pixel_id,
                    reserved,
                    new_energy,
                    json.dumps({
                        "call_id": call_id,
                        "reserved": reserved,
                        "actual_tokens": 0,
                        "resolution": reason,
                    }, ensure_ascii=False),
                ))

                conn.commit()
                return {
                    "call_id": call_id,
                    "run_id": run_id,
                    "pixel_id": pixel_id,
                    "message_id": message_id,
                    "refunded_tokens": reserved,
                    "pixel_balance_after": new_energy,
                }
            except Exception as e:
                conn.rollback()
                if isinstance(e, CoreStoreError):
                    raise
                raise CoreStoreError(f"resolve_unknown_call_no_charge transaction failed: {e}")

    def record_model_call(
        self,
        call_id: str,
        run_id: str,
        pixel_id: str,
        model: str,
        prompt_hash: str,
        raw_response: str,
        normalized_response: str,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        cached_tokens: int = 0,
        actual_tokens: int = 0,
        cost_cny: float = 0.0,
        outcome: str = "SUCCESS",
        pricing_revision: Optional[str] = None,
        message_id: Optional[str] = None,
        _connection=None,
    ) -> bool:
        """记录模型调用明细与元数据."""
        now = time.time()
        from contextlib import nullcontext
        with (nullcontext(_connection) if _connection is not None else self.get_connection()) as conn:
            cur = conn.cursor()
            cur.execute("""
                INSERT OR REPLACE INTO model_calls (
                    call_id, run_id, pixel_id, message_id, model, pricing_revision,
                    prompt_hash, raw_response, normalized_response, prompt_tokens,
                    completion_tokens, cached_tokens, actual_tokens, cost_cny,
                    outcome, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                call_id, run_id, pixel_id, message_id, model, pricing_revision,
                prompt_hash, raw_response, normalized_response, prompt_tokens,
                completion_tokens, cached_tokens, actual_tokens, cost_cny,
                outcome, now
            ))
            if _connection is None:
                conn.commit()
            return True

    def promote_repaired_response(self, call_id: str, normalized_response: str) -> bool:
        """Reuse an already billed failed response after deterministic validation."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            row = cur.execute(
                "SELECT message_id, outcome FROM model_calls WHERE call_id = ?", (call_id,)
            ).fetchone()
            if not row or row["outcome"] != "FAILED_RESPONSE" or not row["message_id"]:
                conn.rollback()
                return False
            cur.execute(
                "UPDATE model_calls SET normalized_response = ?, outcome = 'REPAIRED_RESPONSE' WHERE call_id = ?",
                (normalized_response, call_id),
            )
            cur.execute(
                "UPDATE messages SET status = 'RESPONSE_STORED' WHERE message_id = ? AND status = 'QUEUED'",
                (row["message_id"],),
            )
            if cur.rowcount != 1:
                conn.rollback()
                return False
            conn.commit()
            return True

    # ==================== 经济动作：回款、退款、转账、繁殖 ====================

    def credit_revenue(
        self,
        pixel_id: str,
        net_amount: float,
        external_tx_id: str,
        cost_per_million_tokens: float = 1.0,
        details: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """外部净回款原子入账 (严格幂等校验，优先冲抵 Deficit)."""
        tx_clean = str(external_tx_id).strip()
        if not tx_clean:
            return {"ok": False, "tokens": 0, "status": "MISSING_TX_ID"}
        if net_amount <= 0:
            return {"ok": False, "tokens": 0, "status": "INVALID_AMOUNT"}

        tokens_intended = int((net_amount / cost_per_million_tokens) * 1_000_000.0)
        now = time.time()

        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                # 1. 检查幂等性
                cur.execute("SELECT * FROM external_revenues WHERE external_tx_id = ?", (tx_clean,))
                existing = cur.fetchone()
                if existing:
                    if existing["pixel_id"] == pixel_id and abs(existing["net_amount"] - net_amount) < 1e-6:
                        conn.rollback()
                        return {"ok": True, "tokens": existing["amount_tokens"], "status": "ALREADY_CREDITED"}
                    else:
                        conn.rollback()
                        return {"ok": False, "tokens": 0, "status": "CONFLICT_TX_MISMATCH"}

                # 2. 查询 Pixel 账户
                cur.execute("SELECT energy, active, refund_deficit_tokens FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                p_row = cur.fetchone()
                if not p_row:
                    conn.rollback()
                    return {"ok": False, "tokens": 0, "status": "PIXEL_NOT_FOUND"}

                deficit = p_row["refund_deficit_tokens"]
                current_energy = p_row["energy"]

                # 3. 优先冲抵 Deficit
                if deficit > 0:
                    if tokens_intended <= deficit:
                        new_deficit = deficit - tokens_intended
                        tokens_to_energy = 0
                    else:
                        tokens_to_energy = tokens_intended - deficit
                        new_deficit = 0
                else:
                    new_deficit = 0
                    tokens_to_energy = tokens_intended

                new_energy = current_energy + tokens_to_energy
                new_active = 1 if new_energy > 0 else 0
                blocked_reason = None if new_deficit == 0 else "REFUND_DEFICIT"

                cur.execute("""
                    UPDATE pixel_accounts
                    SET energy = ?, active = ?, refund_deficit_tokens = ?, spend_blocked_reason = ?, updated_at = ?
                    WHERE pixel_id = ?
                """, (new_energy, new_active, new_deficit, blocked_reason, now, pixel_id))

                # 4. 插入 external_revenues
                cur.execute("""
                    INSERT INTO external_revenues (external_tx_id, pixel_id, net_amount, amount_tokens, timestamp, details)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (tx_clean, pixel_id, net_amount, tokens_intended, now, json.dumps(details or {})))

                # 5. 写入不可变账本
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'revenue', ?, ?, ?)
                """, (f"rev_{tx_clean}", now, pixel_id, tokens_intended, new_energy, json.dumps({
                    "external_tx_id": tx_clean,
                    "net_amount": net_amount,
                    "deficit_offset": deficit - new_deficit,
                    **(details or {})
                })))

                conn.commit()
                return {
                    "ok": True,
                    "tokens": tokens_intended,
                    "tokens_added_to_energy": tokens_to_energy,
                    "deficit_remaining": new_deficit,
                    "status": "CREDITED",
                }
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"credit_revenue transaction failed: {e}")

    def refund_revenue(
        self,
        external_tx_id: str,
        refund_id: str,
        refund_amount_cny: Optional[float] = None,
        cost_per_million_tokens: float = 1.0,
        reason: str = "refund",
    ) -> Tuple[bool, int, Optional[str]]:
        """外部回款真实退款冲回: 超出余额进入 deficit 并阻断支出."""
        tx_clean = str(external_tx_id).strip()
        now = time.time()

        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                # 检查原始回款
                cur.execute("SELECT * FROM external_revenues WHERE external_tx_id = ?", (tx_clean,))
                rev = cur.fetchone()
                if not rev:
                    conn.rollback()
                    return False, 0, "TRANSACTION_NOT_FOUND"

                pixel_id = rev["pixel_id"]

                # 检查是否已全额退款
                cur.execute("SELECT COALESCE(SUM(refund_amount_cny), 0) as total_ref FROM external_refunds WHERE external_tx_id = ?", (tx_clean,))
                already_ref = float(cur.fetchone()["total_ref"])
                available_for_ref = rev["net_amount"] - already_ref
                if available_for_ref <= 1e-6:
                    conn.rollback()
                    return False, 0, "ALREADY_FULLY_REFUNDED"

                actual_ref_cny = available_for_ref if refund_amount_cny is None else min(refund_amount_cny, available_for_ref)
                if actual_ref_cny <= 0:
                    conn.rollback()
                    return False, 0, "INVALID_REFUND_AMOUNT"

                tokens_intended = int((actual_ref_cny / cost_per_million_tokens) * 1_000_000.0)

                # 查询 Pixel 账户
                cur.execute("SELECT energy, refund_deficit_tokens FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                p_row = cur.fetchone()
                current_e = p_row["energy"]
                current_def = p_row["refund_deficit_tokens"]

                if current_e < tokens_intended:
                    deficit_increase = tokens_intended - current_e
                    tokens_deducted = current_e
                    new_energy = 0
                    new_active = 0
                    new_def = current_def + deficit_increase
                    blocked = "REFUND_DEFICIT"
                else:
                    deficit_increase = 0
                    tokens_deducted = tokens_intended
                    new_energy = current_e - tokens_intended
                    new_active = 1 if new_energy > 0 else 0
                    new_def = current_def
                    blocked = "REFUND_DEFICIT" if new_def > 0 else None

                cur.execute("""
                    UPDATE pixel_accounts
                    SET energy = ?, active = ?, refund_deficit_tokens = ?, spend_blocked_reason = ?, updated_at = ?
                    WHERE pixel_id = ?
                """, (new_energy, new_active, new_def, blocked, now, pixel_id))

                # 插入 external_refunds
                cur.execute("""
                    INSERT INTO external_refunds (refund_id, external_tx_id, pixel_id, refund_amount_cny, tokens_deducted, deficit_tokens, reason, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (refund_id, tx_clean, pixel_id, actual_ref_cny, tokens_deducted, deficit_increase, reason, now))

                # 写入账本
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'refund', ?, ?, ?)
                """, (refund_id, now, pixel_id, -tokens_deducted, new_energy, json.dumps({
                    "external_tx_id": tx_clean,
                    "refund_amount": actual_ref_cny,
                    "tokens_intended": tokens_intended,
                    "tokens_deducted": tokens_deducted,
                    "deficit_tokens": deficit_increase,
                    "reason": reason,
                })))

                conn.commit()
                return True, tokens_deducted, None
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"refund_revenue transaction failed: {e}")

    def transfer_energy(
        self,
        from_pixel: str,
        to_pixel: str,
        amount: int,
        ref_message_id: Optional[str] = None,
        raise_on_error: bool = True,
    ) -> Tuple[bool, Optional[str]]:
        """原子转账，遵守能量守恒与支出阻断校验."""
        if amount <= 0:
            if raise_on_error:
                raise CoreStoreError("Amount must be strictly positive")
            return False, "Amount must be strictly positive"

        now = time.time()
        tx_id = f"tx_{hashlib.sha256(f'{from_pixel}_{to_pixel}_{now}_{os.urandom(4).hex()}'.encode()).hexdigest()[:12]}"

        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (from_pixel,))
                p_from = cur.fetchone()
                cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (to_pixel,))
                p_to = cur.fetchone()

                if not p_from:
                    conn.rollback()
                    err = f"Sender pixel '{from_pixel}' not found"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, err
                if not p_to:
                    conn.rollback()
                    err = f"Recipient pixel '{to_pixel}' not found"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, err

                if p_from["refund_deficit_tokens"] > 0 or p_from["spend_blocked_reason"]:
                    conn.rollback()
                    err = f"Sender pixel '{from_pixel}' has refund deficit, spend blocked"
                    if raise_on_error:
                        raise SpendBlockedError(err)
                    return False, err

                if not p_from["active"]:
                    conn.rollback()
                    err = f"Sender pixel '{from_pixel}' is not active"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, err
                if not p_to["active"]:
                    conn.rollback()
                    err = f"Recipient pixel '{to_pixel}' is not active"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, err

                if p_from["energy"] < amount:
                    conn.rollback()
                    err = f"Insufficient energy: have {p_from['energy']}, need {amount}"
                    if raise_on_error:
                        raise CoreStoreError(err)
                    return False, err

                new_from_e = p_from["energy"] - amount
                new_to_e = p_to["energy"] + amount
                from_active = 1 if new_from_e > 0 else 0

                cur.execute("UPDATE pixel_accounts SET energy = ?, active = ?, updated_at = ? WHERE pixel_id = ?", (new_from_e, from_active, now, from_pixel))
                cur.execute("UPDATE pixel_accounts SET energy = ?, updated_at = ? WHERE pixel_id = ?", (new_to_e, now, to_pixel))

                # 账本记录
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'transfer', ?, ?, ?)
                """, (f"{tx_id}_out", now, from_pixel, -amount, new_from_e, json.dumps({"to": to_pixel, "ref_message_id": ref_message_id})))

                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'transfer', ?, ?, ?)
                """, (f"{tx_id}_in", now, to_pixel, amount, new_to_e, json.dumps({"from": from_pixel, "ref_message_id": ref_message_id})))

                conn.commit()
                return True, tx_id
            except (CoreStoreError, SpendBlockedError):
                raise
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"transfer_energy transaction failed: {e}")

    def allocate_reproduction(
        self,
        parent_id: str,
        child_id: str,
        child_energy: int,
    ) -> Tuple[bool, Optional[str]]:
        """元胞复制原子扣款与子代创建 (财务层)."""
        if child_energy <= 0:
            return False, "child_energy must be strictly positive"

        now = time.time()
        tx_id = f"reprod_{hashlib.sha256(f'{parent_id}_{child_id}_{now}'.encode()).hexdigest()[:12]}"

        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (parent_id,))
                p_parent = cur.fetchone()
                if not p_parent:
                    conn.rollback()
                    return False, f"Parent pixel '{parent_id}' not found"

                if not p_parent["active"]:
                    conn.rollback()
                    return False, f"Parent pixel '{parent_id}' is not active"

                if p_parent["refund_deficit_tokens"] > 0:
                    conn.rollback()
                    return False, "Parent has refund deficit, spend blocked"

                if p_parent["energy"] < child_energy:
                    conn.rollback()
                    return False, f"Parent insufficient energy: have {p_parent['energy']}, need {child_energy}"

                # 检查子代账户是否已存在
                cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (child_id,))
                if cur.fetchone():
                    conn.rollback()
                    return False, f"Child account '{child_id}' already exists"

                new_parent_e = p_parent["energy"] - child_energy
                parent_active = 1 if new_parent_e > 0 else 0

                cur.execute("UPDATE pixel_accounts SET energy = ?, active = ?, updated_at = ? WHERE pixel_id = ?", (new_parent_e, parent_active, now, parent_id))
                cur.execute("""
                    INSERT INTO pixel_accounts (pixel_id, energy, active, refund_deficit_tokens, updated_at)
                    VALUES (?, ?, 1, 0, ?)
                """, (child_id, child_energy, now))

                # 账本双记
                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'reproduce', ?, ?, ?)
                """, (f"{tx_id}_p", now, parent_id, -child_energy, new_parent_e, json.dumps({"child_id": child_id})))

                cur.execute("""
                    INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                    VALUES (?, ?, ?, 'reproduce', ?, ?, ?)
                """, (f"{tx_id}_c", now, child_id, child_energy, child_energy, json.dumps({"parent_id": parent_id})))

                conn.commit()
                return True, tx_id
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"allocate_reproduction transaction failed: {e}")

    # ==================== 消息状态机与副作用幂等 ====================

    def enqueue_message(
        self,
        message_id: str,
        sender: str,
        recipient: str,
        content: str,
        round_num: int,
        hop: int = 1,
        source_type: str = "pixel",
        is_feedback: bool = False,
        run_id: Optional[str] = None,
    ) -> bool:
        """原子消息入队，已存在则忽略."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            try:
                cur.execute("""
                    INSERT OR IGNORE INTO messages (
                        message_id, run_id, round_num, hop, sender, recipient, content, status, is_feedback, source_type, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)
                """, (message_id, run_id, round_num, hop, sender, recipient, content, 1 if is_feedback else 0, source_type, now, now))
                conn.commit()
                return cur.rowcount > 0
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"enqueue_message failed: {e}")

    def transition_message(self, message_id: str, to_status: str, expected_from: Optional[str] = None) -> bool:
        """更新消息状态机状态."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            if expected_from:
                cur.execute("UPDATE messages SET status = ?, updated_at = ? WHERE message_id = ? AND status = ?", (to_status, now, message_id, expected_from))
            else:
                cur.execute("UPDATE messages SET status = ?, updated_at = ? WHERE message_id = ?", (to_status, now, message_id))
            conn.commit()
            return cur.rowcount > 0

    def get_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        """按 message_id 查询消息详情."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM messages WHERE message_id = ?", (message_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def get_model_call_by_message(self, message_id: str) -> Optional[Dict[str, Any]]:
        """按 message_id 查询最近一次模型调用明细."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM model_calls WHERE message_id = ? ORDER BY created_at DESC LIMIT 1", (message_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def record_effect_once(
        self,
        effect_id: str,
        message_id: str,
        effect_type: str,
        effect_index: int,
        payload_hash: str,
        details: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """记录副作用 (Exactly-Once 保证). 若已记录返回 False (表示重复)."""
        now = time.time()
        clean_type = str(effect_type).strip().lower().replace("_energy", "").replace("_message", "")
        with self.get_connection() as conn:
            cur = conn.cursor()
            try:
                # 双重幂等校验: 检查 effect_id 或 (message_id, clean_type, effect_index)
                cur.execute(
                    "SELECT effect_id FROM effects WHERE effect_id = ? OR (message_id = ? AND effect_type = ? AND effect_index = ?)",
                    (effect_id, message_id, clean_type, effect_index)
                )
                if cur.fetchone():
                    return False

                cur.execute("""
                    INSERT INTO effects (effect_id, message_id, effect_type, effect_index, payload_hash, status, details, created_at)
                    VALUES (?, ?, ?, ?, ?, 'APPLIED', ?, ?)
                """, (effect_id, message_id, clean_type, effect_index, payload_hash, json.dumps(details or {}), now))
                conn.commit()
                return True
            except sqlite3.IntegrityError:
                # effect_id 已存在
                conn.rollback()
                return False
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"record_effect_once failed: {e}")

    def get_unresolved_reservations(self) -> List[Dict[str, Any]]:
        """获取所有未决或未关闭的 reservations."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM reservations WHERE status = 'OPEN'")
            return [dict(r) for r in cur.fetchall()]

    def get_unknown_calls(self) -> List[Dict[str, Any]]:
        """获取所有处于 CALL_OUTCOME_UNKNOWN 状态的模型调用."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM model_calls WHERE outcome = 'CALL_OUTCOME_UNKNOWN'")
            return [dict(r) for r in cur.fetchall()]

    def ensure_pixel_account(
        self,
        pixel_id: str,
        initial_energy: int = 0,
        active: bool = True,
        refund_deficit_tokens: int = 0,
        spend_blocked_reason: Optional[str] = None,
        energy: Optional[int] = None,
    ) -> Dict[str, Any]:
        """确保元胞核心账户在数据库中存在 (若已存在则保留数据库权威余额，禁止外部反向覆盖)."""
        if energy is not None:
            initial_energy = energy
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
            existing = cur.fetchone()
            if existing:
                conn.commit()
                return dict(existing)

            cur.execute("""
                INSERT INTO pixel_accounts (pixel_id, energy, active, refund_deficit_tokens, spend_blocked_reason, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (pixel_id, initial_energy, 1 if active else 0, refund_deficit_tokens, spend_blocked_reason, now))
            cur.execute("""
                INSERT INTO ledger_entries (entry_id, timestamp, pixel_id, entry_type, amount, balance_after, details)
                VALUES (?, ?, ?, 'initial', ?, ?, ?)
            """, (
                f"initial_{pixel_id}",
                now,
                pixel_id,
                initial_energy,
                initial_energy,
                json.dumps({"source": "ensure_pixel_account"}),
            ))
            conn.commit()
            return self.get_pixel_account(pixel_id)

    upsert_pixel_account = ensure_pixel_account

    def get_pixel_account(self, pixel_id: str) -> Optional[Dict[str, Any]]:
        """获取元胞账户信息."""
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
            row = cur.fetchone()
            return dict(row) if row else None

    def reproduce_pixel(self, parent_id: str, child_id: str, child_energy: int) -> str:
        """测试友好型复制接口，失败抛出 CoreStoreError / SpendBlockedError."""
        acc = self.get_pixel_account(parent_id)
        if acc and acc.get("refund_deficit_tokens", 0) > 0:
            raise SpendBlockedError("Parent has refund deficit, spend blocked")
        ok, res = self.allocate_reproduction(parent_id, child_id, child_energy)
        if not ok:
            raise CoreStoreError(res)
        return res

    def deduct_pixel_refund(self, pixel_id: str, refund_tokens: int, refund_id: str) -> int:
        """直接扣减元胞退款额度 (用于测试赤字逻辑)."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("SELECT energy, refund_deficit_tokens FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                p_row = cur.fetchone()
                if not p_row:
                    conn.rollback()
                    raise CoreStoreError(f"Pixel '{pixel_id}' not found")
                cur_e = p_row["energy"]
                cur_def = p_row["refund_deficit_tokens"]
                if cur_e < refund_tokens:
                    deficit_inc = refund_tokens - cur_e
                    deducted = cur_e
                    new_e = 0
                    new_active = 0
                    new_def = cur_def + deficit_inc
                    blocked = "REFUND_DEFICIT"
                else:
                    deficit_inc = 0
                    deducted = refund_tokens
                    new_e = cur_e - refund_tokens
                    new_active = 1 if new_e > 0 else 0
                    new_def = cur_def
                    blocked = "REFUND_DEFICIT" if new_def > 0 else None

                cur.execute("""
                    UPDATE pixel_accounts
                    SET energy = ?, active = ?, refund_deficit_tokens = ?, spend_blocked_reason = ?, updated_at = ?
                    WHERE pixel_id = ?
                """, (new_e, new_active, new_def, blocked, now, pixel_id))
                conn.commit()
                return deducted
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"deduct_pixel_refund failed: {e}")

    def credit_pixel_revenue(self, pixel_id: str, revenue_tokens: int, tx_id: str) -> int:
        """直接充值元胞回款额度 (优先抵扣赤字)."""
        now = time.time()
        with self.get_connection() as conn:
            cur = conn.cursor()
            cur.execute("BEGIN IMMEDIATE")
            try:
                cur.execute("SELECT energy, active, refund_deficit_tokens FROM pixel_accounts WHERE pixel_id = ?", (pixel_id,))
                p_row = cur.fetchone()
                if not p_row:
                    conn.rollback()
                    raise CoreStoreError(f"Pixel '{pixel_id}' not found")

                deficit = p_row["refund_deficit_tokens"]
                current_e = p_row["energy"]
                if deficit > 0:
                    if revenue_tokens <= deficit:
                        new_def = deficit - revenue_tokens
                        tokens_to_e = 0
                    else:
                        tokens_to_e = revenue_tokens - deficit
                        new_def = 0
                else:
                    new_def = 0
                    tokens_to_e = revenue_tokens

                new_e = current_e + tokens_to_e
                new_active = 1 if new_e > 0 else 0
                blocked = None if new_def == 0 else "REFUND_DEFICIT"

                cur.execute("""
                    UPDATE pixel_accounts
                    SET energy = ?, active = ?, refund_deficit_tokens = ?, spend_blocked_reason = ?, updated_at = ?
                    WHERE pixel_id = ?
                """, (new_e, new_active, new_def, blocked, now, pixel_id))
                conn.commit()
                return tokens_to_e
            except Exception as e:
                conn.rollback()
                raise CoreStoreError(f"credit_pixel_revenue failed: {e}")

    settle_call = settle_call_budget
