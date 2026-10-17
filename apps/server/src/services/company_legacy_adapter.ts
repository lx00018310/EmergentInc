import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { SqliteDatabase } from '@emergentinc/persistence';
import type { CompanyExecutionService } from './company_execution_service.js';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import { containedPath } from './safe_path.js';
import { ownerConflict } from './owner_goal_service.js';
import { companyFactHash } from './company_fact_hash.js';

/** Only observes or finishes already-created legacy Runs. New work never enters this adapter. */
export class CompanyLegacyAdapter {
  constructor(readonly manager:WorldRuntimeManager,readonly execution:CompanyExecutionService){
    this.db().exec(`CREATE TABLE IF NOT EXISTS company_legacy_runs(run_id TEXT PRIMARY KEY,task_id TEXT UNIQUE NOT NULL,world_id TEXT NOT NULL,epoch INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS company_legacy_intents(task_id TEXT PRIMARY KEY,turn_id TEXT NOT NULL,world_id TEXT NOT NULL,message_id TEXT NOT NULL,decision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS company_legacy_receipts(operation_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,tool TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT NOT NULL,payload_hash TEXT NOT NULL);`);
  }
  private db(){return this.execution.gate.store.db;}
  hasRun(runId:string){return Boolean(this.db().prepare('SELECT 1 FROM company_legacy_runs WHERE run_id=?').get(runId));}
  private core(worldId:string,readOnly=true){const world=this.manager.registry.control.world(worldId),file=containedPath(this.manager.registry.workspace,...world.workspace_relpath.split('/'),'ledger','v9_core.sqlite3');if(!fs.existsSync(file))ownerConflict('WORLD_CORE_MISSING');return new SqliteDatabase(file,{readOnly});}
  private alive(worldId:string){
    if(this.manager.peek(worldId))return Boolean(this.manager.peek(worldId)!.run.getStatus().running);
    const world=this.manager.registry.control.world(worldId),file=containedPath(this.manager.registry.workspace,...world.workspace_relpath.split('/'),'runtime','instance.lock');
    if(!fs.existsSync(file))return false;const lock=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isSafeInteger(lock.pid)||lock.pid<=0)ownerConflict('OWNER_WORKER_IDENTITY_UNVERIFIED');
    try{process.kill(lock.pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;ownerConflict('OWNER_WORKER_IDENTITY_UNVERIFIED');}
  }
  private read(task:Record<string,any>,worldId:string){
    const core=this.core(worldId);try{
      const run=core.prepare('SELECT * FROM runs WHERE run_id=?').get(task.run_id),checkpoint=core.prepare('SELECT * FROM run_checkpoints WHERE run_id=?').get(task.run_id);
      if(!run)ownerConflict('OWNER_LEGACY_RUN_MISSING');
      const models=core.prepare('SELECT * FROM model_calls WHERE run_id=? ORDER BY created_at,call_id').all(task.run_id),tools=core.prepare('SELECT * FROM tool_executions WHERE run_id=? ORDER BY started_at,operation_id').all(task.run_id);
      const calls=new Set([...models,...core.prepare('SELECT call_id FROM reservations WHERE run_id=?').all(task.run_id)].map(c=>String(c.call_id)));
      const unknownModel=models.some(m=>m.outcome==='CALL_OUTCOME_UNKNOWN')||Boolean(core.prepare("SELECT 1 FROM messages WHERE (run_id=? OR message_id IN (SELECT message_id FROM reservations WHERE run_id=?)) AND status IN ('CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT')").get(task.run_id,task.run_id));
      const unknownTool=tools.some(t=>['STARTED','UNKNOWN'].includes(String(t.status)))||Boolean(core.prepare("SELECT 1 FROM effects WHERE message_id IN (SELECT message_id FROM model_calls WHERE run_id=?) AND status IN ('PENDING','UNKNOWN')").get(task.run_id));
      const outbox=task.turn_id?core.prepare('SELECT * FROM world_outbox WHERE turn_id=? ORDER BY created_at DESC LIMIT 1').get(task.turn_id):undefined;
      const reason=unknownModel?'CALL_OUTCOME_UNKNOWN':unknownTool?'TOOL_OUTCOME_UNKNOWN':undefined;
      const reply=outbox?.reply??task.reply;
      const state=reason?'BLOCKED':reply!=null?'COMPLETED':checkpoint?.resume_pending?'SUSPENDED':task.state==='FAILED'?'FAILED':'BLOCKED';
      return {run,checkpoint,models,calls,tools,reply:reply as string|null,reason:reason??(state==='SUSPENDED'?'OWNER_CONTROLLER_DISCONNECTED':state==='COMPLETED'?undefined:String(task.reason??run.stop_reason??'OWNER_NO_REPLY')),state};
    }finally{core.close();}
  }
  migrate(){
    const db=this.db(),gate=this.execution.gate;
    return gate.store.transaction(()=>{
      let imported=0;
      // Retire a provably unsent old inbox message before handing its same company intent to a worker.
      // The deterministic Core receipt makes a crash between the two databases recoverable.
      for(const task of db.prepare("SELECT * FROM owner_work_tasks WHERE run_id IS NULL AND turn_id IS NOT NULL AND state IN ('QUEUED','RUNNING','BLOCKED')").all()){
        const turn=db.prepare('SELECT * FROM world_chat_turns WHERE turn_id=?').get(task.turn_id);if(!turn)ownerConflict('OWNER_LEGACY_RUN_REVIEW_REQUIRED');
        const worldId=String(turn.world_id);if(this.alive(worldId))ownerConflict('OWNER_PREVIOUS_WORKER_STILL_ALIVE');
        const core=this.core(worldId,false),decisionId=`company-intent:${task.id}`,details=companyFactHash({taskId:task.id,turnId:task.turn_id,instruction:task.instruction});
        try{core.transaction(()=>{
          const message=core.prepare('SELECT * FROM messages WHERE message_id=?').get(turn.message_id),receipt=core.prepare('SELECT * FROM recovery_decisions WHERE decision_id=?').get(decisionId);
          if(!message||message.content!==task.instruction||turn.question!==task.instruction)ownerConflict('OWNER_LEGACY_RUN_REVIEW_REQUIRED');
          if(receipt){if(receipt.details!==details||message.status!=='ABANDONED'||message.abandoned_reason!=='COMPANY_INTENT_MIGRATED')ownerConflict('OWNER_RECEIPT_CONFLICT');return;}
          if(message.run_id||!['QUEUED','WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET'].includes(String(message.status))||core.prepare('SELECT 1 FROM reservations WHERE message_id=?').get(turn.message_id)||core.prepare('SELECT 1 FROM model_calls WHERE message_id=?').get(turn.message_id)||core.prepare('SELECT 1 FROM effects WHERE message_id=?').get(turn.message_id))ownerConflict('OWNER_LEGACY_RUN_REVIEW_REQUIRED');
          core.prepare("UPDATE messages SET status='ABANDONED',abandoned_reason='COMPANY_INTENT_MIGRATED',updated_at=? WHERE message_id=?").run(Date.now()/1000,turn.message_id);
          core.prepare("INSERT INTO recovery_decisions VALUES(?,'message',?,'abandon','Verified unsent intent transferred to company worker',?,?)").run(decisionId,turn.message_id,details,Date.now()/1000);
        });}catch(error){
          if((error as Error).message!=='OWNER_LEGACY_RUN_REVIEW_REQUIRED')throw error;
          db.prepare("INSERT INTO company_legacy_intents VALUES(?,?,?,?,'REVIEW_REQUIRED') ON CONFLICT(task_id) DO NOTHING").run(task.id,task.turn_id,worldId,turn.message_id);
          db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason='OWNER_LEGACY_RUN_REVIEW_REQUIRED',updated_at=? WHERE id=?").run(Date.now(),task.id);
          const dispatch=db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(task.id);
          if(dispatch){const goal=gate.goals.get(String(dispatch.goal_id));if(goal.specificationRevision===dispatch.goal_revision&&['READY','RUNNING'].includes(goal.status))gate.goals.state(goal.id,'BLOCKED','OWNER_LEGACY_RUN_REVIEW_REQUIRED');}
          continue;
        }finally{core.close();}
        db.prepare("INSERT INTO company_legacy_intents VALUES(?,?,?,?,'TRANSFERRED') ON CONFLICT(task_id) DO NOTHING").run(task.id,task.turn_id,worldId,turn.message_id);
        db.prepare("UPDATE owner_work_tasks SET turn_id=NULL,state='QUEUED',reason=NULL,updated_at=? WHERE id=? AND run_id IS NULL").run(Date.now(),task.id);
      }
      for(const task of db.prepare('SELECT * FROM owner_work_tasks WHERE run_id IS NOT NULL ORDER BY created_at,id').all()){
        const runId=String(task.run_id);if(this.execution.isWorkerRun(runId)||this.hasRun(runId))continue;
        const world=this.manager.registry.control.worldForQianji(String(task.person_id)),facts=this.read(task,world.world_id),binding=gate.binding(runId);
        if(this.alive(world.world_id))ownerConflict('OWNER_PREVIOUS_WORKER_STILL_ALIVE');
        const existing=this.execution.forRun(runId),id=existing?.id??`attempt_legacy_${createHash('sha256').update(String(task.id)+':'+runId).digest('hex')}`,now=Date.now();
        if(!existing){
          const fence=Number(db.prepare('SELECT COALESCE(MAX(fence),0)+1 n FROM company_execution_attempts WHERE task_id=?').get(task.id)!.n);
          db.prepare("INSERT INTO company_execution_attempts VALUES(?,?,?,?,?,?,?,?,1,?,'NOT_STARTED',?,?,0,?,?,?)").run(id,task.id,world.world_id,binding?.goalId??null,binding?.specificationRevision??null,binding?.dispatchId??null,runId,fence,facts.state,this.execution.owner,now,facts.reason??null,Number(task.created_at),now);
          db.prepare("INSERT INTO company_dispatch_outbox VALUES(?,?,'DELIVERED',?)").run(id,JSON.stringify({schema:1,attemptId:id,taskId:task.id,worldId:world.world_id,runId,fence,instruction:task.instruction,rounds:0,startRound:0}),now);
        }else {this.execution.adoptAfterExit(runId);if(['DISPATCH_PENDING','RUNNING','SUSPENDED'].includes(existing.state))this.execution.observe(runId,facts.state==='COMPLETED'?'completed':facts.state==='SUSPENDED'?'suspended':facts.state==='FAILED'?'failed':'blocked',facts.reason,facts.reply??undefined,`legacy-import:${runId}`);}
        db.prepare('INSERT INTO company_legacy_runs VALUES(?,?,?,0)').run(runId,task.id,world.world_id);
        for(const callId of facts.calls)for(const permit of db.prepare("SELECT p.id FROM owner_model_permits p JOIN owner_model_sources s ON s.permit_id=p.id WHERE s.source_kind='world' AND s.source_id=? AND p.world_id=?").all(callId,world.world_id))db.prepare('INSERT INTO company_attempt_permits VALUES(?,?) ON CONFLICT(permit_id) DO NOTHING').run(permit.id,id);
        db.prepare('UPDATE owner_work_tasks SET state=?,reply=COALESCE(?,reply),reason=?,updated_at=? WHERE id=?').run(facts.state==='COMPLETED'?'REPLIED':facts.state==='FAILED'?'FAILED':'BLOCKED',facts.reply??null,facts.reason??null,now,task.id);
        this.collect(runId,world.world_id,facts.tools);
        this.execution.refreshAccounting(id);gate.finished(runId,facts.state==='SUSPENDED');
        if(binding&&facts.state==='BLOCKED'){const goal=gate.goals.get(binding.goalId);if(goal.specificationRevision===binding.specificationRevision&&['READY','RUNNING'].includes(goal.status))gate.goals.state(goal.id,'BLOCKED',facts.reason);}
        imported++;
      }
      return imported;
    });
  }
  private collect(runId:string,worldId:string,tools:Record<string,any>[]){
    const a=this.execution.forRun(runId)!,db=this.db(),gate=this.execution.gate;
    for(const tool of tools){
      if(tool.status!=='SUCCESS'||typeof tool.result!=='string')continue;const output=JSON.parse(tool.result),hash=companyFactHash({runId,tool:tool.tool,status:tool.status,output}),old=db.prepare('SELECT payload_hash FROM company_legacy_receipts WHERE operation_id=?').get(tool.operation_id);
      if(old&&old.payload_hash!==hash)ownerConflict('OWNER_RECEIPT_CONFLICT');
      db.prepare('INSERT INTO company_legacy_receipts VALUES(?,?,?,?,?,?) ON CONFLICT(operation_id) DO NOTHING').run(tool.operation_id,runId,tool.tool,tool.status,tool.result,hash);
      if(!a.goalId||tool.tool!=='save_artifact'||typeof output.snapshot_relative_path!=='string'||!output.snapshot_relative_path.startsWith(`evidence/owner-${a.dispatchId}/`))continue;
      const world=this.manager.registry.control.world(worldId);let file:string;try{file=containedPath(this.manager.registry.workspace,...world.workspace_relpath.split('/'),...output.snapshot_relative_path.split('/'));}catch{ownerConflict('OWNER_EVIDENCE_CHANGED');}
      if(!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.statSync(file).size!==output.size_bytes||Number(output.size_bytes)>2_000_000)ownerConflict('OWNER_EVIDENCE_CHANGED');
      const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==output.sha256)ownerConflict('OWNER_EVIDENCE_CHANGED');
      const id=`artifact:${tool.operation_id}`,prior=db.prepare('SELECT * FROM owner_goal_evidence WHERE id=?').get(id);
      if(prior&&(prior.goal_id!==a.goalId||prior.specification_revision!==a.goalRevision||prior.run_id!==runId||prior.reference!==output.snapshot_relative_path||prior.sha256!==output.sha256))ownerConflict('OWNER_EVIDENCE_CHANGED');
      db.prepare("INSERT INTO owner_goal_evidence VALUES(?,?,?,?,?,'artifact',?,?,?,?) ON CONFLICT(id) DO NOTHING").run(id,a.goalId,a.goalRevision!,runId,worldId,output.snapshot_relative_path,output.sha256,bytes.length,Date.now());
    }
  }
  async tick(){
    const gate=this.execution.gate,db=this.db();
    for(const old of db.prepare('SELECT * FROM company_legacy_runs ORDER BY run_id').all()){
      const runId=String(old.run_id),worldId=String(old.world_id),a=this.execution.forRun(runId)!,task=db.prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(old.task_id)!;
      if(!['RUNNING','DISPATCH_PENDING','SUSPENDED'].includes(a.state))continue;
      const runtime=this.manager.peek(worldId),goal=a.goalId?gate.goals.get(a.goalId):null;
      if(runtime?.run.getStatus().running){if(!gate.mayContinue(runId))runtime.run.requestSuspend();continue;}
      if(this.alive(worldId))continue;
      const facts=this.read(task,worldId);this.collect(runId,worldId,facts.tools);
      if(facts.state==='COMPLETED'||facts.state==='BLOCKED'||facts.state==='FAILED'){
        this.execution.observe(runId,facts.state==='COMPLETED'?'completed':facts.state==='FAILED'?'failed':'blocked',facts.reason,facts.reply??undefined,`legacy-result:${runId}:${companyFactHash({state:facts.state,reply:facts.reply,reason:facts.reason??null})}`);gate.finished(runId,false);continue;
      }
      this.execution.observe(runId,'suspended','OWNER_CONTROLLER_DISCONNECTED',undefined,`legacy-pause:${runId}:${old.epoch}`);gate.finished(runId,true);
      if(gate.view().desiredMode==='ON'&&goal?.status==='BLOCKED'&&goal.reason===a.reason&&goal.specificationRevision===a.goalRevision)gate.goals.state(goal.id,'READY');
      if(!gate.isOn()||goal&&(goal.specificationRevision!==a.goalRevision||!['READY','RUNNING'].includes(gate.goals.get(goal.id).status)))continue;
      const loaded=await this.manager.open(worldId),epoch=Number(old.epoch)+1;
      if(loaded.store.runs.getLatestRun()?.run_id!==runId){this.execution.observe(runId,'blocked','OWNER_LEGACY_RUN_REVIEW_REQUIRED');gate.finished(runId,false);continue;}
      db.prepare('UPDATE company_legacy_runs SET epoch=? WHERE run_id=?').run(epoch,runId);
      if(await loaded.run.resumeInterrupted())this.execution.observe(runId,'started',undefined,undefined,`legacy-launch:${runId}:${epoch}`);
    }
  }
  reviews(){
    return [...new Set(this.db().prepare("SELECT world_id FROM company_legacy_runs UNION SELECT world_id FROM company_legacy_intents WHERE decision='REVIEW_REQUIRED'").all().map(r=>String(r.world_id)))].map(worldId=>{
      const runtime=this.manager.peek(worldId);if(runtime)return {worldId,status:runtime.run.getStatus()};
      const core=this.core(worldId);try{return {worldId,status:{running:this.alive(worldId),unfinalized_operations:{unknownCalls:core.prepare("SELECT call_id callId FROM model_calls WHERE outcome='CALL_OUTCOME_UNKNOWN'").all(),unsettledReservations:core.prepare("SELECT call_id callId FROM reservations WHERE status='OPEN'").all(),startedToolExecutions:core.prepare("SELECT operation_id FROM tool_executions WHERE status IN ('STARTED','UNKNOWN')").all().map(r=>String(r.operation_id)),pendingRuns:core.prepare("SELECT run_id FROM runs WHERE status='RUNNING'").all().map(r=>String(r.run_id)),callingMessages:core.prepare("SELECT message_id messageId FROM messages WHERE status IN ('CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT')").all()}}};}finally{core.close();}
    });
  }
}
