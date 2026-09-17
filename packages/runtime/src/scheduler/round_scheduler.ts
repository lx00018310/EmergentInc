import * as fs from "node:fs";
import * as path from "node:path";
import {
  AgentStepInput,
  PixelState,
  StopReason,
  TraceContext,
} from "@emergentinc/protocol";
import { CoreStore, MAX_MESSAGES_PER_ROUND, BudgetExceededError } from "@emergentinc/persistence";
import { shouldNaturalWake, idToCoord } from "@emergentinc/domain";
import { AgentStepRunner } from "../agent_step/agent_step_runner.js";

export interface RoundSchedulerOptions {
  workspaceRoot: string;
  store: CoreStore;
  stepRunner: AgentStepRunner;
  naturalWakeThreshold?: number;
}

export interface RoundSummary {
  round: number;
  messagesProcessed: number;
  activePixelsCount: number;
  stopReason?: StopReason | null;
}

export class RoundScheduler {
  private workspaceRoot: string;
  private store: CoreStore;
  private stepRunner: AgentStepRunner;
  private naturalWakeThreshold: number;

  constructor(options: RoundSchedulerOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.store = options.store;
    this.stepRunner = options.stepRunner;
    this.naturalWakeThreshold = options.naturalWakeThreshold || 5;
  }

  /**
   * 轮次开始：恢复可用等待消息与自然唤醒检查
   */
  public beginRound(currentRound: number, runId: string | null): void {
    // 1. 尝试激活已补充能量的元胞等待消息
    this.store.messages.tryRecoverWaitingPixelBudgetMessages();

    // 2. 检查活跃元胞的自然唤醒
    const activePixels = this.store.pixels.listActivePixels();

    for (const pixel of activePixels) {
      const pendingCount = this.store.messages.countPendingMessages(pixel.pixelId);

      // 从权威状态文件读取该元胞的真实最后活动轮次
      let lastActiveRound = 0;
      try {
        const stateFile = path.resolve(this.workspaceRoot, "live", "pixels", pixel.pixelId, "state.json");
        if (fs.existsSync(stateFile)) {
          const raw = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
          if (typeof raw.last_active_round === "number") {
            lastActiveRound = raw.last_active_round;
          }
        }
      } catch {}

      const wake = shouldNaturalWake({
        pixelId: pixel.pixelId,
        active: pixel.active,
        lastActiveRound,
        currentRound,
        naturalWakeThreshold: this.naturalWakeThreshold,
        hasPendingMessages: pendingCount > 0,
      });

      if (wake) {
        this.store.messages.enqueueMessage({
          runId,
          roundNum: currentRound,
          sender: "system",
          recipient: pixel.pixelId,
          content: "[NATURAL_WAKE] You have been naturally awakened by the environment cycle.",
          isFeedback: false,
          sourceType: "pixel",
        });
      }
    }
  }

  /**
   * 执行一整轮调度
   */
  public async executeRound(
    currentRound: number,
    runId: string,
    signal?: AbortSignal
  ): Promise<RoundSummary> {
    this.beginRound(currentRound, runId);

    let messagesProcessed = 0;
    let stopReason: StopReason | null = null;

    while (messagesProcessed < MAX_MESSAGES_PER_ROUND) {
      // 检查 Stop 信号 (在领取下一条消息之前)
      if (signal?.aborted) {
        stopReason = "USER_STOPPED";
        break;
      }

      // 领取下一条消息
      const message = this.store.messages.claimNext(currentRound);
      if (!message) {
        // 本轮无更多可处理消息
        break;
      }

      // 加载元胞状态
      const pixelAccount = this.store.pixels.getPixelAccount(message.recipient);
      if (!pixelAccount || !pixelAccount.active) {
        // 目标已失活或不存在，直接提交该消息，保持 V9 消费行为
        this.store.messages.commitMessage(message.messageId);
        messagesProcessed++;
        continue;
      }

      // 读取元胞心智文件
      const pixelDir = path.resolve(this.workspaceRoot, "live", "pixels", message.recipient);
      const pixelFile = path.resolve(pixelDir, "pixel.md");
      let pixelMind = "";
      if (fs.existsSync(pixelFile)) {
        pixelMind = fs.readFileSync(pixelFile, "utf-8");
      }

      const coord = idToCoord(message.recipient);
      const pixelState: PixelState = {
        pixelId: message.recipient,
        position: { x: coord[0], y: coord[1] },
        energy: pixelAccount.energy,
        active: pixelAccount.active,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: currentRound,
        refundDeficitTokens: pixelAccount.refundDeficitTokens,
        spendBlockedReason: pixelAccount.spendBlockedReason,
      };

      const trace: TraceContext = {
        runId,
        round: currentRound,
        pixelId: message.recipient,
        messageId: message.messageId,
      };

      const stepInput: AgentStepInput = {
        trace,
        pixelState,
        pixelMind,
        message,
        round: currentRound,
      };

      try {
        await this.stepRunner.execute(stepInput, signal);
        messagesProcessed++;
      } catch (err: any) {
        if (signal?.aborted) {
          stopReason = "USER_STOPPED";
          break;
        }
        if (err instanceof BudgetExceededError) {
          if (err.kind === "PIXEL") {
            // 当前元胞单体能量不足，消息已处于 WAITING_PIXEL_BUDGET，跳过当前消息，让其他有能量元胞继续运行
            continue;
          }
          if (err.kind === "RUN") {
            stopReason = "RUN_BUDGET_EXHAUSTED";
            break;
          }
          if (err.kind === "GLOBAL") {
            stopReason = "GLOBAL_BUDGET_EXHAUSTED";
            break;
          }
        }
        // 遇到严重异常，停止本轮
        stopReason = "INFRASTRUCTURE_FAILURE";
        break;
      }
    }

    if (!stopReason && messagesProcessed >= MAX_MESSAGES_PER_ROUND) {
      stopReason = "MESSAGE_LIMIT_REACHED";
    }

    return {
      round: currentRound,
      messagesProcessed,
      activePixelsCount: this.store.pixels.listActivePixels().length,
      stopReason,
    };
  }
}
