import { randomUUID } from 'node:crypto';
import type { CompanyAttempt, CompanyDispatchCommand, CompanyExecutionReceipt } from '@emergentinc/protocol';
import type { OwnerAutomationGate, GoalRunBinding } from './owner_automation_gate.js';
import { ownerConflict, ownerInput } from './owner_goal_service.js';
import { companyFactHash } from './company_fact_hash.js';

const hash = companyFactHash;
const active = ['DISPATCH_PENDING', 'RUNNING', 'SUSPENDED'];

/** The controller owns claims and applies adapter receipts in the company transaction. */
export class CompanyExecutionService {
  readonly owner = randomUUID();
  constructor(public gate: OwnerAutomationGate) {
    gate.store.db.exec(`
      CREATE TABLE IF NOT EXISTS company_execution_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
      INSERT OR IGNORE INTO company_execution_schema VALUES(1,1);
      CREATE TABLE IF NOT EXISTS company_execution_attempts(
        id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES owner_work_tasks(id),world_id TEXT NOT NULL,
        goal_id TEXT,goal_revision INTEGER,dispatch_id TEXT,run_id TEXT NOT NULL,fence INTEGER NOT NULL,
        revision INTEGER NOT NULL,state TEXT NOT NULL,accounting_state TEXT NOT NULL,
        lease_owner TEXT NOT NULL,lease_expires_at INTEGER NOT NULL,last_sequence INTEGER NOT NULL,
        reason TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(task_id,fence));
      CREATE UNIQUE INDEX IF NOT EXISTS company_task_claim ON company_execution_attempts(task_id) WHERE state IN ('DISPATCH_PENDING','RUNNING');
      CREATE UNIQUE INDEX IF NOT EXISTS company_worker_claim ON company_execution_attempts(world_id) WHERE state IN ('DISPATCH_PENDING','RUNNING');
      CREATE UNIQUE INDEX IF NOT EXISTS company_task_active_attempt ON company_execution_attempts(task_id) WHERE state IN ('DISPATCH_PENDING','RUNNING','SUSPENDED');
      CREATE INDEX IF NOT EXISTS company_attempt_run ON company_execution_attempts(run_id,fence);
      CREATE TABLE IF NOT EXISTS company_dispatch_outbox(attempt_id TEXT PRIMARY KEY REFERENCES company_execution_attempts(id),command_json TEXT NOT NULL,state TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS company_receipt_inbox(event_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES company_execution_attempts(id),sequence INTEGER NOT NULL,fence INTEGER NOT NULL,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,applied INTEGER NOT NULL,created_at INTEGER NOT NULL,UNIQUE(attempt_id,sequence));
      CREATE TABLE IF NOT EXISTS company_attempt_permits(permit_id TEXT PRIMARY KEY REFERENCES owner_model_permits(id),attempt_id TEXT NOT NULL REFERENCES company_execution_attempts(id));
    `);
    if(gate.store.db.prepare('SELECT version FROM company_execution_schema WHERE id=1').get()!.version!==1)throw new Error('OWNER_EXECUTION_SCHEMA_UNSUPPORTED');
    gate.execution = this;
  }
  reattach(gate: OwnerAutomationGate) {
    if(gate.store!==this.gate.store&&(gate.store.db.dbPath===':memory:'||gate.store.db.dbPath!==this.gate.store.db.dbPath))ownerConflict('OWNER_ATTEMPT_CONFLICT');
    this.gate=gate;gate.execution=this;
  }
  private db() { return this.gate.store.db; }
  private map(r: Record<string, any>): CompanyAttempt {
    return {id:r.id,taskId:r.task_id,worldId:r.world_id,goalId:r.goal_id,goalRevision:r.goal_revision,dispatchId:r.dispatch_id,runId:r.run_id,fence:Number(r.fence),revision:Number(r.revision),state:r.state,accountingState:r.accounting_state,leaseOwner:r.lease_owner,leaseExpiresAt:Number(r.lease_expires_at),lastSequence:Number(r.last_sequence),reason:r.reason,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)};
  }
  get(id: string) { const r=this.db().prepare('SELECT * FROM company_execution_attempts WHERE id=?').get(id);if(!r)ownerConflict('OWNER_ATTEMPT_NOT_FOUND');return this.map(r); }
  forRun(runId: string) { const r=this.db().prepare('SELECT * FROM company_execution_attempts WHERE run_id=? ORDER BY fence DESC LIMIT 1').get(runId);return r?this.map(r):undefined; }
  isWorkerRun(runId:string) { const a=this.forRun(runId);if(!a)return false;const row=this.db().prepare('SELECT command_json FROM company_dispatch_outbox WHERE attempt_id=?').get(a.id);return Boolean(row&&JSON.parse(String(row.command_json)).adapter==='worker'); }
  forTask(taskId: string) { const r=this.db().prepare('SELECT * FROM company_execution_attempts WHERE task_id=? ORDER BY fence DESC LIMIT 1').get(taskId);return r?this.map(r):undefined; }
  claim(taskId: string, worldId: string, startRound: number, rounds: number, binding?: GoalRunBinding, worker?: {prepare:(command:CompanyDispatchCommand)=>void}): CompanyDispatchCommand {
    return this.gate.store.transaction(() => {
      this.gate.assertOn();
      const existing=this.db().prepare("SELECT o.command_json FROM company_execution_attempts a JOIN company_dispatch_outbox o ON o.attempt_id=a.id WHERE a.task_id=? AND a.state='DISPATCH_PENDING'").get(taskId);
      if(existing){const command=JSON.parse(String(existing.command_json)) as CompanyDispatchCommand;if(command.worldId!==worldId||command.rounds!==rounds||command.startRound!==startRound||command.adapter!==(worker?'worker':undefined)||hash(command.goal??null)!==hash(binding??null))ownerConflict('OWNER_ATTEMPT_CONFLICT');return command;}
      const task=this.db().prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(taskId);
      if(!task||task.state!=='QUEUED'||this.db().prepare("SELECT 1 FROM company_execution_attempts WHERE task_id=? AND state IN ('DISPATCH_PENDING','RUNNING','SUSPENDED')").get(taskId))ownerConflict('OWNER_ATTEMPT_ALREADY_CLAIMED');
      if(worker){
        const agent=this.db().prepare("SELECT 1 FROM sqlite_master WHERE name='company_agents'").get()?this.db().prepare('SELECT id,legacy_world_id,status FROM company_agents WHERE id=?').get(task.person_id):undefined;
        if(agent){if(agent.status!=='ACTIVE'||(agent.legacy_world_id??agent.id)!==worldId)ownerConflict('OWNER_ATTEMPT_CONFLICT');}
        else if(this.gate.store.worldForQianji(String(task.person_id)).world_id!==worldId)ownerConflict('OWNER_ATTEMPT_CONFLICT');
      }else if(this.gate.store.worldForQianji(String(task.person_id)).world_id!==worldId)ownerConflict('OWNER_ATTEMPT_CONFLICT');
      const id=`attempt_${randomUUID()}`,runId=`run_${randomUUID()}`,now=Date.now();
      const fence=Number(this.db().prepare('SELECT COALESCE(MAX(fence),0)+1 n FROM company_execution_attempts WHERE task_id=?').get(taskId)!.n);
      this.gate.reserveRun(worldId,runId,startRound,rounds,binding,worker?'worker':undefined);
      this.db().prepare("INSERT INTO company_execution_attempts VALUES(?,?,?,?,?,?,?,?,1,'DISPATCH_PENDING','NOT_STARTED',?,?,0,NULL,?,?)").run(id,taskId,worldId,binding?.goalId??null,binding?.specificationRevision??null,binding?.dispatchId??null,runId,fence,this.owner,now+30_000,now,now);
      const command:CompanyDispatchCommand={schema:1,attemptId:id,taskId,worldId,runId,fence,instruction:String(task.instruction),rounds,startRound,...(binding?{goal:binding}:{}),...(worker?{adapter:'worker' as const}:{})};
      this.db().prepare("INSERT INTO company_dispatch_outbox VALUES(?,?,'READY',?)").run(id,JSON.stringify(command),now);
      worker?.prepare(command);
      return command;
    });
  }
  pending() { return this.db().prepare("SELECT command_json FROM company_dispatch_outbox WHERE state='READY' ORDER BY created_at,attempt_id").all().map(r=>JSON.parse(String(r.command_json)) as CompanyDispatchCommand); }
  takeDispatch(attemptId: string) {
    return this.gate.store.transaction(()=>{
      this.gate.assertOn();
      const a=this.get(attemptId);if(a.state!=='DISPATCH_PENDING'||a.leaseOwner!==this.owner)ownerConflict('OWNER_ATTEMPT_STALE');
      return Boolean(this.db().prepare("UPDATE company_dispatch_outbox SET state='LAUNCHING' WHERE attempt_id=? AND state='READY'").run(attemptId).changes);
    });
  }
  cancelPrepared(runId: string) {
    const a=this.forRun(runId);if(!a||a.state!=='DISPATCH_PENDING')return;
    this.gate.store.transaction(()=>{
      this.db().prepare("UPDATE company_execution_attempts SET state='INTERRUPTED',reason='OWNER_DISPATCH_NOT_STARTED',revision=revision+1,updated_at=? WHERE id=? AND state='DISPATCH_PENDING'").run(Date.now(),a.id);
      this.db().prepare("UPDATE company_dispatch_outbox SET state='CANCELLED' WHERE attempt_id=?").run(a.id);
    });
  }
  receipt(receipt: CompanyExecutionReceipt): CompanyAttempt {
    ownerInput(receipt.schema===1&&typeof receipt.eventId==='string'&&receipt.eventId.length>0&&receipt.eventId.length<=200&&Number.isSafeInteger(receipt.sequence)&&receipt.sequence>0&&Number.isSafeInteger(receipt.fence)&&receipt.fence>0&&['started','completed','failed','blocked','interrupted','suspended'].includes(receipt.kind)&&(!receipt.reason||receipt.reason.length<=2000)&&(!receipt.reply||receipt.reply.length<=200_000),'OWNER_RECEIPT_INVALID');
    return this.gate.store.transaction(() => {
      const a=this.get(receipt.attemptId),payloadHash=hash(receipt),old=this.db().prepare('SELECT payload_hash FROM company_receipt_inbox WHERE event_id=?').get(receipt.eventId);
      if(old){if(old.payload_hash!==payloadHash)ownerConflict('OWNER_RECEIPT_CONFLICT');return a;}
      const latest=this.forTask(a.taskId)!;
      if(a.fence!==receipt.fence||latest.id!==a.id)ownerConflict('OWNER_ATTEMPT_STALE');
      const sameSequence=this.db().prepare('SELECT 1 FROM company_receipt_inbox WHERE attempt_id=? AND sequence=?').get(a.id,receipt.sequence);
      if(sameSequence||receipt.sequence<=a.lastSequence)ownerConflict('OWNER_RECEIPT_CONFLICT');
      this.db().prepare('INSERT INTO company_receipt_inbox VALUES(?,?,?,?,?,?,0,?)').run(receipt.eventId,a.id,receipt.sequence,receipt.fence,payloadHash,JSON.stringify(receipt),Date.now());
      this.applyContiguous(a.id);
      this.refreshAccounting(a.id);
      return this.get(a.id);
    });
  }
  private applyContiguous(id: string) {
    for (;;) {
      const a=this.get(id),row=this.db().prepare('SELECT * FROM company_receipt_inbox WHERE attempt_id=? AND sequence=? AND applied=0').get(id,a.lastSequence+1);
      if(!row)return;
      const r=JSON.parse(String(row.payload_json)) as CompanyExecutionReceipt;
      // A terminal result is immutable; a replay cannot turn failure into success.
      if(!active.includes(a.state))ownerConflict('OWNER_ATTEMPT_TERMINAL');
      const state=r.kind==='started'?'RUNNING':r.kind.toUpperCase();
      const taskState=r.kind==='started'?'RUNNING':r.kind==='completed'?'REPLIED':r.kind==='failed'?'FAILED':'BLOCKED';
      const now=Date.now();
      this.db().prepare('UPDATE company_execution_attempts SET state=?,reason=?,revision=revision+1,last_sequence=?,lease_expires_at=?,updated_at=? WHERE id=? AND revision=?').run(state,r.reason??null,r.sequence,r.kind==='started'?now+30_000:now,now,id,a.revision);
      this.db().prepare('UPDATE owner_work_tasks SET state=?,run_id=?,reply=COALESCE(?,reply),reason=?,updated_at=? WHERE id=?').run(taskState,a.runId,r.reply??null,r.reason??null,now,a.taskId);
      this.db().prepare("UPDATE company_dispatch_outbox SET state='DELIVERED' WHERE attempt_id=?").run(id);
      if(a.dispatchId)this.db().prepare('UPDATE owner_goal_dispatches SET run_id=? WHERE id=? AND goal_revision=?').run(a.runId,a.dispatchId,a.goalRevision!);
      if(a.goalId&&r.kind!=='started'&&r.kind!=='completed'){
        const goal=this.gate.goals.get(a.goalId);
        if(goal.specificationRevision===a.goalRevision&&['READY','RUNNING'].includes(goal.status))this.gate.goals.state(a.goalId,'BLOCKED',r.reason??'OWNER_EXECUTION_INTERRUPTED');
      }
      this.db().prepare('UPDATE company_receipt_inbox SET applied=1 WHERE event_id=?').run(r.eventId);
    }
  }
  /** Adapter observer: use a durable identity for the same source fact on every poll. */
  observe(runId: string, kind: CompanyExecutionReceipt['kind'], reason?: string, reply?: string, sourceFactId?:string) {
    const a=this.forRun(runId);if(!a||!active.includes(a.state)||a.leaseOwner!==this.owner)return;
    const eventId=sourceFactId??`adapter_${hash({attempt:a.id,kind,reason:reason??null,reply:reply??null})}`;
    const prior=this.db().prepare('SELECT payload_json FROM company_receipt_inbox WHERE event_id=?').get(eventId);
    return this.receipt(prior?JSON.parse(String(prior.payload_json)):{schema:1,eventId,attemptId:a.id,fence:a.fence,sequence:a.lastSequence+1,kind,...(reason?{reason}:{}),...(reply!==undefined?{reply}:{})});
  }
  /** The adapter must prove the prior process exited; a lease timeout alone is insufficient. */
  adoptAfterExit(runId: string) {
    const a=this.forRun(runId);if(!a||!active.includes(a.state)||a.leaseOwner===this.owner)return;
    this.db().prepare('UPDATE company_execution_attempts SET lease_owner=?,lease_expires_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(this.owner,Date.now()+30_000,Date.now(),a.id,a.revision);
  }
  /** A recovered kernel run gets a fresh fenced attempt; the original result and bill remain historical. */
  resumeLegacyRun(runId: string) {
    const prior=this.forRun(runId);if(!prior||active.includes(prior.state))return;
    this.gate.store.transaction(()=>{
      const latest=this.forTask(prior.taskId)!;if(latest.id!==prior.id)ownerConflict('OWNER_ATTEMPT_STALE');
      const id=`attempt_${randomUUID()}`,now=Date.now();
      this.db().prepare("INSERT INTO company_execution_attempts VALUES(?,?,?,?,?,?,?,?,1,'DISPATCH_PENDING','NOT_STARTED',?,?,0,NULL,?,?)").run(id,prior.taskId,prior.worldId,prior.goalId,prior.goalRevision,prior.dispatchId,prior.runId,prior.fence+1,this.owner,now+30_000,now,now);
      this.observe(runId,'started');
    });
  }
  bindPermit(permitId: string, runId: string) { const a=this.forRun(runId);if(a)this.db().prepare('INSERT INTO company_attempt_permits VALUES(?,?)').run(permitId,a.id); }
  refreshAccounting(id: string) {
    const r=this.db().prepare("SELECT COUNT(*) n,SUM(p.state IN ('SENT','UNKNOWN')) pending FROM company_attempt_permits a JOIN owner_model_permits p ON p.id=a.permit_id WHERE a.attempt_id=?").get(id)!;
    const state=!r.n?'NOT_STARTED':r.pending?'PENDING':'SETTLED';
    this.db().prepare('UPDATE company_execution_attempts SET accounting_state=?,revision=revision+1,updated_at=? WHERE id=? AND accounting_state!=?').run(state,Date.now(),id,state);
  }
  refreshPermit(permitId: string) { const r=this.db().prepare('SELECT attempt_id FROM company_attempt_permits WHERE permit_id=?').get(permitId);if(r)this.refreshAccounting(String(r.attempt_id)); }
}
