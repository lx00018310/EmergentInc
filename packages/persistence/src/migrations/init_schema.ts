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
          execution_id TEXT,
          last_scope_round INTEGER,
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
          execution_id TEXT,
          binding_id TEXT,
          narrative_revision INTEGER,
          status TEXT NOT NULL DEFAULT 'OPEN',
          created_at REAL NOT NULL,
          settled_at REAL
      );

      CREATE TABLE IF NOT EXISTS model_calls (
          call_id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          pixel_id TEXT NOT NULL,
          message_id TEXT,
          execution_id TEXT,
          binding_id TEXT,
          narrative_revision INTEGER,
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
          execution_id TEXT,
          abandoned_reason TEXT,
          content TEXT NOT NULL,
          sender_binding_id TEXT,
          recipient_binding_id TEXT,
          binding_snapshot_captured INTEGER NOT NULL DEFAULT 0,
          narrative_revision INTEGER,
          identity_snapshot_captured INTEGER NOT NULL DEFAULT 0,
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
          binding_id TEXT,
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

      CREATE TABLE IF NOT EXISTS products (
          product_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          target_user TEXT NOT NULL,
          problem_statement TEXT NOT NULL,
          owner_qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          status TEXT NOT NULL DEFAULT 'idea' CHECK(status IN ('idea','validation','building','live','paused','retired')),
          previous_status TEXT,
          retirement_reason TEXT,
          created_from_mission_id TEXT REFERENCES missions(mission_id),
          created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS product_missions (
          product_id TEXT NOT NULL REFERENCES products(product_id),
          mission_id TEXT NOT NULL UNIQUE REFERENCES missions(mission_id),
          linked_at REAL NOT NULL,
          PRIMARY KEY(product_id, mission_id)
      );
      CREATE TABLE IF NOT EXISTS customer_feedback (
          feedback_id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(product_id),
          mission_id TEXT REFERENCES missions(mission_id),
          contact_alias TEXT,
          source TEXT NOT NULL,
          private_feedback_text TEXT NOT NULL,
          public_summary TEXT,
          occurred_at REAL NOT NULL,
          created_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deliveries (
          delivery_id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL REFERENCES products(product_id),
          mission_id TEXT NOT NULL REFERENCES missions(mission_id),
          contact_alias TEXT,
          evidence_ids_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','delivered','accepted','rejected')),
          delivered_at REAL,
          accepted_at REAL,
          acceptance_note TEXT
      );
      CREATE TABLE IF NOT EXISTS revenue_contributions (
          external_tx_id TEXT NOT NULL,
          qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          binding_id TEXT NOT NULL REFERENCES qianji_bindings(binding_id),
          share_bps INTEGER NOT NULL CHECK(share_bps BETWEEN 0 AND 10000),
          evidence_ref TEXT,
          PRIMARY KEY(external_tx_id, qianji_id)
      );
      CREATE TABLE IF NOT EXISTS narrative_artifacts (
          artifact_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          source_event_ids_json TEXT NOT NULL,
          source_mission_ids_json TEXT NOT NULL,
          content_revision INTEGER NOT NULL DEFAULT 1,
          created_at REAL NOT NULL
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

      CREATE TABLE IF NOT EXISTS qianji_profiles (
          qianji_id TEXT PRIMARY KEY,
          career_status TEXT NOT NULL CHECK(career_status IN ('candidate', 'trial', 'active', 'retired')),
          narrative_json TEXT NOT NULL,
          narrative_revision INTEGER NOT NULL DEFAULT 0 CHECK(narrative_revision >= 0),
          created_at REAL NOT NULL,
          retired_at REAL,
          retired_reason TEXT
      );

      CREATE TABLE IF NOT EXISTS qianji_bindings (
          binding_id TEXT PRIMARY KEY,
          qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          pixel_id TEXT NOT NULL,
          incarnation INTEGER NOT NULL CHECK(incarnation > 0),
          bound_at REAL NOT NULL,
          unbound_at REAL,
          birth_effect_id TEXT,
          archive_relative_path TEXT,
          CHECK(unbound_at IS NULL OR unbound_at >= bound_at)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_qianji_binding_current_qianji
      ON qianji_bindings(qianji_id) WHERE unbound_at IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_qianji_binding_current_pixel
      ON qianji_bindings(pixel_id) WHERE unbound_at IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_qianji_binding_incarnation
      ON qianji_bindings(pixel_id, incarnation);

      CREATE INDEX IF NOT EXISTS idx_qianji_binding_history
      ON qianji_bindings(qianji_id, bound_at, binding_id);

      CREATE TABLE IF NOT EXISTS qianji_narrative_revisions (
          qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          revision INTEGER NOT NULL CHECK(revision >= 0),
          narrative_json TEXT NOT NULL,
          created_at REAL NOT NULL,
          PRIMARY KEY(qianji_id, revision)
      );

      CREATE TABLE IF NOT EXISTS world_events (
          event_id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          subject_type TEXT NOT NULL CHECK(subject_type IN ('qianji', 'pixel', 'mission', 'trial', 'product')),
          subject_id TEXT NOT NULL,
          qianji_id TEXT,
          binding_id TEXT,
          pixel_id TEXT,
          round_num INTEGER,
          source_key TEXT NOT NULL UNIQUE,
          payload_json TEXT NOT NULL,
          created_at REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_world_events_time
      ON world_events(created_at DESC, event_id DESC);

      CREATE INDEX IF NOT EXISTS idx_world_events_qianji
      ON world_events(qianji_id, created_at DESC, event_id DESC);

      CREATE TABLE IF NOT EXISTS owner_action_requests (
          idempotency_key TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          request_json TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS qianji_chat_turns (
          turn_id TEXT PRIMARY KEY,
          qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          binding_id TEXT NOT NULL REFERENCES qianji_bindings(binding_id),
          message_id TEXT NOT NULL UNIQUE REFERENCES messages(message_id),
          request_key TEXT NOT NULL UNIQUE,
          question TEXT NOT NULL,
          reply TEXT,
          reply_call_id TEXT,
          created_at REAL NOT NULL,
          replied_at REAL
      );

      CREATE INDEX IF NOT EXISTS idx_qianji_chat_turns_history
      ON qianji_chat_turns(qianji_id, created_at DESC, turn_id DESC);

      CREATE TABLE IF NOT EXISTS recruitments (
          recruitment_id TEXT PRIMARY KEY,
          role_label TEXT NOT NULL,
          jd TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS missions (
          mission_id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          mission_type TEXT NOT NULL,
          objective TEXT NOT NULL,
          acceptance_criteria TEXT NOT NULL,
          budget_tokens INTEGER NOT NULL CHECK(budget_tokens > 0),
          rounds_limit INTEGER NOT NULL CHECK(rounds_limit > 0),
          deadline_round INTEGER CHECK(deadline_round IS NULL OR deadline_round > 0),
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'issued', 'running', 'awaiting_acceptance', 'completed', 'failed', 'cancelled')),
          owner_qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          acceptance_note TEXT,
          created_at REAL NOT NULL,
          completed_at REAL,
          execution_id TEXT
      );

      CREATE TABLE IF NOT EXISTS mission_participants (
          mission_id TEXT NOT NULL REFERENCES missions(mission_id),
          qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          binding_id TEXT NOT NULL REFERENCES qianji_bindings(binding_id),
          duty TEXT,
          PRIMARY KEY(mission_id, qianji_id),
          UNIQUE(mission_id, binding_id)
      );

      CREATE TABLE IF NOT EXISTS executions (
          execution_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('mission', 'trial_candidate')),
          subject_id TEXT NOT NULL,
          budget_tokens INTEGER NOT NULL CHECK(budget_tokens > 0),
          spent_tokens INTEGER NOT NULL DEFAULT 0 CHECK(spent_tokens >= 0),
          reserved_tokens INTEGER NOT NULL DEFAULT 0 CHECK(reserved_tokens >= 0),
          rounds_limit INTEGER NOT NULL CHECK(rounds_limit > 0),
          rounds_used INTEGER NOT NULL DEFAULT 0 CHECK(rounds_used >= 0),
          status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready', 'running', 'awaiting_review', 'blocked', 'closed')),
          input_snapshot_json TEXT NOT NULL,
          tools_snapshot_json TEXT NOT NULL,
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS execution_participants (
          execution_id TEXT NOT NULL REFERENCES executions(execution_id),
          binding_id TEXT NOT NULL REFERENCES qianji_bindings(binding_id),
          released_at REAL,
          PRIMARY KEY(execution_id, binding_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_participant_active
      ON execution_participants(binding_id) WHERE released_at IS NULL;

      CREATE TABLE IF NOT EXISTS execution_evidence (
          evidence_id TEXT PRIMARY KEY,
          execution_id TEXT NOT NULL REFERENCES executions(execution_id),
          binding_id TEXT NOT NULL REFERENCES qianji_bindings(binding_id),
          operation_id TEXT,
          relative_path TEXT,
          sha256 TEXT,
          size_bytes INTEGER CHECK(size_bytes IS NULL OR size_bytes >= 0),
          evidence_type TEXT NOT NULL,
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trials (
          trial_id TEXT PRIMARY KEY,
          recruitment_id TEXT REFERENCES recruitments(recruitment_id),
          challenge_text TEXT NOT NULL,
          acceptance_criteria TEXT NOT NULL,
          total_budget_tokens INTEGER NOT NULL CHECK(total_budget_tokens > 0),
          rounds_per_candidate INTEGER NOT NULL CHECK(rounds_per_candidate > 0),
          candidate_budget_tokens INTEGER NOT NULL CHECK(candidate_budget_tokens > 0),
          allowed_tools_json TEXT NOT NULL,
          model_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'awaiting_selection', 'completed', 'cancelled')),
          winner_qianji_id TEXT REFERENCES qianji_profiles(qianji_id),
          decision_reason TEXT,
          pause_reason TEXT,
          created_at REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trial_candidates (
          candidate_id TEXT PRIMARY KEY,
          trial_id TEXT NOT NULL REFERENCES trials(trial_id),
          qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
          binding_id TEXT NOT NULL REFERENCES qianji_bindings(binding_id),
          execution_id TEXT NOT NULL REFERENCES executions(execution_id),
          ordinal INTEGER NOT NULL CHECK(ordinal > 0),
          evidence_json TEXT,
          selected INTEGER NOT NULL DEFAULT 0 CHECK(selected IN (0, 1)),
          formal_narrative_json TEXT,
          UNIQUE(trial_id, qianji_id),
          UNIQUE(trial_id, ordinal)
      );

      CREATE INDEX IF NOT EXISTS idx_missions_status_time ON missions(status, created_at DESC, mission_id DESC);
      CREATE INDEX IF NOT EXISTS idx_trials_status_time ON trials(status, created_at DESC, trial_id DESC);
      CREATE INDEX IF NOT EXISTS idx_executions_subject ON executions(kind, subject_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_execution_evidence_execution ON execution_evidence(execution_id, created_at, evidence_id);

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
    const reservationColumns = db.prepare("PRAGMA table_info(reservations)").all() as any[];
    if (!reservationColumns.some(c => c.name === "binding_id")) db.exec("ALTER TABLE reservations ADD COLUMN binding_id TEXT");
    if (!reservationColumns.some(c => c.name === "narrative_revision")) db.exec("ALTER TABLE reservations ADD COLUMN narrative_revision INTEGER");
    if (!reservationColumns.some(c => c.name === "execution_id")) db.exec("ALTER TABLE reservations ADD COLUMN execution_id TEXT");

    const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as any[];
    if (!messageColumns.some(c => c.name === "sender_binding_id")) db.exec("ALTER TABLE messages ADD COLUMN sender_binding_id TEXT");
    if (!messageColumns.some(c => c.name === "recipient_binding_id")) db.exec("ALTER TABLE messages ADD COLUMN recipient_binding_id TEXT");
    if (!messageColumns.some(c => c.name === "binding_snapshot_captured")) db.exec("ALTER TABLE messages ADD COLUMN binding_snapshot_captured INTEGER NOT NULL DEFAULT 0");
    if (!messageColumns.some(c => c.name === "narrative_revision")) db.exec("ALTER TABLE messages ADD COLUMN narrative_revision INTEGER");
    if (!messageColumns.some(c => c.name === "identity_snapshot_captured")) db.exec("ALTER TABLE messages ADD COLUMN identity_snapshot_captured INTEGER NOT NULL DEFAULT 0");
    if (!messageColumns.some(c => c.name === "execution_id")) db.exec("ALTER TABLE messages ADD COLUMN execution_id TEXT");
    if (!messageColumns.some(c => c.name === "abandoned_reason")) db.exec("ALTER TABLE messages ADD COLUMN abandoned_reason TEXT");

    const ledgerColumns = db.prepare("PRAGMA table_info(ledger_entries)").all() as any[];
    if (!ledgerColumns.some(c => c.name === "binding_id")) db.exec("ALTER TABLE ledger_entries ADD COLUMN binding_id TEXT");

    const candidateColumns = db.prepare("PRAGMA table_info(trial_candidates)").all() as any[];
    if (!candidateColumns.some(c => c.name === "formal_narrative_json")) db.exec("ALTER TABLE trial_candidates ADD COLUMN formal_narrative_json TEXT");
    const trialColumns = db.prepare("PRAGMA table_info(trials)").all() as any[];
    if (!trialColumns.some(c => c.name === "pause_reason")) db.exec("ALTER TABLE trials ADD COLUMN pause_reason TEXT");
    const revenueColumns = db.prepare("PRAGMA table_info(external_revenues)").all() as any[];
    const revenueMigrations: Array<[string, string]> = [
      ["amount_fen", "INTEGER"], ["currency", "TEXT"], ["product_id", "TEXT"], ["mission_id", "TEXT"],
      ["primary_qianji_id", "TEXT"], ["primary_binding_id", "TEXT"], ["evidence_ref", "TEXT"],
      ["record_source", "TEXT"], ["idempotency_key", "TEXT"],
    ];
    for (const [name, type] of revenueMigrations) if (!revenueColumns.some(c => c.name === name)) {
      db.exec(`ALTER TABLE external_revenues ADD COLUMN ${name} ${type}`);
    }
    const refundColumns = db.prepare("PRAGMA table_info(external_refunds)").all() as any[];
    for (const [name, type] of [["refund_amount_fen", "INTEGER"], ["evidence_ref", "TEXT"], ["idempotency_key", "TEXT"]] as const) {
      if (!refundColumns.some(c => c.name === name)) db.exec(`ALTER TABLE external_refunds ADD COLUMN ${name} ${type}`);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_external_revenues_idempotency ON external_revenues(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_external_refunds_idempotency ON external_refunds(idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_product_missions_product ON product_missions(product_id, linked_at);
      CREATE INDEX IF NOT EXISTS idx_customer_feedback_product ON customer_feedback(product_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS idx_deliveries_product ON deliveries(product_id, delivery_id);
      CREATE INDEX IF NOT EXISTS idx_revenue_product ON external_revenues(product_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_revenue_mission ON external_revenues(mission_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_narrative_artifacts_created ON narrative_artifacts(created_at DESC, artifact_id);`);

    const columns = db.prepare("PRAGMA table_info(model_calls)").all() as any[];
    if (!columns.some(c => c.name === "tool_cost")) {
      db.exec("ALTER TABLE model_calls ADD COLUMN tool_cost REAL");
    }
    if (!columns.some(c => c.name === "round_num")) {
      db.exec("ALTER TABLE model_calls ADD COLUMN round_num INTEGER");
    }
    if (!columns.some(c => c.name === "binding_id")) db.exec("ALTER TABLE model_calls ADD COLUMN binding_id TEXT");
    if (!columns.some(c => c.name === "narrative_revision")) db.exec("ALTER TABLE model_calls ADD COLUMN narrative_revision INTEGER");
    if (!columns.some(c => c.name === "execution_id")) db.exec("ALTER TABLE model_calls ADD COLUMN execution_id TEXT");
    if (columns.some(c => ["cost_cny", "round_num"].includes(c.name) && c.notnull)) {
      // Legacy NOT NULL constraints conflated unknown values with real zeros and
      // unknown rounds with real round 0: rebuild nullable, mapping the legacy
      // default round 0 to NULL ("round unknown"). New writes keep real round 0.
      db.exec(`
        CREATE TABLE model_calls_nullable (
          call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pixel_id TEXT NOT NULL,
          message_id TEXT, execution_id TEXT, binding_id TEXT, narrative_revision INTEGER,
          model TEXT NOT NULL, pricing_revision TEXT, prompt_hash TEXT,
          raw_response TEXT, normalized_response TEXT, prompt_tokens INTEGER,
          completion_tokens INTEGER, cached_tokens INTEGER, actual_tokens INTEGER,
          cost_cny REAL, tool_cost REAL, round_num INTEGER,
          outcome TEXT NOT NULL DEFAULT 'SUCCESS', created_at REAL NOT NULL
        );
        INSERT INTO model_calls_nullable SELECT call_id, run_id, pixel_id, message_id, execution_id, binding_id, narrative_revision,
          model, pricing_revision, prompt_hash, raw_response, normalized_response,
          prompt_tokens, completion_tokens, cached_tokens, actual_tokens, cost_cny,
          NULLIF(tool_cost, 0),
          CASE WHEN round_num = 0 THEN NULL ELSE round_num END,
          outcome, created_at FROM model_calls;
        DROP TABLE model_calls;
        ALTER TABLE model_calls_nullable RENAME TO model_calls;
      `);
    }
    const currentModelColumns = db.prepare("PRAGMA table_info(model_calls)").all() as any[];
    if (!currentModelColumns.some(c => c.name === "execution_id")) db.exec("ALTER TABLE model_calls ADD COLUMN execution_id TEXT");
    const toolColumns = db.prepare("PRAGMA table_info(tool_executions)").all() as any[];
    if (!toolColumns.some(c => c.name === "cost_cny")) db.exec("ALTER TABLE tool_executions ADD COLUMN cost_cny REAL");
    if (!toolColumns.some(c => c.name === "model_call_id")) db.exec("ALTER TABLE tool_executions ADD COLUMN model_call_id TEXT");

    const runColumns = db.prepare("PRAGMA table_info(runs)").all() as any[];
    if (!runColumns.some(c => c.name === "error_code")) db.exec("ALTER TABLE runs ADD COLUMN error_code TEXT");
    if (!runColumns.some(c => c.name === "error_summary")) db.exec("ALTER TABLE runs ADD COLUMN error_summary TEXT");
    if (!runColumns.some(c => c.name === "execution_id")) db.exec("ALTER TABLE runs ADD COLUMN execution_id TEXT");
    if (!runColumns.some(c => c.name === "last_scope_round")) db.exec("ALTER TABLE runs ADD COLUMN last_scope_round INTEGER");

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
    db.prepare(`
      INSERT INTO schema_meta (key, value, updated_at)
      VALUES ('qianji_schema_version', '3', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE schema_meta.value <> excluded.value
    `).run(Date.now() / 1000);
    db.prepare(`
      INSERT INTO schema_meta (key, value, updated_at)
      VALUES ('organization_schema_version', '1', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE schema_meta.value <> excluded.value
    `).run(Date.now() / 1000);
  });
}
