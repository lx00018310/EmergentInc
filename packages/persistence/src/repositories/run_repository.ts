import { SqliteDatabase } from "../sqlite/db.js";
import { RunStatus, StopReason } from "@emergentinc/protocol";

export interface RunRecord {
  run_id: string;
  loop_id?: string | null;
  branch_name?: string | null;
  start_round: number;
  end_round?: number | null;
  run_limit: number;
  run_spent: number;
  run_reserved: number;
  global_limit: number;
  global_spent: number;
  global_reserved: number;
  genesis_revision: number;
  genesis_hash?: string | null;
  pricing_revision?: string | null;
  status: RunStatus;
  stop_reason?: StopReason | null;
  created_at: number;
  finished_at?: number | null;
}

export class RunRepository {
  constructor(private db: SqliteDatabase) {}

  public createRun(run: RunRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO runs (
        run_id, loop_id, branch_name, start_round, end_round,
        run_limit, run_spent, run_reserved, global_limit, global_spent, global_reserved,
        genesis_revision, genesis_hash, pricing_revision, status, stop_reason, created_at, finished_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      run.run_id,
      run.loop_id ?? null,
      run.branch_name ?? null,
      run.start_round,
      run.end_round ?? null,
      run.run_limit,
      run.run_spent,
      run.run_reserved,
      run.global_limit,
      run.global_spent,
      run.global_reserved,
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
    const stmt = this.db.prepare("SELECT * FROM runs WHERE status = 'RUNNING' ORDER BY created_at DESC LIMIT 1");
    return (stmt.get() as unknown as RunRecord) ?? null;
  }

  public updateRunStatus(runId: string, status: RunStatus, stopReason?: StopReason | null): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE runs 
      SET status = ?, stop_reason = COALESCE(?, stop_reason), finished_at = ?
      WHERE run_id = ?
    `);
    stmt.run(status, stopReason ?? null, now, runId);
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
