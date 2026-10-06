import { randomUUID } from "node:crypto";
import { GenerationState, MemoryPoint, lifeId, lifeText, memoryPoint } from "@emergentinc/protocol";
import { BusinessStore, businessHash } from "./business_store.js";
import { migrateLineage } from "./migrations/lineage_schema.js";
import { migrateWorldLife } from './migrations/world_life_schema.js';

export type LifeRow = Record<string, any>;
export class LineageStore extends BusinessStore {
  readonly worldsEnabled:boolean;
  constructor(filename = ":memory:",options:{v23?:boolean}={}) { super(filename, migrateLineage);if(options.v23)migrateWorldLife(this.db);
    this.worldsEnabled=this.db.prepare('PRAGMA table_info(memories)').all().some(c=>c.name==='world_id'); }
  generation(id: string): LifeRow {
    const row = this.db.prepare("SELECT * FROM generations WHERE id=?").get(id);
    if (!row) throw new Error("GENERATION_NOT_FOUND");
    return row;
  }
  activeGeneration(): LifeRow | undefined { return this.db.prepare("SELECT * FROM generations WHERE state='ACTIVE'").get(); }
  generations() { return this.db.prepare("SELECT * FROM generations ORDER BY generation_no DESC").all(); }
  createGeneration(input: { id: string; number: number; parentId?: string; geneHash: string; releaseId: string; state?: GenerationState }) {
    lifeId(input.id); lifeText(input.releaseId, 200);
    if (!/^G\d{4,}$/.test(input.id) || !Number.isSafeInteger(input.number) || input.number < 1 || !/^[a-f0-9]{64}$/.test(input.geneHash))
      throw new Error("INVALID_GENERATION");
    this.db.prepare(`INSERT INTO generations(id,generation_no,parent_id,gene_hash,release_id,state,born_at)
      VALUES(?,?,?,?,?,?,?)`).run(input.id, input.number, input.parentId ?? null, input.geneHash, input.releaseId,
        input.state ?? "BIRTHING", input.state === "ACTIVE" ? Date.now() : null);
    return this.generation(input.id);
  }
  lifeEvent(generation: string, kind: string, payload: unknown, sourceRef: string = randomUUID(), pixelId?: string,worldId?:string) {
    if(worldId&&!this.worldsEnabled)throw new Error('V23_WORLD_LINEAGE_REQUIRED');
    if(this.worldsEnabled){this.db.prepare('INSERT OR IGNORE INTO life_events(generation_id,pixel_id,kind,payload,source_ref,created_at,world_id) VALUES(?,?,?,?,?,?,?)')
      .run(generation,pixelId??null,lifeText(kind,100),JSON.stringify(payload),sourceRef,Date.now(),worldId??null);return;}
    this.db.prepare(`INSERT OR IGNORE INTO life_events(generation_id,pixel_id,kind,payload,source_ref,created_at) VALUES(?,?,?,?,?,?)`)
      .run(generation, pixelId ?? null, lifeText(kind, 100), JSON.stringify(payload), sourceRef, Date.now());
  }
  remember(generation: string, kind: string, point: MemoryPoint, sourceRef: string, pixelId?: string, importance = 3, source = "gate",worldId?:string) {
    if(worldId&&!this.worldsEnabled)throw new Error('V23_WORLD_LINEAGE_REQUIRED');
    const p = memoryPoint(point);
    if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new Error("INVALID_MEMORY_IMPORTANCE");
    const old = this.db.prepare("SELECT * FROM memories WHERE source_ref=?").get(sourceRef);
    if (old) {
      if (old.generation_id !== generation || old.kind !== kind || old.pixel_id !== (pixelId ?? null) || old.point !== p.point ||
          old.reason !== p.reason || old.effect !== p.effect || (this.worldsEnabled&&old.world_id!==(worldId??null))) throw new Error("MEMORY_IDEMPOTENCY_CONFLICT");
      return old;
    }
    this.db.prepare(`INSERT OR IGNORE INTO memories(id,generation_id,pixel_id,kind,point,reason,effect,importance,source,source_ref,created_at${this.worldsEnabled?',world_id':''}) VALUES(?,?,?,?,?,?,?,?,?,?,?${this.worldsEnabled?',?':''})`)
      .run(randomUUID(), generation, pixelId ?? null, lifeText(kind, 100), p.point, p.reason, p.effect, importance, source, sourceRef, Date.now(),...(this.worldsEnabled?[worldId??null]:[]));
    return this.db.prepare("SELECT * FROM memories WHERE source_ref=?").get(sourceRef)!;
  }
  relevantMemories(options: { pixelId?: string; kind?: string; generationId?: string; limit?: number;worldId?:string } = {}) {
    const limit = Math.min(20, Math.max(1, options.limit ?? 20));
    return this.db.prepare(`SELECT * FROM memories WHERE (? IS NULL OR pixel_id IS NULL OR pixel_id=?)
      AND (? IS NULL OR kind=?) AND (? IS NULL OR generation_id=?) ${options.worldId?"AND (world_id=? OR (world_id IS NULL AND (source='gene' OR (source='chain_finalized' AND kind='business_outcome') OR kind IN ('generation_birth','generation_failure','generation_rollback','security_boundary'))))":''} ORDER BY importance DESC,created_at DESC,rowid DESC LIMIT ?`)
      .all(options.pixelId ?? null, options.pixelId ?? null, options.kind ?? null, options.kind ?? null,
        options.generationId ?? null, options.generationId ?? null,...(options.worldId?[options.worldId]:[]), limit);
  }
  proposeGene(generation: string, source: "dream" | "owner", point: MemoryPoint, sourceRef: string = randomUUID()) {
    const p = memoryPoint(point);
    const old = this.db.prepare("SELECT * FROM gene_proposals WHERE source_ref=?").get(sourceRef);
    if (old) {
      if (old.generation_id !== generation || old.source !== source || old.point !== p.point || old.reason !== p.reason || old.effect !== p.effect)
        throw new Error("PROPOSAL_IDEMPOTENCY_CONFLICT");
      return old;
    }
    this.db.transaction(() => {
      this.db.prepare(`INSERT OR IGNORE INTO gene_proposals(id,generation_id,source,point,reason,effect,state,created_at,source_ref)
        VALUES(?,?,?,?,?,?,'PROPOSED',?,?)`).run(randomUUID(), generation, source, p.point, p.reason, p.effect, Date.now(), sourceRef);
      this.lifeEvent(generation, "gene_proposed", { ...p, source }, `proposal:${sourceRef}`);
    });
    return this.db.prepare("SELECT * FROM gene_proposals WHERE source_ref=?").get(sourceRef)!;
  }
  decideProposal(id: string, decision: "APPROVED" | "REJECTED") {
    if (!["APPROVED", "REJECTED"].includes(decision)) throw new Error("INVALID_PROPOSAL_DECISION");
    return this.db.transaction(() => {
      const p = this.proposal(id);
      if (p.state === decision) return p;
      if (p.state !== "PROPOSED") throw new Error("PROPOSAL_NOT_APPROVABLE");
      this.db.prepare("UPDATE gene_proposals SET state=?,owner_decided_at=? WHERE id=?").run(decision, Date.now(), id);
      this.lifeEvent(p.generation_id, "owner_gene_decision", { proposalId: id, decision }, `decision:${id}`);
      return this.proposal(id);
    });
  }
  proposal(id: string): LifeRow {
    const p = this.db.prepare("SELECT * FROM gene_proposals WHERE id=?").get(id);
    if (!p) throw new Error("PROPOSAL_NOT_FOUND");
    return p;
  }
  proposals() { return this.db.prepare("SELECT * FROM gene_proposals ORDER BY created_at DESC,rowid DESC LIMIT 100").all(); }
  factHash(value: unknown) { return businessHash(value); }
}
