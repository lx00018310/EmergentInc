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
    usage: {
      promptTokens: number;
      completionTokens: number;
      cachedTokens?: number;
      actualTokens: number;
      costCny: number;
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
        model: params.model,
        pricingRevision: params.pricingRevision,
        promptHash: params.promptHash,
        rawResponse: params.rawResponse,
        normalizedResponse: params.normalizedResponse || null,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        cachedTokens: params.usage.cachedTokens || 0,
        actualTokens: params.usage.actualTokens,
        costCny: params.usage.costCny,
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

  public close(): void {
    this.db.close();
  }
}
