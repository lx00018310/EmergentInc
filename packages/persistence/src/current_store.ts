import { lifeId, lifeText } from "@emergentinc/protocol";
import { SqliteDatabase } from "./sqlite/db.js";
import { migrateCurrent } from "./migrations/current_schema.js";
import { LifeRow } from "./lineage_store.js";
export class CurrentStore {
  readonly db: SqliteDatabase;
  constructor(filename = ":memory:") {
    this.db = new SqliteDatabase(filename);
    try { migrateCurrent(this.db); } catch (e) { this.db.close(); throw e; }
  }
  close() { this.db.close(); }
  meta(): LifeRow { const m = this.db.prepare("SELECT * FROM current_meta WHERE id=1").get(); if (!m) throw new Error("CURRENT_NOT_INITIALIZED"); return m; }
  initialize(generation: LifeRow, interfaceVersion: string) {
    if (this.db.prepare("SELECT * FROM current_meta").get()) throw new Error("CURRENT_ALREADY_INITIALIZED");
    this.db.prepare("INSERT INTO current_meta VALUES(1,?,0,?,?,?,?)")
      .run(generation.id, generation.gene_hash, generation.release_id, interfaceVersion, Date.now());
  }
  event(kind: string, payload: unknown, pixelId?: string) {
    this.db.prepare("INSERT INTO current_events(pixel_id,kind,payload,created_at) VALUES(?,?,?,?)")
      .run(pixelId ?? null, kind, JSON.stringify(payload), Date.now());
  }
  setWorkingState(pixelId: string, state: unknown, carryForward = false) {
    lifeId(pixelId); const json = JSON.stringify(state);
    if (!json || Buffer.byteLength(json) > 16384) throw new Error("INVALID_WORKING_STATE");
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO pixel_working_state VALUES(?,?,?,?) ON CONFLICT(pixel_id) DO UPDATE SET
        state_json=excluded.state_json,carry_forward=excluded.carry_forward,updated_at=excluded.updated_at`)
        .run(pixelId, json, carryForward ? 1 : 0, Date.now());
      this.event("working_state_changed", { pixelId, state, carryForward }, pixelId);
    });
  }
  setObjective(id: string, pixelId: string, content: string, state = "OPEN", carryForward = false) {
    lifeId(id); lifeId(pixelId); lifeText(content, 2000);
    if (!["OPEN", "COMPLETED", "FAILED"].includes(state)) throw new Error("INVALID_OBJECTIVE_STATE");
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO objectives VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        content=excluded.content,state=excluded.state,carry_forward=excluded.carry_forward,updated_at=excluded.updated_at`)
        .run(id, pixelId, content, state, carryForward ? 1 : 0, Date.now());
      this.event("objective_changed", { id, content, state, carryForward }, pixelId);
    });
  }
  need(id: string, pixelId: string, need: string, evidence: string, carryForward = false) {
    lifeId(id); lifeId(pixelId); lifeText(need, 2000); lifeText(evidence, 4000);
    return this.db.transaction(() => {
      const old = this.db.prepare("SELECT * FROM body_needs WHERE id=?").get(id);
      if (old) {
        if (old.pixel_id !== pixelId || old.need !== need || old.evidence !== evidence || old.carry_forward !== Number(carryForward)) throw new Error("NEED_IDEMPOTENCY_CONFLICT");
        return old;
      }
      this.db.prepare("INSERT INTO body_needs VALUES(?,?,?,?,'NEED',?,?,?)").run(id, pixelId, need, evidence, carryForward ? 1 : 0, Date.now(), Date.now());
      this.event("body_need", { id, need, evidence }, pixelId);
      return this.db.prepare("SELECT * FROM body_needs WHERE id=?").get(id)!;
    });
  }
  skills() { return this.db.prepare("SELECT * FROM body_skills ORDER BY skill_id").all(); }
  state(pixelId: string) { return this.db.prepare("SELECT * FROM pixel_working_state WHERE pixel_id=?").get(pixelId) ?? null; }
  objectives(pixelId: string) { return this.db.prepare("SELECT * FROM objectives WHERE pixel_id=? AND state='OPEN' ORDER BY updated_at DESC LIMIT 20").all(pixelId); }
}

/** Copy only explicit live state. Business facts and event/dream cursors are never copied. */
export function migrateCurrentState(old: CurrentStore, next: CurrentStore) {
  const compatible = old.meta().body_interface_version === next.meta().body_interface_version;
  next.db.transaction(() => {
    for (const r of old.db.prepare("SELECT * FROM pixel_working_state WHERE carry_forward=1").all())
      next.db.prepare("INSERT INTO pixel_working_state VALUES(?,?,?,?)").run(r.pixel_id!, r.state_json!, 1, r.updated_at!);
    for (const r of old.db.prepare("SELECT * FROM objectives WHERE carry_forward=1 AND state='OPEN'").all())
      next.db.prepare("INSERT INTO objectives VALUES(?,?,?,?,?,?)").run(r.id!, r.pixel_id!, r.content!, r.state!, 1, r.updated_at!);
    for (const r of old.db.prepare(`SELECT n.* FROM body_needs n WHERE n.carry_forward=1 AND
      (n.state IN ('NEED','GENERATED') OR (n.state='SATISFIED' AND EXISTS
        (SELECT 1 FROM body_candidates c JOIN body_skills s ON s.active_change_id=c.id
         WHERE c.need_id=n.id AND c.state='ACTIVE' AND s.state='ACTIVE')))`).all())
      next.db.prepare("INSERT INTO body_needs VALUES(?,?,?,?,?,?,?,?)").run(r.id!, r.pixel_id!, r.need!, r.evidence!,
        compatible && r.state === 'SATISFIED' ? 'SATISFIED' : 'NEED', 1, r.created_at!, r.updated_at!);
    const copied = new Set<string>();
    const copyCandidate = (id: string) => {
      if (copied.has(id)) return;
      const r = old.db.prepare("SELECT * FROM body_candidates WHERE id=? AND state IN ('ACTIVE','RETIRED')").get(id);
      if (!r) throw new Error("MIGRATION_SKILL_CANDIDATE_INVALID");
      if (r.previous_id) copyCandidate(String(r.previous_id));
      const needId = r.need_id && next.db.prepare("SELECT id FROM body_needs WHERE id=?").get(r.need_id) ? r.need_id : null;
      next.db.prepare(`INSERT INTO body_candidates(id,skill_id,need_id,candidate_json,request_hash,candidate_hash,validation,state,previous_id,activated_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(r.id!, r.skill_id!, needId, r.candidate_json!, r.request_hash!, r.candidate_hash!, r.validation!, r.state!, r.previous_id!, r.activated_at!, r.created_at!);
      copied.add(id);
    };
    for (const r of old.db.prepare("SELECT * FROM body_skills WHERE state='ACTIVE'").all()) {
      const skillCompatible = compatible && r.interface_version === next.meta().body_interface_version;
      if (r.active_change_id) copyCandidate(String(r.active_change_id));
      next.db.prepare("INSERT INTO body_skills VALUES(?,?,?,?,?,?,?,?)").run(r.skill_id!, r.name!, r.active_change_id!, r.interface_version!,
        skillCompatible ? "ACTIVE" : "REVALIDATION_REQUIRED", 0, 0, Date.now());
    }
  });
}
