import { createHash, randomUUID } from "node:crypto";
import { BusinessPlan, BusinessPlanView, validateBusinessPlan, nextBusinessOccurrence } from "@emergentinc/protocol";
import { SqliteDatabase } from "./sqlite/db.js";
import { migrateBusiness } from "./migrations/business_schema.js";
import { BusinessEvidence } from "./business_evidence.js";

export const businessHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Row = Record<string, any>;
export interface BusinessTask {
  id: string; plan_id: string; revision: number; grant_id: string; capability: string;
  capability_version: string; input: string; generation: number; state: string;
}
export class BusinessStore {
  readonly db: SqliteDatabase;
  readonly evidence: BusinessEvidence;
  constructor(filename = ":memory:") {
    this.db = new SqliteDatabase(filename);
    try { migrateBusiness(this.db); } catch (e) { this.db.close(); throw e; }
    this.evidence = new BusinessEvidence(this.db);
  }
  close() { this.db.close(); }
  settings(): Row | undefined { return this.db.prepare("SELECT * FROM business_settings WHERE id=1").get() as Row | undefined; }
  configure(value: { limitMicros: number; draftLimitMicros: number; draftCallLimit: number; draftExpiresAt: number }) {
    if (!value || ![value.limitMicros, value.draftLimitMicros, value.draftCallLimit, value.draftExpiresAt].every(Number.isSafeInteger) ||
        value.limitMicros < 0 || value.limitMicros > 1_000_000_000_000 || value.draftLimitMicros < 0 ||
        value.draftLimitMicros > value.limitMicros || value.draftCallLimit < 0 || value.draftCallLimit > 10000 ||
        value.draftExpiresAt <= Date.now()) throw new Error("INVALID_BUDGET");
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO business_settings VALUES(1,'CNY',?,?,?,?) ON CONFLICT(id) DO UPDATE SET
        limit_micros=excluded.limit_micros,draft_limit_micros=excluded.draft_limit_micros,
        draft_call_limit=excluded.draft_call_limit,draft_expires_at=excluded.draft_expires_at`)
        .run(value.limitMicros, value.draftLimitMicros, value.draftCallLimit, value.draftExpiresAt);
      this.event(null, "budget_approved", value);
    });
  }
  totals(planId?: string, scope?: string) {
    const row = this.db.prepare(`SELECT COALESCE(SUM(c.amount_micros),0) spent,
      COALESCE(SUM(CASE WHEN o.state IN ('RESERVED','DISPATCHED','OUTCOME_UNKNOWN') THEN o.reserved_micros ELSE 0 END),0) reserved
      FROM business_operations o LEFT JOIN business_cost_entries c ON c.operation_id=o.id
      WHERE (? IS NULL OR o.plan_id=?) AND (? IS NULL OR o.scope=?)`).get(planId ?? null, planId ?? null, scope ?? null, scope ?? null) as Row;
    const spentMicros = Number(row.spent), reservedMicros = Number(row.reserved);
    if (!Number.isSafeInteger(spentMicros) || !Number.isSafeInteger(reservedMicros)) throw new Error("LEDGER_INTEGER_RANGE_EXCEEDED");
    return { spentMicros, reservedMicros };
  }
  event(planId: string | null, kind: string, payload: unknown, id: string = randomUUID()) {
    this.db.prepare("INSERT INTO business_events VALUES(?,?,?,?,?)").run(id, planId, kind, JSON.stringify(payload), Date.now());
  }
  operation(id: string): Row | undefined { return this.db.prepare("SELECT * FROM business_operations WHERE id=?").get(id) as Row | undefined; }
  reserveDraft(id: string, requestHash: string, amount: number, pricing: unknown, planId?: string, request?: unknown) {
    return this.db.transaction(() => {
      const existing = this.operation(id);
      if (existing) {
        if (existing.request_hash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
        return existing;
      }
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("INVALID_RESERVATION");
      const settings = this.settings();
      if (!settings || settings.draft_expires_at <= Date.now()) throw new Error("DRAFT_ALLOWANCE_REQUIRED");
      const total = this.totals(), drafts = this.totals(undefined, "draft");
      const count = Number((this.db.prepare("SELECT COUNT(*) n FROM business_operations WHERE scope='draft'").get() as Row).n);
      if (count >= settings.draft_call_limit || total.spentMicros + total.reservedMicros + amount > settings.limit_micros ||
          drafts.spentMicros + drafts.reservedMicros + amount > settings.draft_limit_micros) throw new Error("BUDGET_EXHAUSTED");
      if (planId) {
        this.getPlan(planId);
        const grant = this.db.prepare("SELECT snapshot FROM business_grants WHERE plan_id=? ORDER BY revision DESC LIMIT 1").get(planId) as Row | undefined;
        const used = this.totals(planId);
        // A model-generated revision cannot increase an already approved lifetime limit.
        if (grant && used.spentMicros + used.reservedMicros + amount > JSON.parse(grant.snapshot).budgetMicros) throw new Error("PLAN_BUDGET_EXHAUSTED");
      }
      this.db.prepare("INSERT INTO business_operations VALUES(?, 'draft', ?, 'plan_proposal', ?, ?, ?, 'RESERVED', NULL, ?, ?)")
        .run(id, planId ?? null, requestHash, JSON.stringify(pricing), amount, Date.now(), request ? JSON.stringify(request) : null);
      return undefined;
    });
  }
  dispatch(id: string) {
    this.db.transaction(() => {
      const s = this.settings();
      if (!s || s.draft_expires_at <= Date.now()) throw new Error("DRAFT_ALLOWANCE_EXPIRED");
      const total = this.totals(), drafts = this.totals(undefined, "draft");
      if (total.spentMicros + total.reservedMicros > s.limit_micros ||
          drafts.spentMicros + drafts.reservedMicros > s.draft_limit_micros) throw new Error("BUDGET_EXHAUSTED");
      const updated = this.db.prepare("UPDATE business_operations SET state='DISPATCHED' WHERE id=? AND state='RESERVED'").run(id);
      if (!updated.changes) throw new Error("OPERATION_NOT_DISPATCHABLE");
    });
  }
  settle(id: string, amount: number | null, response: string | null, evidence: unknown) {
    this.db.transaction(() => {
      const op = this.operation(id);
      if (!op || !["DISPATCHED", "OUTCOME_UNKNOWN"].includes(op.state)) throw new Error("OPERATION_NOT_SETTLEABLE");
      if (amount !== null && (!Number.isSafeInteger(amount) || amount < 0)) throw new Error("INVALID_ACTUAL_COST");
      if (amount !== null) this.db.prepare("INSERT INTO business_cost_entries VALUES(?,?,?,?)").run(id, amount, JSON.stringify(evidence), Date.now());
      this.db.prepare("UPDATE business_operations SET state=?,response=COALESCE(?,response) WHERE id=?")
        .run(amount === null ? "OUTCOME_UNKNOWN" : "SETTLED", response, id);
      this.event(op.plan_id, amount === null ? "cost_unknown" : "cost_settled", { operationId: id, amount, evidence });
    });
  }
  notSent(id: string) {
    this.db.prepare("UPDATE business_operations SET state='NOT_SENT' WHERE id=? AND state IN ('RESERVED','DISPATCHED')").run(id);
  }
  recoverOperations() {
    this.db.transaction(() => {
      this.db.prepare("UPDATE business_operations SET state='OUTCOME_UNKNOWN' WHERE state='DISPATCHED'").run();
      this.db.prepare("UPDATE business_operations SET state='NOT_SENT' WHERE state='RESERVED'").run();
    });
  }
  saveProposal(direction: string, body: BusinessPlan, operationId: string, planId?: string, expectedRevision?: number): BusinessPlanView {
    const plan = validateBusinessPlan(body);
    return this.db.transaction(() => {
      const op = this.operation(operationId);
      if (!op || op.state !== "SETTLED") throw new Error("PROPOSAL_COST_UNRESOLVED");
      // The event is the durable idempotent result, including across process restarts.
      const saved = this.db.prepare("SELECT plan_id,payload FROM business_events WHERE id=?").get(`proposal:${operationId}`) as Row | undefined;
      if (saved) return this.getPlan(saved.plan_id);
      const id = planId ?? randomUUID();
      const previous = planId ? this.getPlan(id) : undefined;
      if (previous && previous.revision !== expectedRevision) throw new Error("REVISION_CONFLICT");
      const revision = this.insertRevision(id, direction, plan, previous?.revision);
      // Only bind initial drafting cost once. A revision never resets previous spend.
      this.db.prepare("UPDATE business_operations SET plan_id=? WHERE id=?").run(id, operationId);
      this.event(id, "proposal_created", { revision, operationId }, `proposal:${operationId}`);
      return this.getPlan(id);
    });
  }
  private insertRevision(id: string, direction: string, plan: BusinessPlan, previousRevision?: number) {
      const revision = (previousRevision ?? 0) + 1;
      if (!previousRevision) this.db.prepare("INSERT INTO business_plans VALUES(?,?,?,'AWAITING_APPROVAL',?)").run(id, direction, revision, Date.now());
      else {
        this.db.prepare("UPDATE business_plans SET revision=?,state='AWAITING_APPROVAL' WHERE id=?").run(revision, id);
        this.db.prepare("UPDATE business_grants SET revoked_at=? WHERE plan_id=? AND revoked_at IS NULL").run(Date.now(), id);
        this.db.prepare("UPDATE business_tasks SET state='CANCELLED' WHERE plan_id=? AND state IN ('READY','WAITING_RESOURCE')").run(id);
        this.db.prepare("UPDATE business_requests SET state='SUPERSEDED' WHERE plan_id=? AND state='OPEN'").run(id);
        this.db.prepare("UPDATE business_schedules SET state='CANCELLED' WHERE plan_id=? AND state='ACTIVE'").run(id);
      }
      this.db.prepare("INSERT INTO business_plan_revisions VALUES(?,?,?,?,?)").run(id, revision, businessHash(plan), JSON.stringify(plan), Date.now());
      return revision;
  }
  revisions(id: string) {
    this.getPlan(id);
    return (this.db.prepare("SELECT revision,hash,body,created_at FROM business_plan_revisions WHERE plan_id=? ORDER BY revision DESC").all(id) as Row[])
      .map(row => ({ revision: row.revision, hash: row.hash, plan: JSON.parse(row.body), createdAt: row.created_at }));
  }
  restoreRevision(id: string, input: { revision: number; hash: string; currentRevision: number; expiresAt: number; budgetMicros: number }) {
    if (!input || !Number.isSafeInteger(input.revision) || !Number.isSafeInteger(input.currentRevision)) throw new Error("INVALID_REVISION");
    return this.db.transaction(() => {
      const current = this.getPlan(id);
      if (current.revision !== input.currentRevision) throw new Error("REVISION_CONFLICT");
      const source = this.db.prepare("SELECT hash,body FROM business_plan_revisions WHERE plan_id=? AND revision=?").get(id, input.revision) as Row | undefined;
      if (!source || source.hash !== input.hash || input.revision >= current.revision) throw new Error("RESTORE_VERSION_CONFLICT");
      const plan = validateBusinessPlan({ ...JSON.parse(source.body), expiresAt: input.expiresAt, budgetMicros: input.budgetMicros });
      if (plan.budgetMicros < current.spentMicros + current.reservedMicros) throw new Error("PLAN_BUDGET_EXHAUSTED");
      const revision = this.insertRevision(id, current.direction, plan, current.revision);
      this.event(id, "strategy_restore_proposed", { revision, sourceRevision: input.revision, sourceHash: input.hash, source: "owner_confirmed" });
      return this.getPlan(id);
    });
  }
  getPlan(id: string): BusinessPlanView {
    const row = this.db.prepare(`SELECT p.*,r.hash,r.body FROM business_plans p JOIN business_plan_revisions r
      ON r.plan_id=p.id AND r.revision=p.revision WHERE p.id=?`).get(id) as Row | undefined;
    if (!row) throw new Error("PLAN_NOT_FOUND");
    const previous = this.db.prepare("SELECT body FROM business_plan_revisions WHERE plan_id=? AND revision=?").get(id, row.revision - 1) as Row | undefined;
    return { id, direction: row.direction, revision: row.revision, hash: row.hash, state: row.state,
      plan: JSON.parse(row.body), ...this.totals(id), ...(previous ? { previousPlan: JSON.parse(previous.body) } : {}) };
  }
  listPlans(): BusinessPlanView[] {
    return (this.db.prepare("SELECT id FROM business_plans ORDER BY created_at DESC").all() as Row[]).map(r => this.getPlan(r.id));
  }
  approve(id: string, revision: number, hash: string) {
    return this.db.transaction(() => {
      const view = this.getPlan(id);
      if (view.revision !== revision || view.hash !== hash) throw new Error("APPROVAL_VERSION_CONFLICT");
      const previous = this.db.prepare("SELECT * FROM business_grants WHERE plan_id=? AND revision=?").get(id, revision) as Row | undefined;
      if (previous) {
        if (previous.revoked_at !== null) throw new Error("GRANT_REVOKED_REVISE_PLAN");
        return view;
      }
      if (view.state !== "AWAITING_APPROVAL" || view.plan.expiresAt <= Date.now()) throw new Error("PLAN_NOT_APPROVABLE");
      if (view.spentMicros + view.reservedMicros > view.plan.budgetMicros) throw new Error("PLAN_BUDGET_EXHAUSTED");
      const grant = randomUUID();
      this.db.prepare("INSERT INTO business_grants VALUES(?,?,?,?,?,'owner',?,NULL)")
        .run(grant, id, revision, hash, JSON.stringify(view.plan), Date.now());
      const missing = new Set(view.plan.resources);
      for (const a of view.plan.actions) {
        if (a.capability === "data_report" && !this.dataset(a.datasetId)) missing.add(`dataset:${a.datasetId}`);
        if (a.capability === "github_issue_create") {
          const c = this.connection(a.connectionId);
          if (!c?.enabled) missing.add(`connection:${a.connectionId}`);
          else if (c.repository !== a.repository || c.account_login !== a.accountLogin) throw new Error("CONNECTION_SCOPE_MISMATCH");
        }
      }
      for (const resource of missing) this.db.prepare("INSERT INTO business_requests VALUES(?,?,?,?,'OPEN',NULL)").run(randomUUID(), id, revision, resource);
      if (view.plan.schedule) {
        const next = nextBusinessOccurrence(view.plan.schedule, Date.now());
        if (next >= view.plan.expiresAt) throw new Error("SCHEDULE_AFTER_PLAN_EXPIRY");
        this.db.prepare("INSERT INTO business_schedules VALUES(?,?,?,?,?,?,0,'ACTIVE')")
          .run(randomUUID(), id, revision, grant, JSON.stringify(view.plan.schedule), next);
      } else this.enqueueActions(view, grant, randomUUID(), missing.size ? "WAITING_RESOURCE" : "READY");
      this.db.prepare("UPDATE business_plans SET state=? WHERE id=?").run(missing.size ? "WAITING_RESOURCE" : "ACTIVE", id);
      this.event(id, "plan_approved", { revision, hash, grant, approvedBy: "owner" });
      return this.getPlan(id);
    });
  }
  control(id: string, action: "pause" | "resume" | "revoke") {
    this.db.transaction(() => {
      const view = this.getPlan(id);
      if (action === "revoke") {
        this.db.prepare("UPDATE business_grants SET revoked_at=? WHERE plan_id=? AND revoked_at IS NULL").run(Date.now(), id);
        this.db.prepare("UPDATE business_tasks SET state='CANCELLED' WHERE plan_id=? AND state IN ('READY','WAITING_RESOURCE')").run(id);
        this.db.prepare("UPDATE business_requests SET state='CANCELLED' WHERE plan_id=? AND state='OPEN'").run(id);
        this.db.prepare("UPDATE business_schedules SET state='CANCELLED' WHERE plan_id=? AND state='ACTIVE'").run(id);
        this.db.prepare("UPDATE business_plans SET state='STOPPED' WHERE id=?").run(id);
      } else if (action === "pause") {
        if (!["ACTIVE", "WAITING_RESOURCE"].includes(view.state)) throw new Error("PLAN_NOT_RUNNING");
        this.db.prepare("UPDATE business_plans SET state='PAUSED' WHERE id=?").run(id);
      } else {
        if (view.state !== "PAUSED" || view.plan.expiresAt <= Date.now()) throw new Error("PLAN_NOT_RESUMABLE");
        const g = this.db.prepare("SELECT id FROM business_grants WHERE plan_id=? AND revision=? AND revoked_at IS NULL").get(id, view.revision);
        if (!g) throw new Error("GRANT_REQUIRED");
        const waiting = this.db.prepare("SELECT id FROM business_requests WHERE plan_id=? AND revision=? AND state='OPEN'").get(id, view.revision);
        this.db.prepare("UPDATE business_plans SET state=? WHERE id=?").run(waiting ? "WAITING_RESOURCE" : "ACTIVE", id);
      }
      this.event(id, `plan_${action}`, {});
    });
    return this.getPlan(id);
  }
  addDataset(id: string, name: string, rows: unknown[]) {
    if (!/^[\w-]{1,100}$/.test(id) || typeof name !== "string" || !name.trim() || name.length > 200 ||
      !Array.isArray(rows) || rows.length > 10000 || rows.some(r => !r || typeof r !== "object" || Array.isArray(r)) ||
      JSON.stringify(rows).length > 500000) throw new Error("INVALID_DATASET");
    if (new Set(rows.flatMap(r => Object.keys(r as object))).size > 200) throw new Error("DATASET_TOO_MANY_FIELDS");
    const content = JSON.stringify(rows), hash = businessHash(rows);
    const existing = this.dataset(id);
    if (existing) { if (existing.hash !== hash) throw new Error("DATASET_IMMUTABLE_USE_NEW_ID"); return id; }
    this.db.prepare("INSERT INTO business_datasets VALUES(?,?,?,?,?)").run(id, name, content, hash, Date.now());
    return id;
  }
  dataset(id: string): Row | undefined { return this.db.prepare("SELECT * FROM business_datasets WHERE id=?").get(id) as Row | undefined; }
  datasets() { return this.db.prepare("SELECT id,name,hash,created_at FROM business_datasets ORDER BY created_at DESC").all(); }
  resolveResource(id: string, decision: "provided" | "reject", note: string) {
    if (!note.trim() || note.length > 4000) throw new Error("RESOURCE_EVIDENCE_REQUIRED");
    this.db.transaction(() => {
      const r = this.db.prepare("SELECT * FROM business_requests WHERE id=?").get(id) as Row | undefined;
      if (!r || r.state !== "OPEN") throw new Error("REQUEST_NOT_OPEN");
      if (r.resource.startsWith("task:")) throw new Error("USE_TASK_RECOVERY_ACTION");
      const plan = this.getPlan(r.plan_id);
      if (plan.revision !== r.revision || plan.plan.expiresAt <= Date.now() || plan.state === "STOPPED") throw new Error("GRANT_INACTIVE");
      if (decision === "reject") { this.control(r.plan_id, "revoke"); return; }
      if (r.resource.startsWith("dataset:") && !this.dataset(r.resource.slice(8))) throw new Error("DATASET_REQUIRED");
      if (r.resource.startsWith("connection:")) {
        const connection = this.connection(r.resource.slice(11));
        if (!connection?.enabled) throw new Error("CONNECTION_REQUIRED");
        if (plan.plan.actions.some(a => a.capability === "github_issue_create" && a.connectionId === connection.id &&
          (a.repository !== connection.repository || a.accountLogin !== connection.account_login))) throw new Error("CONNECTION_SCOPE_MISMATCH");
      }
      this.db.prepare("UPDATE business_requests SET state='PROVIDED',resolution=? WHERE id=?").run(note, id);
      this.event(r.plan_id, "resource_provided", { id, note });
      const waiting = this.db.prepare("SELECT id FROM business_requests WHERE plan_id=? AND revision=? AND state='OPEN'").get(r.plan_id, r.revision);
      if (!waiting) {
        this.db.prepare("UPDATE business_tasks SET state='READY' WHERE plan_id=? AND revision=? AND state='WAITING_RESOURCE'").run(r.plan_id, r.revision);
        this.db.prepare("UPDATE business_plans SET state='ACTIVE' WHERE id=? AND state='WAITING_RESOURCE'").run(r.plan_id);
      }
    });
  }
  assertTaskAuthorized(task: BusinessTask) {
    const plan = this.getPlan(task.plan_id);
    const g = this.db.prepare("SELECT * FROM business_grants WHERE id=? AND plan_id=? AND revision=? AND revoked_at IS NULL")
      .get(task.grant_id, task.plan_id, task.revision) as Row | undefined;
    if (!g || plan.state !== "ACTIVE" || plan.revision !== task.revision || plan.hash !== g.hash || plan.plan.expiresAt <= Date.now()) throw new Error("GRANT_INACTIVE");
    const input = JSON.parse(task.input);
    const snapshot: BusinessPlan = JSON.parse(g.snapshot);
    if (!snapshot.actions.some(a => a.capability === task.capability && a.version === task.capability_version &&
      businessHash(a) === businessHash(input))) throw new Error("CAPABILITY_SCOPE_DENIED");
    if (input.capability === "github_issue_create") {
      const c = this.connection(input.connectionId);
      if (!c?.enabled || c.repository !== input.repository || c.account_login !== input.accountLogin) throw new Error("CONNECTION_SCOPE_DENIED");
    }
    return input as BusinessPlan["actions"][number];
  }
  connection(id: string): Row | undefined { return this.db.prepare("SELECT * FROM business_connections WHERE id=?").get(id) as Row | undefined; }
  connections() { return this.db.prepare("SELECT * FROM business_connections ORDER BY created_at DESC").all(); }
  saveConnection(id: string, repository: string, accountLogin: string) {
    if (!/^[\w-]{1,100}$/.test(id) || this.connection(id)) throw new Error("CONNECTION_IMMUTABLE_USE_NEW_ID");
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO business_connections VALUES(?,'github',?,?,1,?)").run(id, repository, accountLogin, Date.now());
      this.event(null, "connection_authorized", { id, repository, accountLogin });
    });
  }
  disableConnection(id: string) {
    this.db.transaction(() => {
      if (!this.connection(id)) throw new Error("CONNECTION_NOT_FOUND");
      this.db.prepare("UPDATE business_connections SET enabled=0 WHERE id=?").run(id);
      this.event(null, "connection_disabled", { id });
    });
  }
  prepareTaskOperation(task: BusinessTask): string {
    return this.db.transaction(() => {
      this.assertTaskAuthorized(task);
      const id = `task:${task.id}`, requestHash = businessHash(JSON.parse(task.input));
      const existing = this.operation(id);
      if (existing) throw new Error("TASK_OPERATION_ALREADY_EXISTS");
      const settings = this.settings(), totals = this.totals(), view = this.getPlan(task.plan_id);
      if (!settings || totals.spentMicros + totals.reservedMicros > settings.limit_micros ||
        view.spentMicros + view.reservedMicros > view.plan.budgetMicros) throw new Error("BUDGET_EXHAUSTED");
      this.db.prepare("INSERT INTO business_operations VALUES(?,'task',?,'github_issue_create',?,'{}',0,'RESERVED',NULL,?,?)")
        .run(id, task.plan_id, requestHash, Date.now(), task.input);
      return id;
    });
  }
  prepareReviewOperation(task: BusinessTask, request: unknown, reserved: number, pricing: unknown) {
    return this.db.transaction(() => {
      this.assertTaskAuthorized(task);
      if (task.capability !== "review_feedback" || !Number.isSafeInteger(reserved) || reserved < 0) throw new Error("INVALID_REVIEW_RESERVATION");
      const settings = this.settings(), totals = this.totals(), view = this.getPlan(task.plan_id);
      if (!settings || totals.spentMicros + totals.reservedMicros + reserved > settings.limit_micros ||
        view.spentMicros + view.reservedMicros + reserved > view.plan.budgetMicros) throw new Error("BUDGET_EXHAUSTED");
      const id = `task:${task.id}`;
      this.db.prepare("INSERT INTO business_operations VALUES(?,'review',?,'feedback_review',?,?,?,'RESERVED',NULL,?,?)")
        .run(id, task.plan_id, businessHash(request), JSON.stringify(pricing), reserved, Date.now(), JSON.stringify(request));
      return id;
    });
  }
  dispatchTaskOperation(task: BusinessTask, operationId: string) {
    this.db.transaction(() => {
      this.assertTaskAuthorized(task);
      if (operationId !== `task:${task.id}` || !this.db.prepare("UPDATE business_operations SET state='DISPATCHED' WHERE id=? AND state='RESERVED'").run(operationId).changes) throw new Error("OPERATION_NOT_DISPATCHABLE");
    });
  }
  completeTaskOperation(task: BusinessTask, operationId: string, receipt: unknown) {
    this.db.transaction(() => {
      if (operationId !== `task:${task.id}`) throw new Error("OPERATION_SCOPE_DENIED");
      this.settle(operationId, 0, JSON.stringify(receipt), { source: "provider_verified", capability: task.capability });
      this.finishTask(task, receipt);
    });
  }
  unknownTaskOperation(task: BusinessTask, operationId: string) {
    this.db.transaction(() => {
      this.settle(operationId, null, null, { reason: "external_write_outcome_unknown" });
      this.db.prepare("UPDATE business_tasks SET state='OUTCOME_UNKNOWN',lease_until=NULL WHERE id=? AND generation=?").run(task.id, task.generation);
      this.event(task.plan_id, "external_write_requires_review", { taskId: task.id, operationId });
    });
  }
  recoverExternalTasks() {
    this.db.transaction(() => {
      this.db.prepare(`UPDATE business_tasks SET state='OUTCOME_UNKNOWN',lease_until=NULL WHERE state='RUNNING'
        AND capability IN ('github_issue_create','review_feedback') AND EXISTS (SELECT 1 FROM business_operations o WHERE o.id='task:' || business_tasks.id AND o.state='OUTCOME_UNKNOWN')`).run();
      // Pre-dispatch crash is known not sent, but still requires an Owner retry decision.
      const interrupted = this.db.prepare(`SELECT * FROM business_tasks WHERE state='RUNNING'
        AND capability IN ('github_issue_create','review_feedback') AND NOT EXISTS
        (SELECT 1 FROM business_operations o WHERE o.id='task:' || business_tasks.id AND o.state='SETTLED')`).all() as unknown as BusinessTask[];
      for (const task of interrupted) {
        this.finishTask(task, null, "REQUEST_NOT_SENT_REVISE_PLAN");
        if (this.getPlan(task.plan_id).state === "ACTIVE") this.control(task.plan_id, "pause");
      }
    });
  }
  task(id: string): BusinessTask | undefined { return this.db.prepare("SELECT * FROM business_tasks WHERE id=?").get(id) as unknown as BusinessTask | undefined; }
  recordReconciledTask(task: BusinessTask, receipt: unknown) {
    this.db.transaction(() => {
      if (this.task(task.id)?.state !== "OUTCOME_UNKNOWN") throw new Error("TASK_NOT_UNKNOWN");
      this.db.prepare("UPDATE business_tasks SET state='RUNNING' WHERE id=?").run(task.id);
      this.completeTaskOperation(task, `task:${task.id}`, receipt);
    });
  }
  acquireWorker(owner: string) {
    return this.db.transaction(() => {
      const now = Date.now();
      const row = this.db.prepare("SELECT * FROM business_worker WHERE id=1").get() as Row | undefined;
      if (row && row.owner !== owner && row.lease_until > now) return false;
      this.db.prepare("INSERT INTO business_worker VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,lease_until=excluded.lease_until").run(owner, now + 30000);
      return true;
    });
  }
  releaseWorker(owner: string) { this.db.prepare("DELETE FROM business_worker WHERE owner=?").run(owner); }
  private enqueueActions(view: BusinessPlanView, grant: string, occurrence: string, state = "READY") {
    view.plan.actions.forEach((action, index) => this.db.prepare(`INSERT INTO business_tasks
      (id,plan_id,revision,grant_id,capability,capability_version,input,state,next_run_at,parent_id) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(`${occurrence}:${index}`, view.id, view.revision, grant, action.capability, action.version, JSON.stringify(action), state, Date.now(), index ? `${occurrence}:${index - 1}` : null));
  }
  materializeSchedules() {
    this.db.transaction(() => {
      const now = Date.now();
      const due = this.db.prepare(`SELECT s.* FROM business_schedules s JOIN business_plans p ON p.id=s.plan_id
        WHERE s.state='ACTIVE' AND p.state='ACTIVE' AND s.next_run_at<=? ORDER BY s.next_run_at LIMIT 100`).all(now) as Row[];
      for (const schedule of due) {
        if (this.db.prepare("SELECT id FROM business_operations WHERE plan_id=? AND state='OUTCOME_UNKNOWN' AND scope='review'").get(schedule.plan_id)) continue;
        const view = this.getPlan(schedule.plan_id);
        const grant = this.db.prepare("SELECT id FROM business_grants WHERE id=? AND revoked_at IS NULL").get(schedule.grant_id);
        if (!grant || view.revision !== schedule.revision || view.plan.expiresAt <= now) {
          this.db.prepare("UPDATE business_schedules SET state='CANCELLED' WHERE id=?").run(schedule.id); continue;
        }
        const specification = JSON.parse(schedule.specification) as NonNullable<BusinessPlan["schedule"]>;
        const occurrence = `schedule:${schedule.id}:${schedule.next_run_at}`;
        // One coalesced data report after downtime; the next occurrence is strictly in the future.
        this.event(view.id, "schedule_due", { scheduledAt: schedule.next_run_at, actualAt: now }, occurrence);
        this.enqueueActions(view, schedule.grant_id, occurrence);
        const next = nextBusinessOccurrence(specification, now);
        const completed = schedule.occurrences + 1 >= specification.maxOccurrences || next >= view.plan.expiresAt;
        this.db.prepare("UPDATE business_schedules SET occurrences=occurrences+1,next_run_at=?,state=? WHERE id=?")
          .run(next, completed ? "COMPLETED" : "ACTIVE", schedule.id);
      }
    });
  }
  claimTask(skipReview = false): BusinessTask | undefined {
    return this.db.transaction(() => {
      const now = Date.now();
      for (const p of this.listPlans()) {
        if (["ACTIVE", "WAITING_RESOURCE", "PAUSED"].includes(p.state) && p.plan.expiresAt <= now) this.control(p.id, "revoke");
      }
      // Only the built-in pure data processor is replayable. No external writes are registered here.
      this.db.prepare("UPDATE business_tasks SET state='READY' WHERE state='RUNNING' AND lease_until<? AND capability='data_report'").run(now);
      const tasks = this.db.prepare(`SELECT t.* FROM business_tasks t JOIN business_plans p ON p.id=t.plan_id
        WHERE t.state='READY' AND p.state='ACTIVE' AND t.next_run_at<=? AND (?=0 OR t.capability<>'review_feedback')
        AND (t.capability<>'review_feedback' OR NOT EXISTS
          (SELECT 1 FROM business_operations blocked WHERE blocked.plan_id=t.plan_id AND blocked.scope='review' AND blocked.state='OUTCOME_UNKNOWN'))
        AND (t.parent_id IS NULL OR EXISTS (SELECT 1 FROM business_tasks parent WHERE parent.id=t.parent_id AND parent.state='SUCCEEDED'))
        ORDER BY t.next_run_at LIMIT 100`).all(now, skipReview ? 1 : 0) as unknown as BusinessTask[];
      for (const task of tasks) {
        try { this.assertTaskAuthorized(task); } catch (e) {
          // Keep a visible recovery request rather than leaving an active plan with a silently cancelled task.
          this.db.prepare("UPDATE business_tasks SET state='RUNNING' WHERE id=?").run(task.id);
          this.finishTask(task, null, (e as Error).message);
          if (this.getPlan(task.plan_id).state === "ACTIVE") this.control(task.plan_id, "pause");
          continue;
        }
        task.generation++;
        this.db.prepare("UPDATE business_tasks SET state='RUNNING',generation=?,lease_until=?,attempt=attempt+1 WHERE id=?")
          .run(task.generation, now + 30000, task.id);
        return task;
      }
      return undefined;
    });
  }
  finishTask(task: BusinessTask, output: unknown, error?: string) {
    this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE business_tasks SET state=?,output=?,error=?,lease_until=NULL WHERE id=? AND generation=? AND state='RUNNING'")
        .run(error ? "FAILED" : "SUCCEEDED", JSON.stringify(output), error ?? null, task.id, task.generation);
      if (!changed.changes) throw new Error("STALE_WORKER_RESULT");
      this.event(task.plan_id, error ? "task_failed" : "task_completed", { taskId: task.id, revision: task.revision, output, error });
      if (error) this.db.prepare(`INSERT INTO business_requests VALUES(?,?,?,?,'OPEN',NULL)
        ON CONFLICT(plan_id,revision,resource) DO UPDATE SET state='OPEN',resolution=NULL`)
        .run(randomUUID(), task.plan_id, task.revision, `task:${task.id}`);
      const pending = this.db.prepare("SELECT id FROM business_tasks WHERE plan_id=? AND revision=? AND state<>'SUCCEEDED'").get(task.plan_id, task.revision);
      const scheduled = this.db.prepare("SELECT id FROM business_schedules WHERE plan_id=? AND revision=? AND state='ACTIVE'").get(task.plan_id, task.revision);
      if (!pending && !scheduled) this.db.prepare("UPDATE business_plans SET state='COMPLETED' WHERE id=? AND revision=? AND state='ACTIVE'").run(task.plan_id, task.revision);
    });
  }
  retryPureTask(id: string, note: string) {
    if (typeof note !== "string" || !note.trim() || note.length > 4000) throw new Error("RECOVERY_REASON_REQUIRED");
    this.db.transaction(() => {
      const task = this.db.prepare("SELECT * FROM business_tasks WHERE id=?").get(id) as unknown as BusinessTask | undefined;
      if (!task || task.capability !== "data_report" || task.state !== "FAILED") throw new Error("TASK_NOT_RETRYABLE");
      this.assertTaskAuthorized(task);
      this.db.prepare("UPDATE business_tasks SET state='READY',error=NULL,next_run_at=? WHERE id=?").run(Date.now(), id);
      this.db.prepare("UPDATE business_requests SET state='PROVIDED',resolution=? WHERE resource=? AND state='OPEN'").run(note, `task:${id}`);
      this.event(task.plan_id, "pure_task_retry_requested", { taskId: id, note, source: "owner_confirmed" });
    });
  }
  recordFeedback(planId: string, key: string, note: string, evidence: string) {
    if (typeof key !== "string" || !/^[\w-]{8,100}$/.test(key) || typeof note !== "string" || !note.trim() || note.length > 4000 ||
      typeof evidence !== "string" || evidence.length > 4000) throw new Error("INVALID_FEEDBACK");
    return this.db.transaction(() => {
      const view = this.getPlan(planId);
      const id = `feedback:${key}`;
      const previous = this.db.prepare("SELECT plan_id,payload FROM business_events WHERE id=?").get(id) as Row | undefined;
      if (previous) {
        const p = JSON.parse(previous.payload);
        if (previous.plan_id !== planId || p.note !== note || p.evidence !== evidence) throw new Error("IDEMPOTENCY_CONFLICT");
        return { id };
      }
      this.event(planId, "owner_feedback", { note, evidence, revision: view.revision, source: "owner_confirmed" }, id);
      return { id };
    });
  }
  feedback(planId: string) {
    return this.db.prepare("SELECT id,payload,created_at FROM business_events WHERE plan_id=? AND kind='owner_feedback' ORDER BY created_at DESC LIMIT 20").all(planId);
  }
  unreviewedFeedback(planId: string) {
    return this.db.prepare(`SELECT f.id,f.payload,f.created_at FROM business_events f
      WHERE f.plan_id=? AND f.kind='owner_feedback' AND NOT EXISTS (
        SELECT 1 FROM business_events r, json_each(r.payload, '$.feedbackIds') ids
        WHERE r.plan_id=f.plan_id AND r.kind='feedback_reviewed' AND ids.value=f.id)
      ORDER BY f.created_at,f.rowid LIMIT 20`).all(planId);
  }
  reviewFinished(task: BusinessTask, feedbackIds: string[], result: unknown) {
    this.db.transaction(() => {
      this.event(task.plan_id, "feedback_reviewed", { taskId: task.id, feedbackIds, result });
      this.finishTask(task, result);
    });
  }
  overview() {
    return { settings: this.settings() ?? null, ...this.totals(), plans: this.listPlans(), datasets: this.datasets(),
      orders: this.evidence.orders(), receipts: this.evidence.receiptsSummary(),
      connections: this.connections(),
      requests: this.db.prepare("SELECT * FROM business_requests WHERE state='OPEN'").all(),
      unknownOperations: this.db.prepare("SELECT id,plan_id,purpose,reserved_micros,created_at FROM business_operations WHERE state='OUTCOME_UNKNOWN' AND scope IN ('draft','review')").all(),
      proposalProblems: this.db.prepare(`SELECT o.id,o.state,o.created_at FROM business_operations o
        WHERE o.scope='draft' AND o.state IN ('SETTLED','NOT_SENT')
        AND NOT EXISTS (SELECT 1 FROM business_events e WHERE e.id='proposal:' || o.id)
        ORDER BY o.created_at DESC LIMIT 20`).all(),
      tasks: this.db.prepare("SELECT * FROM business_tasks ORDER BY CASE WHEN state IN ('OUTCOME_UNKNOWN','FAILED') THEN 0 ELSE 1 END,next_run_at DESC LIMIT 100").all(),
      schedules: this.db.prepare("SELECT plan_id,revision,next_run_at,occurrences,state FROM business_schedules ORDER BY next_run_at").all(),
      events: this.db.prepare("SELECT * FROM business_events ORDER BY created_at DESC LIMIT 100").all() };
  }
}
