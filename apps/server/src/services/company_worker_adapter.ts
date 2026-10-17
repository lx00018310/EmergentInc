import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDatabase } from '@emergentinc/persistence';
import type { UsageMeter } from '@emergentinc/model';
import type { CompanyDispatchCommand, PreparedModelRequest, ToolResult } from '@emergentinc/protocol';
import type { CompanyWorkerEvent, CompanyWorkerSpec } from '../execution/company_worker_protocol.js';
import { companyWorkerRequest,companyWorkerSystemPrompt } from '../execution/company_worker_engine.js';
import type { CompanyExecutionService } from './company_execution_service.js';
import type { GoalRunBinding } from './owner_automation_gate.js';
import { ownerConflict } from './owner_goal_service.js';
import { companyFactHash } from './company_fact_hash.js';
import { containedPath } from './safe_path.js';
import { companyProcessBirth } from '../execution/company_worker_lock.js';

const digest=companyFactHash;
const terminal=new Set(['COMPLETED','FAILED','BLOCKED','INTERRUPTED']);
const suspendReasons=new Set(['OWNER_CONTROLLER_DISCONNECTED','OWNER_AUTOMATION_OFF','OWNER_GOAL_PAUSED','EVOLUTION_QUIESCED','OWNER_COMPANY_BUDGET_REQUIRED','OWNER_COMPANY_BUDGET_EXHAUSTED','OWNER_COMPANY_BUDGET_BUSY']);
export interface CompanyWorkerAdapterOptions {
  workspace: string; meter: UsageMeter; environment: Record<string,string|undefined>;
  spec(command:CompanyDispatchCommand): CompanyWorkerSpec;
  controllerTool?(attemptId:string,operationId:string,tool:string,args:Record<string,any>):Promise<ToolResult>;
  controllerToolReceipt?(attemptId:string,operationId:string):ToolResult|null;
  artifact?(attemptId:string,operationId:string,result:ToolResult,directory:string):void;
}

/** The company owns money/state; each worker owns only its private journal and artifacts. */
export class CompanyWorkerAdapter {
  private live=new Map<string,{child:ChildProcess;done:Promise<void>;queue:Promise<void>}>();
  constructor(readonly execution:CompanyExecutionService, readonly options:CompanyWorkerAdapterOptions) {
    this.db().exec(`
      CREATE TABLE IF NOT EXISTS company_worker_launches(attempt_id TEXT PRIMARY KEY REFERENCES company_execution_attempts(id),spec_json TEXT NOT NULL,directory_rel TEXT NOT NULL,first_permit TEXT NOT NULL,state TEXT NOT NULL,pid INTEGER,identity TEXT,epoch INTEGER NOT NULL,last_sequence INTEGER NOT NULL DEFAULT 0,reason TEXT);
      CREATE TABLE IF NOT EXISTS company_worker_receipts(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES company_execution_attempts(id),sequence INTEGER NOT NULL,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0,UNIQUE(attempt_id,sequence));
      CREATE TABLE IF NOT EXISTS company_worker_grants(permit_id TEXT PRIMARY KEY REFERENCES owner_model_permits(id),attempt_id TEXT NOT NULL,operation_id TEXT NOT NULL,epoch INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS company_worker_waits(subject_id TEXT PRIMARY KEY,required_micros INTEGER NOT NULL,reason TEXT NOT NULL);
    `);
    if(!this.db().prepare('PRAGMA table_info(company_worker_launches)').all().some(r=>r.name==='process_birth'))this.db().exec('ALTER TABLE company_worker_launches ADD COLUMN process_birth TEXT');
  }
  private db(){return this.execution.gate.store.db;}
  private launch(id:string){const r=this.db().prepare('SELECT * FROM company_worker_launches WHERE attempt_id=?').get(id);if(!r)ownerConflict('OWNER_ATTEMPT_NOT_FOUND');return r;}
  directory(id:string){const r=this.launch(id);try{return containedPath(this.options.workspace,...String(r.directory_rel).split('/'));}catch{ownerConflict('OWNER_WORKER_IDENTITY_CONFLICT');}}
  private spec(id:string){return JSON.parse(String(this.launch(id).spec_json)) as CompanyWorkerSpec;}
  create(taskId:string,worldId:string,rounds:number,binding?:GoalRunBinding) {
    try{const command=this.execution.claim(taskId,worldId,1,rounds,binding,{prepare:command=>{
      const spec=this.options.spec(command);
      spec.systemPrompt??=companyWorkerSystemPrompt(spec.tools);
      if(spec.attemptId!==command.attemptId||spec.taskId!==taskId||spec.runId!==command.runId||spec.fence!==command.fence)ownerConflict('OWNER_WORKER_SPEC_INVALID');
      const call=this.execution.gate.models.prepare(companyWorkerRequest(spec,0),this.options.meter,{worldId,runId:command.runId,attemptId:command.attemptId,binding,sourceKind:'company_worker',scope:'worker'});
      this.db().prepare("INSERT INTO company_worker_launches(attempt_id,spec_json,directory_rel,first_permit,state,epoch) VALUES(?,?,?,?,'READY',0)").run(command.attemptId,JSON.stringify(spec),`system/executions/${command.attemptId}`,call.permitId);
    }});this.db().prepare('DELETE FROM company_worker_waits WHERE subject_id=?').run(taskId);return command;
    }catch(e){this.recordWait(taskId,e);throw e;}
  }
  private recordWait(subject:string,error:any){if(/^OWNER_COMPANY_BUDGET_(EXHAUSTED|BUSY)$/.test(error?.message)&&Number.isSafeInteger(error.requiredMicros)&&error.requiredMicros>=0)this.db().prepare('INSERT INTO company_worker_waits VALUES(?,?,?) ON CONFLICT(subject_id) DO UPDATE SET required_micros=excluded.required_micros,reason=excluded.reason').run(subject,error.requiredMicros,error.message);}
  canStart(subject:string){const wait=this.db().prepare('SELECT required_micros FROM company_worker_waits WHERE subject_id=?').get(subject);if(!wait)return true;const budget=this.execution.gate.budget.view();return !budget.needsRefill&&budget.activatedAt!==null&&budget.availableMicros>=Number(wait.required_micros);}
  isRunning(id:string){return this.live.has(id);}
  disconnect(id:string){const r=this.live.get(id);if(r?.child.connected)r.child.disconnect();}
  disconnectAll(){for(const id of this.live.keys())this.disconnect(id);}
  snapshots(){return this.db().prepare('SELECT a.*,w.state worker_state,w.pid FROM company_execution_attempts a JOIN company_worker_launches w ON w.attempt_id=a.id ORDER BY a.created_at').all();}
  async poll(){for(const row of this.snapshots())if(!this.live.has(String(row.id))&&!['READY','EXITED'].includes(String(row.worker_state)))await this.recover(String(row.id));}
  private async alive(pid:unknown,birth:unknown){if(!Number.isSafeInteger(pid)||Number(pid)<=0)return false;const actual=await companyProcessBirth(Number(pid));return actual!==null&&(typeof birth!=='string'||actual===birth);}
  async start(id:string) {
    if(this.live.has(id))return;
    if(!this.canStart(id))return;
    let row=this.launch(id);const a=this.execution.get(id);
    if(terminal.has(a.state))return;
    if(row.pid&&await this.alive(row.pid,row.process_birth))ownerConflict('OWNER_PREVIOUS_WORKER_STILL_ALIVE');
    if(a.state==='SUSPENDED'&&suspendReasons.has(a.reason??'')&&a.goalId&&this.execution.gate.view().desiredMode==='ON'){
      const goal=this.execution.gate.goals.get(a.goalId);
      if(goal.specificationRevision===a.goalRevision&&goal.status==='BLOCKED'&&goal.reason===a.reason)this.execution.gate.goals.state(goal.id,'READY');
    }
    this.execution.gate.assertWorkerIntent(a.runId,a.id);
    if(!['READY','SUSPENDED'].includes(String(row.state)))ownerConflict('OWNER_ATTEMPT_STALE');
    const epoch=Number(row.epoch)+1;
    this.execution.gate.store.transaction(()=>{
      if(!this.db().prepare("UPDATE company_worker_launches SET state='STARTING',pid=NULL,identity=NULL,process_birth=NULL,epoch=?,reason=NULL WHERE attempt_id=? AND epoch=? AND state IN ('READY','SUSPENDED')").run(epoch,id,row.epoch).changes)ownerConflict('OWNER_ATTEMPT_STALE');
      this.db().prepare("UPDATE company_execution_attempts SET lease_owner=?,lease_expires_at=?,revision=revision+1 WHERE id=?").run(this.execution.owner,Date.now()+30_000,id);
    });
    const directory=this.directory(id);fs.mkdirSync(directory,{recursive:true});
    const source=import.meta.url.endsWith('.ts'),entry=fileURLToPath(new URL(`../execution/company_worker_entry.${source?'ts':'js'}`,import.meta.url));
    const environment:Record<string,string>={};
    for(const key of ['PATH','Path','SystemRoot','TEMP','TMP','NODE_EXTRA_CA_CERTS','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','NODE_USE_ENV_PROXY']){const v=process.env[key];if(v)environment[key]=v;}
    for(const key of ['MCL_API_KEY','MCL_BASE_URL','MCL_TIMEOUT_MS']){const v=this.options.environment[key];if(v)environment[key]=v;}
    const child=fork(entry,[],{cwd:process.cwd(),execArgv:source?['--import','tsx']:[],env:environment,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    this.db().prepare('UPDATE company_worker_launches SET pid=? WHERE attempt_id=? AND epoch=?').run(child.pid!,id,epoch);
    const log=fs.createWriteStream(path.join(directory,`process-${epoch}.log`),{flags:'a'});child.stdout?.pipe(log,{end:false});child.stderr?.pipe(log,{end:false});
    let resolve!:()=>void;const done=new Promise<void>(r=>resolve=r),record={child,done,queue:Promise.resolve()};this.live.set(id,record);
    child.on('message',(message:any)=>{
      record.queue=record.queue.then(async()=>{
        if(message?.kind==='ready'){
          if(message.pid!==child.pid||message.attemptId!==id||message.fence!==a.fence||typeof message.identity!=='string'||typeof message.birth!=='string')ownerConflict('OWNER_WORKER_IDENTITY_CONFLICT');
          this.db().prepare("UPDATE company_worker_launches SET state='RUNNING',identity=?,process_birth=? WHERE attempt_id=? AND epoch=?").run(message.identity,message.birth,id,epoch);
          this.execution.observe(a.runId,'started',undefined,undefined,`worker-launch:${id}:${epoch}`);this.execution.gate.runCreated(a.runId);return;
        }
        if(message?.kind==='failed'){this.db().prepare('UPDATE company_worker_launches SET reason=? WHERE attempt_id=? AND epoch=?').run(String(message.reason??'OWNER_WORKER_FAILED'),id,epoch);return;}
        if(message?.kind!=='rpc')return;
        try{const value=await this.rpc(id,epoch,message.method,message.args);if(child.connected)child.send({kind:'rpc-result',id:message.id,value});}
        catch(e){if(child.connected)child.send({kind:'rpc-result',id:message.id,error:e instanceof Error?e.message:'OWNER_WORKER_FAILED'});}
      }).catch(e=>{this.db().prepare('UPDATE company_worker_launches SET reason=? WHERE attempt_id=?').run(e instanceof Error?e.message:'OWNER_WORKER_FAILED',id);});
    });
    child.once('exit',()=>{void record.queue.then(()=>this.recover(id)).catch(e=>{this.execution.observe(a.runId,'blocked',e instanceof Error?e.message:'OWNER_WORKER_FAILED');}).finally(()=>{log.end();this.live.delete(id);resolve();});});
    child.once('error',error=>{this.db().prepare('UPDATE company_worker_launches SET reason=? WHERE attempt_id=?').run(error.message,id);});
    child.send({kind:'start',directory,spec:this.spec(id)});
  }
  private context(id:string){const a=this.execution.get(id);return {worldId:a.worldId,runId:a.runId,attemptId:id,sourceKind:'company_worker',scope:'worker' as const,binding:a.goalId?{goalId:a.goalId,specificationRevision:a.goalRevision!,dispatchId:a.dispatchId!}:undefined};}
  private async rpc(id:string,epoch:number,method:string,args:any[]) {
    const row=this.launch(id),a=this.execution.get(id);if(row.epoch!==epoch||a.leaseOwner!==this.execution.owner)ownerConflict('OWNER_ATTEMPT_STALE');
    if(method==='receipt'){if(args[0]?.attemptId!==id||args[0]?.fence!==a.fence)ownerConflict('OWNER_ATTEMPT_STALE');this.receipt(args[0]);return;}
    if(method==='controllerToolReceipt'){const key=String(args[0]);if(!key.startsWith(`${id}:tool:`))ownerConflict('OWNER_ATTEMPT_STALE');return this.options.controllerToolReceipt?.(id,key)??null;}
    this.execution.gate.assertWorkerIntent(a.runId,id);
    this.db().prepare('UPDATE company_execution_attempts SET lease_expires_at=? WHERE id=?').run(Date.now()+30_000,id);
    const spec=this.spec(id),operationId=String(args[0]);
    if(method==='authorizeModel'){
      const request=args[1] as PreparedModelRequest;
      if(request.auditCallId!==operationId||!operationId.startsWith(`${id}:model:`)||request.model!==spec.model||request.maxTokens!==spec.maxOutputTokens)ownerConflict('OWNER_WORKER_OPERATION_CONFLICT');
      const original=companyWorkerRequest(spec,0);let permitId:string;
      const first=this.db().prepare('SELECT state FROM owner_model_permits WHERE id=?').get(row.first_permit)!;
      if(operationId===original.auditCallId&&['SENT','UNKNOWN'].includes(String(first.state))&&!this.db().prepare('SELECT 1 FROM company_worker_grants WHERE permit_id=?').get(row.first_permit)){
        // No broker grant proves this prelaunch reservation could never reach the provider.
        if(digest(request)!==digest(original))ownerConflict('OWNER_WORKER_OPERATION_CONFLICT');permitId=String(row.first_permit);
        this.db().prepare("UPDATE owner_model_permits SET state='SENT' WHERE id=?").run(permitId);
      }else {try{permitId=this.execution.gate.models.prepare(request,this.options.meter,this.context(id)).permitId;}catch(e){this.recordWait(id,e);throw e;}}
      this.db().prepare('DELETE FROM company_worker_waits WHERE subject_id=?').run(id);
      this.db().prepare('INSERT INTO company_worker_grants VALUES(?,?,?,?)').run(permitId,id,operationId,epoch);
      this.db().prepare("UPDATE owner_round_permits SET state='STARTED' WHERE run_id=? AND round_no=(SELECT MIN(round_no) FROM owner_round_permits WHERE run_id=?) AND state='RESERVED'").run(a.runId,a.runId);
      return {permitId};
    }
    const tool=String(args[1]);if(!spec.tools.some(t=>t.name===tool&&t.enabled)||!operationId.startsWith(`${id}:tool:`))ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
    if(method==='authorizeTool')return;
    if(method==='controllerTool'&&this.options.controllerTool)return this.options.controllerTool(id,operationId,tool,args[2]);
    ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
  }
  private receipt(event:CompanyWorkerEvent) {
    this.execution.gate.store.transaction(()=>{
      const a=this.execution.get(event.attemptId),r=this.launch(a.id);
      if(event.fence!==a.fence||event.id!==`${a.id}:${event.sequence}`||!Number.isSafeInteger(event.sequence)||event.sequence<1)ownerConflict('OWNER_ATTEMPT_STALE');
      const old=this.db().prepare('SELECT payload_hash FROM company_worker_receipts WHERE id=?').get(event.id),hash=digest(event);
      if(old){if(old.payload_hash!==hash)ownerConflict('OWNER_RECEIPT_CONFLICT');return;}
      this.db().prepare('INSERT INTO company_worker_receipts(id,attempt_id,sequence,payload_hash,payload_json) VALUES(?,?,?,?,?)').run(event.id,a.id,event.sequence,hash,JSON.stringify(event));
      let sequence=Number(r.last_sequence);
      for(;;){const next=this.db().prepare('SELECT payload_json FROM company_worker_receipts WHERE attempt_id=? AND sequence=? AND applied=0').get(a.id,sequence+1);if(!next)break;
        const receipt=JSON.parse(String(next.payload_json)) as CompanyWorkerEvent;this.apply(a.id,receipt);sequence++;
        this.db().prepare('UPDATE company_worker_receipts SET applied=1 WHERE id=?').run(receipt.id);
      }
      this.db().prepare('UPDATE company_worker_launches SET last_sequence=? WHERE attempt_id=?').run(sequence,a.id);
    });
  }
  private apply(id:string,event:CompanyWorkerEvent) {
    const a=this.execution.get(id),p=event.payload;
    if(event.kind==='model'){
      const permit=this.db().prepare('SELECT s.source_id FROM company_attempt_permits x JOIN owner_model_sources s ON s.permit_id=x.permit_id WHERE x.attempt_id=? AND x.permit_id=?').get(id,p.permitId);
      if(!permit||permit.source_id!==p.operationId)ownerConflict('OWNER_WORKER_OPERATION_CONFLICT');
      if(p.response)this.execution.gate.models.response(p.permitId,p.response);else this.execution.gate.models.failure(p.permitId,p.notSent===true);
    }else if(event.kind==='tool'){
      if(p.result?.tool==='save_artifact'&&p.result.status==='SUCCESS')this.options.artifact?.(id,p.operationId,p.result,this.directory(id));
    }else if(['completed','blocked','failed','interrupted'].includes(event.kind)){
      this.execution.observe(a.runId,event.kind as 'completed'|'blocked'|'failed'|'interrupted',p.reason,p.reply,`worker-event:${event.id}`);
      if(event.kind==='completed')this.db().prepare("UPDATE owner_round_permits SET state='COMPLETED' WHERE run_id=? AND state='STARTED'").run(a.runId);
    }
  }
  async recover(id:string) {
    const row=this.launch(id);if(row.pid&&await this.alive(row.pid,row.process_birth))return false;
    const lock=containedPath(this.directory(id),'runtime','instance.lock');
    if(fs.existsSync(lock)){const owner=JSON.parse(fs.readFileSync(lock,'utf8'));if(owner.schema!==1||owner.attemptId!==id||owner.fence!==this.execution.get(id).fence)ownerConflict('OWNER_WORKER_IDENTITY_CONFLICT');if(await this.alive(owner.pid,owner.birth))return false;}
    this.execution.adoptAfterExit(this.execution.get(id).runId);
    const file=path.join(this.directory(id),'journal.sqlite3');let suspendedReason:string|undefined,checkpointSafe=false,unknownTool=false,journalFresh=false;
    // A process killed inside journal creation can leave a file that a read-only connection
    // cannot open on Windows. That is missing evidence, not a controller fault: converge with
    // what the company ledger knows instead of failing the whole poll loop.
    try{
      if(fs.existsSync(file)){
        const journal=new SqliteDatabase(file,{readOnly:true});try{
          const identity=journal.prepare('SELECT * FROM worker_identity WHERE id=1').get();
          if(!identity){journalFresh=true;}
          else if(identity?.schema!==1||identity.spec_hash!==this.journalSpecHash(id))ownerConflict('OWNER_WORKER_IDENTITY_CONFLICT');
          else for(const e of journal.prepare('SELECT * FROM worker_events ORDER BY sequence').all()){
            const event:CompanyWorkerEvent={id:String(e.id),attemptId:id,fence:this.execution.get(id).fence,sequence:Number(e.sequence),kind:e.kind as CompanyWorkerEvent['kind'],payload:JSON.parse(String(e.payload_json))};
            this.receipt(event);if(event.kind==='checkpoint'&&event.payload.suspended)suspendedReason=String(event.payload.reason);
          }
          for(const model of journal.prepare('SELECT * FROM worker_models').all())if(model.permit_id&&!model.response_json)this.execution.gate.models.failure(String(model.permit_id),model.state==='NOT_SENT');
          for(const model of journal.prepare("SELECT * FROM worker_models WHERE state='PREPARED' AND permit_id IS NULL").all())for(const grant of this.db().prepare('SELECT g.permit_id,d.request_hash FROM company_worker_grants g JOIN company_model_dispatches d ON d.permit_id=g.permit_id WHERE g.attempt_id=? AND g.operation_id=?').all(id,model.operation_id)){
            if(digest(JSON.parse(String(model.request_json)))!==grant.request_hash)ownerConflict('OWNER_WORKER_OPERATION_CONFLICT');this.execution.gate.models.failure(String(grant.permit_id),true);
          }
          for(const tool of journal.prepare("SELECT operation_id,tool FROM worker_tools WHERE state='STARTED'").all())if(tool.tool!=='save_artifact'){
            const receipt=this.options.controllerToolReceipt?.(id,String(tool.operation_id));if(!receipt||receipt.operation_id!==tool.operation_id||receipt.tool!==tool.tool)unknownTool=true;
          }
          checkpointSafe=Boolean(journal.prepare('SELECT terminal_json FROM worker_checkpoint WHERE id=1').get()?.terminal_json===null);
        }finally{journal.close();}
      }else journalFresh=true;
    }catch(e){
      if(e instanceof Error&&['OWNER_WORKER_IDENTITY_CONFLICT','OWNER_WORKER_OPERATION_CONFLICT'].includes(e.message))throw e;
      if(e instanceof Error&&['OWNER_ATTEMPT_TERMINAL','OWNER_RECEIPT_CONFLICT','OWNER_ATTEMPT_STALE'].includes(e.message))throw e;
      journalFresh=true;unknownTool=false;checkpointSafe=false;
    }
    const a=this.execution.get(id),firstGranted=this.db().prepare('SELECT 1 FROM company_worker_grants WHERE permit_id=?').get(row.first_permit);
    if(!firstGranted)this.execution.gate.models.failure(String(row.first_permit),true);
    if(!terminal.has(a.state)){
      const unknown=this.db().prepare("SELECT 1 FROM company_attempt_permits x JOIN owner_model_permits p ON p.id=x.permit_id LEFT JOIN company_model_dispatches d ON d.permit_id=p.id WHERE x.attempt_id=? AND p.state IN ('SENT','UNKNOWN') AND d.response_json IS NULL").get(id);
      // A worker killed before writing its identity proves no call or tool left the process.
      if(journalFresh&&!firstGranted&&!unknownTool&&!unknown)this.execution.observe(a.runId,'failed','OWNER_WORKER_DIED_BEFORE_START',undefined,`worker-stop:${id}:${row.epoch}`);
      else if(unknown)this.execution.observe(a.runId,'blocked','CALL_OUTCOME_UNKNOWN',undefined,`worker-stop:${id}:${row.epoch}`);
      else if(unknownTool)this.execution.observe(a.runId,'blocked','TOOL_OUTCOME_UNKNOWN',undefined,`worker-stop:${id}:${row.epoch}`);
      else if(row.reason&&!firstGranted&&!fs.existsSync(file))this.execution.observe(a.runId,'failed',String(row.reason),undefined,`worker-stop:${id}:${row.epoch}`);
      else if(!firstGranted&&!fs.existsSync(file)||suspendedReason&&suspendReasons.has(suspendedReason)||checkpointSafe)this.execution.observe(a.runId,'suspended',suspendedReason??'OWNER_CONTROLLER_DISCONNECTED',undefined,`worker-stop:${id}:${row.epoch}`);
      else this.execution.observe(a.runId,'blocked','OWNER_WORKER_FAILED',undefined,`worker-stop:${id}:${row.epoch}`);
    }
    const result=this.execution.get(id),suspended=result.state==='SUSPENDED';
    this.db().prepare('UPDATE company_worker_launches SET state=?,reason=? WHERE attempt_id=?').run(suspended?'SUSPENDED':'EXITED',result.reason,id);
    this.execution.gate.finished(a.runId,suspended);return true;
  }
  async wait(id:string){await this.live.get(id)?.done;}
  private journalSpecHash(id:string){return createHash('sha256').update(JSON.stringify(this.spec(id))).digest('hex');}
  async close(){for(const r of this.live.values())if(r.child.connected)r.child.disconnect();await Promise.all([...this.live.values()].map(r=>r.done));}
  async quiesce(){
    this.disconnectAll();let timeout:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([Promise.all([...this.live.values()].map(r=>r.done)),new Promise<never>((_resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('OWNER_WORKER_QUIESCE_TIMEOUT')),30_000);})]);}finally{if(timeout)clearTimeout(timeout);}
    await this.poll();
    for(const row of this.snapshots())if(!['READY','EXITED','SUSPENDED'].includes(String(row.worker_state))&&row.pid&&await this.alive(row.pid,row.process_birth))ownerConflict('OWNER_PREVIOUS_WORKER_STILL_ALIVE');
  }
}
