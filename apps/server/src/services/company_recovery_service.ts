import type {OwnerAutomationGate} from './owner_automation_gate.js';
import type {CompanyWorkerAdapter} from './company_worker_adapter.js';
import {companyFactHash} from './company_fact_hash.js';
import {exactKeys,ownerConflict,ownerInput} from './owner_goal_service.js';

/** Owner outcome decisions are separate from billing receipts and never replay an operation. */
export class CompanyRecoveryService {
  constructor(readonly gate:OwnerAutomationGate,readonly worker:CompanyWorkerAdapter){
    gate.store.db.exec(`CREATE TABLE IF NOT EXISTS company_execution_reviews(attempt_id TEXT PRIMARY KEY REFERENCES company_execution_attempts(id),review_hash TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS company_tool_reviews(operation_id TEXT PRIMARY KEY REFERENCES company_controller_tools(operation_id),attempt_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  }
  private attempt(id:string){
    const db=this.gate.store.db,a=this.gate.execution!.get(id),tools=db.prepare("SELECT operation_id,tool,args_hash FROM company_controller_tools WHERE attempt_id=? AND state='STARTED' ORDER BY operation_id").all(id);
    const permits=db.prepare("SELECT p.id,p.state,p.actual_tokens,p.cost_cny,r.reserved_micros FROM company_attempt_permits x JOIN owner_model_permits p ON p.id=x.permit_id LEFT JOIN owner_money_reservations r ON r.permit_id=p.id WHERE x.attempt_id=? ORDER BY p.id").all(id);
    const facts={id:a.id,taskId:a.taskId,goalId:a.goalId,fence:a.fence,revision:a.revision,state:a.state,reason:a.reason,tools,permits};return {...facts,hash:companyFactHash(facts)};
  }
  view(){
    const db=this.gate.store.db;
    // Legacy migrated attempts have no worker launch row; their unknown outcome is still a
    // real pending owner fact and must stay reviewable instead of becoming a dead end.
    const attempts=db.prepare("SELECT a.id FROM company_execution_attempts a WHERE a.state='BLOCKED' AND a.reason IN ('CALL_OUTCOME_UNKNOWN','TOOL_OUTCOME_UNKNOWN') AND NOT EXISTS(SELECT 1 FROM company_execution_reviews r WHERE r.attempt_id=a.id) ORDER BY a.created_at").all().map(r=>this.attempt(String(r.id)));
    const holds=db.prepare("SELECT b.*,c.payload_json FROM company_admission_blocks b LEFT JOIN company_admission_context c USING(id) WHERE b.id='safety'").all().map(r=>{const context=r.payload_json?JSON.parse(String(r.payload_json)):{},permit=context.permitId?db.prepare('SELECT p.id,p.state,p.actual_tokens,p.cost_cny,r.reserved_micros,r.settled_micros FROM owner_model_permits p LEFT JOIN owner_money_reservations r ON r.permit_id=p.id WHERE p.id=?').get(context.permitId):null,facts={id:String(r.id),reason:String(r.reason),updatedAt:Number(r.updated_at),permit:permit??null};return {...facts,canAcknowledge:r.reason==='OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION'&&permit?.state==='SETTLED',hash:companyFactHash(facts)};});
    return {attempts,holds};
  }
  async abandon(id:string,input:any){
    exactKeys(input,['hash','reason','idempotencyKey']);ownerInput(typeof input.hash==='string'&&typeof input.reason==='string'&&input.reason.trim().length>=8&&input.reason.length<=1000,'OWNER_RECOVERY_INVALID');
    const request={abandonAttempt:id,input},old=this.gate.store.db.prepare('SELECT 1 FROM owner_control_requests WHERE key=?').get(input.idempotencyKey);if(old)return this.gate.goals.request(input.idempotencyKey,request,()=>{throw new Error('IDEMPOTENCY_CONFLICT');});
    // A legacy migrated attempt never launched a worker process; only launched ones need proof of exit.
    const launched=Boolean(this.gate.store.db.prepare('SELECT 1 FROM company_worker_launches WHERE attempt_id=?').get(id));
    if(launched&&(this.worker.isRunning(id)||!await this.worker.recover(id)))ownerConflict('OWNER_PREVIOUS_WORKER_STILL_ALIVE');
    return this.gate.goals.request(input.idempotencyKey,request,()=>{
      const facts=this.attempt(id),a=this.gate.execution!.get(id),db=this.gate.store.db;
      if(facts.hash!==input.hash||this.gate.execution!.forTask(a.taskId)?.id!==id||a.state!=='BLOCKED'||!['CALL_OUTCOME_UNKNOWN','TOOL_OUTCOME_UNKNOWN'].includes(a.reason??''))ownerConflict('OWNER_RECOVERY_CHANGED');
      db.prepare("INSERT INTO company_execution_reviews VALUES(?,?,'ABANDONED',?,?)").run(id,input.hash,input.reason,Date.now());
      for(const tool of facts.tools)db.prepare("INSERT INTO company_tool_reviews VALUES(?,?,'ABANDONED',?,?)").run(tool.operation_id,id,input.reason,Date.now());
      for(const permit of facts.permits)if(permit.state==='UNKNOWN')db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_model_outcome_reviewed',NULL,?,?)").run(JSON.stringify({permitId:permit.id,attemptId:id,decision:'abandon',reason:input.reason}),Date.now());
      // The unknown outcome is now explicitly owned. A launched worker may have produced real
      // side effects, so its goal stays blocked until an explicit reopen. A legacy migrated
      // attempt never ran a worker: releasing the task lets the company find another way.
      if(!launched){
        db.prepare("UPDATE owner_work_tasks SET state='QUEUED',run_id=NULL,turn_id=NULL,reply=NULL,reason=NULL,updated_at=? WHERE id=? AND state IN ('FAILED','BLOCKED','NO_REPLY')").run(Date.now(),a.taskId);
        const dispatch=db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(a.taskId);
        if(dispatch){
          db.prepare("UPDATE owner_goal_dispatches SET state='QUEUED',reason=NULL WHERE id=?").run(String(dispatch.id));
          db.prepare("UPDATE owner_goal_steps SET state='QUEUED' WHERE id=?").run(String(dispatch.id));
        }
        if(a.goalId&&this.gate.goals.get(a.goalId).status==='BLOCKED'&&this.gate.goals.get(a.goalId).reason===a.reason)this.gate.goals.state(a.goalId,'READY');
      }
      db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('company_execution_abandoned',NULL,?,?)").run(JSON.stringify({attemptId:id,hash:input.hash,reason:input.reason}),Date.now());
      return {attemptId:id,decision:'ABANDONED',reservationRetained:true,replayed:false};
    });
  }
  acknowledge(id:string,input:any){
    exactKeys(input,['hash','reason','idempotencyKey']);ownerInput(typeof input.hash==='string'&&typeof input.reason==='string'&&input.reason.trim().length>=8&&input.reason.length<=1000,'OWNER_RECOVERY_INVALID');
    return this.gate.goals.request(input.idempotencyKey,{safetyHold:id,input},()=>{
      const hold=this.view().holds.find(h=>h.id===id);if(!hold||hold.hash!==input.hash)ownerConflict('OWNER_RECOVERY_CHANGED');
      if(!hold.canAcknowledge)ownerConflict('OWNER_SAFETY_RECEIPT_REQUIRED');
      this.gate.store.db.prepare('DELETE FROM company_admission_blocks WHERE id=? AND updated_at=?').run(id,hold.updatedAt);
      this.gate.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('company_safety_acknowledged',NULL,?,?)").run(JSON.stringify({id,hold,reason:input.reason}),Date.now());
      return {id,acknowledged:true,desiredMode:this.gate.view().desiredMode};
    });
  }
}
