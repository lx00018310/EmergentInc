import { randomUUID } from "node:crypto";
import {
  QianjiBinding,
  QianjiCareerStatus,
  QianjiNarrativeRevision,
  QianjiNarrativeSpec,
  QianjiProfile,
} from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";
import { WorldEventRepository } from "./world_event_repository.js";

export interface CreateQianjiProfile {
  qianjiId?: string;
  careerStatus?: QianjiCareerStatus;
  narrative?: QianjiNarrativeSpec;
  createdAt?: number;
}

export interface CreateQianjiBinding {
  bindingId?: string;
  qianjiId: string;
  pixelId: string;
  incarnation: number;
  boundAt?: number;
  birthEffectId?: string | null;
}

export class QianjiRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly events: WorldEventRepository,
  ) {}

  public createProfile(input: CreateQianjiProfile = {}): QianjiProfile {
    const qianjiId = input.qianjiId ?? `qj_${randomUUID()}`;
    const narrative: QianjiNarrativeSpec = input.narrative ?? {
      displayName: `未命名千机 ${qianjiId.slice(-6)}`,
      title: null,
      roleLabel: null,
      traits: {},
      behaviorProfile: [],
      flaw: null,
      shortBio: null,
      appearanceSpec: null,
      portraitAsset: null,
      contentRevision: null,
    };
    const careerStatus = input.careerStatus ?? "candidate";
    const createdAt = input.createdAt ?? Date.now() / 1000;
    if (!qianjiId.trim()) throw new Error("qianjiId is required");
    if (!narrative.displayName.trim()) throw new Error("Qianji displayName is required");
    return this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO qianji_profiles
          (qianji_id, career_status, narrative_json, narrative_revision, created_at, retired_at, retired_reason)
        VALUES (?, ?, ?, 0, ?, NULL, NULL)
      `).run(qianjiId, careerStatus, JSON.stringify(narrative), createdAt);
      this.db.prepare(`
        INSERT INTO qianji_narrative_revisions (qianji_id, revision, narrative_json, created_at)
        VALUES (?, 0, ?, ?)
      `).run(qianjiId, JSON.stringify(narrative), createdAt);
      this.events.append({
        eventType: "QIANJI_PROFILE_CREATED",
        subjectType: "qianji",
        subjectId: qianjiId,
        qianjiId,
        sourceKey: `qianji:${qianjiId}:created`,
        payload: { careerStatus, narrativeRevision: 0 },
        createdAt,
      });
      return this.getProfile(qianjiId)!;
    });
  }

  public getProfile(qianjiId: string): QianjiProfile | null {
    const row = this.db.prepare("SELECT * FROM qianji_profiles WHERE qianji_id = ?").get(qianjiId) as any;
    return row ? this.mapProfile(row) : null;
  }

  public listProfiles(options: { careerStatus?: QianjiCareerStatus; limit?: number } = {}): QianjiProfile[] {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("Qianji limit must be an integer from 1 to 200");
    }
    const rows = options.careerStatus
      ? this.db.prepare("SELECT * FROM qianji_profiles WHERE career_status = ? ORDER BY created_at, qianji_id LIMIT ?")
          .all(options.careerStatus, limit) as any[]
      : this.db.prepare("SELECT * FROM qianji_profiles ORDER BY created_at, qianji_id LIMIT ?")
          .all(limit) as any[];
    return rows.map(row => this.mapProfile(row));
  }

  public updateNarrative(qianjiId: string, expectedRevision: number, narrative: QianjiNarrativeSpec): QianjiProfile {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error("Invalid expectedRevision");
    if (!narrative.displayName.trim()) throw new Error("Qianji displayName is required");
    return this.db.transaction(() => {
      const current = this.getProfile(qianjiId);
      if (!current) throw new Error("Qianji not found");
      if (current.narrativeRevision !== expectedRevision) throw new Error("REVISION_CONFLICT");
      const revision = expectedRevision + 1;
      const now = Date.now() / 1000;
      const result = this.db.prepare(`
        UPDATE qianji_profiles SET narrative_json = ?, narrative_revision = ?
        WHERE qianji_id = ? AND narrative_revision = ?
      `).run(JSON.stringify(narrative), revision, qianjiId, expectedRevision);
      if (Number(result.changes) !== 1) throw new Error("REVISION_CONFLICT");
      this.db.prepare(`
        INSERT INTO qianji_narrative_revisions (qianji_id, revision, narrative_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(qianjiId, revision, JSON.stringify(narrative), now);
      this.events.append({
        eventType: "QIANJI_NARRATIVE_UPDATED",
        subjectType: "qianji",
        subjectId: qianjiId,
        qianjiId,
        sourceKey: `qianji:${qianjiId}:narrative:${revision}`,
        payload: { revision },
        createdAt: now,
      });
      return this.getProfile(qianjiId)!;
    });
  }

  public transitionCareerStatus(qianjiId: string, expected: QianjiCareerStatus, next: QianjiCareerStatus, reason?: string): QianjiProfile {
    const transitions: Record<QianjiCareerStatus, readonly QianjiCareerStatus[]> = {
      candidate: ["trial", "retired"], trial: ["candidate", "active", "retired"],
      active: ["retired"], retired: [],
    };
    if (!transitions[expected].includes(next)) throw new Error(`QIANJI_TRANSITION_INVALID:${expected}:${next}`);
    if (next === "retired" && !reason?.trim()) throw new Error("QIANJI_RETIREMENT_REASON_REQUIRED");
    return this.db.transaction(() => {
      const profile = this.getProfile(qianjiId);
      if (!profile) throw new Error("Qianji not found");
      if (profile.careerStatus !== expected) throw new Error("QIANJI_CAREER_STATUS_CONFLICT");
      const retiredAt = next === "retired" ? Date.now() / 1000 : null;
      const result = this.db.prepare(`UPDATE qianji_profiles SET career_status=?, retired_at=?, retired_reason=?
        WHERE qianji_id=? AND career_status=?`).run(next, retiredAt, next === "retired" ? reason!.trim() : null, qianjiId, expected);
      if (Number(result.changes) !== 1) throw new Error("QIANJI_CAREER_STATUS_CONFLICT");
      this.events.append({ eventType: next === "retired" ? "QIANJI_RETIRED" : next === "active" ? "QIANJI_RECRUITED" : "TRIAL_STARTED",
        subjectType: "qianji", subjectId: qianjiId, qianjiId, sourceKey: `qianji:${qianjiId}:career:${next}:${Date.now()}`,
        payload: { from: expected, to: next, reason: reason?.trim() ?? null }, createdAt: retiredAt ?? Date.now() / 1000 });
      return this.getProfile(qianjiId)!;
    });
  }

  public getNarrativeRevision(qianjiId: string, revision: number): QianjiNarrativeRevision | null {
    const row = this.db.prepare(`
      SELECT * FROM qianji_narrative_revisions WHERE qianji_id = ? AND revision = ?
    `).get(qianjiId, revision) as any;
    return row ? {
      qianjiId: String(row.qianji_id),
      revision: Number(row.revision),
      narrative: JSON.parse(String(row.narrative_json)),
      createdAt: Number(row.created_at),
    } : null;
  }

  public createBinding(input: CreateQianjiBinding): QianjiBinding {
    if (!Number.isSafeInteger(input.incarnation) || input.incarnation < 1) {
      throw new Error("incarnation must be a positive integer");
    }
    if (!input.qianjiId.trim() || !input.pixelId.trim()) throw new Error("qianjiId and pixelId are required");
    const bindingId = input.bindingId ?? `binding_${randomUUID()}`;
    const boundAt = input.boundAt ?? Date.now() / 1000;
    return this.db.transaction(() => {
      if (!this.getProfile(input.qianjiId)) throw new Error("Qianji not found");
      this.db.prepare(`
        INSERT INTO qianji_bindings
          (binding_id, qianji_id, pixel_id, incarnation, bound_at, birth_effect_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(bindingId, input.qianjiId, input.pixelId, input.incarnation, boundAt, input.birthEffectId ?? null);
      this.events.append({
        eventType: "QIANJI_BOUND",
        subjectType: "qianji",
        subjectId: input.qianjiId,
        qianjiId: input.qianjiId,
        bindingId,
        pixelId: input.pixelId,
        sourceKey: `binding:${bindingId}:bound`,
        payload: { incarnation: input.incarnation },
        createdAt: boundAt,
      });
      return this.getBinding(bindingId)!;
    });
  }

  public getBinding(bindingId: string): QianjiBinding | null {
    const row = this.db.prepare("SELECT * FROM qianji_bindings WHERE binding_id = ?").get(bindingId) as any;
    return row ? this.mapBinding(row) : null;
  }

  public getCurrentBindingByPixel(pixelId: string): QianjiBinding | null {
    const row = this.db.prepare(`
      SELECT * FROM qianji_bindings WHERE pixel_id = ? AND unbound_at IS NULL
    `).get(pixelId) as any;
    return row ? this.mapBinding(row) : null;
  }

  public getCurrentBindingByQianji(qianjiId: string): QianjiBinding | null {
    const row = this.db.prepare(`
      SELECT * FROM qianji_bindings WHERE qianji_id = ? AND unbound_at IS NULL
    `).get(qianjiId) as any;
    return row ? this.mapBinding(row) : null;
  }

  public listBindings(qianjiId: string): QianjiBinding[] {
    return (this.db.prepare(`
      SELECT * FROM qianji_bindings WHERE qianji_id = ? ORDER BY bound_at, binding_id
    `).all(qianjiId) as any[]).map(row => this.mapBinding(row));
  }

  /** Return identity-attributed activity separately from legacy carrier activity. */
  public getHistory(qianjiId: string, limit = 50): {
    modelCalls: any[];
    toolExecutions: any[];
    ledgerEntries: any[];
    messages: any[];
    costSummary: { totalCostCny: number | null; knownCostCny: number; unknownModelCount: number; unknownToolCount: number };
    carrierLegacy: { modelCalls: any[]; toolExecutions: any[]; ledgerEntries: any[]; messages: any[];
      costSummary: { totalCostCny: number | null; knownCostCny: number; unknownModelCount: number; unknownToolCount: number } };
  } {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("History limit must be 1-200");
    const bindings = this.listBindings(qianjiId);
    const bindingIds = bindings.map(binding => binding.bindingId);
    const pixelIds = [...new Set(bindings.map(binding => binding.pixelId))];
    if (bindingIds.length === 0) {
      const costSummary = { totalCostCny: 0, knownCostCny: 0, unknownModelCount: 0, unknownToolCount: 0 };
      return { modelCalls: [], toolExecutions: [], ledgerEntries: [], messages: [], costSummary,
        carrierLegacy: { modelCalls: [], toolExecutions: [], ledgerEntries: [], messages: [], costSummary: { ...costSummary } } };
    }
    const bindingMarks = bindingIds.map(() => "?").join(", ");
    const pixelMarks = pixelIds.map(() => "?").join(", ");
    const attributedCalls = this.db.prepare(`
      SELECT call_id AS callId, run_id AS runId, pixel_id AS pixelId, message_id AS messageId,
        binding_id AS bindingId, narrative_revision AS narrativeRevision, round_num AS roundNum,
        model, outcome, prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
        cost_cny AS costCny, created_at AS createdAt
      FROM model_calls WHERE binding_id IN (${bindingMarks})
      ORDER BY created_at DESC, call_id DESC LIMIT ?
    `).all(...bindingIds, limit) as any[];
    const legacyCalls = this.db.prepare(`
      SELECT call_id AS callId, run_id AS runId, pixel_id AS pixelId, message_id AS messageId,
        binding_id AS bindingId, narrative_revision AS narrativeRevision, round_num AS roundNum,
        model, outcome, prompt_tokens AS promptTokens, completion_tokens AS completionTokens,
        cost_cny AS costCny, created_at AS createdAt
      FROM model_calls WHERE binding_id IS NULL AND pixel_id IN (${pixelMarks})
      ORDER BY created_at DESC, call_id DESC LIMIT ?
    `).all(...pixelIds, limit) as any[];
    const attributedMessages = this.db.prepare(`
      SELECT message_id AS messageId, round_num AS roundNum, hop, sender, recipient,
        sender_binding_id AS senderBindingId, recipient_binding_id AS recipientBindingId,
        source_type AS sourceType, status, created_at AS createdAt, updated_at AS updatedAt
      FROM messages WHERE sender_binding_id IN (${bindingMarks}) OR recipient_binding_id IN (${bindingMarks})
      ORDER BY created_at DESC, message_id DESC LIMIT ?
    `).all(...bindingIds, ...bindingIds, limit) as any[];
    const legacyMessages = this.db.prepare(`
      SELECT message_id AS messageId, round_num AS roundNum, hop, sender, recipient,
        sender_binding_id AS senderBindingId, recipient_binding_id AS recipientBindingId,
        source_type AS sourceType, status, created_at AS createdAt, updated_at AS updatedAt
      FROM messages WHERE sender_binding_id IS NULL AND recipient_binding_id IS NULL
        AND (sender IN (${pixelMarks}) OR recipient IN (${pixelMarks}))
      ORDER BY created_at DESC, message_id DESC LIMIT ?
    `).all(...pixelIds, ...pixelIds, limit) as any[];
    const attributedLedger = this.db.prepare(`
      SELECT entry_id AS entryId, timestamp, pixel_id AS pixelId, binding_id AS bindingId,
        entry_type AS entryType, amount, balance_after AS balanceAfter, details
      FROM ledger_entries WHERE binding_id IN (${bindingMarks})
      ORDER BY timestamp DESC, entry_id DESC LIMIT ?
    `).all(...bindingIds, limit) as any[];
    const legacyLedger = this.db.prepare(`
      SELECT entry_id AS entryId, timestamp, pixel_id AS pixelId, binding_id AS bindingId,
        entry_type AS entryType, amount, balance_after AS balanceAfter, details
      FROM ledger_entries WHERE binding_id IS NULL AND pixel_id IN (${pixelMarks})
      ORDER BY timestamp DESC, entry_id DESC LIMIT ?
    `).all(...pixelIds, limit) as any[];

    const attributedMessageIds = attributedMessages.map(item => item.messageId);
    const attributedCallIds = attributedCalls.map(item => item.callId);
    const legacyMessageIds = legacyMessages.map(item => item.messageId);
    const legacyCallIds = legacyCalls.map(item => item.callId);
    const findTools = (messageIds: string[], callIds: string[]) => {
      const conditions: string[] = [];
      const params: string[] = [];
      if (messageIds.length) { conditions.push(`message_id IN (${messageIds.map(() => "?").join(", ")})`); params.push(...messageIds); }
      if (callIds.length) { conditions.push(`model_call_id IN (${callIds.map(() => "?").join(", ")})`); params.push(...callIds); }
      if (!conditions.length) return [];
      return this.db.prepare(`
        SELECT operation_id AS operationId, run_id AS runId, message_id AS messageId,
          pixel_id AS pixelId, op_index AS opIndex, tool, status, cost_cny AS costCny,
          model_call_id AS modelCallId, started_at AS startedAt, finished_at AS finishedAt
        FROM tool_executions WHERE ${conditions.join(" OR ")}
        ORDER BY started_at DESC, operation_id DESC LIMIT ?
      `).all(...params, limit) as any[];
    };
    const attributedTools = findTools(attributedMessageIds, attributedCallIds);
    const legacyTools = findTools(legacyMessageIds, legacyCallIds);
    const costSummary = (calls: any[], tools: any[]) => {
      const unknownModelCount = calls.filter(call => call.costCny == null).length;
      const unknownToolCount = tools.filter(tool => tool.costCny == null).length;
      const knownCostCny = calls.reduce((sum, call) => sum + (call.costCny == null ? 0 : Number(call.costCny)), 0)
        + tools.reduce((sum, tool) => sum + (tool.costCny == null ? 0 : Number(tool.costCny)), 0);
      return { totalCostCny: unknownModelCount + unknownToolCount > 0 ? null : knownCostCny,
        knownCostCny, unknownModelCount, unknownToolCount };
    };
    return {
      modelCalls: attributedCalls,
      toolExecutions: attributedTools,
      ledgerEntries: attributedLedger,
      messages: attributedMessages,
      costSummary: costSummary(attributedCalls, attributedTools),
      carrierLegacy: {
        modelCalls: legacyCalls,
        toolExecutions: legacyTools,
        ledgerEntries: legacyLedger,
        messages: legacyMessages,
        costSummary: costSummary(legacyCalls, legacyTools),
      },
    };
  }

  public getCareerSummary(qianjiId: string): {
    modelCallCount: number; actualTokens: number; toolExecutionCount: number; trialCount: number;
    completedMissionCount: number; failedMissionCount: number; successRate: number | null;
    acceptedByMissionType: Array<{ missionType: string; count: number; evidenceIds: string[] }>;
  } {
    if (!this.getProfile(qianjiId)) throw new Error("Qianji not found");
    const bindingIds = this.listBindings(qianjiId).map(binding => binding.bindingId);
    const missionRows = this.db.prepare(`SELECT m.mission_id,m.mission_type,m.status,m.execution_id FROM mission_participants mp
      JOIN missions m ON m.mission_id=mp.mission_id WHERE mp.qianji_id=? AND m.status IN ('completed','failed')
      ORDER BY m.created_at,m.mission_id`).all(qianjiId) as any[];
    const grouped = new Map<string, { missionType: string; count: number; evidenceIds: string[] }>();
    for (const row of missionRows) if (row.status === "completed") {
      const type = String(row.mission_type);
      const group = grouped.get(type) ?? { missionType: type, count: 0, evidenceIds: [] };
      group.count++;
      if (row.execution_id) {
        const evidence = this.db.prepare("SELECT evidence_id FROM execution_evidence WHERE execution_id=? ORDER BY created_at,evidence_id")
          .all(row.execution_id) as any[];
        group.evidenceIds.push(...evidence.map(item => String(item.evidence_id)));
      }
      grouped.set(type, group);
    }
    const marks = bindingIds.length ? bindingIds.map(() => "?").join(",") : "NULL";
    const calls = bindingIds.length ? this.db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(actual_tokens),0) AS tokens FROM model_calls WHERE binding_id IN (${marks})`).get(...bindingIds) as any : { count: 0, tokens: 0 };
    const toolExecutions = bindingIds.length ? this.db.prepare(`SELECT COUNT(DISTINCT te.operation_id) AS count FROM tool_executions te
      JOIN model_calls mc ON mc.call_id=te.model_call_id WHERE mc.binding_id IN (${marks})`).get(...bindingIds) as any : { count: 0 };
    const completedMissionCount = missionRows.filter(row => row.status === "completed").length;
    const failedMissionCount = missionRows.filter(row => row.status === "failed").length;
    const denominator = completedMissionCount + failedMissionCount;
    const trial = this.db.prepare("SELECT COUNT(*) AS count FROM trial_candidates WHERE qianji_id=?").get(qianjiId) as any;
    return { modelCallCount: Number(calls.count), actualTokens: Number(calls.tokens), toolExecutionCount: Number(toolExecutions.count),
      trialCount: Number(trial.count), completedMissionCount, failedMissionCount,
      successRate: denominator === 0 ? null : completedMissionCount / denominator,
      acceptedByMissionType: [...grouped.values()].map(group => ({ ...group, evidenceIds: [...new Set(group.evidenceIds)] })) };
  }

  public unbindAndRetire(
    bindingId: string,
    archiveRelativePath: string,
    reason: string,
    occurredAt = Date.now() / 1000,
  ): QianjiBinding {
    if (!archiveRelativePath.trim() || !reason.trim()) throw new Error("Archive path and retirement reason are required");
    return this.db.transaction(() => {
      const binding = this.getBinding(bindingId);
      if (!binding) throw new Error("Qianji binding not found");
      if (binding.unboundAt !== null) throw new Error("Qianji binding is already closed");
      if (occurredAt < binding.boundAt) throw new Error("unboundAt cannot precede boundAt");
      this.db.prepare(`
        UPDATE qianji_bindings SET unbound_at = ?, archive_relative_path = ?
        WHERE binding_id = ? AND unbound_at IS NULL
      `).run(occurredAt, archiveRelativePath, bindingId);
      this.events.append({
        eventType: "QIANJI_UNBOUND",
        subjectType: "qianji",
        subjectId: binding.qianjiId,
        qianjiId: binding.qianjiId,
        bindingId,
        pixelId: binding.pixelId,
        sourceKey: `binding:${bindingId}:unbound`,
        payload: { incarnation: binding.incarnation, archiveRelativePath },
        createdAt: occurredAt,
      });
      const profile = this.getProfile(binding.qianjiId)!;
      if (profile.careerStatus !== "retired") {
        this.db.prepare(`
          UPDATE qianji_profiles SET career_status = 'retired', retired_at = ?, retired_reason = ?
          WHERE qianji_id = ? AND career_status <> 'retired'
        `).run(occurredAt, reason, binding.qianjiId);
        this.events.append({
          eventType: "QIANJI_RETIRED",
          subjectType: "qianji",
          subjectId: binding.qianjiId,
          qianjiId: binding.qianjiId,
          bindingId,
          pixelId: binding.pixelId,
          sourceKey: `qianji:${binding.qianjiId}:retired:${bindingId}`,
          payload: { reason },
          createdAt: occurredAt,
        });
      }
      return this.getBinding(bindingId)!;
    });
  }

  private mapProfile(row: any): QianjiProfile {
    return {
      qianjiId: String(row.qianji_id),
      careerStatus: row.career_status,
      narrative: JSON.parse(String(row.narrative_json)),
      narrativeRevision: Number(row.narrative_revision),
      createdAt: Number(row.created_at),
      retiredAt: row.retired_at == null ? null : Number(row.retired_at),
      retiredReason: row.retired_reason ?? null,
    };
  }

  private mapBinding(row: any): QianjiBinding {
    return {
      bindingId: String(row.binding_id),
      qianjiId: String(row.qianji_id),
      pixelId: String(row.pixel_id),
      incarnation: Number(row.incarnation),
      boundAt: Number(row.bound_at),
      unboundAt: row.unbound_at == null ? null : Number(row.unbound_at),
      birthEffectId: row.birth_effect_id ?? null,
      archiveRelativePath: row.archive_relative_path ?? null,
    };
  }
}
