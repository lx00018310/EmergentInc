import { randomUUID } from "node:crypto";
import { SqliteDatabase } from "./sqlite/db.js";
import { initSchema } from "./migrations/init_schema.js";
import { RunRepository } from "./repositories/run_repository.js";
import { PixelRepository } from "./repositories/pixel_repository.js";
import { MessageRepository } from "./repositories/message_repository.js";
import { BudgetRepository } from "./repositories/budget_repository.js";
import { ModelCallRepository } from "./repositories/model_call_repository.js";
import { ToolExecutionRepository } from "./repositories/tool_execution_repository.js";
import { EffectRepository } from "./repositories/effect_repository.js";
import { LedgerRepository } from "./repositories/ledger_repository.js";

/**
 * CoreStore：单一事务事实源门面
 */
export class CoreStore {
  public readonly db: SqliteDatabase;
  public readonly runs: RunRepository;
  public readonly pixels: PixelRepository;
  public readonly messages: MessageRepository;
  public readonly budgets: BudgetRepository;
  public readonly modelCalls: ModelCallRepository;
  public readonly toolExecutions: ToolExecutionRepository;
  public readonly effects: EffectRepository;
  public readonly ledger: LedgerRepository;

  constructor(dbPath: string = ":memory:") {
    this.db = new SqliteDatabase(dbPath);
    initSchema(this.db);

    this.runs = new RunRepository(this.db);
    this.pixels = new PixelRepository(this.db);
    this.messages = new MessageRepository(this.db);
    this.budgets = new BudgetRepository(this.db);
    this.modelCalls = new ModelCallRepository(this.db);
    this.toolExecutions = new ToolExecutionRepository(this.db);
    this.effects = new EffectRepository(this.db);
    this.ledger = new LedgerRepository(this.db);

    // 确保全局预算记录存在
    this.budgets.ensureGlobalBudget();
  }

  public transaction<T>(action: () => T): T {
    return this.db.transaction(action);
  }

  /**
   * 在单一 SQLite 事务内原子完成：预算结算、模型调用记录写入、消息推进为 RESPONSE_STORED
   */
  public settleAndStoreModelResponse(params: {
    callId: string;
    runId: string;
    pixelId: string;
    messageId: string;
    model: string;
    pricingRevision?: string;
    promptHash: string;
    rawResponse: string;
    normalizedResponse?: string | null;
    roundNum?: number | null;
    toolCost?: number | null;
    usage: {
      promptTokens: number | null;
      completionTokens: number | null;
      cachedTokens?: number | null;
      actualTokens: number | null;
      costCny: number | null;
    };
  }): void {
    this.db.transaction(() => {
      this.budgets.settle({
        callId: params.callId,
        actualTokens: params.usage.actualTokens,
        costCny: params.usage.costCny,
      });
      this.modelCalls.recordModelCall({
        callId: params.callId,
        runId: params.runId,
        pixelId: params.pixelId,
        messageId: params.messageId,
        roundNum: params.roundNum ?? null,
        model: params.model,
        pricingRevision: params.pricingRevision,
        promptHash: params.promptHash,
        rawResponse: params.rawResponse,
        normalizedResponse: params.normalizedResponse || null,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        cachedTokens: params.usage.cachedTokens ?? null,
        actualTokens: params.usage.actualTokens,
        costCny: params.usage.costCny,
        toolCost: params.toolCost ?? null,
        outcome: "SUCCESS",
        createdAt: Date.now() / 1000,
      });
      this.messages.updateStatus(params.messageId, params.usage.actualTokens === null ? "AWAITING_SETTLEMENT" : "RESPONSE_STORED");
    });
  }

  /**
   * 检查工作区数据库是否存在未决状态 (旧 RUNNING Run、OPEN 预留、CALLING/UNKNOWN 消息、STARTED 工具)
   */
  public getUnfinalizedOperations(): {
    hasUnfinalized: boolean;
    unsettledReservations: Array<{ callId: string; runId: string; pixelId: string; amount: number; createdAt: number }>;
    unknownCalls: Array<{ callId: string; messageId: string; outcome: string; createdAt: number }>;
    callingMessages: Array<{ messageId: string; status: string; updatedAt: number }>;
    pendingRuns: string[];
    startedToolExecutions: string[];
  } {
    const runningRuns = (this.db.prepare("SELECT run_id FROM runs WHERE status = 'RUNNING'").all() as any[]).map(r => r.run_id);
    const openRes = (this.db.prepare("SELECT call_id, run_id, pixel_id, amount, created_at FROM reservations WHERE status = 'OPEN'").all() as any[]).map(r => ({
      callId: r.call_id,
      runId: r.run_id,
      pixelId: r.pixel_id,
      amount: Number(r.amount),
      createdAt: Number(r.created_at),
    }));
    const callingMsgs = (this.db.prepare("SELECT message_id, status, updated_at FROM messages WHERE status IN ('CALLING', 'CALL_OUTCOME_UNKNOWN', 'RESERVED')").all() as any[]).map(m => ({
      messageId: m.message_id,
      status: m.status,
      updatedAt: Number(m.updated_at),
    }));
    const unknownCalls = (this.db.prepare("SELECT call_id, message_id, outcome, created_at FROM model_calls WHERE outcome = 'CALL_OUTCOME_UNKNOWN'").all() as any[]).map(c => ({
      callId: c.call_id,
      messageId: c.message_id,
      outcome: c.outcome,
      createdAt: Number(c.created_at),
    }));
    const startedTools = (this.db.prepare("SELECT operation_id FROM tool_executions WHERE status = 'STARTED'").all() as any[]).map(t => t.operation_id);

    const hasUnfinalized =
      runningRuns.length > 0 ||
      openRes.length > 0 ||
      callingMsgs.length > 0 ||
      unknownCalls.length > 0 ||
      startedTools.length > 0;

    return {
      hasUnfinalized,
      unsettledReservations: openRes,
      unknownCalls,
      callingMessages: callingMsgs,
      pendingRuns: runningRuns,
      startedToolExecutions: startedTools,
    };
  }

  /**
   * 安全对账并自愈未决悬挂状态
   */
  public reconcileUnfinalizedOperations(): {
    reconciledRuns: number;
    reconciledReservations: number;
    reconciledMessages: number;
    reconciledCalls: number;
    reconciledTools: number;
  } {
    // Uncertain billing and side effects require an explicit, audited operator decision.
    return {
      reconciledRuns: 0,
      reconciledReservations: 0,
      reconciledMessages: 0,
      reconciledCalls: 0,
      reconciledTools: 0,
    };
  }

  public resolveRecoveryOperation(params: {
    kind: "model" | "tool" | "run";
    id: string;
    decision: "confirm_not_billed" | "settle_billed" | "settle_reserved" | "abandon" | "acknowledge";
    reason: string;
    actualTokens?: number;
    costCny?: number | null;
  }): { decisionId: string } {
    if (!params.id || !params.reason?.trim()) throw new Error("Recovery requires an operation ID and reason");
    if (params.costCny != null && (!Number.isFinite(params.costCny) || params.costCny < 0)) throw new Error("Invalid billed cost");
    return this.db.transaction(() => {
      const now = Date.now() / 1000;
      if (params.kind === "model") {
        const reservation = this.db.prepare("SELECT * FROM reservations WHERE call_id = ? AND status = 'OPEN'").get(params.id) as any;
        const call = this.modelCalls.getModelCall(params.id);
        if (!reservation && call?.outcome !== "CALL_OUTCOME_UNKNOWN") throw new Error("Model operation is not unresolved");
        const messageId = call?.messageId;
        if (params.decision === "confirm_not_billed") {
          if (call && ["SUCCESS", "MODEL_RESPONSE_INVALID"].includes(call.outcome)) throw new Error("Received responses must be settled or abandoned, not retried as unsent");
          this.budgets.refund(params.id);
          if (messageId) this.messages.updateStatus(messageId, "QUEUED");
        } else if (["settle_billed", "settle_reserved", "abandon"].includes(params.decision)) {
          const tokens = params.decision === "settle_billed" ? params.actualTokens : reservation?.amount;
          if (!reservation || !Number.isSafeInteger(tokens) || tokens < 0) throw new Error("Settlement requires a valid token amount and open reservation");
          this.budgets.settle({ callId: params.id, actualTokens: tokens, costCny: params.costCny ?? null });
          // A reserved-cap settlement is an operator budget decision, not measured usage.
          if (params.decision === "settle_billed" && call) {
            this.db.prepare("UPDATE model_calls SET actual_tokens = ?, cost_cny = ? WHERE call_id = ?")
              .run(tokens, params.costCny ?? null, params.id);
          }
          if (messageId) this.messages.updateStatus(messageId,
            params.decision !== "abandon" && call?.outcome === "SUCCESS" ? "RESPONSE_STORED" : "ABANDONED");
        } else {
          throw new Error("Invalid model recovery decision");
        }
        if (call?.outcome === "CALL_OUTCOME_UNKNOWN") {
          this.db.prepare("UPDATE model_calls SET outcome = 'CALL_OUTCOME_RECONCILED' WHERE call_id = ?").run(params.id);
        }
      } else if (params.kind === "tool") {
        if (params.decision !== "abandon" && params.decision !== "acknowledge") throw new Error("Tool recovery cannot refund or retry uncertain side effects");
        const tool = this.toolExecutions.getExecution(params.id);
        if (!tool || !["STARTED", "UNKNOWN"].includes(tool.status)) throw new Error("Tool operation is not unresolved");
        this.db.prepare("UPDATE tool_executions SET status = 'SKIPPED', result = ?, finished_at = ? WHERE operation_id = ?")
          .run(JSON.stringify({ outcome: "UNKNOWN", recovery: params.decision, reason: params.reason, previousResult: tool.result ?? null }), now, params.id);
        this.messages.updateStatus(tool.message_id, "ABANDONED");
      } else if (params.kind === "run") {
        if (params.decision !== "acknowledge") throw new Error("Run recovery requires acknowledgement");
        const run = this.runs.getRun(params.id);
        if (!run || run.status !== "RUNNING") throw new Error("Run is not unresolved");
        this.runs.updateRunStatus(params.id, "STOPPED", "USER_STOPPED");
      } else {
        throw new Error("Invalid recovery kind");
      }
      const decisionId = randomUUID();
      this.db.prepare("INSERT INTO recovery_decisions (decision_id, kind, id, decision, reason, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(decisionId, params.kind, params.id, params.decision, params.reason.trim(), JSON.stringify(params), now);
      return { decisionId };
    });
  }

  /**
   * 外部激励注入 (V11 External Reward)
   */
  public applyExternalReward(params: {
    pixelId: string;
    amount: number;
    idempotencyKey: string;
    round?: number;
    source?: string;
    reason?: string;
  }): { pixelId: string; newBalance: number; amount: number; eventId: string } {
    if (!params.idempotencyKey?.trim() || params.idempotencyKey.length > 200) throw new Error("Reward requires an idempotency key");
    if (params.amount <= 0 || !Number.isSafeInteger(params.amount)) {
      throw new Error(`Reward amount must be a positive integer, got ${params.amount}`);
    }

    return this.db.transaction(() => {
      const requestJson = JSON.stringify({ pixelId: params.pixelId, amount: params.amount, source: params.source || "human", reason: params.reason || "External Reward" });
      const previous = this.db.prepare("SELECT request_json, result_json FROM external_reward_requests WHERE idempotency_key = ?").get(params.idempotencyKey) as any;
      if (previous) {
        if (previous.request_json !== requestJson) throw new Error("Idempotency key already used for a different reward");
        return JSON.parse(previous.result_json);
      }
      let account = this.pixels.getPixelAccount(params.pixelId);
      if (!account) {
        this.pixels.upsertPixelAccount({
          pixelId: params.pixelId,
          energy: 0,
          active: true,
          refundDeficitTokens: 0,
          spendBlockedReason: null,
        });
      }

      const newBalance = this.pixels.updateEnergy(params.pixelId, params.amount);
      const now = Date.now() / 1000;
      const entryId = `reward_${randomUUID()}`;

      this.ledger.appendEntry({
        entry_id: entryId,
        timestamp: now,
        pixel_id: params.pixelId,
        entry_type: "external_reward",
        amount: params.amount,
        balance_after: newBalance,
        details: JSON.stringify({
          round: params.round ?? 0,
          source: params.source || "human",
          reason: params.reason || "External Reward",
        }),
      });

      const result = { pixelId: params.pixelId, newBalance, amount: params.amount, eventId: entryId };
      this.db.prepare("INSERT INTO external_reward_requests (idempotency_key, request_json, result_json, created_at) VALUES (?, ?, ?, ?)")
        .run(params.idempotencyKey, requestJson, JSON.stringify(result), now);
      return result;
    });
  }

  public close(): void {
    this.db.close();
  }
}
