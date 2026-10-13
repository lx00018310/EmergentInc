import { randomUUID } from 'node:crypto';
import type { CoreStore, WorldRegistryStore } from '@emergentinc/persistence';
import { InfrastructureFailureError, type ModelProvider, type UsageMeter } from '@emergentinc/model';
import type { OwnerAutomation, OwnerRunReport } from '@emergentinc/protocol';
import { OwnerGoalService, exactKeys, ownerConflict, ownerInput } from './owner_goal_service.js';

export interface GoalRunBinding { goalId: string; specificationRevision: number; dispatchId: string; resourceApprovalId?:string }
export class OwnerAutomationGate {
  readonly goals: OwnerGoalService;
  private maintenance = () => false;
  private live = new Set<string>();
  private external = new Set<string>();
  private calls = new Set<string>();
  private suspend = () => {};
  private unresolved = () => false;
  private unknownChecks: (() => boolean)[] = [];
  private flightChecks: (() => boolean)[] = [];
  addUnknownCheck(check: () => boolean) { this.unknownChecks.push(check); }
  addInFlightCheck(check: () => boolean) { this.flightChecks.push(check); }
  private serviceFlights(){return this.flightChecks.filter(check=>check()).length;}
  constructor(readonly store: WorldRegistryStore) {
    this.goals = new OwnerGoalService(store);
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS owner_automation_control(id INTEGER PRIMARY KEY CHECK(id=1),desired_mode TEXT NOT NULL,run_mode TEXT NOT NULL,requested_rounds INTEGER,max_tokens INTEGER NOT NULL,revision INTEGER NOT NULL,batch_id TEXT NOT NULL,updated_at INTEGER NOT NULL,reason TEXT);
      INSERT OR IGNORE INTO owner_automation_control VALUES(1,'OFF','BOUNDED',NULL,0,0,'initial',0,NULL);
      CREATE TABLE IF NOT EXISTS owner_run_permits(run_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,batch_id TEXT NOT NULL,goal_id TEXT,goal_revision INTEGER,dispatch_id TEXT,state TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_round_permits(run_id TEXT NOT NULL REFERENCES owner_run_permits(run_id),round_no INTEGER NOT NULL,batch_id TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(run_id,round_no));
      CREATE TABLE IF NOT EXISTS owner_model_permits(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL,world_id TEXT,goal_id TEXT,goal_revision INTEGER,state TEXT NOT NULL,reserved_tokens INTEGER NOT NULL,actual_tokens INTEGER,cost_cny REAL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS owner_run_permit_state ON owner_run_permits(state);
      CREATE INDEX IF NOT EXISTS owner_model_permit_state ON owner_model_permits(state);
      CREATE INDEX IF NOT EXISTS owner_model_permit_goal ON owner_model_permits(goal_id);
      CREATE INDEX IF NOT EXISTS owner_model_permit_batch ON owner_model_permits(batch_id);
      CREATE INDEX IF NOT EXISTS owner_round_permit_batch ON owner_round_permits(batch_id,state);
      CREATE TABLE IF NOT EXISTS owner_model_sources(permit_id TEXT PRIMARY KEY REFERENCES owner_model_permits(id),source_id TEXT NOT NULL,source_kind TEXT NOT NULL);
    `);
    // A prior process never proves that a SENT call was not delivered.
    const interrupted=store.db.prepare("UPDATE owner_model_permits SET state='UNKNOWN' WHERE state='SENT'").run();
    if(interrupted.changes)this.halt('OWNER_OUTCOME_REVIEW_REQUIRED');
  }
  attach(maintenance: () => boolean, suspend: () => void, unresolved: () => boolean) { this.maintenance = maintenance; this.suspend = suspend; this.unresolved = unresolved; }
  private row() { return this.store.db.prepare('SELECT * FROM owner_automation_control WHERE id=1').get()!; }
  isOn() { return this.row().desired_mode === 'ON' && !this.maintenance() && !this.hasUnknown(); }
  private hasUnknown() { return Boolean(this.store.db.prepare("SELECT 1 FROM owner_model_permits WHERE state='UNKNOWN'").get()) || this.unresolved() || this.unknownChecks.some(check=>check()); }
  assertOn() {
    if (!this.isOn()) throw Object.assign(new InfrastructureFailureError(this.maintenance() ? 'EVOLUTION_QUIESCED' : this.hasUnknown() ? 'OWNER_OUTCOME_REVIEW_REQUIRED' : 'OWNER_AUTOMATION_OFF'), { statusCode: 409 });
  }
  private assertGoal(binding?: GoalRunBinding) {
    if (!binding) return;
    const goal = this.goals.get(binding.goalId);
    const resource=binding.resourceApprovalId&&this.store.db.prepare("SELECT 1 FROM owner_goal_recruits r JOIN owner_recruit_requests q ON q.id=r.request_id WHERE r.request_id=? AND r.goal_id=? AND r.goal_revision=? AND q.state IN ('PENDING','APPROVED')").get(binding.resourceApprovalId,binding.goalId,binding.specificationRevision);
    if (goal.specificationRevision !== binding.specificationRevision || !(resource?!['ARCHIVED','STOPPED','COMPLETED'].includes(goal.status):['READY', 'RUNNING'].includes(goal.status))) ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
    if (goal.spentTokens + goal.reservedTokens >= goal.maxTokens) ownerConflict('OWNER_GOAL_TOKEN_LIMIT');
  }
  control(input: any): OwnerAutomation {
    exactKeys(input, ['desiredMode', 'runMode', 'requestedRounds', 'maxTokens', 'expectedRevision', 'idempotencyKey']);
    ownerInput(['ON', 'OFF'].includes(input.desiredMode) && Number.isSafeInteger(input.expectedRevision));
    const result = this.goals.request(input.idempotencyKey, { control: input }, () => {
      const old = this.row(); if (old.revision !== input.expectedRevision) ownerConflict();
      const current = this.view();
      if (input.desiredMode === 'ON') {
        if (this.maintenance()) ownerConflict('EVOLUTION_QUIESCED');
        if (this.hasUnknown()) ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
        if (old.desired_mode === 'OFF' && (this.live.size || this.calls.size || this.external.size || this.serviceFlights())) ownerConflict('OWNER_AUTOMATION_STOPPING');
        ownerInput(['CONTINUOUS', 'BOUNDED'].includes(input.runMode));
        ownerInput(Number.isSafeInteger(input.maxTokens) && input.maxTokens > 0 && input.maxTokens <= 1_000_000_000);
        ownerInput(input.runMode !== 'BOUNDED' || Number.isSafeInteger(input.requestedRounds) && input.requestedRounds > 0 && input.requestedRounds <= 1_000_000);
        if (old.desired_mode === 'ON') {
          ownerInput(input.maxTokens >= current.spentTokens + current.reservedTokens, 'OWNER_BUDGET_BELOW_SPENT');
          ownerInput(input.runMode !== 'BOUNDED' || input.requestedRounds >= current.startedRounds + current.reservedRounds, 'OWNER_ROUNDS_BELOW_STARTED');
        }
      }
      const on = input.desiredMode === 'ON';
      const batch = on && old.desired_mode === 'OFF' ? randomUUID() : String(old.batch_id);
      if(on && old.desired_mode === 'OFF') {
        const held=Number(this.store.db.prepare("SELECT COUNT(*) n FROM owner_round_permits WHERE state='RESERVED'").get()!.n);
        ownerInput(input.runMode!=='BOUNDED'||input.requestedRounds>=held,'OWNER_ROUNDS_BELOW_STARTED');
        this.store.db.prepare("UPDATE owner_round_permits SET batch_id=? WHERE state='RESERVED'").run(batch);
      }
      // Suspended work remains charged to its original authorization; a new session never replays it as new work.
      this.store.db.prepare('UPDATE owner_automation_control SET desired_mode=?,run_mode=?,requested_rounds=?,max_tokens=?,revision=revision+1,batch_id=?,updated_at=?,reason=NULL WHERE id=1').run(input.desiredMode, on ? input.runMode : old.run_mode, on ? input.runMode === 'BOUNDED' ? input.requestedRounds : null : old.requested_rounds, on ? input.maxTokens : old.max_tokens, batch, Date.now());
      this.store.db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_automation_changed', JSON.stringify({ desiredMode: input.desiredMode, batchId: batch, revision: Number(old.revision) + 1, maxTokens: on ? input.maxTokens : old.max_tokens }), Date.now());
      return this.view();
    });
    if (input.desiredMode === 'OFF' && this.row().desired_mode==='OFF') this.suspend();
    return { ...result, observedState: this.view().observedState, inFlight: this.view().inFlight };
  }
  halt(reason: string) {
    this.store.db.prepare("UPDATE owner_automation_control SET desired_mode='OFF',reason=?,revision=revision+1,updated_at=? WHERE id=1 AND (desired_mode!='OFF' OR reason IS NULL)").run(reason, Date.now());
    this.suspend();
  }
  view(): OwnerAutomation {
    const r = this.row(), db = this.store.db;
    const rounds = db.prepare("SELECT SUM(state IN ('STARTED','COMPLETED')) started,SUM(state='COMPLETED') completed,SUM(state='RESERVED') reserved FROM owner_round_permits WHERE batch_id=?").get(r.batch_id)!;
    const usage = db.prepare("SELECT COALESCE(SUM(actual_tokens),0) spent,COALESCE(SUM(CASE WHEN state IN ('SENT','UNKNOWN') THEN MAX(0,reserved_tokens-COALESCE(actual_tokens,0)) ELSE 0 END),0) reserved,COALESCE(SUM(cost_cny),0) cost,SUM(state!='NOT_SENT' AND cost_cny IS NULL) unknown_cost FROM owner_model_permits WHERE batch_id=?").get(r.batch_id)!;
    const inFlight = this.live.size + this.calls.size + this.external.size + this.serviceFlights();
    const unknown = this.hasUnknown();
    const observedState = r.desired_mode === 'OFF' ? inFlight ? 'STOPPING' : unknown ? 'BLOCKED' : r.reason === 'OWNER_ROUND_LIMIT' || r.reason === 'OWNER_TOKEN_LIMIT' ? 'LIMIT_REACHED' : 'STOPPED'
      : this.maintenance() || unknown ? 'BLOCKED' : inFlight ? 'RUNNING' : 'IDLE';
    return { desiredMode: r.desired_mode as 'ON' | 'OFF', runMode: r.run_mode as 'CONTINUOUS' | 'BOUNDED', requestedRounds: r.requested_rounds as number | null, maxTokens: Number(r.max_tokens), revision: Number(r.revision), batchId: String(r.batch_id), updatedAt: Number(r.updated_at), reason: this.maintenance()?'EVOLUTION_QUIESCED':r.reason as string | null ?? (unknown?'OWNER_OUTCOME_REVIEW_REQUIRED':null), observedState, inFlight, startedRounds: Number(rounds.started ?? 0), completedRounds: Number(rounds.completed ?? 0), reservedRounds: Number(rounds.reserved ?? 0), spentTokens: Number(usage.spent), reservedTokens: Number(usage.reserved), knownCostCny: Number(usage.cost), unknownCostCalls: Number(usage.unknown_cost ?? 0) };
  }
  reserveRun(worldId: string, runId: string, startRound: number, rounds: number, binding?: GoalRunBinding) {
    this.assertOn(); this.assertGoal(binding);
    const held=(batch:unknown)=>Number(this.store.db.prepare("SELECT COUNT(*) n FROM owner_round_permits WHERE batch_id=? AND state IN ('RESERVED','STARTED','COMPLETED')").get(String(batch))!.n);
    let control=this.row();
    if(control.run_mode==='BOUNDED'&&held(control.batch_id)+rounds>Number(control.requested_rounds)){this.enforceLimits();ownerConflict('OWNER_RUN_EXCEEDS_REMAINING_ROUNDS');}
    this.store.transaction(() => {
      this.assertOn(); this.assertGoal(binding);
      control=this.row();
      if(!binding&&this.store.db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE world_id=? AND state IN ('QUEUED','RUNNING')").get(worldId))ownerConflict('OWNER_AUTOMATION_BUSY');
      if(control.run_mode==='BOUNDED'&&held(control.batch_id)+rounds>Number(control.requested_rounds))ownerConflict('OWNER_RUN_EXCEEDS_REMAINING_ROUNDS');
      if (this.store.db.prepare("SELECT 1 FROM owner_run_permits WHERE state IN ('ACTIVE','PREPARING') AND run_id!=?").get(runId)) ownerConflict('OWNER_AUTOMATION_BUSY');
      this.store.db.prepare("INSERT INTO owner_run_permits VALUES(?,?,?,?,?,?,'PREPARING',?)").run(runId, worldId, control.batch_id!, binding?.goalId ?? null, binding?.specificationRevision ?? null, binding?.dispatchId ?? null, Date.now());
      for (let r = startRound; r < startRound + rounds; r++) this.store.db.prepare("INSERT INTO owner_round_permits VALUES(?,?,?,'RESERVED')").run(runId, r, control.batch_id!);
    });
  }
  runCreated(runId: string) { this.store.db.prepare("UPDATE owner_run_permits SET state='ACTIVE' WHERE run_id=?").run(runId); this.live.add(runId); }
  cancelRun(runId: string) { this.store.db.prepare("UPDATE owner_round_permits SET state='RELEASED' WHERE run_id=? AND state='RESERVED'").run(runId); this.store.db.prepare("UPDATE owner_run_permits SET state='FINISHED' WHERE run_id=?").run(runId); this.live.delete(runId); }
  binding(runId: string): GoalRunBinding | undefined {
    const row = this.store.db.prepare('SELECT * FROM owner_run_permits WHERE run_id=?').get(runId);
    return row?.goal_id ? { goalId: String(row.goal_id), specificationRevision: Number(row.goal_revision), dispatchId: String(row.dispatch_id) } : undefined;
  }
  mayContinue(runId: string) { try { this.assertOn(); this.assertGoal(this.binding(runId)); return true; } catch { return false; } }
  beginRound(runId: string, round: number) {
    this.assertOn(); this.assertGoal(this.binding(runId));
    const p = this.store.db.prepare('SELECT state FROM owner_round_permits WHERE run_id=? AND round_no=?').get(runId, round);
    if (!p || !['RESERVED', 'STARTED'].includes(String(p.state))) ownerConflict('OWNER_ROUND_PERMIT_MISSING');
    this.store.db.prepare("UPDATE owner_round_permits SET state='STARTED' WHERE run_id=? AND round_no=? AND state='RESERVED'").run(runId, round);
  }
  completeRound(runId: string, round: number) { this.store.db.prepare("UPDATE owner_round_permits SET state='COMPLETED' WHERE run_id=? AND round_no=? AND state='STARTED'").run(runId, round); }
  finished(runId: string, resumable: boolean) {
    this.live.delete(runId);
    this.store.db.prepare('UPDATE owner_run_permits SET state=? WHERE run_id=?').run(resumable ? 'SUSPENDED' : 'FINISHED', runId);
    if (!resumable) this.store.db.prepare("UPDATE owner_round_permits SET state='RELEASED' WHERE run_id=? AND state='RESERVED'").run(runId);
    this.enforceLimits();
  }
  resume(runId: string) {
    this.assertOn(); this.assertGoal(this.binding(runId));
    if (!this.store.db.prepare('SELECT 1 FROM owner_run_permits WHERE run_id=?').get(runId)) ownerConflict('OWNER_LEGACY_RUN_REQUIRES_NEW_AUTHORIZATION');
    if (this.live.size && !this.live.has(runId)) ownerConflict('OWNER_AUTOMATION_BUSY');
    this.runCreated(runId);
  }
  reconcileRun(runId: string, completedThrough: number, resumable: boolean) {
    this.store.db.prepare("UPDATE owner_round_permits SET state='COMPLETED' WHERE run_id=? AND round_no<=? AND state IN ('STARTED','RESERVED')").run(runId, completedThrough);
    this.finished(runId, resumable);
  }
  enforceLimits() {
    const r=this.row();if(r.desired_mode!=='ON'||this.live.size)return;
    const started=Number(this.store.db.prepare("SELECT COUNT(*) n FROM owner_round_permits WHERE batch_id=? AND state IN ('STARTED','COMPLETED')").get(r.batch_id!)!.n);
    if(r.run_mode==='BOUNDED'&&started>=Number(r.requested_rounds)){this.halt('OWNER_ROUND_LIMIT');return;}
    if(this.calls.size||this.external.size||this.serviceFlights())return;
    const usage=this.store.db.prepare("SELECT COALESCE(SUM(COALESCE(actual_tokens,0)+CASE WHEN state IN ('SENT','UNKNOWN') THEN MAX(0,reserved_tokens-COALESCE(actual_tokens,0)) ELSE 0 END),0) total FROM owner_model_permits WHERE batch_id=?").get(r.batch_id!)!;
    if(Number(usage.total)>=Number(r.max_tokens))this.halt('OWNER_TOKEN_LIMIT');
  }
  async externalAction<T>(key: string, action: () => Promise<T>): Promise<T> {
    this.assertOn(); this.external.add(key); try { return await action(); } finally { this.external.delete(key); }
  }
  reconcileWorld(core: CoreStore, worldId: string) {
    for(const row of this.store.db.prepare("SELECT p.id,s.source_id FROM owner_model_permits p JOIN owner_model_sources s ON s.permit_id=p.id WHERE p.world_id=? AND p.state='UNKNOWN' AND s.source_kind='world'").all(worldId)) {
      const call=core.modelCalls.getModelCall(String(row.source_id));
      const decision=core.db.prepare("SELECT decision FROM recovery_decisions WHERE kind='model' AND id=? ORDER BY created_at DESC LIMIT 1").get(row.source_id);
      if(decision?.decision==='confirm_not_billed')this.store.db.prepare("UPDATE owner_model_permits SET state='NOT_SENT',actual_tokens=0,cost_cny=0 WHERE id=?").run(row.id);
      else if(call&&call.outcome!=='CALL_OUTCOME_UNKNOWN'&&call.actualTokens!==null&&call.costCny!==null)
        this.store.db.prepare("UPDATE owner_model_permits SET state='SETTLED',actual_tokens=?,cost_cny=? WHERE id=?").run(call.actualTokens,call.costCny,row.id);
    }
  }
  modelCalls() { return this.store.db.prepare("SELECT p.*,s.source_id,s.source_kind FROM owner_model_permits p LEFT JOIN owner_model_sources s ON s.permit_id=p.id WHERE p.state='UNKNOWN' ORDER BY p.created_at").all(); }
  report():OwnerRunReport {
    const automation=this.view(),started=Number(this.store.db.prepare("SELECT MIN(created_at) time FROM control_events WHERE kind='owner_automation_changed' AND json_extract(payload,'$.batchId')=?").get(automation.batchId)!.time??Date.now());
    return {asOf:Date.now(),automation,goals:[...this.goals.list(),...this.goals.list(true)].map(goal=>{
      const usage=this.store.db.prepare("SELECT COALESCE(SUM(actual_tokens),0) spent,COALESCE(SUM(CASE WHEN state IN ('SENT','UNKNOWN') THEN MAX(0,reserved_tokens-COALESCE(actual_tokens,0)) ELSE 0 END),0) reserved,COALESCE(SUM(cost_cny),0) cost FROM owner_model_permits WHERE batch_id=? AND goal_id=?").get(automation.batchId,goal.id)!;
      return {goalId:goal.id,title:goal.title,status:goal.status,spentTokens:Number(usage.spent),reservedTokens:Number(usage.reserved),knownCostCny:Number(usage.cost),evidence:this.goals.detail(goal.id).evidence.filter(e=>e.createdAt>=started),reason:goal.reason};
    })};
  }
  reconcileCall(id:string,input:any) {
    exactKeys(input,['actualTokens','costCny','reason','expectedRevision','idempotencyKey']);
    ownerInput(Number.isSafeInteger(input.actualTokens)&&input.actualTokens>=0&&input.actualTokens<=1_000_000_000&&typeof input.costCny==='number'&&Number.isFinite(input.costCny)&&input.costCny>=0&&typeof input.reason==='string'&&input.reason.trim().length>=8&&input.reason.length<=1000);
    return this.goals.request(input.idempotencyKey,{reconcile:id,input},()=>{
      if(this.view().revision!==input.expectedRevision)ownerConflict();
      const row=this.store.db.prepare("SELECT state FROM owner_model_permits WHERE id=?").get(id);
      if(row?.state!=='UNKNOWN')ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      this.store.db.prepare("UPDATE owner_model_permits SET state='SETTLED',actual_tokens=?,cost_cny=? WHERE id=?").run(input.actualTokens,input.costCny,id);
      this.store.db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_model_usage_reconciled',JSON.stringify({permitId:id,...input}),Date.now());
      // This resolves only control accounting. Original World/Business recovery remains mandatory.
      this.store.db.prepare('UPDATE owner_automation_control SET revision=revision+1,updated_at=? WHERE id=1').run(Date.now());
      return this.view();
    });
  }
  assertTool(worldId: string, name: string, effect?: string) {
    this.assertOn();
    const run = this.store.db.prepare("SELECT run_id FROM owner_run_permits WHERE world_id=? AND state='ACTIVE'").get(worldId);
    if (run) this.assertGoal(this.binding(String(run.run_id)));
    // World tools have no trusted publication approval. Business connectors retain their own exact approvals.
    if (effect === 'write' && !['save_artifact', 'transfer_artifact', 'REQUEST_RECRUIT', 'SUBMIT_APP_CODE', 'CREATE_BODY_SKILL', 'CALL_BODY_SKILL', 'NOMINATE_GENE_ASSET', 'PROMOTE_BODY_SKILL'].includes(name)) ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
    if (['ROLLBACK_RELEASE', 'DELETE_RELEASE'].includes(name)) ownerConflict('OWNER_MAINTENANCE_APPROVAL_REQUIRED');
  }
  provider(provider: ModelProvider, meter: UsageMeter, worldId?: string,sourceKind=worldId?'world':'owner_chat',capacity:()=>number=()=>Infinity,resourceBinding?:GoalRunBinding): ModelProvider {
    return { call: async (request, signal) => {
      this.assertOn();
      const run = worldId ? this.store.db.prepare("SELECT * FROM owner_run_permits WHERE world_id=? AND state='ACTIVE'").get(worldId) : undefined;
      const binding = run ? this.binding(String(run.run_id)) : resourceBinding; this.assertGoal(binding);
      const price = meter.getPricingForModel(request.model);
      if (!price || price.currency&&price.currency.toUpperCase()!=='CNY' || ![price.input_cost_per_million, price.output_cost_per_million].every(v => Number.isFinite(v) && v >= 0)) throw new InfrastructureFailureError('MODEL_PRICE_REQUIRED');
      const v = this.view(), overhead = Buffer.byteLength(JSON.stringify(request.messages), 'utf8') + 1024;
      const goal = binding ? this.goals.get(binding.goalId) : undefined;
      const available = Math.min(v.maxTokens-v.spentTokens-v.reservedTokens,goal ? goal.maxTokens-goal.spentTokens-goal.reservedTokens : Infinity,capacity());
      const output = Math.min(request.maxTokens ?? 0, binding ? 4096 : Infinity, available-overhead);
      if (!Number.isSafeInteger(output) || output! <= 0) throw new InfrastructureFailureError('OWNER_MODEL_OUTPUT_LIMIT_REQUIRED');
      const reserve = overhead + output;
      const id = `model_${randomUUID()}`;
      this.store.transaction(() => {
        this.assertOn(); this.assertGoal(binding);
        const v = this.view(); if (v.spentTokens + v.reservedTokens + reserve > v.maxTokens) throw new InfrastructureFailureError('OWNER_TOKEN_LIMIT');
        if (binding) { const goal = this.goals.get(binding.goalId); if (goal.spentTokens + goal.reservedTokens + reserve > goal.maxTokens) throw new InfrastructureFailureError('OWNER_GOAL_TOKEN_LIMIT'); }
        this.store.db.prepare("INSERT INTO owner_model_permits VALUES(?,?,?,?,?,'SENT',?,NULL,NULL,?)").run(id, v.batchId, worldId ?? null, binding?.goalId ?? null, binding?.specificationRevision ?? null, reserve, Date.now());
        if(request.auditCallId)this.store.db.prepare('INSERT INTO owner_model_sources VALUES(?,?,?)').run(id,request.auditCallId,sourceKind);
      });
      this.calls.add(id);
      try {
        const response = await provider.call({...request,maxTokens:output}, signal), usage = meter.calculateUsage({ model: request.model, ...response.usage });
        const known = usage.actualTokens !== null && usage.costCny !== null;
        this.store.db.prepare('UPDATE owner_model_permits SET state=?,actual_tokens=?,cost_cny=? WHERE id=?').run(known ? 'SETTLED' : 'UNKNOWN', usage.actualTokens, usage.costCny, id);
        if (!known) this.halt('OWNER_OUTCOME_REVIEW_REQUIRED');
        else if (usage.actualTokens! > reserve) this.halt('OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION');
        return response; // Existing World/Business ledgers must still store the real response and bill.
      } catch (e) {
        this.store.db.prepare("UPDATE owner_model_permits SET state=?,actual_tokens=?,cost_cny=? WHERE id=? AND state='SENT'").run(e instanceof InfrastructureFailureError ? 'NOT_SENT' : 'UNKNOWN', e instanceof InfrastructureFailureError ? 0 : null, e instanceof InfrastructureFailureError ? 0 : null, id);
        if (!(e instanceof InfrastructureFailureError)) this.halt('OWNER_OUTCOME_REVIEW_REQUIRED');
        throw e;
      } finally { this.calls.delete(id); }
    } };
  }
}
