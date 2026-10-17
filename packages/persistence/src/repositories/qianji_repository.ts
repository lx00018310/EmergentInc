import { randomUUID } from "node:crypto";
import {
  QianjiBinding,
  QianjiCareerStatus,
  QianjiNarrativeRevision,
  QianjiNarrativeSpec,
  QianjiProfile,
  QianjiBirthIdentity,
} from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";
import { WorldEventRepository } from "./world_event_repository.js";

export interface CreateQianjiProfile {
  qianjiId?: string;
  careerStatus?: QianjiCareerStatus;
  narrative?: QianjiNarrativeSpec;
  createdAt?: number;
  birthIdentity?: QianjiBirthIdentity;
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
          (qianji_id, career_status, narrative_json, narrative_revision, birth_identity_json, created_at, retired_at, retired_reason)
        VALUES (?, ?, ?, 0, ?, ?, NULL, NULL)
      `).run(qianjiId, careerStatus, JSON.stringify(narrative), input.birthIdentity ? JSON.stringify(input.birthIdentity) : null, createdAt);
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
      if (current.birthIdentity && JSON.stringify({ ...narrative, displayName: current.narrative.displayName, portraitAsset: current.narrative.portraitAsset }) !==
          JSON.stringify({ ...current.narrative, displayName: current.narrative.displayName, portraitAsset: current.narrative.portraitAsset })) {
        throw new Error("QIANJI_BIRTH_NARRATIVE_IMMUTABLE");
      }
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
      draw: null,
      birthIdentity: row.birth_identity_json ? JSON.parse(String(row.birth_identity_json)) : null,
      legacyIdentity: false,
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
