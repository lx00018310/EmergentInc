import { randomUUID } from "node:crypto";
import { Execution, ExecutionEvidence, ExecutionKind, ExecutionStatus } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";

export interface CreateExecutionInput {
  executionId?: string;
  kind: ExecutionKind;
  subjectId: string;
  budgetTokens: number;
  roundsLimit: number;
  inputSnapshot: Record<string, unknown>;
  toolsSnapshot: string[];
  bindingIds: string[];
  createdAt?: number;
}

export class ExecutionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public create(input: CreateExecutionInput): Execution {
    if (!input.subjectId.trim() || !Number.isSafeInteger(input.budgetTokens) || input.budgetTokens < 1 ||
        !Number.isSafeInteger(input.roundsLimit) || input.roundsLimit < 1 || input.bindingIds.length < 1 ||
        new Set(input.bindingIds).size !== input.bindingIds.length) throw new Error("EXECUTION_FIELDS_INVALID");
    const executionId = input.executionId ?? `execution_${randomUUID()}`;
    const createdAt = input.createdAt ?? Date.now() / 1000;
    return this.db.transaction(() => {
      this.db.prepare(`INSERT INTO executions(execution_id, kind, subject_id, budget_tokens, spent_tokens, reserved_tokens,
        rounds_limit, rounds_used, status, input_snapshot_json, tools_snapshot_json, created_at)
        VALUES (?, ?, ?, ?, 0, 0, ?, 0, 'ready', ?, ?, ?)`)
        .run(executionId, input.kind, input.subjectId, input.budgetTokens, input.roundsLimit,
          JSON.stringify(input.inputSnapshot), JSON.stringify(input.toolsSnapshot), createdAt);
      const insert = this.db.prepare("INSERT INTO execution_participants(execution_id, binding_id, released_at) VALUES (?, ?, NULL)");
      for (const bindingId of input.bindingIds) insert.run(executionId, bindingId);
      return this.get(executionId)!;
    });
  }

  public get(id: string): Execution | null {
    const row = this.db.prepare("SELECT * FROM executions WHERE execution_id=?").get(id) as any;
    if (!row) return null;
    const participants = this.db.prepare(`SELECT execution_id AS executionId, binding_id AS bindingId, released_at AS releasedAt
      FROM execution_participants WHERE execution_id=? ORDER BY binding_id`).all(id) as any[];
    return { executionId: String(row.execution_id), kind: row.kind, subjectId: String(row.subject_id),
      budgetTokens: Number(row.budget_tokens), spentTokens: Number(row.spent_tokens), reservedTokens: Number(row.reserved_tokens),
      roundsLimit: Number(row.rounds_limit), roundsUsed: Number(row.rounds_used), status: row.status,
      inputSnapshot: JSON.parse(String(row.input_snapshot_json)), toolsSnapshot: JSON.parse(String(row.tools_snapshot_json)),
      createdAt: Number(row.created_at), participants: participants.map(item => ({ ...item,
        releasedAt: item.releasedAt == null ? null : Number(item.releasedAt) })) };
  }

  public listBySubject(kind: ExecutionKind, subjectId: string): Execution[] {
    const rows = this.db.prepare("SELECT execution_id FROM executions WHERE kind=? AND subject_id=? ORDER BY created_at, execution_id")
      .all(kind, subjectId) as any[];
    return rows.map(row => this.get(String(row.execution_id))!).filter(Boolean);
  }

  public listEligibleMembers(executionId: string): Array<{ pixelId: string; bindingId: string; qianjiId: string; careerStatus: string }> {
    return (this.db.prepare(`SELECT b.pixel_id AS pixelId, b.binding_id AS bindingId,
        q.qianji_id AS qianjiId, q.career_status AS careerStatus
      FROM execution_participants ep
      JOIN qianji_bindings b ON b.binding_id=ep.binding_id AND b.unbound_at IS NULL
      JOIN qianji_profiles q ON q.qianji_id=b.qianji_id
      JOIN pixel_accounts p ON p.pixel_id=b.pixel_id AND p.active=1
      JOIN executions e ON e.execution_id=ep.execution_id AND e.status='running'
      WHERE ep.execution_id=? AND ep.released_at IS NULL
      ORDER BY b.pixel_id`).all(executionId) as any[])
      .map(row => ({ pixelId: String(row.pixelId), bindingId: String(row.bindingId),
        qianjiId: String(row.qianjiId), careerStatus: String(row.careerStatus) }));
  }

  public isWorldPixelEligible(pixelId: string): boolean {
    const row = this.db.prepare(`SELECT 1 AS eligible
      WHERE NOT EXISTS (
        SELECT 1 FROM qianji_bindings b JOIN qianji_profiles q ON q.qianji_id=b.qianji_id
        WHERE b.pixel_id=? AND b.unbound_at IS NULL AND q.career_status <> 'active'
      ) AND NOT EXISTS (
        SELECT 1 FROM execution_participants ep
        JOIN executions e ON e.execution_id=ep.execution_id
        JOIN qianji_bindings b ON b.binding_id=ep.binding_id
        WHERE b.pixel_id=? AND ep.released_at IS NULL AND e.status <> 'closed'
      )`).get(pixelId, pixelId) as any;
    return Boolean(row);
  }

  public getOpenExecutionForBinding(bindingId: string): Execution | null {
    const row = this.db.prepare(`SELECT e.execution_id FROM execution_participants ep
      JOIN executions e ON e.execution_id=ep.execution_id
      WHERE ep.binding_id=? AND ep.released_at IS NULL AND e.status <> 'closed'
      ORDER BY e.created_at DESC LIMIT 1`).get(bindingId) as any;
    return row ? this.get(String(row.execution_id)) : null;
  }

  public isParticipant(executionId: string, bindingId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM execution_participants
      WHERE execution_id=? AND binding_id=? AND released_at IS NULL`).get(executionId, bindingId));
  }

  /** Count an actually started scoped round exactly once for this Run. */
  public beginScopeRound(executionId: string, runId: string, round: number): number {
    return this.db.transaction(() => {
      const run = this.db.prepare("SELECT execution_id, last_scope_round FROM runs WHERE run_id=?").get(runId) as any;
      if (!run || run.execution_id !== executionId) throw new Error("EXECUTION_RUN_SCOPE_MISMATCH");
      if (run.last_scope_round != null && Number(run.last_scope_round) === round) {
        const execution = this.db.prepare("SELECT rounds_used FROM executions WHERE execution_id=?").get(executionId) as any;
        if (!execution) throw new Error("EXECUTION_NOT_FOUND");
        return Number(execution.rounds_used);
      }
      if (run.last_scope_round != null && Number(run.last_scope_round) > round) throw new Error("EXECUTION_ROUND_ALREADY_COUNTED");
      const updated = this.db.prepare(`UPDATE executions SET rounds_used=rounds_used+1
        WHERE execution_id=? AND status='running' AND rounds_used<rounds_limit`).run(executionId);
      if (Number(updated.changes) !== 1) throw new Error("EXECUTION_ROUND_LIMIT_REACHED");
      this.db.prepare("UPDATE runs SET last_scope_round=? WHERE run_id=? AND execution_id=?")
        .run(round, runId, executionId);
      const execution = this.db.prepare("SELECT rounds_used FROM executions WHERE execution_id=?").get(executionId) as any;
      return Number(execution.rounds_used);
    });
  }

  public transition(id: string, expected: ExecutionStatus, next: ExecutionStatus): Execution {
    return this.db.transaction(() => {
      const result = this.db.prepare("UPDATE executions SET status=? WHERE execution_id=? AND status=?").run(next, id, expected);
      if (Number(result.changes) !== 1) throw new Error("EXECUTION_STATUS_CONFLICT");
      return this.get(id)!;
    });
  }

  public reserveTokens(id: string, amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 1) throw new Error("EXECUTION_RESERVATION_INVALID");
    const result = this.db.prepare(`UPDATE executions SET reserved_tokens=reserved_tokens+?
      WHERE execution_id=? AND status='running' AND spent_tokens+reserved_tokens+?<=budget_tokens`)
      .run(amount, id, amount);
    if (Number(result.changes) !== 1) throw new Error("EXECUTION_BUDGET_EXCEEDED");
  }

  public settleTokens(id: string, reservedDelta: number, spentDelta: number): void {
    if (!Number.isSafeInteger(reservedDelta) || !Number.isSafeInteger(spentDelta) || spentDelta < 0) {
      throw new Error("EXECUTION_SETTLEMENT_INVALID");
    }
    const result = this.db.prepare(`UPDATE executions SET reserved_tokens=reserved_tokens+?, spent_tokens=spent_tokens+?
      WHERE execution_id=? AND reserved_tokens+?>=0`).run(reservedDelta, spentDelta, id, reservedDelta);
    if (Number(result.changes) !== 1) throw new Error("EXECUTION_NOT_FOUND_OR_RESERVATION_INVALID");
  }

  public startNextRound(id: string): number {
    const result = this.db.prepare(`UPDATE executions SET rounds_used=rounds_used+1
      WHERE execution_id=? AND status='running' AND rounds_used<rounds_limit`).run(id);
    if (Number(result.changes) !== 1) throw new Error("EXECUTION_ROUND_LIMIT_REACHED");
    const row = this.db.prepare("SELECT rounds_used FROM executions WHERE execution_id=?").get(id) as any;
    return Number(row.rounds_used);
  }

  public releaseParticipants(id: string, releasedAt = Date.now() / 1000): void {
    return this.db.transaction(() => {
      const execution = this.db.prepare("SELECT status, reserved_tokens FROM executions WHERE execution_id=?").get(id) as any;
      if (!execution) throw new Error("EXECUTION_NOT_FOUND");
      if (execution.status !== "closed" || Number(execution.reserved_tokens) !== 0) throw new Error("EXECUTION_NOT_SETTLED");
      this.db.prepare("UPDATE execution_participants SET released_at=? WHERE execution_id=? AND released_at IS NULL").run(releasedAt, id);
    });
  }

  public addEvidence(input: Omit<ExecutionEvidence, "evidenceId" | "createdAt"> & { evidenceId?: string; createdAt?: number }): ExecutionEvidence {
    if (!input.bindingId || !input.evidenceType.trim() || (input.sizeBytes != null && (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0))) {
      throw new Error("EXECUTION_EVIDENCE_INVALID");
    }
    const evidenceId = input.evidenceId ?? `evidence_${randomUUID()}`;
    const createdAt = input.createdAt ?? Date.now() / 1000;
    this.db.prepare(`INSERT INTO execution_evidence(evidence_id, execution_id, binding_id, operation_id, relative_path,
      sha256, size_bytes, evidence_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(evidenceId, input.executionId, input.bindingId, input.operationId, input.relativePath,
        input.sha256, input.sizeBytes, input.evidenceType, createdAt);
    return { ...input, evidenceId, createdAt };
  }

  public listEvidence(id: string): ExecutionEvidence[] {
    return (this.db.prepare("SELECT * FROM execution_evidence WHERE execution_id=? ORDER BY created_at, evidence_id").all(id) as any[])
      .map(row => ({ evidenceId: String(row.evidence_id), executionId: String(row.execution_id),
        bindingId: String(row.binding_id), operationId: row.operation_id ?? null, relativePath: row.relative_path ?? null,
        sha256: row.sha256 ?? null, sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
        evidenceType: String(row.evidence_type), createdAt: Number(row.created_at) }));
  }
}
