import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CoreStore,
  BudgetExceededError,
  SpendBlockedError,
  initSchema,
} from "../src/index.js";

describe("Persistence: CoreStore & Repositories", () => {
  let store: CoreStore;

  beforeEach(() => {
    store = new CoreStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("retains unknown-usage reservations across reconciliation without inventing token spend", () => {
    store.pixels.upsertPixelAccount({ pixelId: "p", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const message = store.messages.enqueueMessage({ sender: "system", recipient: "p", content: "test", roundNum: 1 });
    store.budgets.reserve({ callId: "unknown", runId: "r", pixelId: "p", estimatedTokens: 100 });
    store.settleAndStoreModelResponse({
      callId: "unknown", runId: "r", pixelId: "p", messageId: message.messageId,
      model: "m", promptHash: "h", rawResponse: "{}",
      usage: { promptTokens: null, completionTokens: null, cachedTokens: null, actualTokens: null, costCny: null },
    });
    expect(store.pixels.getPixelAccount("p")?.energy).toBe(1000);
    expect(store.budgets.getGlobalBudget()?.totalSpent).toBe(0);
    expect(store.budgets.getGlobalBudget()?.totalReserved).toBe(100);
    store.reconcileUnfinalizedOperations();
    expect(store.budgets.getGlobalBudget()?.totalReserved).toBe(100);
    expect(store.getUnfinalizedOperations().unsettledReservations).toHaveLength(1);
  });

  it("requires an audited decision before refunding an unknown call and rolls back invalid decisions", () => {
    store.pixels.upsertPixelAccount({ pixelId: "p", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const message = store.messages.enqueueMessage({ sender: "system", recipient: "p", content: "test", roundNum: 1 });
    store.budgets.reserve({ callId: "unknown", runId: "r", pixelId: "p", estimatedTokens: 100 });
    store.messages.updateStatus(message.messageId, "CALL_OUTCOME_UNKNOWN");
    store.modelCalls.recordModelCall({ callId: "unknown", runId: "r", pixelId: "p", messageId: message.messageId,
      model: "m", promptHash: "h", rawResponse: null, normalizedResponse: null, promptTokens: null,
      completionTokens: null, cachedTokens: null, actualTokens: null, costCny: null, outcome: "CALL_OUTCOME_UNKNOWN", createdAt: 1 });
    store.reconcileUnfinalizedOperations();
    expect(store.budgets.getGlobalBudget()?.totalReserved).toBe(100);
    expect(store.messages.getMessage(message.messageId)?.status).toBe("CALL_OUTCOME_UNKNOWN");
    expect(() => store.resolveRecoveryOperation({ kind: "model", id: "", decision: "confirm_not_billed" })).toThrow();
    expect(store.budgets.getGlobalBudget()?.totalReserved).toBe(100);
    // 理由选填，留空自动记录标准审计说明
    store.resolveRecoveryOperation({ kind: "model", id: "unknown", decision: "confirm_not_billed" });
    expect(store.budgets.getGlobalBudget()?.totalReserved).toBe(0);
    expect(store.messages.getMessage(message.messageId)?.status).toBe("QUEUED");
    expect(store.db.prepare("SELECT reason FROM recovery_decisions").get()).toEqual({ reason: "操作人审批通过 (approved)" });
    store.budgets.refund("unknown");
    expect(store.budgets.getGlobalBudget()?.totalReserved).toBe(0);
    expect(store.pixels.getPixelAccount("p")?.energy).toBe(1000);
  });

  it("resolves unfinalized calling message by returning to queue or abandoning", () => {
    store.pixels.upsertPixelAccount({ pixelId: "p_msg", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const msg = store.messages.enqueueMessage({ sender: "system", recipient: "p_msg", content: "test calling", roundNum: 1 });
    store.messages.updateStatus(msg.messageId, "CALLING");
    expect(store.getUnfinalizedOperations().callingMessages).toHaveLength(1);

    // 确认未计费后重试：转回 QUEUED
    store.resolveRecoveryOperation({ kind: "message", id: msg.messageId, decision: "confirm_not_billed", reason: "requeue uncalled message" });
    expect(store.messages.getMessage(msg.messageId)?.status).toBe("QUEUED");
    expect(store.getUnfinalizedOperations().callingMessages).toHaveLength(0);

    // 再次设为 CALLING，测试 abandon
    store.messages.updateStatus(msg.messageId, "CALLING");
    store.resolveRecoveryOperation({ kind: "message", id: msg.messageId, decision: "abandon", reason: "discard message" });
    expect(store.messages.getMessage(msg.messageId)?.status).toBe("ABANDONED");
    expect(store.getUnfinalizedOperations().callingMessages).toHaveLength(0);
  });

  it("applies an external reward exactly once per idempotency key and rejects key reuse with different payload", () => {
    store.pixels.upsertPixelAccount({ pixelId: "p", energy: 0, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const first = store.applyExternalReward({ pixelId: "p", amount: 50, idempotencyKey: "key-1", reason: "bonus" });
    const replay = store.applyExternalReward({ pixelId: "p", amount: 50, idempotencyKey: "key-1", reason: "bonus" });
    expect(replay).toEqual(first);
    expect(store.pixels.getPixelAccount("p")?.energy).toBe(50);
    expect(store.db.prepare("SELECT count(*) AS n FROM ledger_entries WHERE entry_type = 'external_reward'").get()).toEqual({ n: 1 });
    expect(() => store.applyExternalReward({ pixelId: "p", amount: 99, idempotencyKey: "key-1" })).toThrow();
    expect(() => store.applyExternalReward({ pixelId: "p", amount: 10, idempotencyKey: "" })).toThrow();
  });

  it("migrates legacy non-null cost columns idempotently without losing historical costs", () => {
    store.db.exec(`DROP TABLE model_calls;
      CREATE TABLE model_calls (
        call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pixel_id TEXT NOT NULL,
        message_id TEXT, model TEXT NOT NULL, pricing_revision TEXT, prompt_hash TEXT,
        raw_response TEXT, normalized_response TEXT,
        prompt_tokens INTEGER NOT NULL DEFAULT 0, completion_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0, actual_tokens INTEGER NOT NULL DEFAULT 0,
        cost_cny REAL NOT NULL DEFAULT 0, outcome TEXT NOT NULL, created_at REAL NOT NULL);
      INSERT INTO model_calls (call_id,run_id,pixel_id,model,cost_cny,outcome,created_at)
        VALUES ('old','r','p','m',0.25,'MODEL_RESPONSE_INVALID',1);`);
    initSchema(store.db);
    initSchema(store.db);
    expect(store.modelCalls.getModelCall("old")?.costCny).toBe(0.25);
    store.db.exec("UPDATE model_calls SET cost_cny = NULL, actual_tokens = NULL WHERE call_id = 'old'");
    expect(store.modelCalls.getModelCall("old")?.costCny).toBeNull();
    expect(store.modelCalls.getPixelStepCosts("p")[0].modelCost).toBeNull();
  });

  it("should initialize schema and global budget correctly", () => {
    const global = store.budgets.getGlobalBudget();
    expect(global).not.toBeNull();
    expect(global?.totalLimit).toBe(1000000);
    expect(global?.totalSpent).toBe(0);
    expect(global?.currency).toBe("CNY");
  });

  it("should handle message enqueue and atomic claimNext with FIFO and feedback priority", () => {
    // 1. 入队普通消息 1
    const msg1 = store.messages.enqueueMessage({
      sender: "pixel_1",
      recipient: "pixel_2",
      content: "First normal message",
      roundNum: 1,
      isFeedback: false,
    });

    // 2. 入队普通消息 2
    const msg2 = store.messages.enqueueMessage({
      sender: "pixel_1",
      recipient: "pixel_2",
      content: "Second normal message",
      roundNum: 1,
      isFeedback: false,
    });

    // 3. 入队控制反馈消息 (应当优先被领取)
    const msgFeedback = store.messages.enqueueMessage({
      sender: "system",
      recipient: "pixel_1",
      content: "System feedback",
      roundNum: 1,
      isFeedback: true,
    });

    // 4. 首次领取：必须是控制反馈消息，且状态转为 PROCESSING
    const claimed1 = store.messages.claimNext(1);
    expect(claimed1?.messageId).toBe(msgFeedback.messageId);
    expect(claimed1?.status).toBe("PROCESSING");

    // 5. 第二次领取：按 FIFO 必须是 msg1
    const claimed2 = store.messages.claimNext(1);
    expect(claimed2?.messageId).toBe(msg1.messageId);
    expect(claimed2?.status).toBe("PROCESSING");

    // 6. 第三次领取：必须是 msg2
    const claimed3 = store.messages.claimNext(1);
    expect(claimed3?.messageId).toBe(msg2.messageId);
    expect(claimed3?.status).toBe("PROCESSING");

    // 7. 无更多消息可领取
    const claimedNone = store.messages.claimNext(1);
    expect(claimedNone).toBeNull();
  });

  it("should enforce multi-tier budget reservation, settlement and deficit blocking", () => {
    // 1. 初始化元胞账户
    store.pixels.upsertPixelAccount({
      pixelId: "px_1",
      energy: 500,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    // 2. 创建 Run
    store.runs.createRun({
      run_id: "run_test",
      start_round: 1,
      run_limit: 1000,
      run_spent: 0,
      run_reserved: 0,
      global_limit: 1000000,
      global_spent: 0,
      global_reserved: 0,
      genesis_revision: 1,
      status: "RUNNING",
      created_at: Date.now() / 1000,
    });

    // 3. 正常预留
    store.budgets.reserve({
      callId: "call_1",
      runId: "run_test",
      pixelId: "px_1",
      estimatedTokens: 200,
    });

    const run = store.runs.getRun("run_test");
    expect(run?.run_reserved).toBe(200);

    // 4. 结算预留：实际消耗 150
    store.budgets.settle({
      callId: "call_1",
      actualTokens: 150,
      costCny: 0.015,
    });

    const pixelAfter = store.pixels.getPixelAccount("px_1");
    expect(pixelAfter?.energy).toBe(350); // 500 - 150

    const runAfter = store.runs.getRun("run_test");
    expect(runAfter?.run_reserved).toBe(0);
    expect(runAfter?.run_spent).toBe(150);

    // 5. 超额预算校验：请求 400 超过剩余余额 350
    expect(() => {
      store.budgets.reserve({
        callId: "call_2",
        runId: "run_test",
        pixelId: "px_1",
        estimatedTokens: 400,
      });
    }).toThrow(BudgetExceededError);

    // 6. 赤字阻断校验
    store.pixels.upsertPixelAccount({
      pixelId: "px_1",
      energy: 350,
      active: true,
      refundDeficitTokens: 50,
      spendBlockedReason: "Refund deficit active",
    });

    expect(() => {
      store.budgets.reserve({
        callId: "call_3",
        runId: "run_test",
        pixelId: "px_1",
        estimatedTokens: 10,
      });
    }).toThrow(SpendBlockedError);
  });

  it("should record and check effects for Exactly-Once idempotency", () => {
    const effectId = "eff_123";
    expect(store.effects.hasEffectBeenApplied(effectId)).toBe(false);

    store.effects.recordEffect({
      effect_id: effectId,
      message_id: "msg_1",
      effect_type: "TRANSFER_ENERGY",
      effect_index: 0,
      payload_hash: "hash_abc",
      status: "APPLIED",
      created_at: Date.now() / 1000,
    });

    expect(store.effects.hasEffectBeenApplied(effectId)).toBe(true);
  });

  it("should rollback transaction on error", () => {
    store.pixels.upsertPixelAccount({
      pixelId: "px_rollback",
      energy: 100,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    expect(() => {
      store.transaction(() => {
        store.pixels.updateEnergy("px_rollback", 50);
        throw new Error("Simulated failure in transaction");
      });
    }).toThrow();

    // 验证能量未发生更改
    const account = store.pixels.getPixelAccount("px_rollback");
    expect(account?.energy).toBe(100);
  });
});
