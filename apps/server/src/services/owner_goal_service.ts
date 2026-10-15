import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { WorldRegistryStore } from '@emergentinc/persistence';
import type { OwnerGoal, OwnerGoalAcceptance, OwnerGoalDetail, OwnerGoalStatus } from '@emergentinc/protocol';

export const goalHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function ownerInput(condition: unknown, code = 'OWNER_GOAL_INPUT_INVALID'): asserts condition {
  if (!condition) throw Object.assign(new Error(code), { statusCode: 400 });
}
export function ownerConflict(code = 'OWNER_REVISION_CONFLICT'): never { throw Object.assign(new Error(code), { statusCode: 409 }); }
export function exactKeys(input: unknown, keys: string[]): asserts input is Record<string, any> {
  ownerInput(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => keys.includes(k)));
}
export function ownerKey(key: unknown): asserts key is string { ownerInput(typeof key === 'string' && /^[\w-]{8,128}$/.test(key)); }

export class OwnerGoalService {
  constructor(readonly store: WorldRegistryStore) {
    const db = store.db;
    // VACUUM INTO includes committed WAL data. Never copy a live SQLite main file alone.
    if (db.dbPath !== ':memory:' && !db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_goals'").get()) {
      const backup = `${db.dbPath}.pre-v29.bak`;
      if (!fs.existsSync(backup)) db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS owner_goals(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,specification_revision INTEGER NOT NULL,title TEXT NOT NULL,objective TEXT NOT NULL,acceptance TEXT NOT NULL,max_tokens INTEGER NOT NULL,status TEXT NOT NULL,next_action TEXT NOT NULL DEFAULT '',reason TEXT,verified_count INTEGER NOT NULL DEFAULT 0,evidence_count INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_scheduled_at INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS owner_goal_revisions(goal_id TEXT NOT NULL REFERENCES owner_goals(id),revision INTEGER NOT NULL,snapshot TEXT NOT NULL,PRIMARY KEY(goal_id,revision));
      CREATE TABLE IF NOT EXISTS owner_goal_events(id INTEGER PRIMARY KEY,goal_id TEXT NOT NULL REFERENCES owner_goals(id),revision INTEGER NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_control_requests(key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,response TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_model_permits(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,world_id TEXT,goal_id TEXT,goal_revision INTEGER,state TEXT NOT NULL,reserved_tokens INTEGER NOT NULL,actual_tokens INTEGER,cost_cny REAL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_goal_steps(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL REFERENCES owner_goals(id),goal_revision INTEGER NOT NULL,step_key TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,UNIQUE(goal_id,goal_revision,step_key));
      CREATE TABLE IF NOT EXISTS owner_goal_recruits(request_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL REFERENCES owner_goals(id),goal_revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_goal_dispatches(id TEXT PRIMARY KEY REFERENCES owner_goal_steps(id),goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,task_id TEXT UNIQUE,run_id TEXT,world_id TEXT NOT NULL,state TEXT NOT NULL,reason TEXT);
      CREATE TABLE IF NOT EXISTS owner_goal_evidence(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL REFERENCES owner_goals(id),specification_revision INTEGER NOT NULL,run_id TEXT NOT NULL,world_id TEXT NOT NULL,kind TEXT NOT NULL,reference TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(goal_id,specification_revision,kind,reference,sha256));
    `);
  }
  request<T>(key: string, payload: unknown, fn: () => T): T {
    ownerKey(key);
    return this.store.transaction(() => {
      const hash = goalHash(payload), old = this.store.db.prepare('SELECT * FROM owner_control_requests WHERE key=?').get(key);
      if (old) { if (old.payload_hash !== hash) ownerConflict('IDEMPOTENCY_CONFLICT'); return JSON.parse(String(old.response)); }
      const response = fn();
      this.store.db.prepare('INSERT INTO owner_control_requests VALUES(?,?,?)').run(key, hash, JSON.stringify(response));
      return response;
    });
  }
  private parse(row: any): OwnerGoal {
    const usage = this.store.db.prepare("SELECT COALESCE(SUM(actual_tokens),0) spent,COALESCE(SUM(CASE WHEN state IN ('SENT','UNKNOWN') THEN MAX(0,reserved_tokens-COALESCE(actual_tokens,0)) ELSE 0 END),0) reserved FROM owner_model_permits WHERE goal_id=?").get(row.id)!;
    return { id: row.id, revision: row.revision, specificationRevision: row.specification_revision, title: row.title, objective: row.objective, acceptance: JSON.parse(row.acceptance), maxTokens: row.max_tokens, status: row.status, nextAction: row.next_action, reason: row.reason, verifiedCount: row.verified_count, evidenceCount: row.evidence_count, createdAt: row.created_at, updatedAt: row.updated_at, lastScheduledAt: row.last_scheduled_at, spentTokens: Number(usage.spent), reservedTokens: Number(usage.reserved) };
  }
  list(archived = false): OwnerGoal[] { return this.store.db.prepare(`SELECT * FROM owner_goals WHERE ${archived ? "status='ARCHIVED'" : "status!='ARCHIVED'"} ORDER BY created_at,id`).all().map(r => this.parse(r)); }
  get(id: string): OwnerGoal {
    const row = this.store.db.prepare('SELECT * FROM owner_goals WHERE id=?').get(id);
    if (!row) throw Object.assign(new Error('OWNER_GOAL_NOT_FOUND'), { statusCode: 404 });
    return this.parse(row);
  }
  detail(id: string): OwnerGoalDetail {
    return { goal: this.get(id), events: this.store.db.prepare('SELECT * FROM owner_goal_events WHERE goal_id=? ORDER BY id DESC LIMIT 200').all(id).map(r => ({ id: Number(r.id), goalId: String(r.goal_id), revision: Number(r.revision), kind: String(r.kind), payload: JSON.parse(String(r.payload)), createdAt: Number(r.created_at) })),
      evidence: this.store.db.prepare('SELECT * FROM owner_goal_evidence WHERE goal_id=? ORDER BY created_at DESC,rowid DESC').all(id).map(r => ({ id: String(r.id), goalId: id, specificationRevision: Number(r.specification_revision), runId: r.run_id?String(r.run_id):null, worldId: r.world_id?String(r.world_id):null, kind: r.kind as 'artifact' | 'report' | 'payment', reference: String(r.reference), sha256: String(r.sha256), bytes: Number(r.bytes), createdAt: Number(r.created_at) })),
      dispatches: this.store.db.prepare('SELECT * FROM owner_goal_dispatches WHERE goal_id=? ORDER BY rowid DESC').all(id).map(r => ({ id: String(r.id), taskId: r.task_id as string | null, runId: r.run_id as string | null, worldId: String(r.world_id), state: String(r.state), reason: r.reason as string | null })) };
  }
  private validate(input: any) {
    ownerInput(typeof input.title === 'string' && input.title.trim().length > 0 && input.title.length <= 160);
    ownerInput(typeof input.objective === 'string' && input.objective.trim().length > 0 && input.objective.length <= 1200);
    const a = input.acceptance as OwnerGoalAcceptance;
    ownerInput(a && ['artifact', 'manual','confirmed_payments'].includes(a.kind));
    if (a.kind === 'artifact') {
      exactKeys(a, ['kind', 'filename', 'minBytes']);
      ownerInput(typeof a.filename === 'string' && /^[\p{L}\p{N}_-][\p{L}\p{N}_. -]{0,100}\.(md|txt|json|csv)$/u.test(a.filename) && !a.filename.includes('..') && Number.isSafeInteger(a.minBytes) && a.minBytes >= 1 && a.minBytes <= 1000000);
    } else if(a.kind==='confirmed_payments'){
      exactKeys(a,['kind','invoiceIds','targetCount']);ownerInput(Array.isArray(a.invoiceIds)&&a.invoiceIds.length>0&&a.invoiceIds.length<=100&&a.invoiceIds.every(id=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id))&&new Set(a.invoiceIds).size===a.invoiceIds.length&&Number.isSafeInteger(a.targetCount)&&a.targetCount>0&&a.targetCount<=a.invoiceIds.length);
    } else { exactKeys(a, ['kind', 'description']); ownerInput(typeof a.description === 'string' && a.description.trim().length > 0 && a.description.length <= 1000); }
  }
  create(input: any): OwnerGoal {
    exactKeys(input, ['title', 'objective', 'acceptance', 'maxTokens', 'idempotencyKey']); this.validate(input);
    return this.request(input.idempotencyKey, { create: input }, () => {
      const id = `goal_${randomUUID()}`, now = Date.now();
      this.store.db.prepare("INSERT INTO owner_goals(id,revision,specification_revision,title,objective,acceptance,max_tokens,status,created_at,updated_at) VALUES(?,1,1,?,?,?,?,'READY',?,?)").run(id, input.title.trim(), input.objective.trim(), JSON.stringify(input.acceptance), 0, now, now);
      const goal = this.get(id); this.snapshot(goal); this.event(id, 'created', { acceptance: goal.acceptance }); return goal;
    });
  }
  edit(id: string, input: any): OwnerGoal {
    exactKeys(input, ['title', 'objective', 'acceptance', 'maxTokens', 'expectedRevision', 'idempotencyKey']); this.validate(input);
    return this.request(input.idempotencyKey, { edit: id, input }, () => {
      const old = this.get(id); if (old.revision !== input.expectedRevision) ownerConflict();
      if (old.status === 'ARCHIVED') ownerConflict('OWNER_GOAL_ARCHIVED');
      this.store.db.prepare("UPDATE owner_goals SET revision=revision+1,specification_revision=specification_revision+1,title=?,objective=?,acceptance=?,max_tokens=?,status='READY',reason=NULL,verified_count=0,evidence_count=0,next_action='',updated_at=? WHERE id=?").run(input.title.trim(), input.objective.trim(), JSON.stringify(input.acceptance), 0, Date.now(), id);
      const goal = this.get(id); this.snapshot(goal); this.event(id, 'edited', { previousRevision: old.specificationRevision }); return goal;
    });
  }
  action(id: string, input: any): OwnerGoal {
    exactKeys(input, ['action', 'expectedRevision', 'idempotencyKey','verification']);
    if(input.action==='verify')return this.request(input.idempotencyKey,{verify:id,input},()=>{
      const goal=this.get(id);if(goal.revision!==input.expectedRevision)ownerConflict();
      if(this.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_task_plans'").get()&&this.store.db.prepare('SELECT 1 FROM owner_task_plans WHERE goal_id=? AND goal_revision=?').get(id,goal.specificationRevision))ownerConflict('OWNER_USE_PROPOSALS');
      if(goal.acceptance.kind!=='manual'||goal.status!=='WAITING_APPROVAL')ownerConflict('OWNER_GOAL_TRANSITION_INVALID');
      exactKeys(input.verification,['evidenceIds','reason']);
      ownerInput(Array.isArray(input.verification.evidenceIds)&&input.verification.evidenceIds.length>0&&input.verification.evidenceIds.length<=100&&typeof input.verification.reason==='string'&&input.verification.reason.trim().length>=8&&input.verification.reason.length<=1000);
      const evidence=this.detail(id).evidence.filter(e=>input.verification.evidenceIds.includes(e.id)&&e.specificationRevision===goal.specificationRevision&&e.kind!=='report');
      ownerInput(evidence.length===new Set(input.verification.evidenceIds).size);
      this.store.db.prepare("UPDATE owner_goals SET revision=revision+1,status='COMPLETED',verified_count=1,reason='OWNER_RESULT_VERIFIED',updated_at=? WHERE id=?").run(Date.now(),id);
      this.event(id,'owner_verified',{reason:input.verification.reason,evidence:evidence.map(e=>({id:e.id,sha256:e.sha256})),basis:'EXPLICIT_OWNER_VERIFICATION_NOT_PROVIDER_PAYMENT'});
      return this.get(id);
    });
    ownerInput(input.verification===undefined);
    const transitions: Record<string, { from: OwnerGoalStatus[]; to: OwnerGoalStatus }> = {
      pause: { from: ['READY', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_RESOURCE', 'BLOCKED'], to: 'PAUSED' },
      resume: { from: ['PAUSED', 'WAITING_RESOURCE'], to: 'READY' },
      stop: { from: ['DRAFT', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_RESOURCE', 'PAUSED', 'BLOCKED', 'FAILED'], to: 'STOPPED' },
      reopen: { from: ['STOPPED', 'COMPLETED', 'FAILED', 'BLOCKED', 'WAITING_APPROVAL'], to: 'READY' },
      archive: { from: ['DRAFT', 'READY', 'RUNNING', 'WAITING_APPROVAL', 'WAITING_RESOURCE', 'PAUSED', 'BLOCKED', 'FAILED', 'COMPLETED', 'STOPPED'], to: 'ARCHIVED' },
      restore: { from: ['ARCHIVED'], to: 'PAUSED' },
    };
    ownerInput(typeof input.action === 'string' && transitions[input.action]);
    return this.request(input.idempotencyKey, { action: id, input }, () => {
      const goal = this.get(id), t = transitions[input.action]!; if (goal.revision !== input.expectedRevision) ownerConflict();
      if (!t.from.includes(goal.status)) ownerConflict('OWNER_GOAL_TRANSITION_INVALID');
      // Unknown calls/effects cannot be cleared by merely pressing Continue.
      if (t.to === 'READY' && this.store.db.prepare("SELECT 1 FROM owner_model_permits WHERE goal_id=? AND state='UNKNOWN'").get(id)) ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      this.store.db.prepare('UPDATE owner_goals SET revision=revision+1,status=?,reason=NULL,next_action=?,updated_at=? WHERE id=?').run(t.to, '', Date.now(), id);
      this.event(id, input.action, {}); return this.get(id);
    });
  }
  private snapshot(goal: OwnerGoal) { this.store.db.prepare('INSERT INTO owner_goal_revisions VALUES(?,?,?)').run(goal.id, goal.specificationRevision, JSON.stringify(goal)); }
  event(id: string, kind: string, payload: unknown) { this.store.db.prepare('INSERT INTO owner_goal_events(goal_id,revision,kind,payload,created_at) VALUES(?,?,?,?,?)').run(id, this.get(id).specificationRevision, kind, JSON.stringify(payload), Date.now()); }
  state(id: string, state: OwnerGoalStatus, reason: string | null = null) {
    const old = this.get(id); if (old.status === state && old.reason === reason) return;
    this.store.transaction(() => { this.store.db.prepare('UPDATE owner_goals SET status=?,reason=?,next_action=?,updated_at=? WHERE id=?').run(state, reason, reason ?? '', Date.now(), id); this.event(id, state.toLowerCase(), { reason }); });
  }
}
