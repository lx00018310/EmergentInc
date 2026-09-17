import * as fs from "node:fs";
import * as path from "node:path";
import {
  AgentStepInput,
  AgentStepResult,
  AgentDecision,
  ModelUsage,
  ModelCallRecord,
} from "@emergentinc/protocol";
import { CoreStore, BudgetExceededError, SpendBlockedError } from "@emergentinc/persistence";
import {
  PromptBuilder,
  ModelProvider,
  parseAndNormalizeResponse,
  UsageMeter,
  OutcomeUnknownError,
} from "@emergentinc/model";
import { ToolRuntime } from "@emergentinc/tools";
import { DecisionCompiler } from "../compiler/decision_compiler.js";
import { EffectRuntime } from "../effects/effect_runtime.js";

export interface AgentStepRunnerOptions {
  workspaceRoot: string;
  store: CoreStore;
  provider: ModelProvider;
  toolRuntime: ToolRuntime;
  promptBuilder: PromptBuilder;
  usageMeter: UsageMeter;
}

export class AgentStepRunner {
  private workspaceRoot: string;
  private store: CoreStore;
  private provider: ModelProvider;
  private toolRuntime: ToolRuntime;
  private promptBuilder: PromptBuilder;
  private usageMeter: UsageMeter;

  constructor(options: AgentStepRunnerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.store = options.store;
    this.provider = options.provider;
    this.toolRuntime = options.toolRuntime;
    this.promptBuilder = options.promptBuilder;
    this.usageMeter = options.usageMeter;
  }

  public async execute(input: AgentStepInput, signal?: AbortSignal): Promise<AgentStepResult> {
    const { trace, pixelState, pixelMind, message, round } = input;
    const callId = `call_${message.messageId}_${Date.now()}`;

    // 1. 检查当前消息是否已有成功的 ModelCall (响应复用：支持安全重试与崩溃恢复)
    const existingModelCall = this.store.modelCalls.getLatestByMessageId(message.messageId);
    let rawText: string | null = null;
    let usage: ModelUsage | undefined;

    if (existingModelCall && existingModelCall.outcome === "SUCCESS" && existingModelCall.rawResponse) {
      rawText = existingModelCall.rawResponse;
      usage = {
        promptTokens: existingModelCall.promptTokens,
        completionTokens: existingModelCall.completionTokens,
        cachedTokens: existingModelCall.cachedTokens,
        actualTokens: existingModelCall.actualTokens,
        costCny: existingModelCall.costCny,
      };
      this.store.messages.updateStatus(message.messageId, "RESPONSE_STORED");
    } else {
      // 2. 组装 PreparedPrompt
      const { request, promptHash, estimatedTokens } = this.promptBuilder.prepare({
        state: {
          pixel_id: pixelState.pixelId,
          position: pixelState.position,
          energy: pixelState.energy,
          active: pixelState.active,
          generation: pixelState.generation,
        },
        pixelMd: pixelMind,
        messageMd: message.content,
      });

      // 3. 多级预算检查与预留
      try {
        this.store.budgets.reserve({
          callId,
          runId: trace.runId,
          pixelId: pixelState.pixelId,
          estimatedTokens,
        });
        this.store.messages.updateStatus(message.messageId, "RESERVED");
      } catch (err: any) {
        if (err instanceof SpendBlockedError) {
          this.store.messages.updateStatus(message.messageId, "QUEUED");
          throw err;
        }
        if (err instanceof BudgetExceededError) {
          const status = err.kind === "PIXEL" ? "WAITING_PIXEL_BUDGET" : "WAITING_RUN_BUDGET";
          this.store.messages.updateStatus(message.messageId, status);
          throw err;
        }
        throw err;
      }

      // 4. 调用模型前检查 Stop 信号
      if (signal?.aborted) {
        // 调用前中止：安全退还预留，消息重置回 QUEUED
        this.store.budgets.refund(callId);
        this.store.messages.updateStatus(message.messageId, "QUEUED");
        throw new Error("USER_STOPPED_BEFORE_CALL");
      }

      this.store.messages.updateStatus(message.messageId, "CALLING");

      // 5. 调用模型与精准异常分类
      let rawResponse: any;
      try {
        rawResponse = await this.provider.call(request, signal);
        rawText = rawResponse.rawText;
      } catch (callErr: any) {
        if (callErr instanceof OutcomeUnknownError) {
          // 远端调用发出后超时或中断：严禁退款！保留预留并标记 CALL_OUTCOME_UNKNOWN，记录审计日志
          this.store.messages.updateStatus(message.messageId, "CALL_OUTCOME_UNKNOWN");
          this.store.modelCalls.recordModelCall({
            callId,
            runId: trace.runId,
            pixelId: pixelState.pixelId,
            messageId: message.messageId,
            model: request.model,
            pricingRevision: request.pricingRevision,
            promptHash,
            rawResponse: null,
            normalizedResponse: null,
            promptTokens: 0,
            completionTokens: 0,
            cachedTokens: 0,
            actualTokens: 0,
            costCny: 0,
            outcome: "CALL_OUTCOME_UNKNOWN",
            createdAt: Date.now() / 1000,
          });
          throw callErr;
        }

        // 基础设施连接前失败（如 DNS 解析失败、握手前断开、调用前取消）：退还预留，消息放回队列
        this.store.budgets.refund(callId);
        this.store.messages.updateStatus(message.messageId, "QUEUED");
        throw callErr;
      }

      // 6. 核算实际用量并结算扣款（支持零 token 真实值）
      const rawUsage = rawResponse.usage || {};
      const promptTokens = rawUsage.promptTokens ?? estimatedTokens;
      const completionTokens = rawUsage.completionTokens ?? 0;
      const cachedTokens = rawUsage.cachedTokens ?? 0;

      usage = this.usageMeter.calculateUsage({
        model: request.model,
        promptTokens,
        completionTokens,
        cachedTokens,
      });

      // 7. 单一 SQLite 原子事务：扣除结算预算、记录 ModelCall、标记 RESPONSE_STORED
      this.store.settleAndStoreModelResponse({
        callId,
        runId: trace.runId,
        pixelId: pixelState.pixelId,
        messageId: message.messageId,
        model: request.model,
        pricingRevision: request.pricingRevision,
        promptHash,
        rawResponse: rawText || "",
        normalizedResponse: null,
        usage,
      });
    }

    // 8. 解析归一化决策
    const decision: AgentDecision = parseAndNormalizeResponse(rawText || "", pixelMind);

    // 9. 编译为副作用列表
    const effects = DecisionCompiler.compile({
      decision,
      pixelId: pixelState.pixelId,
      messageId: message.messageId,
      currentHop: message.hop,
    });

    // 10. 执行副作用
    const effectRuntime = new EffectRuntime({
      workspaceRoot: this.workspaceRoot,
      store: this.store,
      toolRuntime: this.toolRuntime,
      round,
      runId: trace.runId,
      signal,
    });
    await effectRuntime.applyEffects(effects);

    // 11. 提交消息终态为 COMMITTED
    this.store.messages.commitMessage(message.messageId);

    // 12. 更新元胞状态中的实际活动轮次
    try {
      const stateFile = path.resolve(this.workspaceRoot, "live", "pixels", pixelState.pixelId, "state.json");
      if (fs.existsSync(stateFile)) {
        const rawState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
        rawState.last_active_round = round;
        fs.writeFileSync(stateFile, JSON.stringify(rawState, null, 2), "utf-8");
      }
    } catch {}

    return {
      decision,
      usage,
      effects,
      trace,
    };
  }
}
