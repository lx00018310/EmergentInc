import { randomUUID } from "node:crypto";
import { Mission, MissionParticipant, MissionStatus } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";
import { WorldEventRepository } from "./world_event_repository.js";

export interface MissionDraftInput {
  title: string;
  missionType: string;
  objective: string;
  acceptanceCriteria: string;
  budgetTokens: number;
  roundsLimit: number;
  deadlineRound?: number | null;
  ownerQianjiId: string;
  participants: Array<{ qianjiId: string; bindingId: string; duty?: string | null }>;
}

export class MissionRepository {
  constructor(private readonly db: SqliteDatabase, private readonly events: WorldEventRepository) {}

  public createDraft(input: MissionDraftInput, missionId = `mission_${randomUUID()}`): Mission {
    if (!Number.isSafeInteger(input.budgetTokens) || input.budgetTokens < 1 || !Number.isSafeInteger(input.roundsLimit) || input.roundsLimit < 1) throw new Error("MISSION_LIMITS_INVALID");
    if (input.deadlineRound != null && (!Number.isSafeInteger(input.deadlineRound) || input.deadlineRound < 1)) throw new Error("MISSION_DEADLINE_INVALID");
    if (!input.title.trim() || !input.missionType.trim() || !input.objective.trim() || !input.acceptanceCriteria.trim()) {
      throw new Error("MISSION_FIELDS_REQUIRED");
    }
    if (!input.ownerQianjiId.trim() || input.participants.length < 1) throw new Error("MISSION_PARTICIPANTS_REQUIRED");
    const now = Date.now() / 1000;
    return this.db.transaction(() => {
      this.db.prepare(`INSERT INTO missions
        (mission_id, title, mission_type, objective, acceptance_criteria, budget_tokens, rounds_limit,
         deadline_round, status, owner_qianji_id, acceptance_note, created_at, completed_at, execution_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, NULL, ?, NULL, NULL)`)
        .run(missionId, input.title.trim(), input.missionType.trim(), input.objective,
          input.acceptanceCriteria, input.budgetTokens, input.roundsLimit, input.deadlineRound ?? null,
          input.ownerQianjiId, now);
      const insert = this.db.prepare(`INSERT INTO mission_participants(mission_id, qianji_id, binding_id, duty)
        VALUES (?, ?, ?, ?)`);
      for (const participant of input.participants) {
        insert.run(missionId, participant.qianjiId, participant.bindingId, participant.duty ?? null);
      }
      return this.get(missionId)!;
    });
  }

  public updateDraft(missionId: string, input: MissionDraftInput): Mission {
    if (!Number.isSafeInteger(input.budgetTokens) || input.budgetTokens < 1 || !Number.isSafeInteger(input.roundsLimit) || input.roundsLimit < 1) throw new Error("MISSION_LIMITS_INVALID");
    if (input.deadlineRound != null && (!Number.isSafeInteger(input.deadlineRound) || input.deadlineRound < 1)) throw new Error("MISSION_DEADLINE_INVALID");
    if (!input.title.trim() || !input.missionType.trim() || !input.objective.trim() || !input.acceptanceCriteria.trim() ||
        !input.ownerQianjiId.trim() || input.participants.length < 1) throw new Error("MISSION_FIELDS_REQUIRED");
    return this.db.transaction(() => {
      const current = this.get(missionId);
      if (!current) throw new Error("MISSION_NOT_FOUND");
      if (current.status !== "draft") throw new Error("MISSION_NOT_DRAFT");
      this.db.prepare(`UPDATE missions SET title=?, mission_type=?, objective=?, acceptance_criteria=?,
        budget_tokens=?, rounds_limit=?, deadline_round=?, owner_qianji_id=? WHERE mission_id=? AND status='draft'`)
        .run(input.title.trim(), input.missionType.trim(), input.objective, input.acceptanceCriteria,
          input.budgetTokens, input.roundsLimit, input.deadlineRound ?? null, input.ownerQianjiId, missionId);
      this.db.prepare("DELETE FROM mission_participants WHERE mission_id = ?").run(missionId);
      const insert = this.db.prepare(`INSERT INTO mission_participants(mission_id, qianji_id, binding_id, duty)
        VALUES (?, ?, ?, ?)`);
      for (const participant of input.participants) {
        insert.run(missionId, participant.qianjiId, participant.bindingId, participant.duty ?? null);
      }
      return this.get(missionId)!;
    });
  }

  public get(missionId: string): Mission | null {
    const row = this.db.prepare("SELECT * FROM missions WHERE mission_id=?").get(missionId) as any;
    if (!row) return null;
    const participants = this.db.prepare(`SELECT mission_id AS missionId, qianji_id AS qianjiId,
      binding_id AS bindingId, duty FROM mission_participants WHERE mission_id=? ORDER BY qianji_id`)
      .all(missionId) as unknown as MissionParticipant[];
    return {
      missionId: String(row.mission_id), title: String(row.title), missionType: String(row.mission_type),
      objective: String(row.objective), acceptanceCriteria: String(row.acceptance_criteria),
      budgetTokens: Number(row.budget_tokens), roundsLimit: Number(row.rounds_limit),
      deadlineRound: row.deadline_round == null ? null : Number(row.deadline_round), status: row.status,
      ownerQianjiId: String(row.owner_qianji_id), acceptanceNote: row.acceptance_note ?? null,
      createdAt: Number(row.created_at), completedAt: row.completed_at == null ? null : Number(row.completed_at),
      executionId: row.execution_id ?? null, participants,
    };
  }

  public list(options: { status?: MissionStatus; limit?: number; before?: { createdAt: number; missionId: string } } = {}): Mission[] {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("MISSION_LIMIT_INVALID");
    const clauses: string[] = [];
    const args: Array<string | number> = [];
    if (options.status) { clauses.push("status=?"); args.push(options.status); }
    if (options.before) { clauses.push("(created_at < ? OR (created_at = ? AND mission_id < ?))"); args.push(options.before.createdAt, options.before.createdAt, options.before.missionId); }
    const rows = this.db.prepare(`SELECT mission_id FROM missions ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY created_at DESC, mission_id DESC LIMIT ?`).all(...args, limit) as any[];
    return rows.map(row => this.get(String(row.mission_id))!).filter(Boolean);
  }

  public setExecution(missionId: string, executionId: string): void {
    const result = this.db.prepare("UPDATE missions SET execution_id=? WHERE mission_id=? AND status='draft'")
      .run(executionId, missionId);
    if (Number(result.changes) !== 1) throw new Error("MISSION_NOT_DRAFT");
  }

  public transition(missionId: string, expected: MissionStatus, next: MissionStatus, details: Record<string, unknown> = {}): Mission {
    return this.db.transaction(() => {
      const current = this.get(missionId);
      if (!current) throw new Error("MISSION_NOT_FOUND");
      if (current.status !== expected) throw new Error("MISSION_STATUS_CONFLICT");
      const now = Date.now() / 1000;
      const completedAt = ["completed", "failed", "cancelled"].includes(next) ? now : null;
      const result = this.db.prepare(`UPDATE missions SET status=?, completed_at=COALESCE(?, completed_at)
        WHERE mission_id=? AND status=?`).run(next, completedAt, missionId, expected);
      if (Number(result.changes) !== 1) throw new Error("MISSION_STATUS_CONFLICT");
      const eventType = next === "draft" ? null : ({
        issued: "MISSION_ISSUED", running: "MISSION_STARTED", awaiting_acceptance: "MISSION_AWAITING_ACCEPTANCE",
        completed: "MISSION_COMPLETED", failed: "MISSION_FAILED", cancelled: "MISSION_CANCELLED",
      } as const)[next];
      if (eventType) this.events.append({ eventType, subjectType: "mission", subjectId: missionId,
        qianjiId: current.ownerQianjiId, sourceKey: `mission:${missionId}:${eventType.toLowerCase()}`,
        payload: details, createdAt: now });
      return this.get(missionId)!;
    });
  }

  public setAcceptance(missionId: string, note: string): void {
    const result = this.db.prepare("UPDATE missions SET acceptance_note=? WHERE mission_id=? AND status='awaiting_acceptance'")
      .run(note, missionId);
    if (Number(result.changes) !== 1) throw new Error("MISSION_NOT_AWAITING_ACCEPTANCE");
  }
}
