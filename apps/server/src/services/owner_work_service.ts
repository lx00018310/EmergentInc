import { createHash, randomUUID } from 'node:crypto';
import type { OwnerOverview, OwnerWork, OwnerWorkTask, OwnerRecruitRequest } from '@emergentinc/protocol';
import type { ToolRegistry } from '@emergentinc/tools';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import { QianjiWorldGateway } from './qianji_world_gateway.js';
import { AppCodeService } from './app_code_service.js';
import type { OwnerChatService } from './owner_chat_service.js';
import type { ReleaseMaintenanceClient } from './release_maintenance_client.js';
import type { GoalRunBinding } from './owner_automation_gate.js';
import type { OwnerProductService } from './owner_product_service.js';
import { CompanyExecutionService } from './company_execution_service.js';
import { CompanyArtifactService } from './company_artifact_service.js';
import { CompanyAgentService } from './company_agent_service.js';
import { CompanyToolService } from './company_tool_service.js';
import { CompanyWorkerAdapter } from './company_worker_adapter.js';
import { BUILTIN_DEFINITIONS } from '@emergentinc/tools';
import type { PaymentService } from './payment_service.js';
import { CompanyLegacyAdapter } from './company_legacy_adapter.js';
import {CompanyRecoveryService} from './company_recovery_service.js';
import {CompanyAttentionService} from './company_attention_service.js';
import {COMPANY_WORKER_MAX_OUTPUT_TOKENS} from '../execution/company_worker_protocol.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown, max: number): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const only = (v: Record<string, any>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
export class OwnerWorkService {
  readonly execution: CompanyExecutionService;
  readonly artifacts: CompanyArtifactService;
  agents?:CompanyAgentService;
  worker?:CompanyWorkerAdapter;
  companyTools?:CompanyToolService;
  legacy?:CompanyLegacyAdapter;
  recovery?:CompanyRecoveryService;
  attention?:CompanyAttentionService;
  products?: OwnerProductService;
  readonly code?: AppCodeService;
  private gateway: QianjiWorldGateway;
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closed = false;
  private schedulerError?:string;
  private requestFlights = new Map<string, Promise<any>>();
  private decisions = new Map<string, {hash:string;decision:string;promise:Promise<any>}>();
  constructor(readonly manager: WorldRuntimeManager, private quiesced: () => boolean = () => false, private upgradeOrigin?: string,private releaseMaintenance?:ReleaseMaintenanceClient) {
    if(!manager.automation)throw new Error('OWNER_COMPANY_CONTROL_REQUIRED');
    this.gateway = new QianjiWorldGateway(manager);
    manager.registry.control.db.exec(`
      CREATE TABLE IF NOT EXISTS owner_work_tasks(id TEXT PRIMARY KEY, request_key TEXT NOT NULL, person_id TEXT NOT NULL, person_name TEXT NOT NULL, instruction TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT, run_id TEXT, reply TEXT, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(request_key,person_id));
      CREATE TABLE IF NOT EXISTS owner_recruit_requests(id TEXT PRIMARY KEY, operation_key TEXT UNIQUE NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL, person_id TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_recruit_decisions(request_id TEXT PRIMARY KEY,hash TEXT NOT NULL,decision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_dispatch_calls(request_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL, response_json TEXT, error TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_work_run_limits(task_id TEXT PRIMARY KEY REFERENCES owner_work_tasks(id), rounds INTEGER NOT NULL CHECK(rounds BETWEEN 1 AND 20));
    `);
    this.execution = new CompanyExecutionService(manager.automation);
    this.artifacts = new CompanyArtifactService(manager.registry.control,manager.registry.workspace);
    if (manager.options.projectRoot) this.code = new AppCodeService(manager, manager.options.projectRoot);
  }
  enableWorkers(environment:Record<string,string|undefined>,payments?:PaymentService) {
    if(this.worker)throw new Error('OWNER_WORKER_ALREADY_CONFIGURED');
    const gate=this.manager.automation!;
    this.agents=new CompanyAgentService(gate.store,this.manager.registry.workspace);this.agents.importLegacy();
    for(const actor of this.agents.list())if(actor.legacyWorldId)this.artifacts.importLegacy(actor.id,actor.directoryRel);
    const code=this.manager.options.projectRoot?new AppCodeService(this.manager,this.manager.options.projectRoot,this.agents):undefined;
    this.companyTools=new CompanyToolService({gate,agents:this.agents,artifacts:this.artifacts,recruit:this.requestRecruit.bind(this),code,payments,release:this.releaseMaintenance,projectRoot:this.manager.options.projectRoot,contracts:this.manager.genome.capability_contracts});
    this.worker=new CompanyWorkerAdapter(this.execution,{workspace:this.manager.registry.workspace,meter:this.manager.options.usageMeter,environment,spec:command=>{
      const actor=this.agents!.forScope(command.worldId);
      const plans=gate.proposals.plans;
      const occurrence=command.goal?gate.store.db.prepare('SELECT node_key,scheduled_at FROM owner_task_occurrences WHERE dispatch_id=?').get(command.goal.dispatchId):undefined;
      const plan=command.goal?plans.get(command.goal.goalId):null,node=plan?.nodes.find(n=>n.key===occurrence?.node_key);
      if(command.goal&&occurrence&&node&&!plans.progress.forDispatch(command.goal.dispatchId))plans.progress.attach(command.goal.goalId,node,command.goal.dispatchId,Number(occurrence.scheduled_at),plan!);
      const progress=command.goal?plans.progress.startWindow(command.goal.dispatchId):undefined,recovery=node?.progressPolicy;
      return {schema:1,attemptId:command.attemptId,taskId:command.taskId,runId:command.runId,fence:command.fence,agent:{id:actor.id,name:actor.name,role:actor.role},instruction:command.instruction,model:this.manager.options.modelName,maxSteps:command.goal?20:command.rounds,maxOutputTokens:COMPANY_WORKER_MAX_OUTPUT_TOKENS,notSentRetries:1,responseFormat:'json_object',...(progress?{progress}:{}),formatCorrections:recovery?1:0,tools:[...BUILTIN_DEFINITIONS.filter(t=>['save_artifact','webfetch','github_repo'].includes(t.name)),...this.companyTools!.catalog()]};
    },controllerTool:(id,key,name,args)=>this.companyTools!.execute(id,key,name,args),controllerToolReceipt:(id,key)=>this.companyTools!.receipt(key,id),artifact:(...args)=>this.artifacts.record(...args)});
    gate.addSuspend(()=>this.worker!.disconnectAll());
    this.recovery=new CompanyRecoveryService(gate,this.worker);
    this.attention=new CompanyAttentionService(gate,this,this.worker);
  }
  start() { this.closed=false; const poll=()=>{void this.tick().catch(e=>{this.schedulerError=e instanceof Error?e.message:String(e);this.closed=true;if(this.timer)clearInterval(this.timer);});};this.timer=setInterval(poll,1000);this.timer.unref();poll(); }
  async close() { this.closed=true; if(this.timer)clearInterval(this.timer); await this.ticking;await this.worker?.close(); }
  hasFailure() {return Boolean(this.schedulerError);}
  view(): OwnerWork {
    const db=this.manager.registry.control.db;
    const goalForTask=this.manager.automation?db.prepare(`SELECT d.goal_id,d.goal_revision,d.id dispatch_id,d.state dispatch_state,
      o.id occurrence_id,o.node_key,o.plan_revision,o.state occurrence_state,o.scheduled_at
      FROM owner_goal_dispatches d LEFT JOIN owner_task_occurrences o ON o.dispatch_id=d.id AND o.goal_id=d.goal_id AND o.goal_revision=d.goal_revision WHERE d.task_id=?`):undefined;
    const goalForRecruit=this.manager.automation?db.prepare(`SELECT g.goal_id,g.goal_revision,w.node_key
      FROM owner_goal_recruits g LEFT JOIN owner_task_resource_waits w ON w.request_id=g.request_id AND w.goal_id=g.goal_id AND w.goal_revision=g.goal_revision WHERE g.request_id=?`):undefined;
    return {tasks:db.prepare('SELECT * FROM owner_work_tasks ORDER BY created_at DESC LIMIT 50').all().map(r=>{
      const link=goalForTask?.get(r.id);
      return {id:String(r.id),attempt:this.execution.forTask(String(r.id)),goalId:link?String(link.goal_id):null,
        ...(link?{goalRevision:Number(link.goal_revision),dispatchId:String(link.dispatch_id),dispatchState:String(link.dispatch_state)}:{}),
        ...(link?.occurrence_id?{planRevision:Number(link.plan_revision),nodeKey:String(link.node_key),occurrenceId:String(link.occurrence_id),occurrenceState:String(link.occurrence_state),scheduledAt:Number(link.scheduled_at)}:{}),
        personId:String(r.person_id),personName:String(r.person_name),instruction:String(r.instruction),state:r.state as OwnerWorkTask['state'],turnId:r.turn_id as string|null,runId:r.run_id as string|null,reply:r.reply as string|null,reason:r.reason as string|null,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)};
    }),
      requests:db.prepare('SELECT * FROM owner_recruit_requests ORDER BY created_at DESC LIMIT 30').all().map(r=>{
        const link=goalForRecruit?.get(r.id);
        return {...JSON.parse(String(r.request_json)),...(link?{goalId:String(link.goal_id),goalRevision:Number(link.goal_revision),...(link.node_key?{nodeKey:String(link.node_key)}:{})}:{}),state:r.state==='PENDING'&&db.prepare('SELECT 1 FROM owner_recruit_decisions WHERE request_id=?').get(r.id)?'APPROVED_QUEUED':r.state,personId:r.person_id};
      }),codeReports:(this.code?.reports()??[]).map(({files,...report})=>({...report,paths:files.map(f=>f.path)})),upgradeOrigin:this.upgradeOrigin,schedulerError:this.schedulerError};
  }
  requestRecruit(input: {role:string;reason:string;instruction:string}, requester: string, key: string) {
    if (!only(input,['role','reason','instruction']) || !text(input.role,80)||!text(input.reason,1000)||!text(input.instruction,2000)) throw new Error('OWNER_RECRUIT_INVALID');
    const db=this.manager.registry.control.db, previous=db.prepare('SELECT request_json FROM owner_recruit_requests WHERE operation_key=?').get(key);
    if(previous){const r=JSON.parse(String(previous.request_json));if(r.role!==input.role||r.reason!==input.reason||r.instruction!==input.instruction||r.requester!==requester)throw new Error('IDEMPOTENCY_CONFLICT');return r;}
    const body={id:`hire_${randomUUID().replaceAll('-','')}`,requester,...input,createdAt:Date.now()}, request:OwnerRecruitRequest={...body,hash:digest(body),state:'PENDING',personId:null};
    db.prepare('INSERT INTO owner_recruit_requests VALUES(?,?,?,\'PENDING\',NULL,?)').run(request.id,key,JSON.stringify(request),request.createdAt); return request;
  }
  registerTools(registry:ToolRegistry, worldId:string) {
    const register=(name:string,description:string,properties:Record<string,any>,required:string[],effect:'read'|'write',handler:(args:any,pixel:string,key:string,runId?:string)=>unknown|Promise<unknown>)=>registry.register({name,description,effect,enabled:true,timeout_seconds:30,input_schema:{type:'object',properties,required,additionalProperties:false}},async(args,ctx)=>{
      if(ctx.workspaceRoot!==this.manager.registry.directory(worldId))throw new Error('WORLD_TOOL_CONTEXT_CONFLICT');
      return {operation_id:ctx.operationId,tool:name,status:'SUCCESS',output:await handler(args,ctx.pixelId,ctx.operationId,ctx.runId),duration_ms:0,truncated:false,costCny:0};
    });
    register('REQUEST_RECRUIT','向 Owner 申请新人物。说明缺少的职责、现有人物无法胜任的理由及招聘后的任务。必须等待 Owner 批准，不自动创建。',{role:{type:'string'},reason:{type:'string'},instruction:{type:'string'}},['role','reason','instruction'],'write',async(a,p,k,runId)=>{
      const runtime=await this.manager.open(worldId);if(!runtime.store.pixels.getPixelAccount(p)?.active)throw new Error('OWNER_REQUEST_ACTOR_INACTIVE');
      const name=this.manager.registry.control.qianji.getProfile(this.manager.registry.control.world(worldId).qianji_id)!.narrative.displayName;
      const request=this.requestRecruit(a,name,`${worldId}:${k}`),binding=this.manager.automation?.binding(runId??'');
      if(binding)this.manager.registry.control.db.prepare('INSERT OR IGNORE INTO owner_goal_recruits VALUES(?,?,?)').run(request.id,binding.goalId,binding.specificationRevision);
      if(binding){const node=this.manager.registry.control.db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(binding.dispatchId);if(node)this.manager.registry.control.db.prepare('INSERT OR IGNORE INTO owner_task_resource_waits VALUES(?,?,?,?)').run(request.id,binding.goalId,binding.specificationRevision,node.node_key);}
      return request;
    });
    register('REPLAN_TASK','根据真实结果调整当前任务中尚未执行的内部步骤。不得改变已完成或执行中的步骤、定时授权、预算和外部权限。',{plan:{type:'object'}},['plan'],'write',(a,_p,_k,runId)=>{
      const gate=this.manager.automation,binding=gate?.binding(runId??'');if(!gate||!binding)throw new Error('OWNER_GOAL_PERMISSION_CHANGED');
      return gate.proposals.plans.reviseInternal(binding.goalId,a.plan,binding.dispatchId);
    });
    register('REQUEST_TASK_CLOSE','达到交付条件时向老板提出结案。说明实际成果；服务端核验本次产物后生成待批准提案，不能自行结案或制造付款证据。',{reason:{type:'string',minLength:8,maxLength:1200}},['reason'],'write',(a,_p,_k,runId)=>{
      const gate=this.manager.automation,binding=gate?.binding(runId??'');if(!gate||!binding||!gate.proposals.plans.get(binding.goalId)?.approved||!text(a.reason,1200)||a.reason.trim().length<8)throw new Error('OWNER_GOAL_PERMISSION_CHANGED');
      gate.store.db.prepare("INSERT OR IGNORE INTO owner_task_close_intents VALUES(?,?,?,?,'PENDING')").run(binding.dispatchId,binding.goalId,binding.specificationRevision,a.reason);gate.goals.event(binding.goalId,'task_close_requested',{dispatchId:binding.dispatchId,reason:a.reason});return {queued:true,requiresOwnerApproval:true};
    });
    if(this.code){
      register('LIST_APP_SOURCE','列出可修改的 8765 应用源码。8766、共享鉴权/持久化/协议、依赖与配置禁止访问和修改。',{},[],'read',()=>this.code!.listFiles());
      register('READ_APP_SOURCE','读取允许修改的当前应用源码及 baseHash。',{path:{type:'string'}},['path'],'read',a=>this.code!.read(a.path));
      register('SUBMIT_APP_CODE','提交实际源码候选副本，并单独报告 Owner。files 每项须含 path、完整 content（删除为 null）及 READ_APP_SOURCE 的 baseHash（新增为 null）。不改变当前服务；等待独立软件升级校验和批准。',{title:{type:'string'},summary:{type:'string'},files:{type:'array',items:{type:'object',properties:{path:{type:'string'},content:{type:['string','null']},baseHash:{type:['string','null']}},required:['path','content','baseHash'],additionalProperties:false}}},['title','summary','files'],'write',(a,p,k)=>this.code!.submit(worldId,p,a,k));
    }
    if(this.releaseMaintenance){
      const generation={type:'string',pattern:'^G[0-9]{4,}$'},reason={type:'string',minLength:1,maxLength:800};
      const actor=async(pixelId:string,operationKey:string)=>{
        const runtime=await this.manager.open(worldId);if(!runtime.store.pixels.getPixelAccount(pixelId)?.active)throw new Error('RELEASE_ACTOR_INACTIVE');
        return {worldId,pixelId,operationKey:`${worldId}:${operationKey}`};
      };
      register('LIST_RELEASE_VERSIONS','查看历史版本、可回退目标、回退后可删除的较新代码版本和维护任务状态。返回受限元数据，不含口令或私有路径。',{},[],'read',()=>this.releaseMaintenance!.list());
      register('ROLLBACK_RELEASE','按发布代次回退到 LIST_RELEASE_VERSIONS 中可回退的 targetGeneration；expectedActive 必须来自最新列表。必须在独立维护界面由 Owner 确认；本工具只报告需要批准，不能自动回退或删除。',{targetGeneration:generation,expectedActive:generation,reason,deleteNewer:{type:'boolean'}},['targetGeneration','expectedActive','reason'],'write',async(a,p,k)=>{await actor(p,k);throw new Error('OWNER_MAINTENANCE_APPROVAL_REQUIRED');});
      register('DELETE_RELEASE','仅在回退后删除列表中可删除的较新代码版本。releaseId、identity、expectedActive 必须来自最新列表。必须由 Owner 在独立维护界面确认；本工具禁止自主删除。',{releaseId:{type:'string'},expectedActive:generation,identity:{type:'string',pattern:'^[a-f0-9]{64}$'},reason},['releaseId','expectedActive','identity','reason'],'write',async(a,p,k)=>{await actor(p,k);throw new Error('OWNER_MAINTENANCE_APPROVAL_REQUIRED');});
    }
  }
  async dispatch(tasks:{personId:string;instruction:string}[],key:string,rounds=20,binding?:GoalRunBinding) {
    this.manager.automation?.assertOn();
    if(this.schedulerError)throw new Error('OWNER_WORKER_FAILED');
    if (!Number.isSafeInteger(rounds)||rounds<1||rounds>20||!Array.isArray(tasks)||!tasks.length||tasks.length>5||new Set(tasks.map(t=>t?.personId)).size!==tasks.length)throw new Error('OWNER_DISPATCH_INVALID');
    // Validate the entire batch before creating any work.
    const profiles=tasks.map(t=>{if(!record(t)||!only(t,['personId','instruction'])||!text(t.personId,100)||!text(t.instruction,binding?16384:2000))throw new Error('OWNER_DISPATCH_INVALID');if(this.agents){const p=this.agents.get(t.personId);if(p.status!=='ACTIVE')throw new Error('OWNER_PERSON_UNAVAILABLE');return {name:p.name};}const p=this.manager.registry.control.qianji.getProfile(t.personId);if(!p||p.careerStatus==='retired'||this.manager.registry.control.worldForQianji(t.personId).status!=='ACTIVE')throw new Error('OWNER_PERSON_UNAVAILABLE');return {name:p.narrative.displayName};});
    const db=this.manager.registry.control.db;
    this.manager.registry.control.transaction(()=>tasks.forEach((t,i)=>{
      const old=db.prepare('SELECT t.instruction,COALESCE(l.rounds,20) requested_rounds FROM owner_work_tasks t LEFT JOIN owner_work_run_limits l ON l.task_id=t.id WHERE t.request_key=? AND t.person_id=?').get(key,t.personId);
      if(old){if(old.instruction!==t.instruction||old.requested_rounds!==rounds)throw new Error('IDEMPOTENCY_CONFLICT');return;}
      const now=Date.now(),id=`task_${randomUUID().replaceAll('-','')}`;
      db.prepare("INSERT INTO owner_work_tasks VALUES(?,?,?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(id,key,t.personId,profiles[i]!.name,t.instruction,now,now);
      db.prepare('INSERT INTO owner_work_run_limits VALUES(?,?)').run(id,rounds);
      if(binding)db.prepare('UPDATE owner_goal_dispatches SET task_id=? WHERE id=? AND goal_id=? AND goal_revision=?').run(id,binding.dispatchId,binding.goalId,binding.specificationRevision);
    }));
    if(!this.ticking)await this.tick(binding?.dispatchId); return this.view().tasks.filter(t=>tasks.some(a=>a.personId===t.personId)&&db.prepare('SELECT request_key FROM owner_work_tasks WHERE id=?').get(t.id)?.request_key===key);
  }
  async decide(id:string,hash:string,decision:'approve'|'reject',defer=false) {
    if(defer)return this.decideOnce(id,hash,decision,true);
    const active=this.decisions.get(id);if(active){if(active.hash!==hash||active.decision!==decision)throw new Error('OWNER_REQUEST_CHANGED');return active.promise;}
    const promise=this.decideOnce(id,hash,decision);this.decisions.set(id,{hash,decision,promise});try{return await promise;}finally{this.decisions.delete(id);}
  }
  private async decideOnce(id:string,hash:string,decision:'approve'|'reject',defer=false) {
    const db=this.manager.registry.control.db,row=db.prepare('SELECT * FROM owner_recruit_requests WHERE id=?').get(id);
    const linked=this.manager.automation?db.prepare('SELECT * FROM owner_goal_recruits WHERE request_id=?').get(id):undefined;
    if(!row)throw new Error('OWNER_REQUEST_NOT_FOUND');const request=JSON.parse(String(row.request_json)) as OwnerRecruitRequest;
    if(hash!==request.hash)throw new Error('OWNER_REQUEST_CHANGED');
    const queued=db.prepare('SELECT * FROM owner_recruit_decisions WHERE request_id=?').get(id);
    if(queued&&(queued.hash!==hash||queued.decision!==decision))throw new Error('OWNER_REQUEST_CHANGED');
    const expected=decision==='approve'?'APPROVED':'REJECTED';
    if(row.state!=='PENDING'){if(row.state!==expected)throw new Error('OWNER_REQUEST_CHANGED');if(row.person_id&&!defer)return this.finishRecruitment(id,request,String(row.person_id),linked);return this.view();}
    if(linked){const goal=this.manager.automation!.goals.get(String(linked.goal_id));if(goal.specificationRevision!==linked.goal_revision||['STOPPED','ARCHIVED','COMPLETED','PARTIALLY_COMPLETED'].includes(goal.status))throw new Error('OWNER_GOAL_PERMISSION_CHANGED');}
    if(row.state==='PENDING'&&decision==='approve'&&this.manager.automation){db.prepare("INSERT OR IGNORE INTO owner_recruit_decisions VALUES(?,?,'approve')").run(id,hash);if(defer||!this.manager.automation.isOn())return {...this.view(),queuedDecision:{requestId:id,decision}};}
    if(decision==='reject'){db.prepare("UPDATE owner_recruit_requests SET state='REJECTED' WHERE id=? AND state='PENDING'").run(id);if(linked){const goal=this.manager.automation!.goals.get(String(linked.goal_id)),wait=db.prepare('SELECT * FROM owner_task_resource_waits WHERE request_id=?').get(id);if(wait)db.prepare("UPDATE owner_task_nodes SET state='BLOCKED',next_at=NULL WHERE goal_id=? AND goal_revision=? AND node_key=?").run(goal.id,goal.specificationRevision,wait.node_key);const plan=this.manager.automation!.proposals.plans.get(goal.id),other=wait&&plan?.nodes.some(n=>n.key!==wait.node_key&&n.state!=='BLOCKED'&&n.state!=='WAITING_RESOURCE'&&n.state!=='COMPLETED');this.manager.automation!.goals.state(goal.id,goal.status==='PAUSED'?'PAUSED':other?'READY':'BLOCKED','OWNER_RESOURCE_REJECTED');}return this.view();}
    // Stable identity makes a crash after creation replay the same approved Worker.
    const identity=digest({requestId:id,hash:request.hash}),personId=`worker_${identity.slice(0,32)}`;
    if(this.agents){
      this.manager.registry.control.transaction(()=>{this.agents!.create({id:personId,name:request.role,role:request.role,instruction:request.instruction});db.prepare("UPDATE owner_recruit_requests SET state='APPROVED',person_id=? WHERE id=? AND state='PENDING'").run(personId,id);});
      return this.finishRecruitment(id,request,personId,linked);
    }
    let profile=this.manager.registry.control.qianji.getProfile(personId);
    if(!profile){this.manager.registry.create({displayName:request.role,title:null,roleLabel:request.role,traits:{},behaviorProfile:[request.instruction],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null},{qianjiId:personId,worldId:`work_${identity.slice(0,32)}`});profile=this.manager.registry.control.qianji.getProfile(personId)!;}
    if(profile.narrative.roleLabel!==request.role||profile.narrative.behaviorProfile[0]!==request.instruction)throw new Error('OWNER_REQUEST_CHANGED');
    db.prepare("UPDATE owner_recruit_requests SET state='APPROVED',person_id=? WHERE id=? AND state='PENDING'").run(profile.qianjiId,id);
    return this.finishRecruitment(id,request,profile.qianjiId,linked);
  }
  private async finishRecruitment(id:string,request:OwnerRecruitRequest,personId:string,linked?:any){
    const db=this.manager.registry.control.db;
    if(linked){const goal=this.manager.automation!.goals.get(String(linked.goal_id)),wait=db.prepare('SELECT * FROM owner_task_resource_waits WHERE request_id=?').get(id);if(goal.specificationRevision===linked.goal_revision&&!['ARCHIVED','STOPPED','COMPLETED','PARTIALLY_COMPLETED'].includes(goal.status)){if(wait){db.prepare("UPDATE owner_task_nodes SET state='WAITING',next_at=? WHERE goal_id=? AND goal_revision=? AND node_key=? AND state='WAITING_RESOURCE'").run(Date.now(),goal.id,goal.specificationRevision,wait.node_key);db.prepare("UPDATE owner_task_occurrences SET state='RESOURCE_APPROVED' WHERE goal_id=? AND goal_revision=? AND node_key=? AND state='WAITING_RESOURCE'").run(goal.id,goal.specificationRevision,wait.node_key);}if(goal.status!=='PAUSED')this.manager.automation!.goals.state(goal.id,'READY');}}
    else await this.dispatch([{personId,instruction:request.instruction}],`recruit:${id}`);
    db.prepare('DELETE FROM owner_recruit_decisions WHERE request_id=?').run(id);
    return this.view();
  }
  private routed(key:string) {
    if(!this.manager.automation)return undefined;
    const row=this.manager.registry.control.db.prepare('SELECT response FROM owner_control_requests WHERE key=?').get(`chat_route_${digest(key)}`);
    return row?JSON.parse(String(row.response)):undefined;
  }
  cached(key:string,question:string,history:unknown,language:string) {
    const old=this.manager.registry.control.db.prepare('SELECT * FROM owner_dispatch_calls WHERE request_key=?').get(key);
    if(!old)return null;if(old.payload_hash!==digest({question,history,language}))throw new Error('IDEMPOTENCY_CONFLICT');
    if(old.response_json)return Promise.resolve(JSON.parse(String(old.response_json)));if(this.requestFlights.has(key))return this.requestFlights.get(key)!;
    if(['create_task','revise_task','create_goal','configure_product','dispatch'].includes(this.routed(key)?.intent?.kind))return null;
    throw new Error(String(old.error??'OWNER_REQUEST_IN_PROGRESS'));
  }
  async ask(key:string,question:string,history:{role:'user'|'assistant';content:string}[],language:'en'|'zh-CN',data:OwnerOverview,chat:OwnerChatService,forced?:{personId:string;instruction:string}[],hire?:{id:string;hash:string;decision:'approve'|'reject'}) {
    const payloadHash=digest({question,history,language}),db=this.manager.registry.control.db,old=db.prepare('SELECT * FROM owner_dispatch_calls WHERE request_key=?').get(key);
    const checkpoint=old?this.routed(key):undefined;
    if(old){if(old.payload_hash!==payloadHash)throw new Error('IDEMPOTENCY_CONFLICT');if(old.response_json)return JSON.parse(String(old.response_json));if(this.requestFlights.has(key))return this.requestFlights.get(key)!;if(!['create_task','revise_task','create_goal','configure_product','dispatch','answer','clarify','recruit','recruit_decision'].includes(checkpoint?.intent?.kind))throw new Error(String(old.error??'OWNER_REQUEST_IN_PROGRESS'));}
    else db.prepare("INSERT INTO owner_dispatch_calls(request_key,payload_hash,state,created_at) VALUES(?,?,'IN_FLIGHT',?)").run(key,payloadHash,Date.now());
    const run=async()=>{
      try {
        const routed=checkpoint??(hire?{intent:{kind:'recruit_decision',...hire},usage:{tokens:0,cost_cny:0}}:forced?{intent:{kind:'dispatch',tasks:forced},usage:{tokens:0,cost_cny:0}}:await chat.route(question,history,data,language,this.products?.catalog()));
        const i=routed.intent, say=(zh:string,en:string)=>language==='en'?en:zh;
        if(!record(i)||typeof i.kind!=='string')throw new Error('OWNER_DISPATCH_INVALID');
        if(i.kind==='dispatch'&&!forced)throw new Error('OWNER_DISPATCH_INVALID');
        const reviseRevision=checkpoint?.reviseRevision??(i.kind==='revise_task'?data.goals?.find(g=>g.id===i.goalId)?.revision:undefined);
        if(i.kind==='create_goal'&&!checkpoint&&this.manager.automation){i.kind='create_task';i.plan={summary:i.objective,nodes:[{key:'deliver',title:i.title,instruction:i.objective,dependsOn:[],trigger:{kind:'once'},filename:i.filename??'result.md'}]};}
        if(this.manager.automation&&['create_task','revise_task','create_goal','configure_product','dispatch','answer','clarify','recruit','recruit_decision'].includes(i.kind)&&!checkpoint)this.manager.automation.goals.request(`chat_route_${digest(key)}`,{payloadHash},()=>({...routed,...(i.kind==='revise_task'?{reviseRevision}:{} )}));
        let answer:string,extra:Record<string,unknown>={};
        if(i.kind==='answer'&&only(i,['kind','answer'])&&text(i.answer,8000))answer=i.answer;
        else if(hire&&i.kind==='recruit_decision'){
          await this.decide(hire.id,hire.hash,hire.decision,true);answer=hire.decision==='approve'?say('招聘已批准并排队，实际创建和工作结果会随后汇报。','Recruitment is approved and queued. Actual creation and work will be reported after execution.'):say('招聘申请已拒绝，未创建人物。','Recruitment was rejected. No person was created.');
        } else if(i.kind==='clarify'&&only(i,['kind','answer'])&&text(i.answer,2000))answer=i.answer;
        else if(['create_task','revise_task'].includes(i.kind)&&only(i,['kind','goalId','title','objective','plan','publication','filename'])&&text(i.title,160)&&text(i.objective,1200)){
          if(!this.manager.automation)throw new Error('OWNER_GOALS_UNAVAILABLE');
          if(/^(?:是否|有没有|为什么|如何|查询|查看|解释|翻译|总结|what|why|how|show|translate|summari[sz]e)/i.test(question.trim()))throw new Error('OWNER_GOAL_AUTH_REQUIRED');
          const gate=this.manager.automation;
          const result=gate.goals.request(`chat_task_${digest(key)}`,{payloadHash},()=>{
            const plan=gate.proposals.plans.validate(i.plan);
            const acceptance={kind:'manual',description:'Owner reviews the actual task deliverables / 老板核对真实任务成果后结案'};
            if(i.kind==='revise_task'&&!Number.isSafeInteger(reviseRevision))throw new Error('OWNER_GOAL_PERMISSION_CHANGED');
            const goal=i.kind==='revise_task'?gate.goals.edit(i.goalId,{title:i.title,objective:i.objective,acceptance,expectedRevision:reviseRevision,idempotencyKey:`chat_goal_${digest(key)}`}):gate.goals.create({title:i.title,objective:i.objective,acceptance,idempotencyKey:`chat_goal_${digest(key)}`});
            if(i.publication!==undefined){if(!this.products)throw new Error('OWNER_PRODUCTS_UNAVAILABLE');this.products.bind(goal,key,question,i.publication,i.filename??'product.json');}
            const view=gate.proposals.plans.install(goal.id,plan,false);
            const proposal=gate.proposals.propose('task_plan',{title:goal.title,planHash:digest(view),plan},`task-plan:${goal.id}:${goal.specificationRevision}`,goal.id);
            return {goal:gate.goals.get(goal.id),proposal};
          });
          extra.createdGoal=result.goal;extra.companyProposal=result.proposal;
          answer=say('已整理为任务计划。批准后会自动推进各步骤，并附真实成果向你汇报；完成后由你决定结案。','The task plan is ready for approval. Approved steps continue automatically with actual deliverables; you decide when to close the task.');
        }
        else if(i.kind==='create_goal'&&only(i,['kind','title','objective','filename','publication'])&&text(i.title,160)&&text(i.objective,1200)){
          this.manager.automation?.assertOn();
          if(!this.manager.automation)throw new Error('OWNER_GOALS_UNAVAILABLE');
          if(i.filename!==undefined&&(!text(i.filename,100)||!/^[-\w]+\.(?:json|md|txt|csv)$/.test(i.filename)))throw new Error('OWNER_DISPATCH_INVALID');
          const command=question.replace(/“[^”]*”|「[^」]*」|"[^"]*"/g,' ').trim();
          if(!/^(?:(?:请|帮我|给我|我要|我希望|我需要|再)\s*)*(?:建立|创建|设立|持续|长期|先|调查|调研|研究)|^(?:(?:please|I want to|I'd like to)\s+)*(?:create|set up|research|investigate|first)\b/i.test(command))throw new Error('OWNER_GOAL_AUTH_REQUIRED');
          const goal=this.manager.registry.control.transaction(()=>{
            const goal=this.manager.automation!.goals.create({title:i.title,objective:i.objective,acceptance:{kind:'manual',description:'Verify real business results and traceable source evidence; a draft alone proves neither demand nor revenue. 按真实业务成果和可追溯证据核验；不得仅凭草稿宣称营收或需求成立。'},idempotencyKey:`chat_goal_${digest(key)}`});
            if(i.publication!==undefined){if(!this.products)throw new Error('OWNER_PRODUCTS_UNAVAILABLE');const bound=db.prepare('SELECT 1 FROM owner_product_intents WHERE goal_id=?').get(goal.id);if(!bound)this.products.bind(goal,key,question,i.publication,i.filename??'product.json');}
            return goal;
          });extra.createdGoal=goal;answer=say('已创建经营目标，等待既有调度器安排执行。实际产物、证据和阻碍会显示在目标详情。','The business goal was created and is waiting for scheduling. Actual deliverables, evidence and blockers will appear in goal details.');
        }
        else if(i.kind==='configure_product'&&this.products){
          const {kind,...input}=i;const product=this.products.configure(key,question,input);extra.configuredProduct=product;
          answer=product.enabled?say(`已在公开商城上架「${product.nameZh}」，价格 ${product.price} USDT。`,`Published “${product.nameEn}” in the public store at ${product.price} USDT.`):product.reason?say(`已保存商品草稿，价格 ${product.price} USDT；未上架：缺少收款通道。请通过既有安全授权入口补齐收款资料后继续。`,`Product draft saved at ${product.price} USDT; it is not published because a payment rail is missing. Complete payment details through the existing secure authorization entry to continue.`):say('商品已更新并保持未上架。','The product was updated and is unpublished.');
        }
        else if(i.kind==='dispatch'&&only(i,['kind','tasks','rounds'])){
          if(i.rounds!==undefined&&(!Number.isSafeInteger(i.rounds)||i.rounds<1||i.rounds>20))throw new Error('OWNER_DISPATCH_INVALID');
          if(!this.manager.automation){
            const rounds=i.rounds??20;extra.tasks=await this.dispatch(i.tasks,key,rounds);answer=say(`已按分工派发任务，最多运行 ${rounds} 轮。`,`Tasks assigned by role for up to ${rounds} rounds.`);
          }else{
          if(!Array.isArray(i.tasks)||!i.tasks.length||i.tasks.length>5)throw new Error('OWNER_DISPATCH_INVALID');
          const gate=this.manager.automation;
          const result=gate.goals.request(`chat_task_${digest(key)}`,{payloadHash},()=>{
            const plan={summary:question.slice(0,1200),nodes:i.tasks.map((t:any,index:number)=>({key:`work_${index}`,title:`${index+1}`,instruction:t.instruction,dependsOn:[],trigger:{kind:'once'},filename:`work_${index}.md`,personId:t.personId}))};
            gate.proposals.plans.validate(plan);
            const goal=gate.goals.create({title:question.slice(0,160),objective:question.slice(0,1200),acceptance:{kind:'manual',description:'Review actual deliverables / 核对真实交付成果'},idempotencyKey:`chat_goal_${digest(key)}`});
            const view=gate.proposals.plans.install(goal.id,plan,false),proposal=gate.proposals.propose('task_plan',{title:goal.title,planHash:digest(view),plan},`task-plan:${goal.id}:${goal.specificationRevision}`,goal.id);return {goal:gate.goals.get(goal.id),proposal};
          });extra.createdGoal=result.goal;extra.companyProposal=result.proposal;answer=say('任务计划已生成，批准后自动执行并汇报。','The task plan is ready; approval starts execution and reporting.');
          }
        }
        else if(i.kind==='recruit'&&only(i,['kind','role','reason','instruction'])){if(!/^(?:(?:请|帮我|给我|我要|我希望|我需要)\s*)*(?:招聘|招募|新建执行者)|^(?:please\s+)?(?:recruit|hire|create a worker)\b/i.test(question.trim()))throw new Error('OWNER_GOAL_AUTH_REQUIRED');extra.request=this.requestRecruit({role:i.role,reason:i.reason,instruction:i.instruction},say('老板窗口助手','Owner assistant'),`dispatch:${key}`);answer=say('已提出资源申请。批准后才创建执行者；工作仍受公司运行状态与预算约束。','A resource request was created. Approval creates the worker; execution remains subject to company control and budget.');}
        else throw new Error('OWNER_DISPATCH_INVALID');
        const response={answer,...extra,sources:['Owner dispatch / actual World runs / owner_work_tasks'],as_of:new Date().toISOString(),usage:routed.usage};db.prepare("UPDATE owner_dispatch_calls SET state='DONE',response_json=? WHERE request_key=?").run(JSON.stringify(response),key);return response;
      } catch(e){db.prepare("UPDATE owner_dispatch_calls SET state='FAILED',error=? WHERE request_key=?").run(e instanceof Error?e.message:String(e),key);throw e;}
    };
    const promise=run();this.requestFlights.set(key,promise);try{return await promise;}finally{this.requestFlights.delete(key);}
  }
  tick(goalDispatchId?:string):Promise<void> {
    if(this.ticking)return goalDispatchId?this.ticking.then(()=>this.tick(goalDispatchId)):this.ticking;
    this.ticking=Promise.resolve().then(()=>this.runTick(goalDispatchId)).finally(()=>{this.ticking=undefined;});return this.ticking;
  }
  private async runTick(goalDispatchId?:string) {
    if(this.closed||this.quiesced())return;
    const db=this.manager.registry.control.db;
    if(this.manager.automation?.isOn())for(const row of db.prepare("SELECT * FROM owner_recruit_decisions WHERE decision='approve'").all()){
      if(this.decisions.has(String(row.request_id)))continue;
      const linked=db.prepare('SELECT * FROM owner_goal_recruits WHERE request_id=?').get(row.request_id),goal=linked?this.manager.automation.goals.get(String(linked.goal_id)):null;
      if(goal&&(goal.specificationRevision!==linked!.goal_revision||['STOPPED','ARCHIVED','COMPLETED','PARTIALLY_COMPLETED'].includes(goal.status))){db.prepare("UPDATE owner_recruit_requests SET state='CANCELLED' WHERE id=? AND state='PENDING'").run(row.request_id);db.prepare('DELETE FROM owner_recruit_decisions WHERE request_id=?').run(row.request_id);continue;}
      await this.decide(String(row.request_id),String(row.hash),'approve');
    }
    if(this.worker){await this.runWorkerTick(goalDispatchId);return;}
    for(const row of db.prepare("SELECT t.*,COALESCE(l.rounds,20) requested_rounds FROM owner_work_tasks t LEFT JOIN owner_work_run_limits l ON l.task_id=t.id WHERE t.state IN ('QUEUED','RUNNING') OR (t.state='BLOCKED' AND t.reason IN ('WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET','RUN_BUDGET_EXHAUSTED','EXECUTION_BUDGET_EXHAUSTED','OWNER_COMPANY_BUDGET_REQUIRED','OWNER_COMPANY_BUDGET_EXHAUSTED','OWNER_TOKEN_LIMIT')) ORDER BY t.created_at").all()) {
      if(this.closed||this.quiesced())return;
      try {
        const personId=String(row.person_id),world=this.manager.registry.control.worldForQianji(personId),runtime=await this.manager.open(world.world_id);
        if(row.state==='BLOCKED'){
          if(!this.manager.automation?.isOn()||runtime.run.getStatus().stop_reason==='USER_STOPPED')continue;
          if(!row.run_id||!runtime.store.runs.getCheckpoint(String(row.run_id))?.resume_pending)row.run_id=null;
          db.prepare("UPDATE owner_work_tasks SET state='QUEUED',reason=NULL,run_id=?,updated_at=? WHERE id=?").run(row.run_id,Date.now(),row.id);row.state='QUEUED';
        }
        let turnId=row.turn_id?String(row.turn_id):null;
        // A new assignment waits for the current Run to finish before using this World's inbox.
        if(!turnId&&runtime.run.getStatus().running)continue;
        const linked=this.manager.automation?db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(row.id):undefined;
        const binding=linked?{goalId:String(linked.goal_id),specificationRevision:Number(linked.goal_revision),dispatchId:String(linked.id)}:undefined;
        if(binding&&!row.run_id&&binding.dispatchId!==goalDispatchId)continue;
        if(binding){const goal=this.manager.automation!.goals.get(binding.goalId);if(goal.specificationRevision!==binding.specificationRevision||!['READY','RUNNING'].includes(goal.status))continue;}
        if(!turnId){if(this.manager.automation&&!this.manager.automation.isOn())continue;const turn=await this.gateway.enqueue(personId,String(row.instruction),String(row.id));turnId=String(turn.turn_id);db.prepare('UPDATE owner_work_tasks SET turn_id=? WHERE id=?').run(turnId,row.id);}
        const turn=(await this.gateway.turns(personId)).find(t=>t.turnId===turnId);
        if(turn?.status==='replied'){this.execution.observe(String(row.run_id),'completed',undefined,String(turn.reply??''));db.prepare("UPDATE owner_work_tasks SET state='REPLIED',reply=?,reason=NULL,updated_at=? WHERE id=?").run(turn.reply,Date.now(),row.id);continue;}
        if(turn?.status==='no_reply'||turn?.status==='failed'){this.execution.observe(String(row.run_id),turn.status==='failed'?'failed':'blocked',turn.blockReason??'OWNER_NO_REPLY');db.prepare("UPDATE owner_work_tasks SET state=?,reason=?,updated_at=? WHERE id=?").run(turn.status==='failed'?'FAILED':'NO_REPLY',turn.blockReason??'Run ended without an Owner reply',Date.now(),row.id);continue;}
        if(row.run_id&&runtime.run.getStatus().running&&runtime.run.getStatus().run_id===row.run_id&&row.state!=='RUNNING')db.prepare("UPDATE owner_work_tasks SET state='RUNNING',reason=NULL,updated_at=? WHERE id=?").run(Date.now(),row.id);
        if(!row.run_id&&!runtime.run.getStatus().running){
          if(this.closed||this.quiesced())return;
          if(this.manager.automation&&!this.manager.automation.isOn())continue;
          if(this.manager.automation&&this.manager.list().some(w=>w.running))continue;
          const command=this.execution.claim(String(row.id),world.world_id,runtime.run.getWorldRound()+1,Number(row.requested_rounds),binding);
          if(!this.execution.takeDispatch(command.attemptId))continue;
          await runtime.run.start({preparedRunId:command.runId,rounds:Number(row.requested_rounds),goalBinding:binding,onRunCreated:runId=>{this.execution.observe(runId,'started');db.prepare('UPDATE world_chat_turns SET run_id=? WHERE turn_id=?').run(runId,turnId);}});
          if(binding)db.prepare('UPDATE owner_goals SET last_scheduled_at=? WHERE id=?').run(Date.now(),binding.goalId);
        } else if(row.run_id&&!runtime.run.getStatus().running) {
          const checkpoint=runtime.store.runs.getCheckpoint(String(row.run_id));
          if(checkpoint?.resume_pending){
            const status=runtime.run.getStatus();
            if(this.manager.automation?.isOn()&&(status.stop_reason==='SERVICE_SHUTDOWN'||String(status.error_summary).includes('OWNER_TOKEN_LIMIT')))await runtime.run.resumeInterrupted();
            else if(['CALL_OUTCOME_UNKNOWN','TOOL_OUTCOME_UNKNOWN','PAUSED_RECOVERY_REQUIRED','INFRASTRUCTURE_FAILURE'].includes(status.stop_reason)){
              this.execution.observe(String(row.run_id),'blocked',status.stop_reason);
              db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason=?,updated_at=? WHERE id=?").run(status.stop_reason,Date.now(),row.id);
            }
            continue;
          }
          const blocked=turn?.status==='blocked'||turn?.status==='queued'||turn?.status==='processing';
          this.execution.observe(String(row.run_id),'blocked',turn?.blockReason??runtime.run.getStatus().stop_reason??'OWNER_NO_REPLY');
          db.prepare('UPDATE owner_work_tasks SET state=?,reason=?,updated_at=? WHERE id=?').run(blocked?'BLOCKED':'NO_REPLY',turn?.blockReason??runtime.run.getStatus().stop_reason??'No owner reply',Date.now(),row.id);
        }
      } catch(e){
        const reason=e instanceof Error?e.message:String(e);
        if(['OWNER_ATTEMPT_STALE','OWNER_ATTEMPT_ALREADY_CLAIMED','OWNER_AUTOMATION_BUSY'].includes(reason))continue;
        const attempt=this.execution.forTask(String(row.id));if(attempt){this.execution.observe(attempt.runId,'blocked',reason);const runtime=this.manager.peek(attempt.worldId);if(runtime&&!runtime.store.runs.getCheckpoint(attempt.runId))this.manager.automation!.cancelRun(attempt.runId);}
        db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason=?,updated_at=? WHERE id=?").run(reason,Date.now(),row.id);
      }
    }
    // A separately resumed run can later produce the real reply.
    for(const row of db.prepare("SELECT * FROM owner_work_tasks WHERE state IN ('BLOCKED','NO_REPLY') AND turn_id IS NOT NULL").all()) {
      try {
        const turn=(await this.gateway.turns(String(row.person_id))).find(t=>t.turnId===row.turn_id);
        if(turn?.status==='replied')db.prepare("UPDATE owner_work_tasks SET state='REPLIED',reply=?,reason=NULL,updated_at=? WHERE id=?").run(turn.reply,Date.now(),row.id);
        else {
          const runtime=this.manager.peek(this.manager.registry.control.worldForQianji(String(row.person_id)).world_id);
          if(runtime?.run.getStatus().running&&runtime.run.getStatus().run_id===row.run_id)
            db.prepare("UPDATE owner_work_tasks SET state='RUNNING',reason=NULL,updated_at=? WHERE id=?").run(Date.now(),row.id);
        }
      }catch{/* Keep the recorded blocker until there is verified new evidence. */}
    }
  }
  private async runWorkerTick(goalDispatchId?:string) {
    const worker=this.worker!,gate=this.manager.automation!,db=gate.store.db;
    await this.legacy?.tick();
    await worker.poll();
    if(gate.isOn())for(const task of db.prepare("SELECT * FROM owner_work_tasks WHERE state='BLOCKED' AND run_id IS NULL AND reason IN ('OWNER_COMPANY_BUDGET_REQUIRED','OWNER_COMPANY_BUDGET_EXHAUSTED','OWNER_COMPANY_BUDGET_BUSY')").all()){
      if(!worker.canStart(String(task.id)))continue;
      const d=db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(task.id),goal=d?gate.goals.get(String(d.goal_id)):null;
      if(goal&&(goal.specificationRevision!==d!.goal_revision||['PAUSED','STOPPED','ARCHIVED','COMPLETED','PARTIALLY_COMPLETED'].includes(goal.status)||goal.status==='BLOCKED'&&goal.reason!==task.reason))continue;
      db.prepare("UPDATE owner_work_tasks SET state='QUEUED',reason=NULL,updated_at=? WHERE id=?").run(Date.now(),task.id);
      if(d){db.prepare("UPDATE owner_goal_dispatches SET state='QUEUED',reason=NULL WHERE id=?").run(d.id);db.prepare("UPDATE owner_goal_steps SET state='QUEUED' WHERE id=?").run(d.id);if(goal?.status==='BLOCKED')gate.goals.state(goal.id,'READY');}
    }
    for(const a of worker.snapshots()){
      const goal=a.goal_id?gate.goals.get(String(a.goal_id)):null;
      if(worker.isRunning(String(a.id))&&(gate.view().desiredMode==='OFF'||goal&&(goal.specificationRevision!==a.goal_revision||['PAUSED','STOPPED','ARCHIVED'].includes(goal.status))))worker.disconnect(String(a.id));
      if(['SUSPENDED','DISPATCH_PENDING'].includes(String(a.state))&&['READY','SUSPENDED'].includes(String(a.worker_state))&&gate.view().desiredMode==='ON'&&!worker.isRunning(String(a.id))&&(!goal||goal.specificationRevision===a.goal_revision&&!['PAUSED','STOPPED','ARCHIVED','COMPLETED','PARTIALLY_COMPLETED'].includes(goal.status))){
        if(db.prepare("SELECT 1 FROM company_execution_attempts WHERE world_id=? AND id!=? AND state IN ('RUNNING','DISPATCH_PENDING')").get(a.world_id,a.id))continue;
        try{await worker.start(String(a.id));}catch(e){if(!['OWNER_PREVIOUS_WORKER_STILL_ALIVE','OWNER_AUTOMATION_OFF','OWNER_GOAL_PAUSED','EVOLUTION_QUIESCED','OWNER_COMPANY_BUDGET_REQUIRED','OWNER_COMPANY_BUDGET_EXHAUSTED','OWNER_COMPANY_BUDGET_BUSY'].includes((e as Error).message))throw e;}
      }
    }
    if(!gate.isOn())return;
    for(const task of db.prepare("SELECT t.*,COALESCE(l.rounds,20) requested_rounds FROM owner_work_tasks t LEFT JOIN owner_work_run_limits l ON l.task_id=t.id WHERE t.state='QUEUED' AND t.run_id IS NULL AND t.turn_id IS NULL ORDER BY t.created_at,t.id").all()){
      const d=db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(task.id);
      if(d&&d.id!==goalDispatchId)continue;
      const binding=d?{goalId:String(d.goal_id),specificationRevision:Number(d.goal_revision),dispatchId:String(d.id)}:undefined;
      if(binding){const goal=gate.goals.get(binding.goalId);if(goal.specificationRevision!==binding.specificationRevision||!['READY','RUNNING'].includes(goal.status))continue;}
      const actor=this.agents!.get(String(task.person_id)),scope=this.agents!.scopeId(actor.id);
      if(db.prepare("SELECT 1 FROM company_execution_attempts WHERE world_id=? AND state IN ('RUNNING','DISPATCH_PENDING')").get(scope))continue;
      try{const command=worker.create(String(task.id),scope,Number(task.requested_rounds),binding);await worker.start(command.attemptId);}
      catch(e){const reason=e instanceof Error?e.message:String(e);if(['OWNER_AUTOMATION_BUSY','OWNER_ATTEMPT_ALREADY_CLAIMED'].includes(reason))continue;db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason=?,updated_at=? WHERE id=?").run(reason,Date.now(),task.id);if(binding&&['READY','RUNNING'].includes(gate.goals.get(binding.goalId).status))gate.goals.state(binding.goalId,'BLOCKED',reason);}
    }
  }
}
