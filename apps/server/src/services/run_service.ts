import * as fs from "node:fs";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { RoundScheduler, RoundSummary } from "@emergentinc/runtime";
import { PromptService } from "./prompt_service.js";

export interface RunStartOptions {
  rounds: number;
  commandText?: string; // Deprecated: never dispatched to agents.
  runBudgetTokens: number;
  /** Server-resolved organization scope. Never populated from a world Run HTTP body. */
  executionId?: string | null;
  /** Internal synchronous transaction hook; route handlers never accept this value. */
  onRunCreated?: (runId: string) => void;
  /** Internal callback for scoped organization work; never accepted from HTTP input. */
  onRunFinalized?: (runId: string, executionId: string, status: "awaiting_review" | "blocked", reason: string) => void;
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
  private errorCode: string | null = null;
  private hasExecutedRunInProcess: boolean = false;
  private errorPhase: string | null = null;
  private currentExecutionId: string | null = null;
  private readonly executionFinalizers = new Map<string, (runId: string, executionId: string, status: "awaiting_review" | "blocked", reason: string) => void>();

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
    const hasUnfinalized = unfinalized.hasUnfinalized;

    // 内存态为空时回退到最近一次持久化 Run，进程重启后状态仍可见
    const latestRun = this.currentRunId ? null : this.store.runs.getLatestRun();
    const persistedStatus = latestRun?.status;
    const stopReason = this.lastStopReason ?? latestRun?.stop_reason ?? null;
    const lastError = this.lastError ?? latestRun?.error_summary ?? null;
    const errorCode = this.errorCode ?? latestRun?.error_code ?? null;
    const errorPhase = this.errorPhase;

    let resultStatus = "READY";
    if (this.isRunning) {
      resultStatus = "RUNNING";
    } else if (hasUnfinalized) {
      resultStatus = "PAUSED_RECOVERY_REQUIRED";
    } else if (stopReason === "PAUSED_RECOVERY_REQUIRED") {
      resultStatus = "RECOVERY_RESOLVED";
    } else if (this.hasExecutedRunInProcess && (lastError || stopReason === "INFRASTRUCTURE_FAILURE" || persistedStatus === "FAILED")) {
      // A fresh in-process failure: surface loudly as FAILED until resolved.
      resultStatus = "FAILED";
    } else if (lastError || stopReason === "INFRASTRUCTURE_FAILURE" || persistedStatus === "FAILED") {
      // A historical failure from a previous process must not keep re-painting the
      // UI as FAILED on every page load once its unknown items were resolved by
      // audited operator decisions; it becomes an acknowledged historical event.
      resultStatus = "RECOVERY_RESOLVED";
    } else if (
      stopReason === "USER_STOPPED" ||
      stopReason === "RUN_BUDGET_EXHAUSTED" ||
      stopReason === "EXECUTION_BUDGET_EXHAUSTED" ||
      stopReason === "READ_LOOP_THRESHOLD_REACHED" ||
      stopReason === "MODEL_RESPONSE_INVALID" ||
      stopReason === "NO_ACTIVE_MESSAGES" ||
      persistedStatus === "STOPPED"
    ) {
      resultStatus = "STOPPED";
    } else if (
      stopReason === "ROUND_LIMIT_REACHED" ||
      stopReason === "MESSAGE_LIMIT_REACHED" ||
      persistedStatus === "COMPLETED"
    ) {
      resultStatus = "COMPLETED";
    } else if (stopReason) {
      resultStatus = stopReason;
    }

    const lastCompletedRound = this.getWorldRound();

    return {
      running: this.isRunning,
      run_id: this.currentRunId ?? latestRun?.run_id ?? null,
      current_loop: this.currentRunId ?? latestRun?.run_id ?? null,
      current_run: this.currentRunId ?? latestRun?.run_id ?? null,
      current_round: lastCompletedRound,
      last_completed_round: lastCompletedRound,
      executing_round: this.isRunning ? this.currentRound : null,
      requested_rounds: this.requestedRounds,
      completed_rounds: this.completedRounds,
      messages_processed: this.messagesProcessed,
      model_calls_completed: modelCallsCount,
      idle_rounds: this.idleRounds,
      stop_requested: Boolean(this.abortController?.signal?.aborted),
      stop_reason: stopReason,
      last_error: lastError,
      error_code: errorCode,
      error_summary: lastError,
      error_phase: errorPhase,
      result_status: resultStatus,
      is_mock_mode: this.isMockMode,
      unfinalized_operations: hasUnfinalized ? unfinalized : null,
    };
  }

  public async start(options: RunStartOptions): Promise<any> {
    if (!this.isModelConfigured && !this.isMockMode) {
      throw new Error(
        "MODEL_NOT_CONFIGURED: Valid MCL_API_KEY is not configured. Set environment variable or start server with --mock for sandbox testing."
      );
    }

    if (!Number.isSafeInteger(options.rounds) || options.rounds <= 0) {
      throw new Error("rounds must be a positive integer.");
    }
    if (!Number.isSafeInteger(options.runBudgetTokens) || options.runBudgetTokens <= 0) {
      throw new Error("run_budget_tokens must be positive.");
    }

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const currentWorldRound = this.getWorldRound();
    const executionId = options.executionId ?? null;
    if (executionId && !options.onRunCreated) {
      throw new Error("EXECUTION_RUN_REQUIRES_INTERNAL_START_HOOK");
    }
    const execution = executionId ? this.store.executions.get(executionId) : null;
    if (executionId && !execution) throw new Error("EXECUTION_NOT_FOUND");
    if (execution && !["ready", "blocked", "awaiting_review"].includes(execution.status)) {
      throw new Error(`EXECUTION_NOT_STARTABLE:${execution.status}`);
    }
    if (execution && options.rounds > execution.roundsLimit - execution.roundsUsed) {
      throw new Error("EXECUTION_ROUND_LIMIT_EXCEEDED");
    }
    const startRound = currentWorldRound + (execution?.roundsUsed ?? 0) + 1;
    const endRound = startRound + options.rounds - 1;

    // 数据库事务是唯一的 Run 互斥点：检查旧未决状态并创建新 Run 必须原子完成。
    const genesisPrompt = this.promptService?.getPrompt("genesis_prompt.json");
    const genesisRevision = genesisPrompt?.revision || 1;
    this.store.transaction(() => {
      const unfinalized = this.store.getUnfinalizedOperations();
      if (unfinalized.hasUnfinalized) {
        this.lastStopReason = "PAUSED_RECOVERY_REQUIRED";
        throw new Error(
          `RUN_BLOCKED_UNFINALIZED_OPERATIONS: Detected unfinalized operations in store. Manual confirmation or safe reconciliation required. ` +
          `Summary: reservations=${unfinalized.unsettledReservations.length}, unknownCalls=${unfinalized.unknownCalls.length}, callingMessages=${unfinalized.callingMessages.length}`
        );
      }
      this.store.runs.createRun({
        run_id: runId,
        execution_id: executionId,
        start_round: startRound,
        end_round: endRound,
        run_limit: options.runBudgetTokens,
        run_spent: 0,
        run_reserved: 0,
        genesis_revision: genesisRevision,
        status: "RUNNING",
        created_at: Date.now() / 1000,
      });
      if (options.onRunCreated) options.onRunCreated(runId);
      this.store.messages.resetWaitingRunBudgetMessages(executionId);
    });
    if (executionId && options.onRunFinalized) this.executionFinalizers.set(runId, options.onRunFinalized);

    this.currentRunId = runId;
    this.currentExecutionId = executionId;
    this.isRunning = true;
    this.requestedRounds = options.rounds;
    this.completedRounds = 0;
    this.messagesProcessed = 0;
    this.idleRounds = 0;
    this.currentRound = currentWorldRound;
    this.lastStopReason = null;
    this.lastError = null;
    this.errorCode = null;
    this.errorPhase = null;
    this.abortController = new AbortController();

    // Control-plane rounds never enqueue agent messages; use per-Pixel Mandate.

    // 异步执行轮次调度，不阻塞 HTTP 响应
    this.runLoop(runId, startRound, endRound, this.abortController.signal, executionId).catch((err) => {
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

  public reconcile(): { status: string; reconciled: any } {
    if (this.isRunning) {
      throw new Error("Cannot reconcile while run is in progress.");
    }
    const res = this.store.reconcileUnfinalizedOperations();
    return {
      status: "REVIEW_REQUIRED",
      reconciled: res,
    };
  }

  private async runLoop(
    runId: string,
    startRound: number,
    endRound: number,
    signal: AbortSignal,
    executionId: string | null
  ): Promise<void> {
    try {
      for (let r = startRound; r <= endRound; r++) {
        if (signal.aborted) {
          this.lastStopReason = "USER_STOPPED";
          break;
        }

        this.currentRound = r;
        if (executionId) this.store.executions.beginScopeRound(executionId, runId, r);
        const summary: RoundSummary = await this.scheduler.executeRound(r, runId, signal, executionId);

        const diagnostic = summary as RoundSummary & { errorCode?: string; errorSummary?: string; errorPhase?: string };
        if (diagnostic.errorCode) this.errorCode = diagnostic.errorCode;
        if (diagnostic.errorSummary) this.lastError = diagnostic.errorSummary;
        if (diagnostic.errorPhase) this.errorPhase = diagnostic.errorPhase;

        // 如果本轮遭遇基础设施失败或被主动中断，不可计入完成轮次，不可推进世界轮次
        if (summary.stopReason === "INFRASTRUCTURE_FAILURE" || summary.stopReason === "PAUSED_RECOVERY_REQUIRED" || signal.aborted) {
          this.lastStopReason = signal.aborted ? "USER_STOPPED" : summary.stopReason!;
          break;
        }

        this.completedRounds++;
        this.messagesProcessed += summary.messagesProcessed;
        if (summary.messagesProcessed === 0) {
          this.idleRounds++;
        }

        // 仅在整轮完整成功执行后，才推进持久化的绝对世界轮次
        if (!executionId) this.updateWorldRound(r);

        if (summary.stopReason) {
          this.lastStopReason = summary.stopReason;
          break;
        }
      }

      const isStopped =
        signal.aborted ||
        this.lastStopReason === "USER_STOPPED" ||
        this.lastStopReason === "RUN_BUDGET_EXHAUSTED" ||
        this.lastStopReason === "EXECUTION_BUDGET_EXHAUSTED" ||
        this.lastStopReason === "READ_LOOP_THRESHOLD_REACHED" ||
        this.lastStopReason === "MODEL_RESPONSE_INVALID" ||
        this.lastStopReason === "NO_ACTIVE_MESSAGES";
      const isFailed = this.lastStopReason === "INFRASTRUCTURE_FAILURE";
      const finalStatus = isFailed ? "FAILED" : (isStopped || this.lastStopReason === "PAUSED_RECOVERY_REQUIRED") ? "STOPPED" : "COMPLETED";
      const finalReason = this.lastStopReason || (signal.aborted ? "USER_STOPPED" : "ROUND_LIMIT_REACHED");

      this.lastStopReason = finalReason;
      this.store.runs.updateRunStatus(runId, finalStatus, finalReason as any, this.errorCode, this.lastError);
      this.finalizeExecutionRun(executionId, finalReason);
      this.notifyExecutionFinalized(runId, executionId, finalReason);
    } catch (err: any) {
      this.lastError = err.summary || err.message || String(err);
      this.errorCode = err.code || "INFRASTRUCTURE_FAILURE";
      this.errorPhase = err.phase || null;
      this.lastStopReason = "INFRASTRUCTURE_FAILURE";
      this.store.runs.updateRunStatus(runId, "FAILED", "INFRASTRUCTURE_FAILURE", this.errorCode, this.lastError);
      this.finalizeExecutionRun(executionId, this.lastStopReason);
      this.notifyExecutionFinalized(runId, executionId, this.lastStopReason);
    } finally {
      this.isRunning = false;
      this.abortController = null;
      // Marks that this process has executed a run loop, so status reporting can
      // tell a fresh in-process failure apart from a restarted historical record.
      this.hasExecutedRunInProcess = true;
    }
  }

  private finalizeExecutionRun(executionId: string | null, reason: string | null): void {
    if (!executionId) return;
    const execution = this.store.executions.get(executionId);
    if (!execution || execution.status !== "running") return;
    const unresolved = this.store.db.prepare(`SELECT
        (SELECT COUNT(*) FROM reservations WHERE execution_id=? AND status='OPEN') +
        (SELECT COUNT(*) FROM messages WHERE execution_id=? AND status IN ('PROCESSING','RESERVED','CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT')) +
        (SELECT COUNT(*) FROM model_calls WHERE execution_id=? AND outcome='CALL_OUTCOME_UNKNOWN') AS count`)
      .get(executionId, executionId, executionId) as any;
    let overBudget = execution.spentTokens + execution.reservedTokens > execution.budgetTokens;
    if (execution.kind === "trial_candidate") {
      const trialBudget = this.store.db.prepare(`SELECT t.total_budget_tokens,
          COALESCE(SUM(e.spent_tokens + e.reserved_tokens), 0) AS used_tokens
        FROM trials t LEFT JOIN executions e ON e.kind='trial_candidate' AND e.subject_id=t.trial_id
        WHERE t.trial_id=? GROUP BY t.trial_id`).get(execution.subjectId) as any;
      overBudget = overBudget || Boolean(trialBudget && Number(trialBudget.used_tokens) > Number(trialBudget.total_budget_tokens));
    }
    const blocked = overBudget || Number(unresolved?.count ?? 0) > 0 ||
      ["CALL_OUTCOME_UNKNOWN", "TOOL_OUTCOME_UNKNOWN", "PAUSED_RECOVERY_REQUIRED"].includes(reason || "");
    this.store.executions.transition(executionId, "running", blocked ? "blocked" : "awaiting_review");
  }

  private notifyExecutionFinalized(runId: string, executionId: string | null, reason: string | null): void {
    if (!executionId) return;
    const callback = this.executionFinalizers.get(runId);
    this.executionFinalizers.delete(runId);
    if (!callback) return;
    const status = this.store.executions.get(executionId)?.status;
    if (status !== "awaiting_review" && status !== "blocked") return;
    try {
      callback(runId, executionId, status, reason ?? "RUN_FINISHED");
    } catch (error) {
      // A notification error must not rewrite an already-finalized Run or hide its ledger state.
      console.error(`[RunService] Scoped finalization callback failed for ${executionId}:`, error);
    }
  }
}
