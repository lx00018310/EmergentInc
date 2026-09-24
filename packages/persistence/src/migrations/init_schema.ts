import { SqliteDatabase } from "../sqlite/db.js";

/**
 * 初始化 CoreStore 所有核心表与索引
 */
export function initSchema(db: SqliteDatabase): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS global_budget (
          id TEXT PRIMARY KEY DEFAULT 'GLOBAL',
          total_limit INTEGER NOT NULL,
          total_spent INTEGER NOT NULL DEFAULT 0,
          total_reserved INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'CNY',
          updated_at REAL NOT NULL
      );

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
          error_code TEXT,
          error_summary TEXT,
          created_at REAL NOT NULL,
          finished_at REAL
      );

      CREATE TABLE IF NOT EXISTS pixel_accounts (
          pixel_id TEXT PRIMARY KEY,
          energy INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          refund_deficit_tokens INTEGER NOT NULL DEFAULT 0,
          spend_blocked_reason TEXT,
          updated_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
          call_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          pixel_id TEXT NOT NULL,
          amount INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          created_at REAL NOT NULL,
          settled_at REAL
      );

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
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          cached_tokens INTEGER,
          actual_tokens INTEGER,
          cost_cny REAL,
          tool_cost REAL,
          round_num INTEGER,
          outcome TEXT NOT NULL DEFAULT 'SUCCESS',
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owner_chat_calls (
          call_id TEXT PRIMARY KEY,
          stage TEXT NOT NULL,
          model TEXT NOT NULL,
          question_hash TEXT NOT NULL,
          prompt_tokens INTEGER,
          completion_tokens INTEGER,
          actual_tokens INTEGER,
          cost_cny REAL,
          outcome TEXT NOT NULL,
          created_at REAL NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS ledger_entries (
          entry_id TEXT PRIMARY KEY,
          timestamp REAL NOT NULL,
          pixel_id TEXT NOT NULL,
          entry_type TEXT NOT NULL,
          amount INTEGER NOT NULL,
          balance_after INTEGER NOT NULL,
          details TEXT
      );

      CREATE TABLE IF NOT EXISTS external_revenues (
          external_tx_id TEXT PRIMARY KEY,
          pixel_id TEXT NOT NULL,
          net_amount REAL NOT NULL,
          amount_tokens INTEGER NOT NULL,
          timestamp REAL NOT NULL,
          details TEXT
      );

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

      CREATE TABLE IF NOT EXISTS recovery_decisions (
          decision_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          id TEXT NOT NULL,
          decision TEXT NOT NULL,
          reason TEXT NOT NULL,
          details TEXT,
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_reward_requests (
          idempotency_key TEXT PRIMARY KEY,
          request_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tool_executions (
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
      );

      CREATE INDEX IF NOT EXISTS idx_messages_queue 
      ON messages(status, round_num, is_feedback, created_at);

      CREATE INDEX IF NOT EXISTS idx_effects_lookup
      ON effects(message_id, effect_index);

      CREATE INDEX IF NOT EXISTS idx_tool_executions_lookup
      ON tool_executions(message_id, op_index);

      CREATE INDEX IF NOT EXISTS idx_reservations_pixel
      ON reservations(pixel_id, status);
    `);

    // SQLite needs a table rebuild to remove legacy NOT NULL/default-zero constraints.
    const columns = db.prepare("PRAGMA table_info(model_calls)").all() as any[];
    if (!columns.some(c => c.name === "tool_cost")) {
      db.exec("ALTER TABLE model_calls ADD COLUMN tool_cost REAL");
    }
    if (!columns.some(c => c.name === "round_num")) {
      db.exec("ALTER TABLE model_calls ADD COLUMN round_num INTEGER");
    }
    if (columns.some(c => ["cost_cny", "round_num"].includes(c.name) && c.notnull)) {
      // Legacy NOT NULL constraints conflated unknown values with real zeros and
      // unknown rounds with real round 0: rebuild nullable, mapping the legacy
      // default round 0 to NULL ("round unknown"). New writes keep real round 0.
      db.exec(`
        CREATE TABLE model_calls_nullable (
          call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pixel_id TEXT NOT NULL,
          message_id TEXT, model TEXT NOT NULL, pricing_revision TEXT, prompt_hash TEXT,
          raw_response TEXT, normalized_response TEXT, prompt_tokens INTEGER,
          completion_tokens INTEGER, cached_tokens INTEGER, actual_tokens INTEGER,
          cost_cny REAL, tool_cost REAL, round_num INTEGER,
          outcome TEXT NOT NULL DEFAULT 'SUCCESS', created_at REAL NOT NULL
        );
        INSERT INTO model_calls_nullable SELECT call_id, run_id, pixel_id, message_id,
          model, pricing_revision, prompt_hash, raw_response, normalized_response,
          prompt_tokens, completion_tokens, cached_tokens, actual_tokens, cost_cny,
          NULLIF(tool_cost, 0),
          CASE WHEN round_num = 0 THEN NULL ELSE round_num END,
          outcome, created_at FROM model_calls;
        DROP TABLE model_calls;
        ALTER TABLE model_calls_nullable RENAME TO model_calls;
      `);
    }
    const toolColumns = db.prepare("PRAGMA table_info(tool_executions)").all() as any[];
    if (!toolColumns.some(c => c.name === "cost_cny")) db.exec("ALTER TABLE tool_executions ADD COLUMN cost_cny REAL");
    if (!toolColumns.some(c => c.name === "model_call_id")) db.exec("ALTER TABLE tool_executions ADD COLUMN model_call_id TEXT");

    const runColumns = db.prepare("PRAGMA table_info(runs)").all() as any[];
    if (!runColumns.some(c => c.name === "error_code")) db.exec("ALTER TABLE runs ADD COLUMN error_code TEXT");
    if (!runColumns.some(c => c.name === "error_summary")) db.exec("ALTER TABLE runs ADD COLUMN error_summary TEXT");

    // Legacy messages used source_type 'engine_feedback'; the protocol enum no longer has it.
    // Normalize historical rows to 'feedback' once and record the migration marker.
    const legacyFeedback = db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE source_type = 'engine_feedback'
    `).get() as any;
    if (Number(legacyFeedback?.count ?? 0) > 0) {
      db.prepare("UPDATE messages SET source_type = 'feedback' WHERE source_type = 'engine_feedback'").run();
      db.prepare(`
        INSERT INTO schema_meta (key, value, updated_at)
        VALUES ('legacy_engine_feedback_normalized', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(String(legacyFeedback.count), Date.now() / 1000);
    }
  });
}
