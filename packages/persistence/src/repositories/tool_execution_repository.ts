import { SqliteDatabase } from "../sqlite/db.js";
import { ToolExecutionStatus } from "@emergentinc/protocol";

export interface ToolExecutionRecord {
  operation_id: string;
  run_id?: string | null;
  message_id: string;
  pixel_id: string;
  op_index: number;
  tool: string;
  args_hash: string;
  status: ToolExecutionStatus;
  result?: string | null;
  cost_cny?: number | null;
  model_call_id?: string | null;
  started_at: number;
  finished_at?: number | null;
}

export class ToolExecutionRepository {
  constructor(private db: SqliteDatabase) {}

  public recordStarted(record: Omit<ToolExecutionRecord, "status" | "finished_at">): void {
    const stmt = this.db.prepare(`
      INSERT INTO tool_executions (
        operation_id, run_id, message_id, pixel_id, op_index, tool, args_hash, status, started_at, model_call_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'STARTED', ?, ?)
      ON CONFLICT(operation_id) DO NOTHING
    `);

    stmt.run(
      record.operation_id,
      record.run_id ?? null,
      record.message_id,
      record.pixel_id,
      record.op_index,
      record.tool,
      record.args_hash,
      record.started_at,
      record.model_call_id ?? null
    );
  }

  public recordFinished(params: {
    operationId: string;
    status: ToolExecutionStatus;
    result: string;
    finishedAt: number;
    costCny?: number | null;
  }): void {
    const stmt = this.db.prepare(`
      UPDATE tool_executions
      SET status = ?, result = ?, finished_at = ?, cost_cny = ?
      WHERE operation_id = ?
    `);
    const cost = params.costCny;
    stmt.run(params.status, params.result, params.finishedAt,
      typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null,
      params.operationId);
  }

  public getExecution(operationId: string): ToolExecutionRecord | null {
    const stmt = this.db.prepare("SELECT * FROM tool_executions WHERE operation_id = ?");
    return (stmt.get(operationId) as unknown as ToolExecutionRecord) ?? null;
  }
}
