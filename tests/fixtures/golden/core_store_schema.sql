CREATE TABLE effects (
                effect_id TEXT PRIMARY KEY,
                message_id TEXT NOT NULL,
                effect_type TEXT NOT NULL,
                effect_index INTEGER NOT NULL,
                payload_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'APPLIED',
                details TEXT,
                created_at REAL NOT NULL
            )

CREATE TABLE external_refunds (
                refund_id TEXT PRIMARY KEY,
                external_tx_id TEXT NOT NULL,
                pixel_id TEXT NOT NULL,
                refund_amount_cny REAL NOT NULL,
                tokens_deducted INTEGER NOT NULL,
                deficit_tokens INTEGER NOT NULL,
                reason TEXT,
                timestamp REAL NOT NULL
            )

CREATE TABLE external_revenues (
                external_tx_id TEXT PRIMARY KEY,
                pixel_id TEXT NOT NULL,
                net_amount REAL NOT NULL,
                amount_tokens INTEGER NOT NULL,
                timestamp REAL NOT NULL,
                details TEXT
            )

CREATE TABLE global_budget (
                id TEXT PRIMARY KEY DEFAULT 'GLOBAL',
                total_limit INTEGER NOT NULL,
                total_spent INTEGER NOT NULL DEFAULT 0,
                total_reserved INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'CNY',
                updated_at REAL NOT NULL
            )

CREATE TABLE ledger_entries (
                entry_id TEXT PRIMARY KEY,
                timestamp REAL NOT NULL,
                pixel_id TEXT NOT NULL,
                entry_type TEXT NOT NULL,
                amount INTEGER NOT NULL,
                balance_after INTEGER NOT NULL,
                details TEXT
            )

CREATE TABLE messages (
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
            )

CREATE TABLE model_calls (
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
            )

CREATE TABLE pixel_accounts (
                pixel_id TEXT PRIMARY KEY,
                energy INTEGER NOT NULL DEFAULT 0,
                active INTEGER NOT NULL DEFAULT 1,
                refund_deficit_tokens INTEGER NOT NULL DEFAULT 0,
                spend_blocked_reason TEXT,
                updated_at REAL NOT NULL
            )

CREATE TABLE reservations (
                call_id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                pixel_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN',
                created_at REAL NOT NULL,
                settled_at REAL
            )

CREATE TABLE runs (
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
            )

CREATE TABLE schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            )

CREATE TABLE tool_executions (
                operation_id TEXT PRIMARY KEY,
                run_id TEXT,
                message_id TEXT NOT NULL,
                pixel_id TEXT NOT NULL,
                op_index INTEGER NOT NULL,
                tool TEXT NOT NULL,
                args_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'STARTED',
                result TEXT,
                started_at REAL NOT NULL,
                finished_at REAL
            )
