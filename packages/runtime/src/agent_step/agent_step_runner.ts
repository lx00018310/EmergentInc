import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
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
  InfrastructureFailureError,
  InvalidModelResponseError,
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

  public isReadOnlyTool(name: string): boolean {
    return this.toolRuntime.registry.get(name)?.definition.effect === "read";
  }

  public async execute(input: AgentStepInput, signal?: AbortSignal): Promise<AgentStepResult> {
    const { trace, pixelState, pixelMind, message, round } = input;
    let callId = `call_${message.messageId}_${randomUUID()}`;
    const persistedStatus = this.store.messages.getMessage(message.messageId)?.status;
    if (["AWAITING_SETTLEMENT", "CALL_OUTCOME_UNKNOWN", "ABANDONED"].includes(persistedStatus || "")) {
      throw Object.assign(new Error(`Message requires operator resolution: ${persistedStatus}`), {
        code: "PAUSED_RECOVERY_REQUIRED", phase: "settlement",
      });
    }
    if (this.store.modelCalls.countInvalidResponses(message.messageId) >= 2) {
      this.store.messages.updateStatus(message.messageId, "MODEL_RESPONSE_INVALID");
      throw new InvalidModelResponseError("Invalid response retry limit reached", "");
    }

    // 1. 检查当前消息是否已有成功的 ModelCall (响应复用：支持安全重试与崩溃恢复)
    const existingModelCall = this.store.modelCalls.getLatestByMessageId(message.messageId);
    let rawText: string | null = null;
    let currentTipsMd = "";
    let usage: ModelUsage | undefined;

    if (existingModelCall && existingModelCall.outcome === "SUCCESS" && existingModelCall.rawResponse) {
      callId = existingModelCall.callId;
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
      // 读取私有 artifacts 列表 (历史私有) — canonical root 与工具层 live/artifacts/<pixelId> 一致
      const pixelArtifactsDir = path.resolve(this.workspaceRoot, "live", "artifacts", pixelState.pixelId);
      let pixelFiles: string[] = [];
      if (fs.existsSync(pixelArtifactsDir)) {
        try {
          pixelFiles = fs.readdirSync(pixelArtifactsDir).filter((f) => !f.startsWith("."));
        } catch {}
      }

      // 读取 Human Mandate (独立 External，严禁写入 pixel.md)
      const pixelDir = path.resolve(this.workspaceRoot, "live", "pixels", pixelState.pixelId);
      const mandateFile = path.resolve(pixelDir, "mandate.md");
      let humanMandate: string | null = null;
      if (fs.existsSync(mandateFile)) {
        try {
          humanMandate = fs.readFileSync(mandateFile, "utf-8").trim();
        } catch {}
      }

      // 读取当前 tips.md（模型缺失 tips_md 输出时保留原值）
      const tipsFile = path.resolve(pixelDir, "tips.md");
      if (fs.existsSync(tipsFile)) {
        try {
          currentTipsMd = fs.readFileSync(tipsFile, "utf-8");
        } catch {}
      }

      // Environment is visible only through the next-hop READ_ENVIRONMENT message.
      let environmentInfo: string | null = null;
      let humanInstructions: string | null = null;
      // Only Pixel-originated messages belong to LOCAL MESSAGES.
      let messageMd = message.sourceType === "pixel" ? message.content : "";
      const feedbackLines: string[] = [];
      const systemLines: string[] = [];
      let humanMaterial: string | null = null;
      if (message.sourceType === "environment") {
        environmentInfo = environmentInfo ? `${environmentInfo}\n\n${message.content}` : message.content;
        messageMd = "";
      } else if (message.sourceType === "feedback") {
        feedbackLines.push(message.content);
        messageMd = "";
      } else if (message.sourceType === "system") {
        systemLines.push(message.content);
        messageMd = "";
      } else if (message.sourceType === "material") {
        humanMaterial = message.content;
        messageMd = "";
      } else if (message.sourceType === "human") {
        humanInstructions = message.content;
      } else if (message.sourceType !== "pixel") {
        // Fail closed for legacy/unknown sources rather than mislabeling them as peers.
        systemLines.push(message.content);
      }

      // 2. 组装 PreparedPrompt (V11 严格五层分离)
      const { request, promptHash, estimatedTokens } = this.promptBuilder.prepare({
        state: {
          pixel_id: pixelState.pixelId,
          position: pixelState.position,
          energy: pixelState.energy,
          active: pixelState.active,
          generation: pixelState.generation,
        },
        pixelMd: pixelMind,
        messageMd: messageMd || "(no local messages)",
        external: {
          humanMandate,
          humanInstructions,
          environmentInfo,
          humanMaterials: humanMaterial,
          feedback: feedbackLines.length > 0 ? feedbackLines.join("\n\n") : null,
          systemMessages: systemLines.length > 0 ? systemLines.join("\n\n") : null,
        },
        pixelFiles,
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
        if (!(callErr instanceof InfrastructureFailureError)) {
          const unknownError = callErr instanceof OutcomeUnknownError ? callErr : new OutcomeUnknownError(
            "Unclassified model error after dispatch; outcome requires review", callErr
          );
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
            roundNum: round,
            promptTokens: null,
            completionTokens: null,
            cachedTokens: null,
            actualTokens: null,
            costCny: null,
            outcome: "CALL_OUTCOME_UNKNOWN",
            createdAt: Date.now() / 1000,
          });
          throw unknownError;
        }

        // 基础设施连接前失败（如 DNS 解析失败、握手前断开、调用前取消）：退还预留，消息放回队列
        this.store.budgets.refund(callId);
        this.store.messages.updateStatus(message.messageId, "QUEUED");
        throw callErr;
      }

      // 6. 核算实际用量并结算扣款（支持零 token 真实值）
      usage = this.usageMeter.calculateUsage({
        ...rawResponse.usage,
        model: request.model,
      });

      // 7. 单一 SQLite 原子事务：扣除结算预算、记录 ModelCall、标记 RESPONSE_STORED
      this.store.settleAndStoreModelResponse({
        callId,
        runId: trace.runId,
        pixelId: pixelState.pixelId,
        messageId: message.messageId,
        roundNum: round,
        model: request.model,
        pricingRevision: request.pricingRevision,
        promptHash,
        rawResponse: rawText || "",
        normalizedResponse: null,
        usage,
      });
    }

    if (this.store.messages.getMessage(message.messageId)?.status === "AWAITING_SETTLEMENT") {
      throw Object.assign(new Error("Model usage missing; operator settlement required before effects"), {
        code: "PAUSED_RECOVERY_REQUIRED", phase: "settlement",
      });
    }

    // 模型费用若已耗尽能量，本次响应只留作审计，不允许失活 Pixel 再执行副作用。
    if (!this.store.pixels.getPixelAccount(pixelState.pixelId)?.active) {
      this.store.messages.commitMessage(message.messageId);
      this.syncPixelState(pixelState.pixelId, round);
      return { decision: {}, usage, effects: [], trace };
    }

    // 8. 解析归一化决策
    let decision: AgentDecision;
    try {
      decision = parseAndNormalizeResponse(rawText || "", pixelMind, currentTipsMd);
    } catch (parseErr: any) {
      if (parseErr instanceof InvalidModelResponseError) {
        // 供应商已经计费，但是响应不可使用：
        // 1. 在 model_calls 中更新 outcome 为 MODEL_RESPONSE_INVALID
        this.store.db.prepare(
          "UPDATE model_calls SET outcome = 'MODEL_RESPONSE_INVALID' WHERE call_id = ?"
        ).run(callId);
        // At most one paid retry across runs and process restarts.
        const exhausted = this.store.modelCalls.countInvalidResponses(message.messageId) >= 2;
        this.store.messages.updateStatus(message.messageId, exhausted ? "MODEL_RESPONSE_INVALID" : "QUEUED");
      }
      throw parseErr;
    }

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
      modelCallId: callId,
    });
    await effectRuntime.applyEffects(effects);

    // 11. 提交消息终态为 COMMITTED
    this.store.messages.commitMessage(message.messageId);

    // 12. 更新元胞状态中的实际活动轮次
    this.syncPixelState(pixelState.pixelId, round);

    return {
      decision,
      usage,
      effects,
      trace,
    };
  }

  private syncPixelState(pixelId: string, round: number): void {
    try {
      const stateFile = path.resolve(this.workspaceRoot, "live", "pixels", pixelId, "state.json");
      if (fs.existsSync(stateFile)) {
        const rawState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
        const account = this.store.pixels.getPixelAccount(pixelId);
        if (account) {
          rawState.energy = account.energy;
          rawState.active = account.active;
        }
        rawState.last_active_round = round;
        fs.writeFileSync(stateFile, JSON.stringify(rawState, null, 2), "utf-8");
      }
    } catch {}
  }
}
