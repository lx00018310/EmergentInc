import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import type { CoreStore, WorldRegistryStore } from '@emergentinc/persistence';
import { InfrastructureFailureError, type ModelProvider, type UsageMeter } from '@emergentinc/model';
import type { OwnerAutomation, OwnerRunReport } from '@emergentinc/protocol';
import { OwnerGoalService, exactKeys, ownerConflict, ownerInput } from './owner_goal_service.js';

export interface GoalRunBinding { goalId: string; specificationRevision: number; dispatchId: string; resourceApprovalId?:string }
import { OwnerProposalService } from './owner_proposal_service.js';
import { OwnerCompanyBudget,reviewedOutcomeSql } from './owner_company_budget.js';
import type { CompanyExecutionService } from './company_execution_service.js';
import { CompanyAdmissionService } from './company_admission_service.js';
import { CompanyModelLedger, type CompanyModelContext } from './company_model_ledger.js';
export class OwnerAutomationGate {
  execution?: CompanyExecutionService;
  readonly goals: OwnerGoalService;
  readonly budget: OwnerCompanyBudget;
  readonly proposals: OwnerProposalService;
  readonly admission: CompanyAdmissionService;
  readonly models: CompanyModelLedger;
  private maintenance = () => false;
  private live = new Set<string>();
  private external = new Set<string>();
  private calls = new Set<string>();
  private suspend = () => {};
  private suspendChecks:(()=>void)[]=[];
  addSuspend(check:()=>void){this.suspendChecks.push(check);}
  private suspendAll(){this.suspend();for(const check of this.suspendChecks)check();}
  private unresolved: (worldId: string) => boolean = () => false;
  private unknownChecks: ((worldId?: string, goalId?: string) => boolean)[] = [];
  private flightChecks: (() => boolean)[] = [];
  addUnknownCheck(check: (worldId?: string, goalId?: string) => boolean) { this.unknownChecks.push(check); }
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
    this.budget = new OwnerCompanyBudget(store);
    this.admission = new CompanyAdmissionService(store);
    this.models = new CompanyModelLedger(store,this.budget,{
      admit:context=>this.assertModelPermission(context),batchId:()=>String(this.row().batch_id),
      bind:(id,context)=>{if(context.runId)this.execution?.bindPermit(id,context.runId);},
      changed:id=>this.execution?.refreshPermit(id),exceeded:id=>this.halt('OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION',id)
    });
    this.proposals = new OwnerProposalService(this);
    // A prior process never proves that a SENT call was not delivered.
    store.db.prepare("UPDATE owner_model_permits SET state='UNKNOWN' WHERE state='SENT'").run();
  }
  attach(maintenance: () => boolean, suspend: () => void, unresolved: (worldId: string) => boolean) { this.maintenance = maintenance; this.suspend = suspend; this.unresolved = unresolved; }
  private row() { return this.store.db.prepare('SELECT * FROM owner_automation_control WHERE id=1').get()!; }
  private usage(){return this.store.db.prepare("SELECT COALESCE(SUM(actual_tokens),0) spent,COALESCE(SUM(CASE WHEN state IN ('SENT','UNKNOWN') THEN MAX(0,reserved_tokens-COALESCE(actual_tokens,0)) ELSE 0 END),0) reserved,COALESCE(SUM(cost_cny),0) cost,SUM(state!='NOT_SENT' AND cost_cny IS NULL) unknown_cost FROM owner_model_permits").get()!;}
  isOn() { return this.row().desired_mode==='ON'&&!this.maintenance()&&!this.admission.reason()&&this.budget.view().activatedAt!==null&&this.budget.view().availableMicros>0&&!this.budget.view().needsRefill; }
  private hasUnknown() { return Boolean(this.store.db.prepare(`SELECT 1 FROM owner_model_permits p WHERE p.state='UNKNOWN' AND NOT ${reviewedOutcomeSql}`).get()); }
  scopeBlocked(worldId: string, goalId?: string) {
    return Boolean(this.store.db.prepare(`SELECT 1 FROM owner_model_permits p LEFT JOIN owner_model_sources s ON s.permit_id=p.id WHERE p.state='UNKNOWN' AND (s.source_kind IS NULL OR s.source_kind!='company_worker') AND NOT ${reviewedOutcomeSql} AND (p.world_id=? OR (? IS NOT NULL AND p.goal_id=?))`).get(worldId,goalId??null,goalId??null))
      || this.unresolved(worldId) || this.unknownChecks.some(check=>check(worldId,goalId));
  }
  private assertScope(worldId?: string, binding?: GoalRunBinding) {
    if(worldId&&this.scopeBlocked(worldId,binding?.goalId))throw Object.assign(new InfrastructureFailureError('OWNER_OUTCOME_REVIEW_REQUIRED'),{statusCode:409});
  }
  private assertModelPermission(context: CompanyModelContext) {
    this.assertOn();this.assertGoal(context.binding);
    if(context.scope==='worker'){
      const attempt=context.runId?this.execution?.forRun(context.runId):undefined;
      if(!attempt||attempt.id!==context.attemptId||!['DISPATCH_PENDING','RUNNING'].includes(attempt.state))ownerConflict('OWNER_ATTEMPT_STALE');
      if(this.store.db.prepare("SELECT 1 FROM company_attempt_permits a JOIN owner_model_permits p ON p.id=a.permit_id LEFT JOIN company_model_dispatches d ON d.permit_id=p.id WHERE a.attempt_id=? AND p.state='UNKNOWN' AND d.response_json IS NULL").get(attempt.id))ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
    }else this.assertScope(context.worldId,context.binding);
  }
  ensureRunning(source: string, required = 0, start: 'never' | 'initial' | 'resume' = 'never'): OwnerAutomation {
    return this.store.transaction(() => {
      const old=this.row(),initial=old.desired_mode==='OFF'&&old.revision===0&&old.reason===null;
      if(old.desired_mode==='OFF'&&!(start==='resume'||start==='initial'&&initial))return this.view();
      if(this.maintenance())ownerConflict('EVOLUTION_QUIESCED');
      if(this.admission.reason())ownerConflict(this.admission.reason()!);
      if(old.reason&&!['OWNER_TOKEN_LIMIT','OWNER_OUTCOME_REVIEW_REQUIRED'].includes(String(old.reason)))ownerConflict(String(old.reason));
      const budget=this.budget.view();if(budget.activatedAt===null)ownerConflict('OWNER_COMPANY_BUDGET_REQUIRED');
      if(budget.needsRefill||!budget.availableMicros)ownerConflict('OWNER_COMPANY_BUDGET_EXHAUSTED');
      if(old.desired_mode==='OFF'&&(this.live.size||this.calls.size||this.external.size||this.serviceFlights()))ownerConflict('OWNER_AUTOMATION_STOPPING');
      if(old.desired_mode!=='ON')this.store.db.prepare("UPDATE owner_automation_control SET desired_mode='ON',run_mode='CONTINUOUS',requested_rounds=NULL,revision=revision+1,reason=NULL,updated_at=? WHERE id=1").run(Date.now());
      return this.view();
    });
  }
  assertOn() {
    if (!this.isOn()) throw Object.assign(new InfrastructureFailureError(this.maintenance() ? 'EVOLUTION_QUIESCED' : this.row().desired_mode!=='ON'?'OWNER_AUTOMATION_OFF':this.admission.reason()??(this.budget.view().activatedAt===null?'OWNER_COMPANY_BUDGET_REQUIRED':'OWNER_COMPANY_BUDGET_EXHAUSTED')), {statusCode:409});
  }
  private assertGoal(binding?: GoalRunBinding) {
    if (!binding) return;
    const goal = this.goals.get(binding.goalId);
    const resource=binding.resourceApprovalId&&this.store.db.prepare("SELECT 1 FROM owner_goal_recruits r JOIN owner_recruit_requests q ON q.id=r.request_id WHERE r.request_id=? AND r.goal_id=? AND r.goal_revision=? AND q.state IN ('PENDING','APPROVED')").get(binding.resourceApprovalId,binding.goalId,binding.specificationRevision);
    if (goal.specificationRevision !== binding.specificationRevision || !(resource?!['ARCHIVED','STOPPED','COMPLETED'].includes(goal.status):['READY', 'RUNNING'].includes(goal.status))) ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
  }
  control(input: any): OwnerAutomation {
    exactKeys(input, ['desiredMode', 'runMode', 'requestedRounds', 'expectedRevision', 'idempotencyKey']);
    ownerInput(['ON','OFF'].includes(input.desiredMode)&&Number.isSafeInteger(input.expectedRevision));
    const result=this.goals.request(input.idempotencyKey,{control:input},()=>{
      const old=this.row();if(old.revision!==input.expectedRevision)ownerConflict();
      if(input.desiredMode==='ON')this.ensureRunning('owner_control',0,'resume');
      else this.store.db.prepare("UPDATE owner_automation_control SET desired_mode='OFF',revision=revision+1,updated_at=? WHERE id=1").run(Date.now());
      this.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_automation_changed',NULL,?,?)").run(JSON.stringify({desiredMode:input.desiredMode}),Date.now());
      return this.view();
    });
    if(this.row().desired_mode==='OFF')this.suspendAll();return {...result,observedState:this.view().observedState,inFlight:this.view().inFlight};
  }
  halt(reason: string,permitId?:string) {
    this.admission.block('safety',reason,permitId?{permitId}:undefined);
    this.suspendAll();
  }
  view(): OwnerAutomation {
    const r = this.row(), db = this.store.db;
    const rounds = db.prepare("SELECT SUM(state IN ('STARTED','COMPLETED')) started,SUM(state='COMPLETED') completed,SUM(state='RESERVED') reserved FROM owner_round_permits").get()!;
    const usage=this.usage();
    const inFlight = this.live.size + this.calls.size + this.external.size + this.serviceFlights();
    const budget=this.budget.view();
    const observedState=r.desired_mode==='OFF'?(inFlight?'STOPPING':'STOPPED'):this.maintenance()||this.admission.reason()?'BLOCKED':(budget.needsRefill||budget.availableMicros<=0)?'LIMIT_REACHED':inFlight?'RUNNING':'IDLE';
    return {desiredMode:r.desired_mode as 'ON'|'OFF',runMode:'CONTINUOUS',requestedRounds:null,maxTokens:Number(r.max_tokens),revision:Number(r.revision),batchId:String(r.batch_id),updatedAt:Number(r.updated_at),reason:this.maintenance()?'EVOLUTION_QUIESCED':this.admission.reason()??(r.desired_mode==='ON'&&(budget.needsRefill||budget.availableMicros<=0)?(budget.activatedAt===null?'OWNER_COMPANY_BUDGET_REQUIRED':'OWNER_COMPANY_BUDGET_EXHAUSTED'):r.reason==='OWNER_OUTCOME_REVIEW_REQUIRED'?null:r.reason as string|null),observedState,inFlight,startedRounds:Number(rounds.started??0),completedRounds:Number(rounds.completed??0),reservedRounds:Number(rounds.reserved??0),spentTokens:Number(usage.spent),reservedTokens:Number(usage.reserved),knownCostCny:Number(usage.cost),unknownCostCalls:Number(usage.unknown_cost??0),budget};
  }
  reserveRun(worldId: string, runId: string, startRound: number, rounds: number, binding?: GoalRunBinding, scope?: 'worker') {
    this.ensureRunning('reserve_run');
    this.assertOn(); this.assertGoal(binding); if(scope!=='worker')this.assertScope(worldId,binding);
    let control=this.row();
    this.store.transaction(() => {
      this.assertOn(); this.assertGoal(binding);
      control=this.row();
      const prior=this.store.db.prepare('SELECT * FROM owner_run_permits WHERE run_id=?').get(runId);
      if(prior){
        const range=this.store.db.prepare('SELECT MIN(round_no) first,COUNT(*) n FROM owner_round_permits WHERE run_id=?').get(runId)!;
        if(prior.state!=='PREPARING'||prior.world_id!==worldId||prior.goal_id!==(binding?.goalId??null)||prior.goal_revision!==(binding?.specificationRevision??null)||prior.dispatch_id!==(binding?.dispatchId??null)||range.first!==startRound||range.n!==rounds)ownerConflict('OWNER_ATTEMPT_CONFLICT');
        return;
      }
      if(!binding&&this.store.db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE world_id=? AND state IN ('QUEUED','RUNNING')").get(worldId))ownerConflict('OWNER_AUTOMATION_BUSY');
      if (this.store.db.prepare("SELECT 1 FROM owner_run_permits WHERE world_id=? AND state IN ('ACTIVE','PREPARING') AND run_id!=?").get(worldId,runId)) ownerConflict('OWNER_AUTOMATION_BUSY');
      this.store.db.prepare("INSERT INTO owner_run_permits VALUES(?,?,?,?,?,?,'PREPARING',?)").run(runId, worldId, control.batch_id!, binding?.goalId ?? null, binding?.specificationRevision ?? null, binding?.dispatchId ?? null, Date.now());
      for (let r = startRound; r < startRound + rounds; r++) this.store.db.prepare("INSERT INTO owner_round_permits VALUES(?,?,?,'RESERVED')").run(runId, r, control.batch_id!);
    });
  }
  assertWorkerIntent(runId: string, attemptId: string) {
    if(this.maintenance())ownerConflict('EVOLUTION_QUIESCED');
    if(this.row().desired_mode!=='ON')ownerConflict('OWNER_AUTOMATION_OFF');
    if(this.admission.reason())ownerConflict(this.admission.reason()!);
    const binding=this.binding(runId);
    if(binding&&this.goals.get(binding.goalId).status==='PAUSED')ownerConflict('OWNER_GOAL_PAUSED');
    this.assertGoal(binding);
    const a=this.execution?.forRun(runId);if(!a||a.id!==attemptId||!['DISPATCH_PENDING','RUNNING','SUSPENDED'].includes(a.state))ownerConflict('OWNER_ATTEMPT_STALE');
  }
  runCreated(runId: string) { this.store.db.prepare("UPDATE owner_run_permits SET state='ACTIVE' WHERE run_id=?").run(runId); this.live.add(runId); }
  cancelRun(runId: string) { this.store.db.prepare("UPDATE owner_round_permits SET state='RELEASED' WHERE run_id=? AND state='RESERVED'").run(runId); this.store.db.prepare("UPDATE owner_run_permits SET state='FINISHED' WHERE run_id=?").run(runId);this.execution?.observe(runId,'interrupted','OWNER_EXECUTION_CANCELLED');this.live.delete(runId); }
  binding(runId: string): GoalRunBinding | undefined {
    const row = this.store.db.prepare('SELECT * FROM owner_run_permits WHERE run_id=?').get(runId);
    return row?.goal_id ? { goalId: String(row.goal_id), specificationRevision: Number(row.goal_revision), dispatchId: String(row.dispatch_id) } : undefined;
  }
  mayContinue(runId: string) { try { this.assertOn(); this.assertGoal(this.binding(runId)); const p=this.store.db.prepare('SELECT world_id FROM owner_run_permits WHERE run_id=?').get(runId);this.assertScope(p?String(p.world_id):undefined,this.binding(runId));return true; } catch { return false; } }
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
    const permit=this.store.db.prepare('SELECT world_id FROM owner_run_permits WHERE run_id=?').get(runId);
    if (!permit) ownerConflict('OWNER_LEGACY_RUN_REQUIRES_NEW_AUTHORIZATION');
    this.assertScope(String(permit.world_id),this.binding(runId));
    if (this.store.db.prepare("SELECT 1 FROM owner_run_permits WHERE world_id=? AND run_id!=? AND state IN ('ACTIVE','PREPARING')").get(permit.world_id,runId)) ownerConflict('OWNER_AUTOMATION_BUSY');
    this.execution?.resumeLegacyRun(runId);
    this.runCreated(runId);
  }
  reconcileRun(runId: string, completedThrough: number, resumable: boolean) {
    this.store.db.prepare("UPDATE owner_round_permits SET state='COMPLETED' WHERE run_id=? AND round_no<=? AND state IN ('STARTED','RESERVED')").run(runId, completedThrough);
    this.finished(runId, resumable);
  }
  enforceLimits() { if(this.row().desired_mode==='ON'&&!this.live.size&&!this.calls.size&&(this.budget.view().needsRefill||!this.budget.view().availableMicros))this.suspendAll(); }
  async externalAction<T>(key: string, action: () => Promise<T>): Promise<T> {
    this.assertOn(); this.external.add(key); try { return await action(); } finally { this.external.delete(key); }
  }
  reconcileWorld(core: CoreStore, worldId: string) {
    for(const row of this.store.db.prepare("SELECT p.id,s.source_id FROM owner_model_permits p JOIN owner_model_sources s ON s.permit_id=p.id WHERE p.world_id=? AND p.state='UNKNOWN' AND s.source_kind='world'").all(worldId)) {
      const call=core.modelCalls.getModelCall(String(row.source_id));
      const reservation=core.db.prepare('SELECT message_id FROM reservations WHERE call_id=?').get(row.source_id);
      const decision=core.db.prepare("SELECT decision_id,decision FROM recovery_decisions WHERE kind='model' AND id=? ORDER BY created_at DESC LIMIT 1").get(row.source_id);
      if(decision?.decision==='confirm_not_billed')this.store.db.prepare("UPDATE owner_model_permits SET state='NOT_SENT',actual_tokens=0,cost_cny=0 WHERE id=?").run(row.id);
      else if(call&&call.outcome!=='CALL_OUTCOME_UNKNOWN'&&call.actualTokens!==null&&call.costCny!==null)
        this.store.transaction(()=>{this.budget.settle(String(row.id),Math.ceil(call.costCny!*1000000));this.store.db.prepare("UPDATE owner_model_permits SET state='SETTLED',actual_tokens=?,cost_cny=? WHERE id=?").run(call.actualTokens,call.costCny,row.id);});
      else if(decision&&['abandon','settle_reserved'].includes(String(decision.decision))&&(!call||call.outcome==='CALL_OUTCOME_RECONCILED')&&
        (call?.messageId??reservation?.message_id)&&core.messages.getMessage(String(call?.messageId??reservation?.message_id))?.status==='ABANDONED'&&
        !core.db.prepare("SELECT 1 FROM reservations WHERE call_id=? AND status='OPEN'").get(row.source_id)){
        // One recovery decision suffices. Keep UNKNOWN money reserved until actual billing is verified.
        this.store.db.prepare(`INSERT INTO control_events(kind,world_id,payload,created_at)
          SELECT 'owner_model_outcome_reviewed',?,?,? FROM owner_model_permits p WHERE p.id=? AND NOT ${reviewedOutcomeSql}`)
          .run(worldId,JSON.stringify({permitId:row.id,sourceCallId:row.source_id,sourceDecisionId:decision.decision_id,decision:decision.decision}),Date.now(),row.id);
      }
      this.execution?.refreshPermit(String(row.id));
    }
    this.clearResolvedReview();
  }
  private clearResolvedReview(){if(!this.hasUnknown())this.store.db.prepare("UPDATE owner_automation_control SET reason=NULL WHERE reason='OWNER_OUTCOME_REVIEW_REQUIRED'").run();}
  modelCalls(includeReviewed=false) { return this.store.db.prepare(`SELECT p.*,s.source_id,s.source_kind,${reviewedOutcomeSql} reviewed FROM owner_model_permits p LEFT JOIN owner_model_sources s ON s.permit_id=p.id WHERE p.state='UNKNOWN' ${includeReviewed?'':`AND NOT ${reviewedOutcomeSql}`} ORDER BY p.created_at`).all(); }
  report():OwnerRunReport {
    const automation=this.view();
    return {asOf:Date.now(),automation,goals:[...this.goals.list(),...this.goals.list(true)].map(goal=>{
      const usage=this.store.db.prepare("SELECT COALESCE(SUM(actual_tokens),0) spent,COALESCE(SUM(CASE WHEN state IN ('SENT','UNKNOWN') THEN MAX(0,reserved_tokens-COALESCE(actual_tokens,0)) ELSE 0 END),0) reserved,COALESCE(SUM(cost_cny),0) cost FROM owner_model_permits WHERE goal_id=?").get(goal.id)!;
      return {goalId:goal.id,title:goal.title,status:goal.status,spentTokens:Number(usage.spent),reservedTokens:Number(usage.reserved),knownCostCny:Number(usage.cost),evidence:this.goals.detail(goal.id).evidence,reason:goal.reason};
    })};
  }
  reconcileCall(id:string,input:any) {
    exactKeys(input,['actualTokens','costCny','reason','expectedRevision','idempotencyKey']);
    ownerInput(Number.isSafeInteger(input.actualTokens)&&input.actualTokens>=0&&typeof input.costCny==='number'&&Number.isFinite(input.costCny)&&input.costCny>=0&&typeof input.reason==='string'&&input.reason.trim().length>=8&&input.reason.length<=1000);
    return this.goals.request(input.idempotencyKey,{reconcile:id,input},()=>{
      if(this.view().revision!==input.expectedRevision)ownerConflict();
      const row=this.store.db.prepare("SELECT state FROM owner_model_permits WHERE id=?").get(id);
      if(row?.state!=='UNKNOWN')ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      this.budget.settle(id,Math.ceil(input.costCny*1000000));
      this.store.db.prepare("UPDATE owner_model_permits SET state='SETTLED',actual_tokens=?,cost_cny=? WHERE id=?").run(input.actualTokens,input.costCny,id);
      this.store.db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_model_usage_reconciled',JSON.stringify({permitId:id,...input}),Date.now());
      this.clearResolvedReview();
      // This resolves only control accounting. Original World/Business recovery remains mandatory.
      this.store.db.prepare('UPDATE owner_automation_control SET revision=revision+1,updated_at=? WHERE id=1').run(Date.now());
      this.execution?.refreshPermit(id);
      return this.view();
    });
  }
  assertTool(worldId: string, name: string, effect?: string) {
    this.assertOn();
    const run = this.store.db.prepare("SELECT run_id FROM owner_run_permits WHERE world_id=? AND state='ACTIVE'").get(worldId);
    this.assertScope(worldId,run?this.binding(String(run.run_id)):undefined);
    if (run) this.assertGoal(this.binding(String(run.run_id)));
    // World tools have no trusted publication approval. Business connectors retain their own exact approvals.
    if (effect === 'write' && !['save_artifact', 'transfer_artifact', 'REQUEST_RECRUIT', 'SUBMIT_APP_CODE', 'REPLAN_TASK', 'REQUEST_TASK_CLOSE', 'CREATE_BODY_SKILL', 'CALL_BODY_SKILL', 'SUBMIT_EXTENSION', 'SET_EXTENSION_STATE', 'NOMINATE_GENE_ASSET', 'PROMOTE_BODY_SKILL'].includes(name)) ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
    if (['ROLLBACK_RELEASE', 'DELETE_RELEASE'].includes(name)) ownerConflict('OWNER_MAINTENANCE_APPROVAL_REQUIRED');
  }
  provider(provider: ModelProvider, meter: UsageMeter, worldId?: string,sourceKind=worldId?'world':'owner_chat',resourceBinding?:GoalRunBinding): ModelProvider {
    return { call: async (request, signal) => {
      const run = worldId ? this.store.db.prepare("SELECT * FROM owner_run_permits WHERE world_id=? AND state='ACTIVE'").get(worldId) : undefined;
      const binding = run ? this.binding(String(run.run_id)) : resourceBinding;
      const call=this.models.prepare(request,meter,{worldId,sourceKind,binding,runId:run?String(run.run_id):undefined});
      if(call.response)return call.response;
      const id=call.permitId;
      this.calls.add(id);
      try {
        const response=await provider.call(call.request,signal);
        this.models.response(id,response);return response;
      } catch (e) {
        this.models.failure(id,e instanceof InfrastructureFailureError);throw e;
      } finally { this.calls.delete(id);this.execution?.refreshPermit(id); }
    } };
  }
}
