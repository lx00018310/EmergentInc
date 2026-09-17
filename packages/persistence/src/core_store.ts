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
    roundNum?: number;
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
        roundNum: params.roundNum ?? 0,
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
      this.messages.updateStatus(params.messageId, "RESPONSE_STORED");
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
    return this.db.transaction(() => {
      // 1. 获取所有未决预留并安全退款
      // A received response without usage may already be billed; never auto-refund it.
      const openRes = this.db.prepare(`
        SELECT call_id FROM reservations WHERE status = 'OPEN'
        AND NOT EXISTS (
          SELECT 1 FROM model_calls m WHERE m.call_id = reservations.call_id
          AND m.actual_tokens IS NULL AND m.outcome IN ('SUCCESS', 'MODEL_RESPONSE_INVALID')
        )
      `).all() as any[];
      for (const res of openRes) {
        this.budgets.refund(res.call_id);
      }

      // 2. 将所有处于 CALLING 或 CALL_OUTCOME_UNKNOWN 或 RESERVED 的消息重置回 QUEUED
      const callingMsgs = this.db.prepare(
        "SELECT message_id FROM messages WHERE status IN ('CALLING', 'CALL_OUTCOME_UNKNOWN', 'RESERVED')"
      ).all() as any[];
      for (const m of callingMsgs) {
        this.messages.updateStatus(m.message_id, "QUEUED");
      }

      // 3. 将悬挂 RUNNING 的 Run 归档为 STOPPED
      const runningRuns = this.db.prepare(
        "SELECT run_id FROM runs WHERE status = 'RUNNING'"
      ).all() as any[];
      for (const r of runningRuns) {
        this.runs.updateRunStatus(r.run_id, "STOPPED", "USER_STOPPED");
      }

      // 4. 将未决的 CALL_OUTCOME_UNKNOWN 标记为 CALL_OUTCOME_RECONCILED
      const unknownCalls = this.db.prepare(
        "SELECT call_id FROM model_calls WHERE outcome = 'CALL_OUTCOME_UNKNOWN'"
      ).all() as any[];
      if (unknownCalls.length > 0) {
        this.db.prepare(
          "UPDATE model_calls SET outcome = 'CALL_OUTCOME_RECONCILED' WHERE outcome = 'CALL_OUTCOME_UNKNOWN'"
        ).run();
      }

      // 5. 将悬挂 STARTED 的工具执行标记为 FAILED
      const startedTools = this.db.prepare(
        "SELECT operation_id FROM tool_executions WHERE status = 'STARTED'"
      ).all() as any[];
      if (startedTools.length > 0) {
        this.db.prepare(
          "UPDATE tool_executions SET status = 'FAILED', error_text = 'RECONCILED_TERMINATED' WHERE status = 'STARTED'"
        ).run();
      }

      return {
        reconciledRuns: runningRuns.length,
        reconciledReservations: openRes.length,
        reconciledMessages: callingMsgs.length,
        reconciledCalls: unknownCalls.length,
        reconciledTools: startedTools.length,
      };
    });
  }

  /**
   * 外部激励注入 (V11 External Reward)
   */
  public applyExternalReward(params: {
    pixelId: string;
    amount: number;
    round?: number;
    source?: string;
    reason?: string;
  }): { pixelId: string; newBalance: number; amount: number } {
    if (params.amount <= 0 || !Number.isInteger(params.amount)) {
      throw new Error(`Reward amount must be a positive integer, got ${params.amount}`);
    }

    return this.db.transaction(() => {
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
      const entryId = `reward_${params.pixelId}_${Date.now()}`;

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

      return {
        pixelId: params.pixelId,
        newBalance,
        amount: params.amount,
      };
    });
  }

  public close(): void {
    this.db.close();
  }
}
