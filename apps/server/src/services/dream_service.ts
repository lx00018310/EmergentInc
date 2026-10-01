import { createHash } from "node:crypto";
import { memoryPoint, nextBusinessOccurrence } from "@emergentinc/protocol";
import { LifeContext } from "./life_context.js";
import { LifeModel } from "./body_growth_service.js";

type Cursor = { current: number; lineage: number; business: number };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const zero = (): Cursor => ({ current: 0, lineage: 0, business: 0 });
const currentKinds = ["working_state_changed", "objective_changed", "body_need", "body_generated", "body_activated", "body_validation_failed", "body_rolled_back", "body_run_succeeded"];
const businessKinds = ["owner_feedback", "payment_evidence_recorded", "owner_order_updated", "task_failed", "task_completed"];

export class DreamService {
  private busy = false;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<unknown>;
  private failure: string | null = null;
  constructor(readonly life: LifeContext, private model?: LifeModel, readonly time = "03:00", readonly timezone = "Asia/Shanghai") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("INVALID_DREAM_TIME");
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { throw new Error("INVALID_DREAM_TIMEZONE"); }
  }
  status() {
    const pendingFactCount = this.facts().facts.length;
    return { busy: this.busy, failure: this.failure, time: this.time, timezone: this.timezone,
      hasNewFacts: pendingFactCount > 0, pendingFactCount };
  }
  private facts() {
    const generation = String(this.life.current.meta().generation_id);
    // Current cursors belong to one generation; shared cursors never regress after an older run is recovered.
    const from = this.life.lineage.db.prepare(`SELECT
      COALESCE(MAX(CASE WHEN generation_id=? THEN json_extract(to_cursor,'$.current') END),0) current,
      COALESCE(MAX(json_extract(to_cursor,'$.lineage')),0) lineage,
      COALESCE(MAX(json_extract(to_cursor,'$.business')),0) business
      FROM dream_runs WHERE status='COMPLETED' AND trigger!='post_rollback'`).get(generation) as Cursor;
    const to = { ...from };
    const facts: unknown[] = [];
    const sources = [
      { name: "current" as const, rows: this.life.current.db.prepare(`SELECT sequence cursor,kind,pixel_id,payload,created_at FROM current_events
          WHERE sequence>? AND kind IN (${currentKinds.map(() => "?").join(",")}) ORDER BY sequence LIMIT 40`).all(from.current, ...currentKinds) },
      { name: "lineage" as const, rows: this.life.lineage.db.prepare(`SELECT sequence cursor,kind,pixel_id,payload,created_at FROM life_events
          WHERE sequence>? AND (kind!='gene_proposed' OR json_extract(payload,'$.source')!='dream') ORDER BY sequence LIMIT 40`).all(from.lineage) },
      { name: "business" as const, rows: this.life.lineage.db.prepare(`SELECT rowid cursor,kind,payload,created_at FROM business_events
          WHERE rowid>? AND kind IN (${businessKinds.map(() => "?").join(",")}) ORDER BY rowid LIMIT 40`).all(from.business, ...businessKinds) },
    ];
    let bytes = 0;
    for (const source of sources) for (const row of source.rows) {
      const payload = JSON.parse(String(row.payload));
      const fact = { source: source.name, cursor: Number(row.cursor), kind: row.kind, pixel_id: row.pixel_id ?? "business",
        payload, created_at: row.created_at };
      const size = Buffer.byteLength(JSON.stringify(fact));
      // A single large change is reduced to its evidence reference rather than loading the whole state/report.
      const bounded = size > 4000 ? { ...fact, payload: { source_hash: hash(payload), excerpt: JSON.stringify(payload).slice(0, 1500) } } : fact;
      const boundedSize = Buffer.byteLength(JSON.stringify(bounded));
      if (bytes + boundedSize > 24000) break;
      facts.push(bounded); bytes += boundedSize; to[source.name] = Number(row.cursor);
    }
    return { generation, from, to, facts };
  }
  async run(trigger = "manual") { return this.runInput(trigger); }
  async retry(id: string) {
    const old = this.life.lineage.db.prepare("SELECT * FROM dream_runs WHERE id=?").get(id);
    if (!old || old.trigger === "post_rollback" || !["FAILED", "OUTCOME_UNKNOWN", "RUNNING"].includes(String(old.status)))
      throw new Error("DREAM_NOT_RETRYABLE");
    return this.runInput("owner_retry", id);
  }
  private async runInput(trigger: string, retryId?: string) {
    if (this.busy) throw new Error("DREAM_ALREADY_RUNNING");
    const db = this.life.lineage.db;
    const pending = db.prepare("SELECT id FROM dream_runs WHERE status IN ('RUNNING','OUTCOME_UNKNOWN') ORDER BY created_at LIMIT 1").get();
    if (pending && pending.id !== retryId) throw new Error("DREAM_OUTCOME_REQUIRES_REVIEW");
    const retried = retryId ? db.prepare("SELECT * FROM dream_runs WHERE id=?").get(retryId) : undefined;
    const operation = retried ? this.life.lineage.operation(`life:${retried.generation_id}:dream:${retryId}`) : undefined;
    if (retryId && (operation?.state !== "SETTLED" || !operation.response)) throw new Error("DREAM_SETTLED_RESPONSE_REQUIRED");
    const input = retried ? JSON.parse(String(retried.input_json)) : this.facts();
    if (!input.facts.length) return { status: "SKIPPED", modelCalls: 0 };
    if (!retryId && !this.model) throw new Error("DREAM_MODEL_REQUIRED");
    const inputHash = retried ? String(retried.input_hash) : hash(input), id = retryId ?? `dream-${inputHash}`;
    const old = db.prepare("SELECT * FROM dream_runs WHERE id=?").get(id);
    if (old?.status === "COMPLETED") return old;
    if (!retryId && (old?.status === "RUNNING" || old?.status === "OUTCOME_UNKNOWN")) throw new Error("DREAM_OUTCOME_REQUIRES_REVIEW");
    const modelInput = old ? JSON.parse(String(old.input_json)) : { ...input, genome: this.life.genome,
      relevant_memories: this.life.lineage.relevantMemories({ limit: 10 }) };
    this.busy = true;
    db.prepare(`INSERT INTO dream_runs(id,generation_id,from_cursor,to_cursor,status,input_hash,created_at,trigger,input_json)
      VALUES(?,?,?,?,'RUNNING',?,?,?,?) ON CONFLICT(id) DO UPDATE SET status='RUNNING',error=NULL`)
      .run(id, input.generation, JSON.stringify(input.from), JSON.stringify(input.to), inputHash, Date.now(), trigger, JSON.stringify(modelInput));
    try {
      const raw = retryId ? operation!.response! : await this.model!("dream", id, modelInput);
      const output = JSON.parse(raw);
      if (!output || Object.keys(output).sort().join(",") !== "gene_proposals,memories" ||
          !Array.isArray(output.memories) || !Array.isArray(output.gene_proposals) || output.memories.length > 20 || output.gene_proposals.length > 5)
        throw new Error("INVALID_DREAM_OUTPUT");
      const memories = output.memories.map(memoryPoint), proposals = output.gene_proposals.map(memoryPoint);
      db.transaction(() => {
        memories.forEach((p: ReturnType<typeof memoryPoint>, i: number) => this.life.lineage.remember(input.generation, "dream", p, `${id}:memory:${i}`, "business", 3, "dream"));
        proposals.forEach((p: ReturnType<typeof memoryPoint>, i: number) => this.life.lineage.proposeGene(this.life.current.meta().generation_id, "dream", p, `${id}:proposal:${i}`));
        db.prepare("UPDATE dream_runs SET status='COMPLETED',output_hash=?,finished_at=? WHERE id=?").run(hash(output), Date.now(), id);
      });
      this.failure = null;
      return db.prepare("SELECT * FROM dream_runs WHERE id=?").get(id)!;
    } catch (e) {
      const error = e instanceof Error ? e.message : "DREAM_FAILED";
      const unknown = /OUTCOME_UNKNOWN|COST_UNKNOWN|PREVIOUS_CALL_REQUIRES_REVIEW/.test(error);
      db.prepare("UPDATE dream_runs SET status=?,error=?,finished_at=? WHERE id=?").run(unknown ? "OUTCOME_UNKNOWN" : "FAILED", error, Date.now(), id);
      this.failure = error; throw e;
    } finally { this.busy = false; }
  }
  async finalDream() {
    // Drain bounded batches. Do not silently birth while important pre-birth facts remain.
    for (let i = 0; i < 100; i++) {
      const result = await this.run("final");
      if (result.status === "SKIPPED") return result;
    }
    throw new Error("FINAL_DREAM_BACKLOG_REQUIRES_REVIEW");
  }
  async postRollback(value: unknown) {
    if (this.busy) throw new Error("DREAM_ALREADY_RUNNING");
    const input = value as { source_generation: string; sha256: string; facts: unknown[] };
    if (!input || !/^G\d{4,}$/.test(input.source_generation) || !/^[a-f0-9]{64}$/.test(input.sha256) ||
        !Array.isArray(input.facts) || input.facts.length > 40 || Buffer.byteLength(JSON.stringify(input)) > 48000)
      throw new Error("INVALID_POST_ROLLBACK_DREAM_INPUT");
    const state = this.life.lineage.generation(input.source_generation).state;
    if (!["FAILED", "ROLLED_BACK"].includes(state)) throw new Error("POST_ROLLBACK_GENERATION_REQUIRED");
    const db = this.life.lineage.db, id = `post-rollback-${input.source_generation}-${input.sha256.slice(0, 24)}`;
    const old = db.prepare("SELECT * FROM dream_runs WHERE id=?").get(id);
    if (old?.status === "COMPLETED") return old;
    const pending = db.prepare("SELECT id FROM dream_runs WHERE status IN ('RUNNING','OUTCOME_UNKNOWN') AND id!=?").get(id);
    if (pending) throw new Error("DREAM_OUTCOME_REQUIRES_REVIEW");
    if (old && ["RUNNING", "OUTCOME_UNKNOWN"].includes(String(old.status))) {
      const op = this.life.lineage.operation(`life:${this.life.current.meta().generation_id}:dream:${id}`);
      if (op?.state !== "SETTLED" || !op.response) throw new Error("DREAM_SETTLED_RESPONSE_REQUIRED");
    }
    if (input.facts.length && !this.model) throw new Error("DREAM_MODEL_REQUIRED");
    this.busy = true;
    const inputHash = hash(input);
    db.prepare(`INSERT INTO dream_runs(id,generation_id,from_cursor,to_cursor,status,input_hash,created_at,trigger,input_json)
      VALUES(?,?,?,?,'RUNNING',?,?,'post_rollback',?) ON CONFLICT(id) DO UPDATE SET status='RUNNING',error=NULL`)
      .run(id, input.source_generation, JSON.stringify(zero()), JSON.stringify(zero()), inputHash, Date.now(), JSON.stringify(input));
    try {
      const raw = input.facts.length ? await this.model!("dream", id, old ? JSON.parse(String(old.input_json)) : input) : '{"memories":[],"gene_proposals":[]}';
      const output = JSON.parse(raw);
      if (!output || Object.keys(output).sort().join(",") !== "gene_proposals,memories" ||
          !Array.isArray(output.memories) || !Array.isArray(output.gene_proposals) || output.memories.length > 20 || output.gene_proposals.length > 5)
        throw new Error("INVALID_DREAM_OUTPUT");
      const memories = output.memories.map(memoryPoint), proposals = output.gene_proposals.map(memoryPoint);
      db.transaction(() => {
        memories.forEach((p: ReturnType<typeof memoryPoint>, i: number) => this.life.lineage.remember(input.source_generation, "dream", p, `${id}:memory:${i}`, "business", 4, "post_rollback"));
        proposals.forEach((p: ReturnType<typeof memoryPoint>, i: number) => this.life.lineage.proposeGene(this.life.current.meta().generation_id, "dream", p, `${id}:proposal:${i}`));
        db.prepare("UPDATE dream_runs SET status='COMPLETED',output_hash=?,finished_at=? WHERE id=?").run(hash(output), Date.now(), id);
        this.life.lineage.lifeEvent(this.life.current.meta().generation_id, "post_rollback_dream_completed", { sourceGeneration: input.source_generation }, `post-rollback-completed:${input.source_generation}`);
      });
      return db.prepare("SELECT * FROM dream_runs WHERE id=?").get(id)!;
    } catch (e) {
      const error = e instanceof Error ? e.message : "DREAM_FAILED";
      db.prepare("UPDATE dream_runs SET status=?,error=?,finished_at=? WHERE id=?")
        .run(/UNKNOWN|PREVIOUS_CALL_REQUIRES_REVIEW/.test(error) ? "OUTCOME_UNKNOWN" : "FAILED", error, Date.now(), id);
      throw e;
    } finally { this.busy = false; }
  }
  start() {
    const specification = { kind: "daily" as const, time: this.time, timezone: this.timezone, maxOccurrences: 366 };
    let next = nextBusinessOccurrence(specification, Date.now());
    this.timer = setInterval(() => {
      if (Date.now() < next || this.busy) return;
      next = nextBusinessOccurrence(specification, Date.now());
      this.inFlight = this.run("daily").catch(e => { this.failure = (e as Error).message; }).finally(() => { this.inFlight = undefined; });
    }, 30000);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer); await this.inFlight;
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 25));
  }
}
