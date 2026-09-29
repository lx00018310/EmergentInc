import { createHash } from "node:crypto";
import { SqliteDatabase } from "@emergentinc/persistence";
import { RootlessSandbox, AUTOMATION_PROFILE, AUTOMATION_SUITE_HASH, automationCandidateHash, validateAutomation, validateAutomationInput, validateAutomationOutput } from "@emergentinc/tools";

type Row = Record<string, any>;
type Runner = Pick<RootlessSandbox, "probe" | "run" | "recoverInterrupted">;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/** Separate trusted administrator process. Callers must hold the supervisor directory's OS-process lock. */
export class AutomationSupervisor {
  private readonly db: SqliteDatabase;
  private running = false;
  private recovered = false;
  constructor(filename: string, private runner: Runner, exclusiveSupervisorLockHeld: true) {
    if (!exclusiveSupervisorLockHeld) throw new Error("EXCLUSIVE_SUPERVISOR_LOCK_REQUIRED");
    this.db = new SqliteDatabase(filename);
    try { this.db.transaction(() => {
      const version = Number(this.db.prepare("PRAGMA user_version").get()!.user_version);
      if (version === 1) return;
      if (version !== 0 || this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)
        throw new Error("UNSUPPORTED_SUPERVISOR_SCHEMA");
      this.db.exec(`CREATE TABLE changes (
        id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, problem TEXT NOT NULL, evidence TEXT NOT NULL, source TEXT NOT NULL,
        state TEXT NOT NULL, candidate_hash TEXT, validation TEXT, approval_hash TEXT, approved_at INTEGER,
        previous_id TEXT REFERENCES changes(id), activated_at INTEGER, created_at INTEGER NOT NULL);
        CREATE TABLE active (profile TEXT PRIMARY KEY, change_id TEXT NOT NULL REFERENCES changes(id));
        CREATE TABLE history (sequence INTEGER PRIMARY KEY AUTOINCREMENT, change_id TEXT NOT NULL REFERENCES changes(id),
          kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
        PRAGMA user_version=1;`);
    }); } catch (e) { this.db.close(); throw e; }
  }
  close() { if (this.running) throw new Error("SUPERVISOR_BUSY"); this.db.close(); }
  private event(id: string, kind: string, payload: unknown = {}) {
    this.db.prepare("INSERT INTO history(change_id,kind,payload,created_at) VALUES(?,?,?,?)").run(id, kind, JSON.stringify(payload), Date.now());
  }
  get(id: string): Row {
    const row = this.db.prepare("SELECT * FROM changes WHERE id=?").get(id) as Row | undefined;
    if (!row) throw new Error("CHANGE_NOT_FOUND");
    return { ...row, validation: row.validation ? JSON.parse(row.validation) : null,
      history: this.db.prepare("SELECT kind,payload,created_at FROM history WHERE change_id=? ORDER BY sequence").all(id) };
  }
  list() { return this.db.prepare("SELECT id,problem,state,candidate_hash,created_at FROM changes ORDER BY created_at DESC").all(); }
  submit(input: { id: string; source: string; problem: string; evidence: string }) {
    if (!input || typeof input.id !== "string" || !/^[\w-]{8,100}$/.test(input.id) || typeof input.source !== "string" ||
      !input.source.trim() || Buffer.byteLength(input.source) > 65536 || [input.problem, input.evidence].some(v => typeof v !== "string" || !v.trim() || v.length > 4000))
      throw new Error("INVALID_CHANGE_REQUEST");
    const requestHash = hash({ source: input.source, problem: input.problem, evidence: input.evidence });
    return this.db.transaction(() => {
      const previous = this.db.prepare("SELECT request_hash FROM changes WHERE id=?").get(input.id);
      if (previous) { if (previous.request_hash !== requestHash) throw new Error("CHANGE_IDEMPOTENCY_CONFLICT"); return this.get(input.id); }
      this.db.prepare(`INSERT INTO changes(id,request_hash,problem,evidence,source,state,created_at) VALUES(?,?,?,?,?,'PROPOSED',?)`)
        .run(input.id, requestHash, input.problem, input.evidence, input.source, Date.now());
      this.event(input.id, "candidate_proposed"); return this.get(input.id);
    });
  }
  async recover() {
    if (this.running) throw new Error("SUPERVISOR_BUSY");
    await this.runner.recoverInterrupted({ exclusiveSupervisorLockHeld: true });
    this.db.transaction(() => {
      for (const row of this.db.prepare("SELECT id FROM changes WHERE state='VALIDATING'").all()) {
        this.db.prepare("UPDATE changes SET state='PROPOSED' WHERE id=?").run(row.id!);
        this.event(String(row.id), "interrupted_validation_reset");
      }
    });
    this.recovered = true;
  }
  async validate(id: string) {
    if (!this.recovered) throw new Error("SUPERVISOR_RECOVERY_REQUIRED");
    if (this.running) throw new Error("SUPERVISOR_BUSY");
    const change = this.get(id);
    if (change.state === "AWAITING_APPROVAL") { this.checked(change); return change; }
    if (change.state !== "PROPOSED") throw new Error("CHANGE_NOT_VALIDATABLE");
    this.running = true;
    this.db.transaction(() => { this.db.prepare("UPDATE changes SET state='VALIDATING' WHERE id=?").run(id); this.event(id, "validation_started"); });
    try {
      const receipt = await validateAutomation(change.source, this.runner);
      this.db.transaction(() => {
        this.db.prepare("UPDATE changes SET state=?,candidate_hash=?,validation=? WHERE id=?")
          .run(receipt.passed ? "AWAITING_APPROVAL" : "REJECTED", receipt.candidateHash, JSON.stringify(receipt), id);
        this.event(id, receipt.passed ? "validation_passed" : "validation_failed", receipt);
      });
    } catch (e) {
      // No approved program is affected when the validation environment is absent.
      this.db.transaction(() => { this.db.prepare("UPDATE changes SET state='PROPOSED' WHERE id=?").run(id);
        this.event(id, "validation_environment_unavailable", { reason: e instanceof Error ? e.message : "VALIDATION_FAILED" }); });
      throw e;
    } finally { this.running = false; }
    return this.get(id);
  }
  private checked(change: Row) {
    const v = change.validation;
    if (!v?.passed || v.profile !== AUTOMATION_PROFILE || v.suiteHash !== AUTOMATION_SUITE_HASH ||
      v.sourceHash !== hash(change.source) || change.candidate_hash !== automationCandidateHash(change.source, v.image) || v.candidateHash !== change.candidate_hash)
      throw new Error("CANDIDATE_VALIDATION_INVALID");
    return v;
  }
  approve(id: string, candidateHash: string) {
    if (this.running) throw new Error("SUPERVISOR_BUSY");
    return this.db.transaction(() => {
      const c = this.get(id); this.checked(c);
      if (candidateHash !== c.candidate_hash) throw new Error("CANDIDATE_APPROVAL_HASH_CONFLICT");
      if (c.approval_hash === candidateHash) return c;
      if (c.state !== "AWAITING_APPROVAL") throw new Error("CHANGE_NOT_APPROVABLE");
      this.db.prepare("UPDATE changes SET approval_hash=?,approved_at=? WHERE id=?").run(candidateHash, Date.now(), id);
      this.event(id, "owner_candidate_approved", { candidateHash }); return this.get(id);
    });
  }
  async activate(id: string) {
    if (!this.recovered) throw new Error("SUPERVISOR_RECOVERY_REQUIRED");
    if (this.running) throw new Error("SUPERVISOR_BUSY");
    const environment = await this.runner.probe();
    return this.db.transaction(() => {
      const c = this.get(id), receipt = this.checked(c);
      if (receipt.image !== environment.image) throw new Error("APPROVED_RUNTIME_CHANGED");
      if (!c.approval_hash || c.approval_hash !== c.candidate_hash) throw new Error("OWNER_CANDIDATE_APPROVAL_REQUIRED");
      if (c.activated_at !== null) return c; // A repeated change_id never activates twice or resurrects a failed release.
      if (c.state !== "AWAITING_APPROVAL") throw new Error("CHANGE_NOT_DEPLOYABLE");
      const previous = this.db.prepare("SELECT change_id FROM active WHERE profile=?").get(AUTOMATION_PROFILE)?.change_id ?? null;
      if (previous) this.db.prepare("UPDATE changes SET state='RETIRED' WHERE id=?").run(previous);
      this.db.prepare("UPDATE changes SET state='ACTIVE',previous_id=?,activated_at=? WHERE id=?").run(previous, Date.now(), id);
      this.db.prepare("INSERT INTO active VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET change_id=excluded.change_id").run(AUTOMATION_PROFILE, id);
      this.event(id, "automation_activated", { candidateHash: c.candidate_hash, previous }); return this.get(id);
    });
  }
  rollback(id: string, reason: string) {
    return this.db.transaction(() => {
      const c = this.get(id);
      if (c.state === "ROLLED_BACK") return c;
      const active = this.db.prepare("SELECT change_id FROM active WHERE profile=?").get(AUTOMATION_PROFILE);
      if (active?.change_id !== id) throw new Error("CHANGE_NOT_ACTIVE");
      let restored: string | null = null;
      if (c.previous_id) {
        const previous = this.get(c.previous_id); this.checked(previous);
        if (previous.approval_hash !== previous.candidate_hash || previous.validation.image !== c.validation.image) throw new Error("PREVIOUS_APPROVAL_INVALID");
        this.db.prepare("UPDATE changes SET state='ACTIVE' WHERE id=?").run(previous.id);
        this.db.prepare("UPDATE active SET change_id=? WHERE profile=?").run(previous.id, AUTOMATION_PROFILE); restored = previous.id;
      } else this.db.prepare("DELETE FROM active WHERE profile=?").run(AUTOMATION_PROFILE);
      this.db.prepare("UPDATE changes SET state='ROLLED_BACK' WHERE id=?").run(id);
      this.event(id, "automation_rolled_back", { reason, restored }); return this.get(id);
    });
  }
  async run(input: unknown) {
    if (!this.recovered) throw new Error("SUPERVISOR_RECOVERY_REQUIRED");
    if (this.running) throw new Error("SUPERVISOR_BUSY");
    validateAutomationInput(input);
    const active = this.db.prepare("SELECT change_id FROM active WHERE profile=?").get(AUTOMATION_PROFILE);
    if (!active) throw new Error("APPROVED_AUTOMATION_REQUIRED");
    const c = this.get(String(active.change_id)), receipt = this.checked(c);
    if (c.approval_hash !== c.candidate_hash) throw new Error("OWNER_CANDIDATE_APPROVAL_REQUIRED");
    this.running = true;
    try {
      const environment = await this.runner.probe();
      if (environment.image !== receipt.image) throw new Error("APPROVED_RUNTIME_CHANGED");
      const result = await this.runner.run(c.source, input);
      validateAutomationOutput(input, result);
      this.event(c.id, "automation_run_completed", { inputHash: hash(input), resultHash: hash(result) });
      return { changeId: c.id, candidateHash: c.candidate_hash, result };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "AUTOMATION_EXECUTION_FAILED";
      try {
        if (!/^(AUTOMATION_|SANDBOX_COMMAND_TIMEOUT$|SANDBOX_OUTPUT_LIMIT$)/.test(reason)) throw new Error("ENVIRONMENT_REQUIRES_REVIEW");
        this.rollback(c.id, reason);
      } catch {
        this.db.transaction(() => { this.db.prepare("DELETE FROM active WHERE profile=?").run(AUTOMATION_PROFILE);
          this.db.prepare("UPDATE changes SET state='RECOVERY_REQUIRED' WHERE id=?").run(c.id); this.event(c.id, "rollback_failed", { reason }); });
      }
      throw e; // No automatic replay against the previous program.
    } finally { this.running = false; }
  }
}
