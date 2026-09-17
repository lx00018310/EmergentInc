import { CoreStore } from "@emergentinc/persistence";
import { RoundScheduler, RoundSummary } from "@emergentinc/runtime";

export interface RunStartOptions {
  rounds: number;
  commandText?: string;
  runBudgetTokens: number;
  globalBudgetTokens: number;
}

export class RunService {
  private isRunning: boolean = false;
  private currentRunId: string | null = null;
  private currentRound: number = 0;
  private abortController: AbortController | null = null;
  private lastStopReason: string | null = null;

  constructor(
    private store: CoreStore,
    private scheduler: RoundScheduler
  ) {}

  public getStatus(): any {
    return {
      running: this.isRunning,
      current_loop: this.currentRunId,
      current_round: this.currentRound,
      last_stop_reason: this.lastStopReason,
    };
  }

  public async start(options: RunStartOptions): Promise<any> {
    if (this.isRunning) {
      throw new Error("Run is already in progress.");
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

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    this.currentRunId = runId;
    this.isRunning = true;
    this.lastStopReason = null;
    this.abortController = new AbortController();

    // 记录 Run 实体
    this.store.runs.createRun({
      run_id: runId,
      start_round: 1,
      end_round: options.rounds,
      run_limit: options.runBudgetTokens,
      run_spent: 0,
      run_reserved: 0,
      global_limit: options.globalBudgetTokens,
      global_spent: 0,
      global_reserved: 0,
      genesis_revision: 1,
      status: "RUNNING",
      created_at: Date.now() / 1000,
    });

    // 异步执行轮次调度，不阻塞 HTTP 响应
    this.runLoop(runId, options.rounds, this.abortController.signal).catch((err) => {
      console.error(`Run ${runId} execution encountered an error:`, err);
    });

    return {
      status: "STARTED",
      run_id: runId,
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

  private async runLoop(runId: string, maxRounds: number, signal: AbortSignal): Promise<void> {
    try {
      for (let r = 1; r <= maxRounds; r++) {
        if (signal.aborted) {
          this.lastStopReason = "USER_STOPPED";
          break;
        }

        this.currentRound = r;
        const summary: RoundSummary = await this.scheduler.executeRound(r, runId, signal);

        if (summary.stopReason) {
          this.lastStopReason = summary.stopReason;
          break;
        }
      }

      const finalReason = this.lastStopReason || (signal.aborted ? "USER_STOPPED" : "ROUND_LIMIT_REACHED");
      this.store.runs.updateRunStatus(runId, signal.aborted ? "STOPPED" : "COMPLETED", finalReason as any);
    } catch (err: any) {
      this.lastStopReason = "INFRASTRUCTURE_FAILURE";
      this.store.runs.updateRunStatus(runId, "FAILED", "INFRASTRUCTURE_FAILURE");
    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }
}
