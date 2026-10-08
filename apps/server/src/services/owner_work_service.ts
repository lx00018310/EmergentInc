import { createHash, randomUUID } from 'node:crypto';
import type { OwnerOverview, OwnerWork, OwnerWorkTask, OwnerRecruitRequest } from '@emergentinc/protocol';
import type { ToolRegistry } from '@emergentinc/tools';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import { QianjiWorldGateway } from './qianji_world_gateway.js';
import { GachaService } from './gacha_service.js';
import { AppCodeService } from './app_code_service.js';
import type { OwnerChatService } from './owner_chat_service.js';
import type { ReleaseMaintenanceClient } from './release_maintenance_client.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value: unknown, max: number): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const record = (value: unknown): value is Record<string, any> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const only = (v: Record<string, any>, keys: string[]) => Object.keys(v).every(k => keys.includes(k));
export class OwnerWorkService {
  readonly code?: AppCodeService;
  private gateway: QianjiWorldGateway;
  private timer?: ReturnType<typeof setInterval>;
  private ticking?: Promise<void>;
  private closed = false;
  private schedulerError?:string;
  private requestFlights = new Map<string, Promise<any>>();
  private decisions = new Map<string, {hash:string;decision:string;promise:Promise<any>}>();
  constructor(readonly manager: WorldRuntimeManager, private quiesced: () => boolean = () => false, private upgradeOrigin?: string,private releaseMaintenance?:ReleaseMaintenanceClient) {
    this.gateway = new QianjiWorldGateway(manager);
    manager.registry.control.db.exec(`
      CREATE TABLE IF NOT EXISTS owner_work_tasks(id TEXT PRIMARY KEY, request_key TEXT NOT NULL, person_id TEXT NOT NULL, person_name TEXT NOT NULL, instruction TEXT NOT NULL, state TEXT NOT NULL, turn_id TEXT, run_id TEXT, reply TEXT, reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(request_key,person_id));
      CREATE TABLE IF NOT EXISTS owner_recruit_requests(id TEXT PRIMARY KEY, operation_key TEXT UNIQUE NOT NULL, request_json TEXT NOT NULL, state TEXT NOT NULL, person_id TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_dispatch_calls(request_key TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, state TEXT NOT NULL, response_json TEXT, error TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owner_work_run_limits(task_id TEXT PRIMARY KEY REFERENCES owner_work_tasks(id), rounds INTEGER NOT NULL CHECK(rounds BETWEEN 1 AND 20));
    `);
    if (manager.options.projectRoot) this.code = new AppCodeService(manager, manager.options.projectRoot);
  }
  start() { this.closed=false; const poll=()=>{void this.tick().catch(e=>{this.schedulerError=e instanceof Error?e.message:String(e);this.closed=true;if(this.timer)clearInterval(this.timer);});};this.timer=setInterval(poll,1000);this.timer.unref();poll(); }
  async close() { this.closed=true; if(this.timer)clearInterval(this.timer); await this.ticking; }
  hasFailure() {return Boolean(this.schedulerError);}
  view(): OwnerWork {
    const db=this.manager.registry.control.db;
    return {tasks:db.prepare('SELECT * FROM owner_work_tasks ORDER BY created_at DESC LIMIT 50').all().map(r=>({id:String(r.id),personId:String(r.person_id),personName:String(r.person_name),instruction:String(r.instruction),state:r.state as OwnerWorkTask['state'],turnId:r.turn_id as string|null,runId:r.run_id as string|null,reply:r.reply as string|null,reason:r.reason as string|null,createdAt:Number(r.created_at),updatedAt:Number(r.updated_at)})),
      requests:db.prepare('SELECT * FROM owner_recruit_requests ORDER BY created_at DESC LIMIT 30').all().map(r=>({...JSON.parse(String(r.request_json)),state:r.state,personId:r.person_id})),codeReports:(this.code?.reports()??[]).map(({files,...report})=>({...report,paths:files.map(f=>f.path)})),upgradeOrigin:this.upgradeOrigin,schedulerError:this.schedulerError};
  }
  requestRecruit(input: {role:string;reason:string;instruction:string}, requester: string, key: string) {
    if (!only(input,['role','reason','instruction']) || !text(input.role,80)||!text(input.reason,1000)||!text(input.instruction,2000)) throw new Error('OWNER_RECRUIT_INVALID');
    const db=this.manager.registry.control.db, previous=db.prepare('SELECT request_json FROM owner_recruit_requests WHERE operation_key=?').get(key);
    if(previous){const r=JSON.parse(String(previous.request_json));if(r.role!==input.role||r.reason!==input.reason||r.instruction!==input.instruction||r.requester!==requester)throw new Error('IDEMPOTENCY_CONFLICT');return r;}
    const body={id:`hire_${randomUUID().replaceAll('-','')}`,requester,...input,createdAt:Date.now()}, request:OwnerRecruitRequest={...body,hash:digest(body),state:'PENDING',personId:null};
    db.prepare('INSERT INTO owner_recruit_requests VALUES(?,?,?,\'PENDING\',NULL,?)').run(request.id,key,JSON.stringify(request),request.createdAt); return request;
  }
  registerTools(registry:ToolRegistry, worldId:string) {
    const register=(name:string,description:string,properties:Record<string,any>,required:string[],effect:'read'|'write',handler:(args:any,pixel:string,key:string)=>unknown|Promise<unknown>)=>registry.register({name,description,effect,enabled:true,timeout_seconds:30,input_schema:{type:'object',properties,required,additionalProperties:false}},async(args,ctx)=>{
      if(ctx.workspaceRoot!==this.manager.registry.directory(worldId))throw new Error('WORLD_TOOL_CONTEXT_CONFLICT');
      return {operation_id:ctx.operationId,tool:name,status:'SUCCESS',output:await handler(args,ctx.pixelId,ctx.operationId),duration_ms:0,truncated:false,costCny:0};
    });
    register('REQUEST_RECRUIT','向 Owner 申请新人物。说明缺少的职责、现有人物无法胜任的理由及招聘后的任务。必须等待 Owner 批准，不自动创建。',{role:{type:'string'},reason:{type:'string'},instruction:{type:'string'}},['role','reason','instruction'],'write',async(a,p,k)=>{
      const runtime=await this.manager.open(worldId);if(!runtime.store.pixels.getPixelAccount(p)?.active)throw new Error('OWNER_REQUEST_ACTOR_INACTIVE');
      const name=this.manager.registry.control.qianji.getProfile(this.manager.registry.control.world(worldId).qianji_id)!.narrative.displayName;
      return this.requestRecruit(a,name,`${worldId}:${k}`);
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
      register('ROLLBACK_RELEASE','按发布代次回退到 LIST_RELEASE_VERSIONS 中可回退的 targetGeneration；expectedActive 必须来自最新列表。无需 Owner 再批准。返回接受状态后维护服务执行并重启 8765；不能把接受当完成。deleteNewer=true 会在回退成功后删除所有较新代码版本，保留业务数据和审计；旧版本可能不含本工具，可在同一次调用中明确选择清理。',{targetGeneration:generation,expectedActive:generation,reason,deleteNewer:{type:'boolean'}},['targetGeneration','expectedActive','reason'],'write',async(a,p,k)=>this.releaseMaintenance!.rollback(a,await actor(p,k)));
      register('DELETE_RELEASE','仅在回退后删除列表中可删除的较新代码版本。releaseId、identity、expectedActive 必须来自最新列表。无需 Owner 再批准；不删除业务数据、账本、Current 快照或谱系。',{releaseId:{type:'string'},expectedActive:generation,identity:{type:'string',pattern:'^[a-f0-9]{64}$'},reason},['releaseId','expectedActive','identity','reason'],'write',async(a,p,k)=>this.releaseMaintenance!.delete(a,await actor(p,k)));
    }
  }
  async dispatch(tasks:{personId:string;instruction:string}[],key:string,rounds=20) {
    if(this.schedulerError)throw new Error('OWNER_WORKER_FAILED');
    if (!Number.isSafeInteger(rounds)||rounds<1||rounds>20||!Array.isArray(tasks)||!tasks.length||tasks.length>5||new Set(tasks.map(t=>t?.personId)).size!==tasks.length)throw new Error('OWNER_DISPATCH_INVALID');
    // Validate the entire batch before creating any work.
    const profiles=tasks.map(t=>{if(!record(t)||!only(t,['personId','instruction'])||!text(t.personId,100)||!text(t.instruction,2000))throw new Error('OWNER_DISPATCH_INVALID');const p=this.manager.registry.control.qianji.getProfile(t.personId);if(!p||p.careerStatus==='retired'||this.manager.registry.control.worldForQianji(t.personId).status!=='ACTIVE')throw new Error('OWNER_PERSON_UNAVAILABLE');return p;});
    const db=this.manager.registry.control.db;
    this.manager.registry.control.transaction(()=>tasks.forEach((t,i)=>{
      const old=db.prepare('SELECT t.instruction,COALESCE(l.rounds,20) requested_rounds FROM owner_work_tasks t LEFT JOIN owner_work_run_limits l ON l.task_id=t.id WHERE t.request_key=? AND t.person_id=?').get(key,t.personId);
      if(old){if(old.instruction!==t.instruction||old.requested_rounds!==rounds)throw new Error('IDEMPOTENCY_CONFLICT');return;}
      const now=Date.now(),id=`task_${randomUUID().replaceAll('-','')}`;
      db.prepare("INSERT INTO owner_work_tasks VALUES(?,?,?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(id,key,t.personId,profiles[i]!.narrative.displayName,t.instruction,now,now);
      db.prepare('INSERT INTO owner_work_run_limits VALUES(?,?)').run(id,rounds);
    }));
    await this.tick(); return this.view().tasks.filter(t=>tasks.some(a=>a.personId===t.personId)&&db.prepare('SELECT request_key FROM owner_work_tasks WHERE id=?').get(t.id)?.request_key===key);
  }
  async energy(personId:string,refill:boolean,infinite:boolean|undefined,key:string) {
    const profile=this.manager.registry.control.qianji.getProfile(personId),world=this.manager.registry.control.worldForQianji(personId);
    if(!profile||profile.careerStatus==='retired'||world.status!=='ACTIVE')throw new Error('OWNER_PERSON_UNAVAILABLE');
    const runtime=await this.manager.open(world.world_id),pixelId=world.gateway_pixel_id;
    const account=pixelId?runtime.store.pixels.getPixelAccount(pixelId):null;
    if(!pixelId||!account?.active||account.refundDeficitTokens>0)throw new Error('OWNER_GATEWAY_UNAVAILABLE');
    if(typeof infinite==='boolean')this.manager.registry.control.setGatewayInfiniteEnergy(world.world_id,infinite);
    const amount=refill?Math.max(0,100000-account.energy):0;
    if(amount)runtime.store.applyExternalReward({pixelId,amount,idempotencyKey:`owner-chat-energy:${key}`,source:'owner_chat',reason:'Owner explicitly requested gateway energy refill'});
    // Explicit refill permits retrying energy-blocked work; never replay unknown calls or a manual pause.
    const waiting=runtime.store.db.prepare("SELECT 1 FROM messages WHERE recipient=? AND status='WAITING_PIXEL_BUDGET' LIMIT 1").get(pixelId);
    const previous=runtime.store.runs.getLatestRun(),remaining=previous?Math.max(0,previous.run_limit-previous.run_spent-previous.run_reserved):0;
    const rounds=previous?.end_round==null?0:Math.max(1,Math.min(20,previous.end_round-runtime.run.getWorldRound()));
    if((refill||infinite===true)&&waiting&&remaining>0&&rounds>0&&!runtime.run.getStatus().running&&!this.quiesced()&&runtime.run.getStatus().stop_reason!=='USER_STOPPED'&&!runtime.store.getUnfinalizedOperations().hasUnfinalized)
      await runtime.run.start({rounds,runBudgetTokens:remaining});
    return {personId,name:profile.narrative.displayName,pixelId,energy:runtime.store.pixels.getPixelAccount(pixelId)!.energy,infiniteEnergy:this.manager.registry.control.gatewayInfiniteEnergy(world.world_id),running:runtime.run.getStatus().running};
  }
  async decide(id:string,hash:string,decision:'approve'|'reject') {
    const active=this.decisions.get(id);if(active){if(active.hash!==hash||active.decision!==decision)throw new Error('OWNER_REQUEST_CHANGED');return active.promise;}
    const promise=this.decideOnce(id,hash,decision);this.decisions.set(id,{hash,decision,promise});try{return await promise;}finally{this.decisions.delete(id);}
  }
  private async decideOnce(id:string,hash:string,decision:'approve'|'reject') {
    const db=this.manager.registry.control.db,row=db.prepare('SELECT * FROM owner_recruit_requests WHERE id=?').get(id);
    if(!row)throw new Error('OWNER_REQUEST_NOT_FOUND');const request=JSON.parse(String(row.request_json)) as OwnerRecruitRequest;
    if(hash!==request.hash)throw new Error('OWNER_REQUEST_CHANGED');
    const expected=decision==='approve'?'APPROVED':'REJECTED';
    if(row.state!=='PENDING'){if(row.state!==expected)throw new Error('OWNER_REQUEST_CHANGED');if(row.person_id)await this.dispatch([{personId:String(row.person_id),instruction:request.instruction}],`recruit:${id}`);return this.view();}
    if(decision==='reject'){db.prepare("UPDATE owner_recruit_requests SET state='REJECTED' WHERE id=? AND state='PENDING'").run(id);return this.view();}
    const m=this.manager,service=new GachaService({store:m.registry.control,workspaceRoot:m.registry.workspace,provider:m.options.isModelConfigured?m.options.provider:undefined,usageMeter:m.options.usageMeter,modelName:m.options.modelName,
      createWorld:(narrative,birth)=>m.registry.create({...narrative,roleLabel:request.role,behaviorProfile:[`职责：${request.role}`,`Owner 批准的初始任务：${request.instruction}`]}, {birthIdentity:birth}).qianji_id});
    const profile=await service.recruit(`owner-recruit:${id}`);
    db.prepare("UPDATE owner_recruit_requests SET state='APPROVED',person_id=? WHERE id=? AND state='PENDING'").run(profile.qianjiId,id);
    await this.dispatch([{personId:profile.qianjiId,instruction:request.instruction}],`recruit:${id}`);return this.view();
  }
  cached(key:string,question:string,history:unknown,language:string) {
    const old=this.manager.registry.control.db.prepare('SELECT * FROM owner_dispatch_calls WHERE request_key=?').get(key);
    if(!old)return null;if(old.payload_hash!==digest({question,history,language}))throw new Error('IDEMPOTENCY_CONFLICT');
    if(old.response_json)return Promise.resolve(JSON.parse(String(old.response_json)));if(this.requestFlights.has(key))return this.requestFlights.get(key)!;throw new Error(String(old.error??'OWNER_REQUEST_IN_PROGRESS'));
  }
  async ask(key:string,question:string,history:{role:'user'|'assistant';content:string}[],language:'en'|'zh-CN',data:OwnerOverview,chat:OwnerChatService,forced?:{personId:string;instruction:string}[],hire?:{id:string;hash:string;decision:'approve'|'reject'}) {
    const payloadHash=digest({question,history,language}),db=this.manager.registry.control.db,old=db.prepare('SELECT * FROM owner_dispatch_calls WHERE request_key=?').get(key);
    if(old){if(old.payload_hash!==payloadHash)throw new Error('IDEMPOTENCY_CONFLICT');if(old.response_json)return JSON.parse(String(old.response_json));if(this.requestFlights.has(key))return this.requestFlights.get(key)!;throw new Error(String(old.error??'OWNER_REQUEST_IN_PROGRESS'));}
    db.prepare("INSERT INTO owner_dispatch_calls VALUES(?,?,'IN_FLIGHT',NULL,NULL,?)").run(key,payloadHash,Date.now());
    const run=async()=>{
      try {
        const routed=hire?{intent:{kind:'recruit_decision',...hire},usage:{tokens:0,cost_cny:0}}:forced?{intent:{kind:'dispatch',tasks:forced},usage:{tokens:0,cost_cny:0}}:await chat.route(question,history,data,language);
        const i=routed.intent, say=(zh:string,en:string)=>language==='en'?en:zh;
        if(!record(i)||typeof i.kind!=='string')throw new Error('OWNER_DISPATCH_INVALID');
        let answer:string,extra:Record<string,unknown>={};
        if(i.kind==='answer'&&only(i,['kind'])){
          const response=await chat.ask(question,history,language);response.usage.tokens=response.usage.tokens!==null&&routed.usage.tokens!==null?response.usage.tokens+routed.usage.tokens:null;response.usage.cost_cny=response.usage.cost_cny!==null&&routed.usage.cost_cny!==null?response.usage.cost_cny+routed.usage.cost_cny:null;
          db.prepare("UPDATE owner_dispatch_calls SET state='DONE',response_json=? WHERE request_key=?").run(JSON.stringify(response),key);return response;
        } else if(hire&&i.kind==='recruit_decision'){
          await this.decide(hire.id,hire.hash,hire.decision);answer=hire.decision==='approve'?say('招聘已批准。新人物及其实际任务会显示在下方。','Recruitment was approved. The new person and their actual work appear below.'):say('招聘申请已拒绝，未创建人物。','Recruitment was rejected. No person was created.');
        } else if(i.kind==='clarify'&&only(i,['kind','answer'])&&text(i.answer,2000))answer=i.answer;
        else if(i.kind==='dispatch'&&only(i,['kind','tasks','rounds'])){const rounds=i.rounds===undefined?20:i.rounds;extra.tasks=await this.dispatch(i.tasks,key,rounds);answer=say(`已按分工派发任务并进入运行队列。下方会显示实际运行、阻塞和人物回复；每项任务最多 ${rounds} 轮、100000 Run Tokens。`,`Tasks were assigned and queued for execution. Actual runs, blockers and person replies appear below. Each task is limited to ${rounds} rounds and 100000 Run tokens.`);}
        else if(i.kind==='energy'&&only(i,['kind','personId','refill','infinite'])&&typeof i.personId==='string'&&(i.refill===undefined||typeof i.refill==='boolean')&&(i.infinite===undefined||typeof i.infinite==='boolean')&&(i.refill===true||typeof i.infinite==='boolean')){
          const result=await this.energy(i.personId,i.refill===true,i.infinite,key);extra.energy=result;answer=say(`${result.name}：当前入口元胞 ${result.pixelId} 的能量为 ${result.energy}，无限能量${result.infiniteEnergy?'已开启':'已关闭'}。其他元胞是否获能仍由入口自主决定，Run 预算和实际计费继续有效。`,`${result.name}: gateway ${result.pixelId} has ${result.energy} energy; automatic replenishment is ${result.infiniteEnergy?'enabled':'disabled'}. The gateway decides whether to supply other cells. Run budgets and actual billing remain in effect.`);
        } else if(i.kind==='recruit'&&only(i,['kind','role','reason','instruction'])){extra.request=this.requestRecruit({role:i.role,reason:i.reason,instruction:i.instruction},say('老板窗口助手','Owner assistant'),`dispatch:${key}`);answer=say('已提出招聘申请。请在待办中查看职责、理由和初始任务；批准后才创建人物并派发任务。','A recruitment request was created. Review the role, reason and initial task in Inbox. Approval creates the person and dispatches the task.');}
        else throw new Error('OWNER_DISPATCH_INVALID');
        const response={answer,...extra,sources:['Owner dispatch / actual World runs / owner_work_tasks'],as_of:new Date().toISOString(),usage:routed.usage};db.prepare("UPDATE owner_dispatch_calls SET state='DONE',response_json=? WHERE request_key=?").run(JSON.stringify(response),key);return response;
      } catch(e){db.prepare("UPDATE owner_dispatch_calls SET state='FAILED',error=? WHERE request_key=?").run(e instanceof Error?e.message:String(e),key);throw e;}
    };
    const promise=run();this.requestFlights.set(key,promise);try{return await promise;}finally{this.requestFlights.delete(key);}
  }
  tick():Promise<void> {
    if(this.ticking)return this.ticking;
    this.ticking=this.runTick().finally(()=>{this.ticking=undefined;});return this.ticking;
  }
  private async runTick() {
    if(this.closed||this.quiesced())return;
    const db=this.manager.registry.control.db;
    for(const row of db.prepare("SELECT t.*,COALESCE(l.rounds,20) requested_rounds FROM owner_work_tasks t LEFT JOIN owner_work_run_limits l ON l.task_id=t.id WHERE t.state IN ('QUEUED','RUNNING') ORDER BY t.created_at").all()) {
      if(this.closed||this.quiesced())return;
      try {
        const personId=String(row.person_id),world=this.manager.registry.control.worldForQianji(personId),runtime=await this.manager.open(world.world_id);
        let turnId=row.turn_id?String(row.turn_id):null;
        // A new assignment waits for its own bounded Run instead of consuming another Run's budget.
        if(!turnId&&runtime.run.getStatus().running)continue;
        if(!turnId){const turn=await this.gateway.enqueue(personId,String(row.instruction),String(row.id));turnId=String(turn.turn_id);db.prepare('UPDATE owner_work_tasks SET turn_id=? WHERE id=?').run(turnId,row.id);}
        const turn=(await this.gateway.turns(personId)).find(t=>t.turnId===turnId);
        if(turn?.status==='replied'){db.prepare("UPDATE owner_work_tasks SET state='REPLIED',reply=?,reason=NULL,updated_at=? WHERE id=?").run(turn.reply,Date.now(),row.id);continue;}
        if(turn?.status==='no_reply'||turn?.status==='failed'){db.prepare("UPDATE owner_work_tasks SET state=?,reason=?,updated_at=? WHERE id=?").run(turn.status==='failed'?'FAILED':'NO_REPLY',turn.blockReason??'Run ended without an Owner reply',Date.now(),row.id);continue;}
        if(!row.run_id&&!runtime.run.getStatus().running){
          if(this.closed||this.quiesced())return;
          await runtime.run.start({rounds:Number(row.requested_rounds),runBudgetTokens:100000,onRunCreated:runId=>{db.prepare("UPDATE owner_work_tasks SET state='RUNNING',run_id=?,updated_at=? WHERE id=?").run(runId,Date.now(),row.id);db.prepare('UPDATE world_chat_turns SET run_id=? WHERE turn_id=?').run(runId,turnId);}});
        } else if(row.run_id&&!runtime.run.getStatus().running) {
          const blocked=turn?.status==='blocked'||turn?.status==='queued'||turn?.status==='processing';
          db.prepare('UPDATE owner_work_tasks SET state=?,reason=?,updated_at=? WHERE id=?').run(blocked?'BLOCKED':'NO_REPLY',turn?.blockReason??runtime.run.getStatus().stop_reason??'No owner reply',Date.now(),row.id);
        }
      } catch(e){db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason=?,updated_at=? WHERE id=?").run(e instanceof Error?e.message:String(e),Date.now(),row.id);}
    }
    // An explicit energy retry or a manual recovery can later produce the real reply.
    for(const row of db.prepare("SELECT * FROM owner_work_tasks WHERE state IN ('BLOCKED','NO_REPLY') AND turn_id IS NOT NULL").all()) {
      try {const turn=(await this.gateway.turns(String(row.person_id))).find(t=>t.turnId===row.turn_id);if(turn?.status==='replied')db.prepare("UPDATE owner_work_tasks SET state='REPLIED',reply=?,reason=NULL,updated_at=? WHERE id=?").run(turn.reply,Date.now(),row.id);}catch{/* Keep the recorded blocker until there is verified new evidence. */}
    }
  }
}
