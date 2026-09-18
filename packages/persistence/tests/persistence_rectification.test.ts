import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CoreStore,
  initSchema,
  ModelCallRepository,
  SqliteDatabase,
} from "../src/index.js";

/**
 * T0-3 / T0-4 / T1-3 / T1-5 持久层整改回归：
 * 1. legacy engine_feedback 归一为 feedback（幂等）
 * 2. legacy round 0 标记为 unknown，对外暴露 nullable round，不与真实 Round 0 混淆
 * 3. 成本元数据保留：cost/tool cost 不因迁移丢失，未知不当作 0
 * 4. getCostSummary() 任何组成未知时整体未知
 * 5. countInvalidResponses(messageId) 供 runtime 重试上限使用
 * 6. recovery_decisions / external_reward_requests 表存在且约束正确
 */
describe("Persistence: rectification migrations & cost semantics", () => {
  let store: CoreStore;

  beforeEach(() => {
    store = new CoreStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  function createLegacyMessagesSchema(db: SqliteDatabase): void {
    // 模拟旧库：messages 已存在但无 source_type 变更，model_calls 为旧结构
    db.exec(`
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
      );
      INSERT INTO messages (message_id, sender, recipient, content, source_type, created_at, updated_at)
        VALUES ('m_fb1', 'engine', 'pixel_1', 'legacy feedback body', 'engine_feedback', 1, 1),
               ('m_fb2', 'engine', 'pixel_1', 'another legacy body', 'engine_feedback', 2, 2),
               ('m_ok', 'pixel_1', 'pixel_2', 'normal', 'pixel', 3, 3);
    `);
  }

  it("normalizes legacy engine_feedback messages to feedback idempotently and records a marker", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      createLegacyMessagesSchema(db);
      initSchema(db);

      const rows = db.prepare("SELECT message_id, source_type FROM messages ORDER BY message_id").all() as any[];
      expect(rows.find(r => r.message_id === "m_fb1")?.source_type).toBe("feedback");
      expect(rows.find(r => r.message_id === "m_fb2")?.source_type).toBe("feedback");
      expect(rows.find(r => r.message_id === "m_ok")?.source_type).toBe("pixel");

      const marker = db.prepare("SELECT value FROM schema_meta WHERE key = 'legacy_engine_feedback_normalized'").get() as any;
      expect(Number(marker?.value ?? 0)).toBe(2);

      // 幂等：重复迁移不改变结果
      initSchema(db);
      const rowsAgain = db.prepare("SELECT source_type, COUNT(*) as c FROM messages GROUP BY source_type").all() as any[];
      expect(rowsAgain.find(r => r.source_type === "feedback")?.c).toBe(2);
      const markerAgain = db.prepare("SELECT value FROM schema_meta WHERE key = 'legacy_engine_feedback_normalized'").get() as any;
      expect(Number(markerAgain?.value ?? 0)).toBe(2);
    } finally {
      db.close();
    }
  });

  it("maps legacy default-zero rounds to null while new writes keep real round 0", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      // 旧库：cost_cny NOT NULL（触发 nullable 重建）+ round_num 皆为迁移默认 0
      db.exec(`
        CREATE TABLE model_calls (
          call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pixel_id TEXT NOT NULL,
          message_id TEXT, model TEXT NOT NULL, pricing_revision TEXT, prompt_hash TEXT,
          raw_response TEXT, normalized_response TEXT,
          prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
          cached_tokens INTEGER NOT NULL DEFAULT 0, actual_tokens INTEGER NOT NULL DEFAULT 0,
          cost_cny REAL NOT NULL DEFAULT 0, outcome TEXT NOT NULL, created_at REAL NOT NULL
        );
        INSERT INTO model_calls (call_id, run_id, pixel_id, model, cost_cny, outcome, created_at)
          VALUES ('legacy_a', 'r', 'p', 'm', 0.01, 'SUCCESS', 1);
      `);
      initSchema(db);

      // legacy 默认 0 被迁移为 NULL（轮次未知）
      const legacyRow = db.prepare("SELECT round_num FROM model_calls WHERE call_id = 'legacy_a'").get() as any;
      expect(legacyRow.round_num).toBeNull();

      // 迁移后的库上继续写入真实 Round 0：保持为 0，重复 initSchema 不改写
      const repo = new ModelCallRepository(db);
      repo.recordModelCall({
        callId: "fresh_1", runId: "r", pixelId: "p", roundNum: 0,
        model: "m", promptTokens: 1, completionTokens: 1, cachedTokens: null,
        actualTokens: 2, costCny: 0.001, outcome: "SUCCESS", createdAt: 10,
      });
      initSchema(db);
      const freshRow = db.prepare("SELECT round_num FROM model_calls WHERE call_id = 'fresh_1'").get() as any;
      expect(Number(freshRow.round_num)).toBe(0);
      // legacy 仍为 NULL，未被二次迁移污染
      const legacyStill = db.prepare("SELECT round_num FROM model_calls WHERE call_id = 'legacy_a'").get() as any;
      expect(legacyStill.round_num).toBeNull();
    } finally {
      db.close();
    }
  });

  it("exposes nullable round for legacy rows and preserves cost metadata through migration", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      db.exec(`
        CREATE TABLE model_calls (
          call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pixel_id TEXT NOT NULL,
          message_id TEXT, model TEXT NOT NULL, pricing_revision TEXT, prompt_hash TEXT,
          raw_response TEXT, normalized_response TEXT,
          prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
          cached_tokens INTEGER NOT NULL DEFAULT 0, actual_tokens INTEGER NOT NULL DEFAULT 0,
          cost_cny REAL NOT NULL DEFAULT 0, outcome TEXT NOT NULL, created_at REAL NOT NULL
        );
        INSERT INTO model_calls (call_id, run_id, pixel_id, model, cost_cny, outcome, created_at)
          VALUES ('legacy_c', 'r', 'p', 'm', 0.009057, 'SUCCESS', 1);
      `);
      initSchema(db);
      initSchema(db); // 幂等

      const repo = new ModelCallRepository(db);
      const record = repo.getModelCall("legacy_c");
      expect(record).not.toBeNull();
      expect(record?.costCny).toBeCloseTo(0.009057, 10);
      // legacy 默认 0 轮次暴露为 null（未知），不冒充真实 Round 0
      expect(record?.roundNum).toBeNull();
      const step = repo.getPixelStepCosts("p")[0];
      expect(step.round).toBeNull();
      expect(step.callId).toBe("legacy_c");
      expect(step.runId).toBe("r");
      expect(step.outcome).toBe("SUCCESS");
      expect(step.modelCost).toBeCloseTo(0.009057, 10);
    } finally {
      db.close();
    }
  });

  it("getCostSummary reports null totals when any component is unknown, never unknown-as-zero", () => {
    // 已知模型成本 + 已知工具成本
    store.modelCalls.recordModelCall({
      callId: "c1", runId: "r", pixelId: "p", roundNum: 1, model: "m",
      promptTokens: 10, completionTokens: 10, cachedTokens: null, actualTokens: 20,
      costCny: 0.01, outcome: "SUCCESS", createdAt: 1,
    });
    store.db.exec(`INSERT INTO tool_executions (operation_id, message_id, pixel_id, op_index, tool, args_hash, status, started_at, cost_cny)
      VALUES ('t1', 'm1', 'p', 0, 'read', 'h', 'SUCCESS', 1, 0.1)`);
    let summary = store.modelCalls.getCostSummary();
    expect(summary.modelCostCny).toBeCloseTo(0.01, 10);
    expect(summary.toolCostCny).toBeCloseTo(0.1, 10);
    expect(summary.totalCostCny).toBeCloseTo(0.11, 10);
    expect(summary.knownCostCny).toBeCloseTo(0.11, 10);
    expect(summary.unknownModelCount).toBe(0);
    expect(summary.unknownToolCount).toBe(0);

    // 工具成本未知：工具侧与整体未知，未知数计数，不当作 0
    store.db.exec(`INSERT INTO tool_executions (operation_id, message_id, pixel_id, op_index, tool, args_hash, status, started_at, cost_cny)
      VALUES ('t2', 'm1', 'p', 1, 'vps_exec', 'h', 'UNKNOWN', 2, NULL)`);
    summary = store.modelCalls.getCostSummary();
    expect(summary.toolCostCny).toBeNull();
    expect(summary.totalCostCny).toBeNull();
    expect(summary.unknownToolCount).toBe(1);
    // known 部分仍可展示
    expect(summary.knownCostCny).toBeCloseTo(0.11, 10);
  });

  it("getCostSummary reports null model cost when usage is missing", () => {
    store.modelCalls.recordModelCall({
      callId: "c2", runId: "r", pixelId: "p", roundNum: 1, model: "m",
      promptTokens: null, completionTokens: null, cachedTokens: null, actualTokens: null,
      costCny: null, outcome: "SUCCESS", createdAt: 2,
    });
    const summary = store.modelCalls.getCostSummary();
    expect(summary.modelCostCny).toBeNull();
    expect(summary.totalCostCny).toBeNull();
    expect(summary.unknownModelCount).toBe(1);
  });

  it("counts invalid model responses per message for runtime retry caps", () => {
    store.modelCalls.recordModelCall({
      callId: "inv1", runId: "r", pixelId: "p", messageId: "msg_x", roundNum: 1, model: "m",
      promptTokens: 5, completionTokens: 8192, cachedTokens: null, actualTokens: 8197,
      costCny: 0.02, outcome: "MODEL_RESPONSE_INVALID", createdAt: 1,
    });
    expect(store.modelCalls.countInvalidResponses("msg_x")).toBe(1);

    store.modelCalls.recordModelCall({
      callId: "inv2", runId: "r", pixelId: "p", messageId: "msg_x", roundNum: 1, model: "m",
      promptTokens: 5, completionTokens: 9479, cachedTokens: null, actualTokens: 9484,
      costCny: 0.03, outcome: "MODEL_RESPONSE_INVALID", createdAt: 2,
    });
    expect(store.modelCalls.countInvalidResponses("msg_x")).toBe(2);

    // 其他 outcome 不计入
    store.modelCalls.recordModelCall({
      callId: "ok1", runId: "r", pixelId: "p", messageId: "msg_x", roundNum: 1, model: "m",
      promptTokens: 5, completionTokens: 5, cachedTokens: null, actualTokens: 10,
      costCny: 0.01, outcome: "SUCCESS", createdAt: 3,
    });
    expect(store.modelCalls.countInvalidResponses("msg_x")).toBe(2);
    expect(store.modelCalls.countInvalidResponses("msg_never_seen")).toBe(0);
  });

  it("creates recovery_decisions and external_reward_requests with required constraints", () => {
    const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[];
    const names = tables.map(t => t.name);
    expect(names).toContain("recovery_decisions");
    expect(names).toContain("external_reward_requests");

    store.db.exec(`
      INSERT INTO recovery_decisions (decision_id, kind, id, decision, reason, details, created_at)
        VALUES ('d1', 'unknown_model_call', 'c1', 'SETTLE_BY_BILL', 'provider invoice attached', NULL, 1);
    `);
    const decision = store.db.prepare("SELECT * FROM recovery_decisions WHERE decision_id = 'd1'").get() as any;
    expect(decision.kind).toBe("unknown_model_call");
    expect(decision.decision).toBe("SETTLE_BY_BILL");

    store.db.exec(`
      INSERT INTO external_reward_requests (idempotency_key, request_json, result_json, created_at)
        VALUES ('idem_1', '{"pixelId":"p","amount":5}', '{"newBalance":105}', 1);
    `);
    // 同主键重复插入必须失败（幂等护栏）
    expect(() => {
      store.db.exec(`
        INSERT INTO external_reward_requests (idempotency_key, request_json, result_json, created_at)
          VALUES ('idem_1', '{"pixelId":"p","amount":5}', '{"newBalance":105}', 2);
      `);
    }).toThrow();
  });
});
