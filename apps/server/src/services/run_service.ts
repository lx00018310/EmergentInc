import * as fs from "node:fs";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { RoundScheduler, RoundSummary } from "@emergentinc/runtime";
import { PromptService } from "./prompt_service.js";

export interface RunStartOptions {
  rounds: number;
  commandText?: string;
  runBudgetTokens: number;
  globalBudgetTokens: number;
}

export interface RunServiceOptions {
  workspaceRoot: string;
  store: CoreStore;
  scheduler: RoundScheduler;
  promptService?: PromptService;
  isMockMode?: boolean;
  isModelConfigured?: boolean;
}

export class RunService {
  private workspaceRoot: string;
  private store: CoreStore;
  private scheduler: RoundScheduler;
  private promptService?: PromptService;
  private isMockMode: boolean;
  private isModelConfigured: boolean;

  private isRunning: boolean = false;
  private currentRunId: string | null = null;
  private currentRound: number = 0;
  private requestedRounds: number = 0;
  private completedRounds: number = 0;
  private messagesProcessed: number = 0;
  private idleRounds: number = 0;
  private abortController: AbortController | null = null;
  private lastStopReason: string | null = null;
  private lastError: string | null = null;

  constructor(
    optionsOrStore: RunServiceOptions | CoreStore,
    maybeScheduler?: RoundScheduler
  ) {
    if ("store" in (optionsOrStore as any)) {
      const opts = optionsOrStore as RunServiceOptions;
      this.workspaceRoot = opts.workspaceRoot;
      this.store = opts.store;
      this.scheduler = opts.scheduler;
      this.promptService = opts.promptService;
      this.isMockMode = Boolean(opts.isMockMode);
      this.isModelConfigured = Boolean(opts.isModelConfigured);
    } else {
      this.store = optionsOrStore as CoreStore;
      this.scheduler = maybeScheduler!;
      this.workspaceRoot = "";
      this.isMockMode = true; // 兼容单元测试环境默认 mock
      this.isModelConfigured = true;
    }
  }

  private exitHandler?: () => void;

  private getLockFilePath(): string | null {
    if (!this.workspaceRoot) return null;
    return path.resolve(this.workspaceRoot, ".engine.lock");
  }

  private isPidRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      return e.code === "EPERM";
    }
  }

  public acquireWorkspaceLock(runId?: string): void {
    const lockFile = this.getLockFilePath();
    if (!lockFile) return;

    if (!this.exitHandler) {
      this.exitHandler = () => this.releaseWorkspaceLock();
      process.once("exit", this.exitHandler);
    }

    if (fs.existsSync(lockFile)) {
      try {
        const content = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
        const existingPid = Number(content.pid);
        if (existingPid && existingPid !== process.pid && this.isPidRunning(existingPid)) {
          throw new Error(
            `WORKSPACE_LOCKED: Workspace is locked by active process ${existingPid} (runId: ${content.runId || "unknown"})`
          );
        }
      } catch (err: any) {
        if (err.message?.startsWith("WORKSPACE_LOCKED")) {
          throw err;
        }
        // 废弃无主锁，安全接管
      }
    }

    const lockData = {
      pid: process.pid,
      createdAt: Date.now(),
      runId: runId || this.currentRunId,
    };
    fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2), "utf-8");
  }

  public releaseWorkspaceLock(): void {
    if (this.exitHandler) {
      process.removeListener("exit", this.exitHandler);
      this.exitHandler = undefined;
    }
    const lockFile = this.getLockFilePath();
    if (!lockFile) return;
    try {
      if (fs.existsSync(lockFile)) {
        const content = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
        if (content.pid === process.pid) {
          fs.unlinkSync(lockFile);
        }
      }
    } catch {}
  }

  public getWorldRound(): number {
    if (!this.workspaceRoot) return 0;
    const worldFile = path.resolve(this.workspaceRoot, "live", "world_state.json");
    if (!fs.existsSync(worldFile)) return 0;
    try {
      const data = JSON.parse(fs.readFileSync(worldFile, "utf-8"));
      return Number(data.round || 0);
    } catch {
      return 0;
    }
  }

  private updateWorldRound(round: number): void {
    if (!this.workspaceRoot) return;
    const worldFile = path.resolve(this.workspaceRoot, "live", "world_state.json");
    try {
      let data: any = { round: 0 };
      if (fs.existsSync(worldFile)) {
        data = JSON.parse(fs.readFileSync(worldFile, "utf-8"));
      }
      data.round = round;
      fs.writeFileSync(worldFile, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[RunService] Failed to persist world_state.json round:", err);
    }
  }

  public getStatus(): any {
    const modelCallsCount = this.currentRunId
      ? this.store.modelCalls.countByRunId(this.currentRunId)
      : 0;

    const unfinalized = this.store.getUnfinalizedOperations();
    const hasUnfinalized =
      unfinalized.unsettledReservations.length > 0 ||
      unfinalized.unknownCalls.length > 0 ||
      unfinalized.callingMessages.length > 0;

    let resultStatus = "READY";
    if (this.isRunning) {
      resultStatus = "RUNNING";
    } else if (hasUnfinalized || this.lastStopReason === "PAUSED_RECOVERY_REQUIRED") {
      resultStatus = "PAUSED_RECOVERY_REQUIRED";
    } else if (this.lastError || this.lastStopReason === "INFRASTRUCTURE_FAILURE") {
      resultStatus = "FAILED";
    } else if (
      this.lastStopReason === "USER_STOPPED" ||
      this.lastStopReason === "RUN_BUDGET_EXHAUSTED" ||
      this.lastStopReason === "GLOBAL_BUDGET_EXHAUSTED" ||
      this.lastStopReason === "READ_LOOP_THRESHOLD_REACHED"
    ) {
      resultStatus = "STOPPED";
    } else if (
      this.lastStopReason === "ROUND_LIMIT_REACHED" ||
      this.lastStopReason === "MESSAGE_LIMIT_REACHED"
    ) {
      resultStatus = "COMPLETED";
    } else if (this.lastStopReason) {
      resultStatus = this.lastStopReason;
    }

    const lastCompletedRound = this.getWorldRound();

    return {
      running: this.isRunning,
      run_id: this.currentRunId,
      current_loop: this.currentRunId,
      current_run: this.currentRunId,
      current_round: lastCompletedRound,
      last_completed_round: lastCompletedRound,
      executing_round: this.isRunning ? this.currentRound : null,
      requested_rounds: this.requestedRounds,
      completed_rounds: this.completedRounds,
      messages_processed: this.messagesProcessed,
      model_calls_completed: modelCallsCount,
      idle_rounds: this.idleRounds,
      stop_requested: Boolean(this.abortController?.signal?.aborted),
      stop_reason: this.lastStopReason,
      last_error: this.lastError,
      result_status: resultStatus,
      is_mock_mode: this.isMockMode,
      unfinalized_operations: hasUnfinalized ? unfinalized : null,
    };
  }

  public async start(options: RunStartOptions): Promise<any> {
    if (this.isRunning) {
      throw new Error("Run is already in progress.");
    }

    if (!this.isModelConfigured && !this.isMockMode) {
      throw new Error(
        "MODEL_NOT_CONFIGURED: Valid MCL_API_KEY is not configured. Set environment variable or start server with --mock for sandbox testing."
      );
    }

    if (options.rounds <= 0) {
      throw new Error("rounds must be a positive integer.");
    }
    if (options.runBudgetTokens <= 0) {
      throw new Error("run_budget_tokens must be positive.");
    }
    if (options.globalBudgetTokens <= 0) {
      throw new Error("global_budget_tokens must be positive.");
    }

    // 1. 检查是否存在未决操作（悬挂调用、未知结果调用、未决预留）
    const unfinalized = this.store.getUnfinalizedOperations();
    if (
      unfinalized.unsettledReservations.length > 0 ||
      unfinalized.unknownCalls.length > 0 ||
      unfinalized.callingMessages.length > 0
    ) {
      this.lastStopReason = "PAUSED_RECOVERY_REQUIRED";
      throw new Error(
        `RUN_BLOCKED_UNFINALIZED_OPERATIONS: Detected unfinalized operations in store. Manual confirmation or safe reconciliation required. ` +
        `Summary: reservations=${unfinalized.unsettledReservations.length}, unknownCalls=${unfinalized.unknownCalls.length}, callingMessages=${unfinalized.callingMessages.length}`
      );
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 2. 工作区排他锁检查与获取
    this.acquireWorkspaceLock(runId);
    const currentWorldRound = this.getWorldRound();
    const startRound = currentWorldRound + 1;
    const endRound = currentWorldRound + options.rounds;

    this.currentRunId = runId;
    this.isRunning = true;
    this.requestedRounds = options.rounds;
    this.completedRounds = 0;
    this.messagesProcessed = 0;
    this.idleRounds = 0;
    this.currentRound = currentWorldRound;
    this.lastStopReason = null;
    this.lastError = null;
    this.abortController = new AbortController();

    // 读取创世提示词真实版本
    const genesisPrompt = this.promptService?.getPrompt("genesis_prompt.json");
    const genesisRevision = genesisPrompt?.revision || 1;

    // 记录 Run 实体
    this.store.runs.createRun({
      run_id: runId,
      start_round: startRound,
      end_round: endRound,
      run_limit: options.runBudgetTokens,
      run_spent: 0,
      run_reserved: 0,
      global_limit: options.globalBudgetTokens,
      global_spent: 0,
      global_reserved: 0,
      genesis_revision: genesisRevision,
      status: "RUNNING",
      created_at: Date.now() / 1000,
    });

    // 尝试激活上一轮因 Run 预算等待的消息
    this.store.messages.resetWaitingRunBudgetMessages();

    // 异步执行轮次调度，不阻塞 HTTP 响应
    this.runLoop(runId, startRound, endRound, this.abortController.signal).catch((err) => {
      console.error(`Run ${runId} execution encountered an error:`, err);
    });

    return {
      status: "STARTED",
      run_id: runId,
      start_round: startRound,
      end_round: endRound,
      rounds: options.rounds,
    };
  }

  public requestStop(): { status: string; message: string } {
    if (!this.isRunning || !this.abortController) {
      return { status: "IDLE", message: "No active run to stop." };
    }
    this.abortController.abort(new Error("USER_STOPPED"));
    return { status: "STOPPING", message: "Stop request signaled to active run." };
  }

  private async runLoop(
    runId: string,
    startRound: number,
    endRound: number,
    signal: AbortSignal
  ): Promise<void> {
    try {
      for (let r = startRound; r <= endRound; r++) {
        if (signal.aborted) {
          this.lastStopReason = "USER_STOPPED";
          break;
        }

        this.currentRound = r;
        const summary: RoundSummary = await this.scheduler.executeRound(r, runId, signal);

        // 如果本轮遭遇基础设施失败或被主动中断，不可计入完成轮次，不可推进世界轮次
        if (summary.stopReason === "INFRASTRUCTURE_FAILURE" || signal.aborted) {
          this.lastStopReason = signal.aborted ? "USER_STOPPED" : "INFRASTRUCTURE_FAILURE";
          break;
        }

        this.completedRounds++;
        this.messagesProcessed += summary.messagesProcessed;
        if (summary.messagesProcessed === 0) {
          this.idleRounds++;
        }

        // 仅在整轮完整成功执行后，才推进持久化的绝对世界轮次
        this.updateWorldRound(r);

        if (summary.stopReason) {
          this.lastStopReason = summary.stopReason;
          break;
        }
      }

      const isStopped =
        signal.aborted ||
        this.lastStopReason === "USER_STOPPED" ||
        this.lastStopReason === "RUN_BUDGET_EXHAUSTED" ||
        this.lastStopReason === "GLOBAL_BUDGET_EXHAUSTED" ||
        this.lastStopReason === "READ_LOOP_THRESHOLD_REACHED";
      const isFailed = this.lastStopReason === "INFRASTRUCTURE_FAILURE";
      const finalStatus = isFailed ? "FAILED" : isStopped ? "STOPPED" : "COMPLETED";
      const finalReason = this.lastStopReason || (signal.aborted ? "USER_STOPPED" : "ROUND_LIMIT_REACHED");

      this.store.runs.updateRunStatus(runId, finalStatus, finalReason as any);
    } catch (err: any) {
      this.lastError = err.message || String(err);
      this.lastStopReason = "INFRASTRUCTURE_FAILURE";
      this.store.runs.updateRunStatus(runId, "FAILED", "INFRASTRUCTURE_FAILURE");
    } finally {
      this.isRunning = false;
      this.abortController = null;
      this.releaseWorkspaceLock();
    }
  }
}
