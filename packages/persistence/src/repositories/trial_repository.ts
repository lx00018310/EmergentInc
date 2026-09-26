import { randomUUID } from "node:crypto";
import { Recruitment, Trial, TrialCandidate, TrialStatus } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";
import { WorldEventRepository } from "./world_event_repository.js";

export interface TrialDraftInput {
  recruitmentId?: string | null;
  challengeText: string;
  acceptanceCriteria: string;
  totalBudgetTokens: number;
  roundsPerCandidate: number;
  candidateBudgetTokens: number;
  allowedTools: string[];
  modelName: string;
}

export class TrialRepository {
  constructor(private readonly db: SqliteDatabase, private readonly events: WorldEventRepository) {}

  public createRecruitment(roleLabel: string, jd: string, recruitmentId = `recruitment_${randomUUID()}`): Recruitment {
    if (!roleLabel.trim() || !jd.trim()) throw new Error("RECRUITMENT_FIELDS_REQUIRED");
    const createdAt = Date.now() / 1000;
    this.db.prepare("INSERT INTO recruitments(recruitment_id, role_label, jd, status, created_at) VALUES (?, ?, ?, 'open', ?)")
      .run(recruitmentId, roleLabel.trim(), jd, createdAt);
    return this.getRecruitment(recruitmentId)!;
  }

  public getRecruitment(id: string): Recruitment | null {
    const row = this.db.prepare("SELECT * FROM recruitments WHERE recruitment_id=?").get(id) as any;
    return row ? { recruitmentId: String(row.recruitment_id), roleLabel: String(row.role_label), jd: String(row.jd), status: row.status, createdAt: Number(row.created_at) } : null;
  }

  public listRecruitments(limit = 50): Recruitment[] {
    this.assertLimit(limit);
    return (this.db.prepare("SELECT recruitment_id FROM recruitments ORDER BY created_at DESC, recruitment_id DESC LIMIT ?").all(limit) as any[])
      .map(row => this.getRecruitment(String(row.recruitment_id))!).filter(Boolean);
  }

  public closeRecruitment(id: string): void {
    const result = this.db.prepare("UPDATE recruitments SET status='closed' WHERE recruitment_id=? AND status='open'").run(id);
    if (Number(result.changes) !== 1) throw new Error("RECRUITMENT_NOT_OPEN");
  }

  public createDraft(input: TrialDraftInput, trialId = `trial_${randomUUID()}`): Trial {
    if (!input.challengeText.trim() || !input.acceptanceCriteria.trim() || !input.modelName.trim() || !input.allowedTools.length ||
        !Number.isSafeInteger(input.totalBudgetTokens) || input.totalBudgetTokens < 1 ||
        !Number.isSafeInteger(input.candidateBudgetTokens) || input.candidateBudgetTokens < 1 ||
        !Number.isSafeInteger(input.roundsPerCandidate) || input.roundsPerCandidate < 1) throw new Error("TRIAL_FIELDS_INVALID");
    const createdAt = Date.now() / 1000;
    this.db.prepare(`INSERT INTO trials(trial_id, recruitment_id, challenge_text, acceptance_criteria, total_budget_tokens,
      rounds_per_candidate, candidate_budget_tokens, allowed_tools_json, model_name, status, winner_qianji_id, decision_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NULL, NULL, ?)`)
      .run(trialId, input.recruitmentId ?? null, input.challengeText, input.acceptanceCriteria,
        input.totalBudgetTokens, input.roundsPerCandidate, input.candidateBudgetTokens,
        JSON.stringify(input.allowedTools), input.modelName, createdAt);
    return this.get(trialId)!;
  }

  public get(id: string): Trial | null {
    const row = this.db.prepare("SELECT * FROM trials WHERE trial_id=?").get(id) as any;
    if (!row) return null;
    return { trialId: String(row.trial_id), recruitmentId: row.recruitment_id ?? null,
      challengeText: String(row.challenge_text), acceptanceCriteria: String(row.acceptance_criteria),
      totalBudgetTokens: Number(row.total_budget_tokens), roundsPerCandidate: Number(row.rounds_per_candidate),
      candidateBudgetTokens: Number(row.candidate_budget_tokens), allowedTools: JSON.parse(String(row.allowed_tools_json)),
      modelName: String(row.model_name), status: row.status, winnerQianjiId: row.winner_qianji_id ?? null,
      decisionReason: row.decision_reason ?? null, pauseReason: row.pause_reason ?? null,
      createdAt: Number(row.created_at), candidates: this.listCandidates(id) };
  }

  public list(options: { status?: TrialStatus; limit?: number } = {}): Trial[] {
    const limit = options.limit ?? 50;
    this.assertLimit(limit);
    const rows = options.status
      ? this.db.prepare("SELECT trial_id FROM trials WHERE status=? ORDER BY created_at DESC, trial_id DESC LIMIT ?").all(options.status, limit) as any[]
      : this.db.prepare("SELECT trial_id FROM trials ORDER BY created_at DESC, trial_id DESC LIMIT ?").all(limit) as any[];
    return rows.map(row => this.get(String(row.trial_id))!).filter(Boolean);
  }

  public addCandidate(input: Omit<TrialCandidate, "candidateId" | "evidence" | "selected">, candidateId = `candidate_${randomUUID()}`): TrialCandidate {
    return this.db.transaction(() => {
      const trial = this.get(input.trialId);
      if (!trial) throw new Error("TRIAL_NOT_FOUND");
      if (trial.status !== "draft") throw new Error("TRIAL_NOT_DRAFT");
      this.db.prepare(`INSERT INTO trial_candidates(candidate_id, trial_id, qianji_id, binding_id, execution_id, ordinal, evidence_json, selected, formal_narrative_json)
        VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?)`)
        .run(candidateId, input.trialId, input.qianjiId, input.bindingId, input.executionId, input.ordinal,
          input.formalNarrative ? JSON.stringify(input.formalNarrative) : null);
      return this.getCandidate(candidateId)!;
    });
  }

  public getCandidate(id: string): TrialCandidate | null {
    const row = this.db.prepare("SELECT * FROM trial_candidates WHERE candidate_id=?").get(id) as any;
    return row ? this.mapCandidate(row) : null;
  }

  public listCandidates(trialId: string): TrialCandidate[] {
    return (this.db.prepare("SELECT * FROM trial_candidates WHERE trial_id=? ORDER BY ordinal, candidate_id").all(trialId) as any[])
      .map(row => this.mapCandidate(row));
  }

  public setCandidateEvidence(candidateId: string, evidence: unknown[]): void {
    const result = this.db.prepare("UPDATE trial_candidates SET evidence_json=? WHERE candidate_id=?")
      .run(JSON.stringify(evidence), candidateId);
    if (Number(result.changes) !== 1) throw new Error("TRIAL_CANDIDATE_NOT_FOUND");
  }

  public setPauseReason(id: string, reason: string | null): void {
    const result = this.db.prepare("UPDATE trials SET pause_reason=? WHERE trial_id=? AND status='running'").run(reason, id);
    if (Number(result.changes) !== 1) throw new Error("TRIAL_NOT_RUNNING");
  }

  public clearPauseReason(id: string): void { this.setPauseReason(id, null); }

  public transition(id: string, expected: TrialStatus, next: TrialStatus, details: Record<string, unknown> = {}): Trial {
    return this.db.transaction(() => {
      const trial = this.get(id);
      if (!trial) throw new Error("TRIAL_NOT_FOUND");
      if (trial.status !== expected) throw new Error("TRIAL_STATUS_CONFLICT");
      const result = this.db.prepare("UPDATE trials SET status=? WHERE trial_id=? AND status=?").run(next, id, expected);
      if (Number(result.changes) !== 1) throw new Error("TRIAL_STATUS_CONFLICT");
      const eventType = next === "draft" ? null : ({ running: "TRIAL_STARTED", awaiting_selection: "TRIAL_AWAITING_SELECTION",
        completed: "TRIAL_COMPLETED", cancelled: "TRIAL_CANCELLED" } as const)[next];
      if (eventType) this.events.append({ eventType, subjectType: "trial", subjectId: id,
        sourceKey: `trial:${id}:${eventType.toLowerCase()}`, payload: details });
      return this.get(id)!;
    });
  }

  public decide(id: string, winnerQianjiId: string | null, reason: string): Trial {
    if (!reason.trim()) throw new Error("TRIAL_DECISION_REASON_REQUIRED");
    return this.db.transaction(() => {
      const trial = this.get(id);
      if (!trial) throw new Error("TRIAL_NOT_FOUND");
      if (trial.status !== "awaiting_selection") throw new Error("TRIAL_NOT_AWAITING_SELECTION");
      if (winnerQianjiId && !trial.candidates.some(candidate => candidate.qianjiId === winnerQianjiId)) {
        throw new Error("TRIAL_WINNER_NOT_CANDIDATE");
      }
      this.db.prepare("UPDATE trial_candidates SET selected=CASE WHEN qianji_id=? THEN 1 ELSE 0 END WHERE trial_id=?")
        .run(winnerQianjiId, id);
      this.db.prepare("UPDATE trials SET winner_qianji_id=?, decision_reason=?, status='completed' WHERE trial_id=? AND status='awaiting_selection'")
        .run(winnerQianjiId, reason.trim(), id);
      this.events.append({ eventType: "TRIAL_COMPLETED", subjectType: "trial", subjectId: id,
        sourceKey: `trial:${id}:completed`, payload: { winnerQianjiId, decisionReason: reason.trim() } });
      return this.get(id)!;
    });
  }

  private mapCandidate(row: any): TrialCandidate {
    return { candidateId: String(row.candidate_id), trialId: String(row.trial_id), qianjiId: String(row.qianji_id),
      bindingId: String(row.binding_id), executionId: String(row.execution_id), ordinal: Number(row.ordinal),
      evidence: row.evidence_json == null ? null : JSON.parse(String(row.evidence_json)), selected: Boolean(row.selected),
      formalNarrative: row.formal_narrative_json == null ? null : JSON.parse(String(row.formal_narrative_json)) };
  }

  private assertLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("LIMIT_INVALID");
  }
}
