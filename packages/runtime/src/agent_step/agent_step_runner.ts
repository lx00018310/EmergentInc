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
import { PromptBuilder, ModelProvider, parseAndNormalizeResponse, UsageMeter } from "@emergentinc/model";
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

    // 1. 检查当前消息是否已有 RESPONSE_STORED (如崩溃后重启继续执行)
    const existingModelCall = this.store.modelCalls.getModelCall(callId);
    let rawText: string | null = null;
    let usage: ModelUsage | undefined;

    if (existingModelCall && existingModelCall.rawResponse) {
      rawText = existingModelCall.rawResponse;
      usage = {
        promptTokens: existingModelCall.promptTokens,
        completionTokens: existingModelCall.completionTokens,
        cachedTokens: existingModelCall.cachedTokens,
        actualTokens: existingModelCall.actualTokens,
        costCny: existingModelCall.costCny,
      };
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
        // 调用前中止：退还预留，消息重置回 QUEUED，放回队首
        this.store.budgets.refund(callId);
        this.store.messages.updateStatus(message.messageId, "QUEUED");
        throw new Error("USER_STOPPED_BEFORE_CALL");
      }

      this.store.messages.updateStatus(message.messageId, "CALLING");

      // 5. 调用模型
      let rawResponse: any;
      try {
        rawResponse = await this.provider.call(request, signal);
        rawText = rawResponse.rawText;
      } catch (callErr: any) {
        // 基础设施失败：退还预留，放回队列
        this.store.budgets.refund(callId);
        this.store.messages.updateStatus(message.messageId, "QUEUED");
        throw callErr;
      }

      // 6. 核算实际用量并结算扣款
      const rawUsage = rawResponse.usage || {};
      const promptTokens = rawUsage.promptTokens || estimatedTokens;
      const completionTokens = rawUsage.completionTokens || 200;
      const cachedTokens = rawUsage.cachedTokens || 0;

      usage = this.usageMeter.calculateUsage({
        model: request.model,
        promptTokens,
        completionTokens,
        cachedTokens,
      });

      this.store.budgets.settle({
        callId,
        actualTokens: usage.actualTokens,
        costCny: usage.costCny,
      });

      // 7. 保存原始响应并更新状态为 RESPONSE_STORED
      const callRecord: ModelCallRecord = {
        callId,
        runId: trace.runId,
        pixelId: pixelState.pixelId,
        messageId: message.messageId,
        model: request.model,
        pricingRevision: request.pricingRevision,
        promptHash,
        rawResponse: rawText,
        normalizedResponse: null,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cachedTokens: usage.cachedTokens,
        actualTokens: usage.actualTokens,
        costCny: usage.costCny,
        outcome: "SUCCESS",
        createdAt: Date.now() / 1000,
      };
      this.store.modelCalls.recordModelCall(callRecord);
      this.store.messages.updateStatus(message.messageId, "RESPONSE_STORED");
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
