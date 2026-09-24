import * as fs from "node:fs";
import * as path from "node:path";
import {
  Effect,
  UpdateMindEffect,
  CapabilityUnavailableEffect,
  ReadEnvironmentEffect,
  ToolCallEffect,
  TransferEnergyEffect,
  ReproduceEffect,
  RouteMessageEffect,
  isValidPixelMdLength,
  getUnicodeLength,
} from "@emergentinc/protocol";
import { CoreStore } from "@emergentinc/persistence";
import {
  validateEnergyTransfer,
  validateReproduction,
  validateMessageRouting,
  isHopLimitReached,
  getNeighbors6,
} from "@emergentinc/domain";
import { ToolRuntime, ToolContext } from "@emergentinc/tools";
import { FeedbackFactory } from "../feedback/feedback_factory.js";

export interface EffectRuntimeContext {
  workspaceRoot: string;
  store: CoreStore;
  toolRuntime: ToolRuntime;
  round: number;
  runId: string | null;
  signal?: AbortSignal;
  modelCallId?: string;
}

export class EffectRuntime {
  constructor(private ctx: EffectRuntimeContext) {}

  public async applyEffects(effects: Effect[]): Promise<void> {
    let priorToolFailed = false;
    let actorDeactivated = false;
    const toolExecutions: Array<{ tool: string; status: string; outputOrError: any }> = [];
    let toolTargetPixelId: string | null = null;

    for (const effect of effects) {
      if (actorDeactivated) break;
      // 1. Exactly-Once 幂等检查
      if (this.ctx.store.effects.hasEffectBeenApplied(effect.effectId)) {
        continue;
      }

      // 2. 根据类型派发执行
      switch (effect.effectType) {
        case "UPDATE_MIND":
          await this.applyUpdateMind(effect);
          break;

        case "CAPABILITY_UNAVAILABLE":
          await this.applyCapabilityUnavailable(effect);
          break;

        case "READ_ENVIRONMENT":
          await this.applyReadEnvironment(effect);
          break;

        case "TOOL_CALL":
          if (priorToolFailed) {
            // 单工具失败后，本批剩余工具跳过，记录为 SKIPPED
            this.ctx.store.effects.recordEffect({
              effect_id: effect.effectId,
              message_id: effect.messageId,
              effect_type: "TOOL_CALL",
              effect_index: effect.effectIndex,
              payload_hash: effect.payloadHash,
              status: "SKIPPED",
              details: JSON.stringify({ reason: "PRIOR_TOOL_FAILED" }),
              created_at: Date.now() / 1000,
            });
            break;
          }

          toolTargetPixelId = effect.pixelId;
          const toolResult = await this.applyToolCall(effect);
          toolExecutions.push(toolResult.execution);
          if (!toolResult.success) {
            priorToolFailed = true;
          }
          break;

        case "TRANSFER_ENERGY":
          await this.applyTransferEnergy(effect);
          actorDeactivated = !this.ctx.store.pixels.getPixelAccount(effect.fromPixelId)?.active;
          break;

        case "REPRODUCE":
          await this.applyReproduce(effect);
          actorDeactivated = !this.ctx.store.pixels.getPixelAccount(effect.parentPixelId)?.active;
          break;

        case "ROUTE_MESSAGE":
          await this.applyRouteMessage(effect);
          break;
      }
    }

    // 聚合入队：将同一 Step 内的所有工具执行回执合并为单条结构化反馈消息，防止队列刷屏与饥饿
    if (toolExecutions.length > 0 && toolTargetPixelId) {
      const feedback = FeedbackFactory.createBatchToolExecutionFeedback(
        toolTargetPixelId,
        this.ctx.round,
        this.ctx.runId,
        toolExecutions
      );
      this.ctx.store.messages.enqueueMessage(feedback);
    }
  }

  private async applyUpdateMind(effect: UpdateMindEffect): Promise<void> {
    const pixelDir = path.resolve(this.ctx.workspaceRoot, "live", "pixels", effect.pixelId);
    const pixelFile = path.resolve(pixelDir, "pixel.md");

    // 心智长度校验 (<= 2000 码点)
    if (!isValidPixelMdLength(effect.content)) {
      const actualLen = getUnicodeLength(effect.content);
      const feedback = FeedbackFactory.createMindValidationFeedback(
        effect.pixelId,
        this.ctx.round,
        this.ctx.runId,
        actualLen
      );
      this.ctx.store.messages.enqueueMessage(feedback);

      this.ctx.store.effects.recordEffect({
        effect_id: effect.effectId,
        message_id: effect.messageId,
        effect_type: effect.effectType,
        effect_index: effect.effectIndex,
        payload_hash: effect.payloadHash,
        status: "FAILED",
        details: JSON.stringify({ error: "MIND_TOO_LONG", length: actualLen }),
        created_at: Date.now() / 1000,
      });
      return;
    }

    // 写入 pixel.md
    if (!fs.existsSync(pixelDir)) {
      fs.mkdirSync(pixelDir, { recursive: true });
    }
    fs.writeFileSync(pixelFile, effect.content, "utf-8");

    // tips.md：仅在模型显式提供 tips_md 且内容真变化时写入（mtime 可作为版本信号）
    if (effect.tipsContent !== undefined) {
      const tipsFile = path.resolve(pixelDir, "tips.md");
      let oldTips: string | null = null;
      if (fs.existsSync(tipsFile)) {
        try {
          oldTips = fs.readFileSync(tipsFile, "utf-8");
        } catch {}
      }
      if (oldTips !== effect.tipsContent) {
        fs.writeFileSync(tipsFile, effect.tipsContent, "utf-8");
      }
    }

    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId,
      message_id: effect.messageId,
      effect_type: effect.effectType,
      effect_index: effect.effectIndex,
      payload_hash: effect.payloadHash,
      status: "APPLIED",
      created_at: Date.now() / 1000,
    });
  }

  private async applyCapabilityUnavailable(effect: CapabilityUnavailableEffect): Promise<void> {
    const feedback = FeedbackFactory.createCapabilityUnavailableFeedback(
      effect.pixelId,
      this.ctx.round,
      this.ctx.runId,
      effect.capability
    );
    this.ctx.store.messages.enqueueMessage(feedback);

    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId,
      message_id: effect.messageId,
      effect_type: effect.effectType,
      effect_index: effect.effectIndex,
      payload_hash: effect.payloadHash,
      status: "APPLIED",
      created_at: Date.now() / 1000,
    });
  }

  private async applyReadEnvironment(effect: ReadEnvironmentEffect): Promise<void> {
    const envPath = path.resolve(this.ctx.workspaceRoot, "live", "environment.md");
    let content = "";
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf-8");
    }

    // 生成 ENVIRONMENT 消息加入队列
    this.ctx.store.messages.enqueueMessage({
      runId: this.ctx.runId,
      roundNum: this.ctx.round,
      sender: "environment",
      recipient: effect.pixelId,
      content,
      isFeedback: true,
      sourceType: "environment",
    });

    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId,
      message_id: effect.messageId,
      effect_type: effect.effectType,
      effect_index: effect.effectIndex,
      payload_hash: effect.payloadHash,
      status: "APPLIED",
      created_at: Date.now() / 1000,
    });
  }

  private async applyToolCall(effect: ToolCallEffect): Promise<{
    success: boolean;
    execution: { tool: string; status: string; outputOrError: any };
  }> {
    const toolCtx: ToolContext = {
      workspaceRoot: this.ctx.workspaceRoot,
      pixelId: effect.pixelId,
      runId: this.ctx.runId || "run_default",
      messageId: effect.messageId,
      operationId: effect.operationId,
      signal: this.ctx.signal,
    };

    // 记录工具执行开始
    this.ctx.store.toolExecutions.recordStarted({
      operation_id: effect.operationId,
      model_call_id: this.ctx.modelCallId ?? this.ctx.store.modelCalls.getLatestByMessageId(effect.messageId)?.callId,
      run_id: this.ctx.runId,
      message_id: effect.messageId,
      pixel_id: effect.pixelId,
      op_index: effect.effectIndex,
      tool: effect.toolCall.tool,
      args_hash: effect.payloadHash,
      started_at: Date.now() / 1000,
    });

    const result = await this.ctx.toolRuntime.execute(
      effect.toolCall.tool,
      effect.toolCall.args,
      toolCtx
    );

    // 记录工具执行结束
    this.ctx.store.toolExecutions.recordFinished({
      operationId: effect.operationId,
      status: result.status,
      result: JSON.stringify(result.output || result.error_message || ""),
      finishedAt: Date.now() / 1000,
      costCny: result.costCny,
    });

    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId,
      message_id: effect.messageId,
      effect_type: effect.effectType,
      effect_index: effect.effectIndex,
      payload_hash: effect.payloadHash,
      status: result.status === "SUCCESS" ? "APPLIED" : "FAILED",
      details: JSON.stringify(result),
      created_at: Date.now() / 1000,
    });

    return {
      success: result.status === "SUCCESS",
      execution: {
        tool: result.tool,
        status: result.status,
        outputOrError: result.status === "SUCCESS" ? result.output : result.error_message,
      },
    };
  }

  private async applyTransferEnergy(effect: TransferEnergyEffect): Promise<void> {
    const fromAccount = this.ctx.store.pixels.getPixelAccount(effect.fromPixelId);
    const toAccount = this.ctx.store.pixels.getPixelAccount(effect.transfer.target);

    const validation = validateEnergyTransfer({
      fromPixelId: effect.fromPixelId,
      fromEnergy: fromAccount?.energy || 0,
      fromActive: Boolean(fromAccount?.active),
      toPixelId: effect.transfer.target,
      toExists: Boolean(toAccount),
      amount: effect.transfer.amount,
    });

    if (!validation.valid) {
      const feedback = FeedbackFactory.createTransferFailureFeedback(
        effect.fromPixelId,
        this.ctx.round,
        this.ctx.runId,
        effect.transfer.target,
        validation.errorCode || "VALIDATION_FAILED",
        validation.errorMessage || "Transfer validation failed"
      );
      this.ctx.store.messages.enqueueMessage(feedback);

      this.ctx.store.effects.recordEffect({
        effect_id: effect.effectId,
        message_id: effect.messageId,
        effect_type: effect.effectType,
        effect_index: effect.effectIndex,
        payload_hash: effect.payloadHash,
        status: "FAILED",
        details: JSON.stringify(validation),
        created_at: Date.now() / 1000,
      });
      return;
    }

    // 原子划转
    this.ctx.store.transaction(() => {
      const newFrom = this.ctx.store.pixels.updateEnergy(
        effect.fromPixelId,
        -effect.transfer.amount
      );
      const newTo = this.ctx.store.pixels.updateEnergy(
        effect.transfer.target,
        effect.transfer.amount
      );

      const now = Date.now() / 1000;
      this.ctx.store.ledger.appendEntry({
        entry_id: `${effect.effectId}_out`,
        timestamp: now,
        pixel_id: effect.fromPixelId,
        entry_type: "transfer_out",
        amount: -effect.transfer.amount,
        balance_after: newFrom,
        details: JSON.stringify({ to: effect.transfer.target }),
      });

      this.ctx.store.ledger.appendEntry({
        entry_id: `${effect.effectId}_in`,
        timestamp: now,
        pixel_id: effect.transfer.target,
        entry_type: "transfer_in",
        amount: effect.transfer.amount,
        balance_after: newTo,
        details: JSON.stringify({ from: effect.fromPixelId }),
      });
    });
    this.syncAccountStateFile(effect.fromPixelId);
    this.syncAccountStateFile(effect.transfer.target);

    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId,
      message_id: effect.messageId,
      effect_type: effect.effectType,
      effect_index: effect.effectIndex,
      payload_hash: effect.payloadHash,
      status: "APPLIED",
      created_at: Date.now() / 1000,
    });
  }

  private async applyReproduce(effect: ReproduceEffect): Promise<void> {
    const parentAccount = this.ctx.store.pixels.getPixelAccount(effect.parentPixelId);
    const activePixels = this.ctx.store.pixels.listActivePixels();
    const occupiedPositions = new Set(activePixels.map((p) => p.pixelId));

    const validation = validateReproduction({
      parentPixelId: effect.parentPixelId,
      parentEnergy: parentAccount?.energy || 0,
      parentActive: Boolean(parentAccount?.active),
      direction: effect.request.direction,
      initialEnergy: effect.request.initial_energy,
      occupiedPositions,
    });

    if (!validation.valid || !validation.childPixelId) {
      this.recordReproductionFailure(effect, validation.errorCode || "VALIDATION_FAILED", validation.errorMessage || "Reproduction validation failed");
      return;
    }

    const childPixelId = validation.childPixelId;
    const oldAccount = this.ctx.store.pixels.getPixelAccount(childPixelId);
    const unsettledMessage = this.ctx.store.db.prepare(`
      SELECT 1 FROM messages WHERE recipient = ?
      AND status IN ('PROCESSING', 'RESERVED', 'CALLING', 'RESPONSE_STORED', 'CALL_OUTCOME_UNKNOWN', 'AWAITING_SETTLEMENT') LIMIT 1
    `).get(childPixelId);
    const openReservation = this.ctx.store.db.prepare("SELECT 1 FROM reservations WHERE pixel_id = ? AND status = 'OPEN' LIMIT 1").get(childPixelId);
    if (unsettledMessage || openReservation || (oldAccount && (oldAccount.active || oldAccount.energy !== 0 || oldAccount.refundDeficitTokens > 0))) {
      this.recordReproductionFailure(effect, "TARGET_NOT_RESETTABLE", `Target '${childPixelId}' must be inactive, empty of energy and free of unsettled work`);
      return;
    }

    // 同坐标的新生命不继承旧文件；旧文件与交付物移入历史目录。
    const childDir = path.resolve(this.ctx.workspaceRoot, "live", "pixels", childPixelId);
    const artifactsDir = path.resolve(this.ctx.workspaceRoot, "live", "artifacts", childPixelId);
    const historyDir = path.resolve(this.ctx.workspaceRoot, "live", "history", childPixelId, effect.effectId);
    const archivedPixelDir = path.resolve(historyDir, "pixel");
    const archivedArtifactsDir = path.resolve(historyDir, "artifacts");
    if (fs.existsSync(historyDir)) {
      throw new Error(`Reproduction archive already exists: ${historyDir}`);
    }
    const readState = (file: string): any => {
      return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf-8")) : {};
    };
    const oldState = readState(path.resolve(childDir, "state.json"));
    const parentState = readState(path.resolve(this.ctx.workspaceRoot, "live", "pixels", effect.parentPixelId, "state.json"));
    const generation = Number.isSafeInteger(parentState.generation) && parentState.generation >= 0 ? parentState.generation + 1 : 1;
    const incarnation = oldAccount
      ? (Number.isSafeInteger(oldState.incarnation) && oldState.incarnation > 0 ? oldState.incarnation + 1 : 2)
      : 1;
    const hadPixelDir = fs.existsSync(childDir);
    const hadArtifactsDir = fs.existsSync(artifactsDir);
    if ((hadPixelDir && !fs.lstatSync(childDir).isDirectory()) ||
        (hadArtifactsDir && !fs.lstatSync(artifactsDir).isDirectory())) {
      throw new Error("Reproduction target is not a directory");
    }

    let movedPixel = false;
    let movedArtifacts = false;
    try {
      if (hadPixelDir || hadArtifactsDir) fs.mkdirSync(historyDir, { recursive: true });
      if (hadPixelDir) {
        fs.renameSync(childDir, archivedPixelDir);
        movedPixel = true;
      }
      if (hadArtifactsDir) {
        fs.renameSync(artifactsDir, archivedArtifactsDir);
        movedArtifacts = true;
      }
      fs.mkdirSync(childDir, { recursive: true });
      fs.writeFileSync(path.resolve(childDir, "pixel.md"), "", "utf-8");
      fs.writeFileSync(path.resolve(childDir, "tips.md"), "", "utf-8");
      fs.writeFileSync(path.resolve(childDir, "mandate.md"), "", "utf-8");
      fs.writeFileSync(path.resolve(childDir, "state.json"), JSON.stringify({
        id: childPixelId,
        position: validation.childCoord,
        active: true,
        energy: effect.request.initial_energy,
        parent: effect.parentPixelId,
        born_round: this.ctx.round,
        last_active_round: this.ctx.round,
        generation,
        incarnation,
      }, null, 2), "utf-8");

      this.ctx.store.transaction(() => {
        const current = this.ctx.store.pixels.getPixelAccount(childPixelId);
        if (current?.active || (current && (current.energy !== 0 || current.refundDeficitTokens > 0))) {
          throw new Error("Reproduction target changed during reset");
        }
        const parent = this.ctx.store.pixels.getPixelAccount(effect.parentPixelId);
        if (!parent?.active || parent.energy < effect.request.initial_energy) {
          throw new Error("Reproduction parent no longer has enough energy");
        }
        const parentAfter = this.ctx.store.pixels.updateEnergy(effect.parentPixelId, -effect.request.initial_energy);
        this.ctx.store.pixels.upsertPixelAccount({
          pixelId: childPixelId,
          energy: effect.request.initial_energy,
          active: true,
          refundDeficitTokens: 0,
          spendBlockedReason: null,
        });
        this.ctx.store.db.prepare(`
          UPDATE messages SET status = 'ABANDONED', updated_at = ?
          WHERE recipient = ? AND status IN ('QUEUED', 'WAITING_PIXEL_BUDGET', 'WAITING_RUN_BUDGET')
        `).run(Date.now() / 1000, childPixelId);
        const now = Date.now() / 1000;
        this.ctx.store.ledger.appendEntry({
          entry_id: `${effect.effectId}_parent`, timestamp: now, pixel_id: effect.parentPixelId,
          entry_type: "reproduction_out", amount: -effect.request.initial_energy,
          balance_after: parentAfter, details: JSON.stringify({ child: childPixelId, incarnation }),
        });
        this.ctx.store.ledger.appendEntry({
          entry_id: `${effect.effectId}_child`, timestamp: now, pixel_id: childPixelId,
          entry_type: "reproduction_in", amount: effect.request.initial_energy,
          balance_after: effect.request.initial_energy,
          details: JSON.stringify({ parent: effect.parentPixelId, incarnation }),
        });
        this.ctx.store.effects.recordEffect({
          effect_id: effect.effectId, message_id: effect.messageId, effect_type: effect.effectType,
          effect_index: effect.effectIndex, payload_hash: effect.payloadHash,
          status: "APPLIED", created_at: now,
        });
      });
    } catch (err) {
      if ((movedPixel || !hadPixelDir) && fs.existsSync(childDir)) fs.rmSync(childDir, { recursive: true, force: true });
      if (movedPixel) fs.renameSync(archivedPixelDir, childDir);
      if (movedArtifacts) fs.renameSync(archivedArtifactsDir, artifactsDir);
      throw err;
    }
    this.syncAccountStateFile(effect.parentPixelId);
  }

  private syncAccountStateFile(pixelId: string): void {
    const stateFile = path.resolve(this.ctx.workspaceRoot, "live", "pixels", pixelId, "state.json");
    try {
      if (!fs.existsSync(stateFile)) return;
      const account = this.ctx.store.pixels.getPixelAccount(pixelId);
      if (!account) return;
      const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
      state.energy = account.energy;
      state.active = account.active;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf-8");
    } catch {}
  }

  private recordReproductionFailure(effect: ReproduceEffect, code: string, message: string): void {
    this.ctx.store.messages.enqueueMessage(FeedbackFactory.createReproductionFailureFeedback(
      effect.parentPixelId, this.ctx.round, this.ctx.runId, code, message
    ));
    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId, message_id: effect.messageId, effect_type: effect.effectType,
      effect_index: effect.effectIndex, payload_hash: effect.payloadHash,
      status: "FAILED", details: JSON.stringify({ errorCode: code, errorMessage: message }),
      created_at: Date.now() / 1000,
    });
  }

  private async applyRouteMessage(effect: RouteMessageEffect): Promise<void> {
    const activePixels = this.ctx.store.pixels.listActivePixels();
    const activeNeighbors = new Set(
      getNeighbors6(effect.sender).filter((nId) =>
        activePixels.some((p) => p.pixelId === nId && p.active)
      )
    );

    const validation = validateMessageRouting({
      sender: effect.sender,
      recipient: effect.recipient,
      content: effect.content,
      hop: effect.hop,
      activeNeighbors,
    });

    if (!validation.valid) {
      const feedback = FeedbackFactory.createRoutingFailureFeedback(
        effect.sender,
        this.ctx.round,
        this.ctx.runId,
        effect.recipient,
        validation.errorCode || "VALIDATION_FAILED",
        validation.errorMessage || "Routing validation failed"
      );
      this.ctx.store.messages.enqueueMessage(feedback);

      this.ctx.store.effects.recordEffect({
        effect_id: effect.effectId,
        message_id: effect.messageId,
        effect_type: effect.effectType,
        effect_index: effect.effectIndex,
        payload_hash: effect.payloadHash,
        status: "FAILED",
        details: JSON.stringify(validation),
        created_at: Date.now() / 1000,
      });
      return;
    }

    // 目标若是 SELF，映射接收人为 sender 自身
    const realRecipient =
      effect.recipient.toUpperCase() === "SELF" ? effect.sender : effect.recipient;

    // 检查跳数限制
    const hopOverLimit = isHopLimitReached(effect.hop);
    const targetRound = hopOverLimit ? this.ctx.round + 1 : this.ctx.round;

    this.ctx.store.messages.enqueueMessage({
      runId: this.ctx.runId,
      roundNum: targetRound,
      hop: effect.hop,
      sender: effect.sender,
      recipient: realRecipient,
      content: effect.content,
      isFeedback: false,
      sourceType: "pixel",
    });

    this.ctx.store.effects.recordEffect({
      effect_id: effect.effectId,
      message_id: effect.messageId,
      effect_type: effect.effectType,
      effect_index: effect.effectIndex,
      payload_hash: effect.payloadHash,
      status: "APPLIED",
      details: hopOverLimit ? JSON.stringify({ deferred_to_round: targetRound }) : undefined,
      created_at: Date.now() / 1000,
    });
  }
}
