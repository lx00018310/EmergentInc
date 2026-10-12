import { SqliteDatabase } from "../sqlite/db.js";
import { RunStatus, StopReason } from "@emergentinc/protocol";

export interface RunRecord {
  run_id: string;
  execution_id?: string | null;
  last_scope_round?: number | null;
  loop_id?: string | null;
  branch_name?: string | null;
  start_round: number;
  end_round?: number | null;
  run_limit: number;
  run_spent: number;
  run_reserved: number;
  /** 旧版字段，仅保留历史记录；新 Run 写入 0。 */
  global_limit?: number;
  global_spent?: number;
  global_reserved?: number;
  genesis_revision: number;
  genesis_hash?: string | null;
  pricing_revision?: string | null;
  status: RunStatus;
  stop_reason?: StopReason | null;
  error_code?: string | null;
  error_summary?: string | null;
  created_at: number;
  finished_at?: number | null;
}

export class RunRepository {
  constructor(private db: SqliteDatabase) {}

  public createCheckpoint(runId: string, nextRound: number): void {
    this.db.prepare("INSERT INTO run_checkpoints(run_id,next_round) VALUES(?,?)").run(runId, nextRound);
  }

  public getCheckpoint(runId: string): RunCheckpoint | null {
    return (this.db.prepare("SELECT * FROM run_checkpoints WHERE run_id=?").get(runId) as unknown as RunCheckpoint) ?? null;
  }

  public setResumePending(runId: string, pending: boolean): void {
    this.db.prepare("UPDATE run_checkpoints SET resume_pending=? WHERE run_id=?").run(pending ? 1 : 0, runId);
  }

  public completeRound(runId: string, round: number, messages: number): void {
    this.db.prepare(`UPDATE run_checkpoints SET next_round=?,round_started=0,round_messages=0,
      completed_rounds=completed_rounds+1,messages_processed=messages_processed+?,idle_rounds=idle_rounds+?
      WHERE run_id=? AND next_round=?`).run(round + 1, messages, messages === 0 ? 1 : 0, runId, round);
  }

  public getWorldRound(): number | null {
    const row = this.db.prepare(`SELECT MAX(c.next_round-1) AS round FROM run_checkpoints c
      JOIN runs r USING(run_id) WHERE r.execution_id IS NULL`).get() as any;
    return row?.round == null ? null : Number(row.round);
  }

  public createRun(run: RunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (
        run_id, execution_id, last_scope_round, loop_id, branch_name, start_round, end_round,
        run_limit, run_spent, run_reserved, global_limit, global_spent, global_reserved,
        genesis_revision, genesis_hash, pricing_revision, status, stop_reason, created_at, finished_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      run.run_id,
      run.execution_id ?? null,
      run.last_scope_round ?? null,
      run.loop_id ?? null,
      run.branch_name ?? null,
      run.start_round,
      run.end_round ?? null,
      run.run_limit,
      run.run_spent,
      run.run_reserved,
      run.global_limit ?? 0,
      run.global_spent ?? 0,
      run.global_reserved ?? 0,
      run.genesis_revision,
      run.genesis_hash ?? null,
      run.pricing_revision ?? null,
      run.status,
      run.stop_reason ?? null,
      run.created_at,
      run.finished_at ?? null
    );
  }

  public getRun(runId: string): RunRecord | null {
    const stmt = this.db.prepare("SELECT * FROM runs WHERE run_id = ?");
    return (stmt.get(runId) as unknown as RunRecord) ?? null;
  }

  public getActiveRun(): RunRecord | null {
    const stmt = this.db.prepare("SELECT * FROM runs WHERE status = 'RUNNING' ORDER BY created_at DESC, rowid DESC LIMIT 1");
    return (stmt.get() as unknown as RunRecord) ?? null;
  }

  public getLatestRun(): RunRecord | null {
    const stmt = this.db.prepare("SELECT * FROM runs ORDER BY created_at DESC, rowid DESC LIMIT 1");
    return (stmt.get() as unknown as RunRecord) ?? null;
  }

  public updateRunStatus(runId: string, status: RunStatus, stopReason?: StopReason | null, errorCode?: string | null, errorSummary?: string | null): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = ?, stop_reason = COALESCE(?, stop_reason), error_code = COALESCE(?, error_code),
          error_summary = COALESCE(?, error_summary), finished_at = ?
      WHERE run_id = ?
    `);
    stmt.run(status, stopReason ?? null, errorCode ?? null, errorSummary ?? null, now, runId);
  }

  public updateRunBudget(runId: string, spentDelta: number, reservedDelta: number): void {
    const stmt = this.db.prepare(`
      UPDATE runs 
      SET run_spent = run_spent + ?, run_reserved = run_reserved + ?
      WHERE run_id = ?
    `);
    stmt.run(spentDelta, reservedDelta, runId);
  }
}

export interface RunCheckpoint {
  run_id: string;
  next_round: number;
  round_started: number;
  round_messages: number;
  completed_rounds: number;
  messages_processed: number;
  idle_rounds: number;
  resume_pending: number;
}
