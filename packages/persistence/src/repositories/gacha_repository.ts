import { QianjiDraw, GachaOrigin, GachaGenerationStatus } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";

export type CreateDraw = Omit<QianjiDraw, "cardPrompt" | "promptFingerprint" | "promptNarrativeRevision" | "imageStatus" | "imageError" | "createdAt"> & {
  generationInput?: unknown;
  createdAt?: number;
};

export class GachaRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public getPity(): number {
    const row = this.db.prepare("SELECT misses FROM gacha_pity WHERE channel='owner'").get() as { misses: number };
    return Number(row.misses);
  }

  public setPity(misses: number): void {
    if (!Number.isSafeInteger(misses) || misses < 0 || misses > 9) throw new Error("GACHA_PITY_INVALID");
    this.db.prepare("UPDATE gacha_pity SET misses=? WHERE channel='owner'").run(misses);
  }

  public create(input: CreateDraw): QianjiDraw {
    const createdAt = input.createdAt ?? Date.now() / 1000;
    const { generationInput: _generationInput, createdAt: _createdAt, ...facts } = input;
    this.db.prepare(`INSERT INTO qianji_draws
      (qianji_id, draw_json, draw_fingerprint, requested_origin, origin, lineage_json, skill_tags_json, lineage_evidence_json, fallback_reason,
       generation_status, generation_input_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(input.qianjiId, JSON.stringify(facts), input.drawFingerprint, input.requestedOrigin, input.origin,
        JSON.stringify(input.lineage), JSON.stringify(input.skillTags), JSON.stringify(input.lineageEvidence), input.fallbackReason, input.generationStatus,
        input.generationInput === undefined ? null : JSON.stringify(input.generationInput), createdAt, createdAt);
    return this.get(input.qianjiId)!;
  }

  public get(qianjiId: string): QianjiDraw | null {
    const row = this.db.prepare("SELECT * FROM qianji_draws WHERE qianji_id=?").get(qianjiId) as any;
    if (!row) return null;
    const facts = JSON.parse(String(row.draw_json));
    const image = this.db.prepare("SELECT status,error FROM gacha_images WHERE qianji_id=?").get(qianjiId) as { status: QianjiDraw["imageStatus"]; error: string | null } | undefined;
    return { ...facts, qianjiId,
      requestedOrigin: row.requested_origin as GachaOrigin,
      origin: row.origin as GachaOrigin,
      lineage: JSON.parse(String(row.lineage_json)),
      skillTags: JSON.parse(String(row.skill_tags_json)),
      lineageEvidence: JSON.parse(String(row.lineage_evidence_json)),
      fallbackReason: row.fallback_reason ?? null,
      generationStatus: row.generation_status as GachaGenerationStatus,
      cardPrompt: row.card_prompt ?? null,
      promptFingerprint: row.prompt_fingerprint ?? null,
      promptNarrativeRevision: row.prompt_narrative_revision == null ? null : Number(row.prompt_narrative_revision),
      imageStatus: image?.status ?? "pending",
      imageError: image?.error ?? null,
      createdAt: Number(row.created_at),
    };
  }

  public beginImage(qianjiId: string, model: string): void {
    this.db.prepare(`INSERT INTO gacha_images(qianji_id,status,model,error,asset_id,updated_at)
      VALUES(?,'generating',?,NULL,NULL,?) ON CONFLICT(qianji_id) DO UPDATE SET
      status='generating',model=excluded.model,error=NULL,updated_at=excluded.updated_at
      WHERE gacha_images.status IN ('failed','generating')`).run(qianjiId, model, Date.now() / 1000);
  }

  public finishImage(qianjiId: string, assetId: string): void {
    const result = this.db.prepare("UPDATE gacha_images SET status='ready',asset_id=?,error=NULL,updated_at=? WHERE qianji_id=? AND status='generating'")
      .run(assetId, Date.now() / 1000, qianjiId);
    if (Number(result.changes) !== 1) throw new Error("GACHA_IMAGE_STATE_CONFLICT");
  }

  public failImage(qianjiId: string, error: string): void {
    this.db.prepare("UPDATE gacha_images SET status='failed',error=?,updated_at=? WHERE qianji_id=? AND status='generating'")
      .run(error.slice(0, 1000), Date.now() / 1000, qianjiId);
  }

  public recordImportedImage(qianjiId: string, assetId: string, source: "local" | "url"): void {
    const result = this.db.prepare(`INSERT INTO gacha_images(qianji_id,status,model,error,asset_id,updated_at)
      VALUES(?,'ready',?,NULL,?,?) ON CONFLICT(qianji_id) DO UPDATE SET
      status='ready',model=excluded.model,error=NULL,asset_id=excluded.asset_id,updated_at=excluded.updated_at
      WHERE gacha_images.status <> 'generating'`).run(qianjiId, `import:${source}`, assetId, Date.now() / 1000);
    if (Number(result.changes) !== 1) throw new Error("GACHA_IMAGE_IN_PROGRESS");
  }

  public getGenerationInput(qianjiId: string): unknown | null {
    const row = this.db.prepare("SELECT generation_input_json FROM qianji_draws WHERE qianji_id=?").get(qianjiId) as any;
    return row?.generation_input_json ? JSON.parse(String(row.generation_input_json)) : null;
  }

  public finish(qianjiId: string, origin: GachaOrigin, lineage: string[], skillTags: string[],
    lineageEvidence: QianjiDraw["lineageEvidence"], fallbackReason: string | null): void {
    const result = this.db.prepare(`UPDATE qianji_draws SET origin=?, lineage_json=?, skill_tags_json=?, lineage_evidence_json=?, fallback_reason=?,
      generation_status='ready', generation_error=NULL, updated_at=? WHERE qianji_id=? AND generation_status IN ('pending','failed')`)
      .run(origin, JSON.stringify(lineage), JSON.stringify(skillTags), JSON.stringify(lineageEvidence), fallbackReason, Date.now() / 1000, qianjiId);
    if (Number(result.changes) !== 1) throw new Error("GACHA_GENERATION_STATE_CONFLICT");
  }

  public fail(qianjiId: string, error: string): void {
    this.db.prepare(`UPDATE qianji_draws SET generation_status='failed', generation_error=?, updated_at=?
      WHERE qianji_id=? AND generation_status='pending'`).run(error.slice(0, 1000), Date.now() / 1000, qianjiId);
  }

  public resetFailed(qianjiId: string): void {
    this.db.prepare(`UPDATE qianji_draws SET generation_status='pending', generation_error=NULL, updated_at=?
      WHERE qianji_id=? AND generation_status='failed'`).run(Date.now() / 1000, qianjiId);
  }

  public getError(qianjiId: string): string | null {
    const row = this.db.prepare("SELECT generation_error FROM qianji_draws WHERE qianji_id=?").get(qianjiId) as any;
    return row?.generation_error ?? null;
  }

  public setPrompt(qianjiId: string, prompt: string, fingerprint: string, revision: number): void {
    const result = this.db.prepare(`UPDATE qianji_draws SET card_prompt=?, prompt_fingerprint=?, prompt_narrative_revision=?, updated_at=?
      WHERE qianji_id=? AND card_prompt IS NULL AND generation_status='ready'`)
      .run(prompt, fingerprint, revision, Date.now() / 1000, qianjiId);
    if (Number(result.changes) !== 1) throw new Error("GACHA_PROMPT_STATE_CONFLICT");
  }

  public list(limit = 50, before?: { createdAt: number; qianjiId: string }): QianjiDraw[] {
    const rows = before
      ? this.db.prepare(`SELECT qianji_id FROM qianji_draws WHERE created_at < ? OR (created_at = ? AND qianji_id < ?)
          ORDER BY created_at DESC, qianji_id DESC LIMIT ?`).all(before.createdAt, before.createdAt, before.qianjiId, limit) as any[]
      : this.db.prepare("SELECT qianji_id FROM qianji_draws ORDER BY created_at DESC, qianji_id DESC LIMIT ?").all(limit) as any[];
    return rows.map(row => this.get(String(row.qianji_id))!);
  }
}
