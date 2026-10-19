import type { OwnerRecruitRequest, ToolDefinition, ToolResult } from '@emergentinc/protocol';
import type { CompanyAgentService } from './company_agent_service.js';
import type { CompanyArtifactService } from './company_artifact_service.js';
import type { OwnerAutomationGate } from './owner_automation_gate.js';
import type { AppCodeService } from './app_code_service.js';
import type { PaymentService } from './payment_service.js';
import type { ReleaseMaintenanceClient } from './release_maintenance_client.js';
import { InstanceExtensionService } from './instance_extension_service.js';
import { listSkills, readSkill, parseSkillMarkdown } from './skill_library.js';
import { exactKeys, ownerConflict, ownerInput } from './owner_goal_service.js';
import { companyFactHash } from './company_fact_hash.js';
import { readGeneCatalog,loadGeneAsset } from './gene_catalog.js';

interface Dependencies {
  gate:OwnerAutomationGate;agents:CompanyAgentService;artifacts:CompanyArtifactService;
  recruit:(input:{role:string;reason:string;instruction:string},requester:string,key:string)=>OwnerRecruitRequest;
  code?:AppCodeService;payments?:PaymentService;release?:ReleaseMaintenanceClient;
  projectRoot?:string;contracts:Record<string,unknown>;
}
/** Typed company commands with durable receipts. Workers cannot mutate company tables directly. */
export class CompanyToolService {
  private definitions=new Map<string,ToolDefinition>();
  private handlers=new Map<string,(actorId:string,attemptId:string,key:string,args:any)=>unknown|Promise<unknown>>();
  private flights=new Map<string,Promise<ToolResult>>();
  constructor(readonly dependencies:Dependencies) {
    const {gate,agents,artifacts}=dependencies,db=gate.store.db;
    db.exec(`CREATE TABLE IF NOT EXISTS company_controller_tools(operation_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL REFERENCES company_execution_attempts(id),tool TEXT NOT NULL,args_hash TEXT NOT NULL,state TEXT NOT NULL,result_json TEXT);`);
    const register=(name:string,description:string,effect:'read'|'write',properties:Record<string,any>,required:string[],handler:(actorId:string,attemptId:string,key:string,args:any)=>unknown|Promise<unknown>)=>{
      this.definitions.set(name,{name,description,effect,enabled:true,timeout_seconds:30,input_schema:{type:'object',properties,required,additionalProperties:false}});this.handlers.set(name,handler);
    };
    const binding=(id:string)=>{const a=gate.execution!.get(id);if(!a.goalId)ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');return a;};
    register('REPORT_TASK_GAP','Record an unresolved fact with a stable key; reuse its ID in later queries. This grants no permissions / 用固定标识记录缺失事实，后续查询沿用其编号，不增加权限。','write',{factKey:{type:'string'},description:{type:'string'}},['factKey','description'],(_actor,id,_key,args)=>{
      const a=binding(id),occ=db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(a.dispatchId!);
      ownerInput(typeof args.factKey==='string'&&typeof args.description==='string'&&Boolean(occ),'OWNER_PROGRESS_INVALID');
      return gate.proposals.plans.progress.gap(a.goalId!,`reported:${args.factKey}`,args.description,String(occ!.node_key));
    });
    register('READ_TASK_PROGRESS','Read this approved step’s complete requirements, retained attempts and owner-supplied material; these grant no extra permissions / 读取本批准环节的完整要求、已试办法及人工资料，不增加权限。','read',{},[],(_actor,id)=>{
      const a=binding(id),plan=gate.proposals.plans.get(a.goalId!),occ=db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(a.dispatchId!),node=plan?.nodes.find(n=>n.key===occ?.node_key);
      ownerInput(Boolean(plan?.approved&&node),'OWNER_GOAL_PERMISSION_CHANGED');
      return {node,context:gate.proposals.plans.progress.context(a.goalId!,node!,a.dispatchId!),ownerMaterials:gate.proposals.plans.progress.notes(a.goalId!,node!.key),source:'OWNER_SUPPLIED_UNVERIFIED',readOnly:true};
    });
    register('REQUEST_RECRUIT','Request an exact role and wait for Owner approval / 申请准确职责，等待老板批准。','write',{role:{type:'string'},reason:{type:'string'},instruction:{type:'string'}},['role','reason','instruction'],(actor,id,key,args)=>{
      const request=dependencies.recruit(args,agents.get(actor).name,key),a=gate.execution!.get(id);
      if(a.goalId){db.prepare('INSERT OR IGNORE INTO owner_goal_recruits VALUES(?,?,?)').run(request.id,a.goalId,a.goalRevision!);const node=db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(a.dispatchId!);if(node)db.prepare('INSERT OR IGNORE INTO owner_task_resource_waits VALUES(?,?,?,?)').run(request.id,a.goalId,a.goalRevision!,node.node_key);}
      return request;
    });
    register('REPLAN_TASK','Revise unstarted internal steps only; authorization and schedules remain fixed / 仅调整尚未执行的内部步骤，不能扩大授权或定时。','write',{plan:{type:'object'}},['plan'],(_actor,id,_key,args)=>{const a=binding(id);return gate.proposals.plans.reviseInternal(a.goalId!,args.plan,a.dispatchId!);});
    register('REQUEST_TASK_CLOSE','Request Owner closure using actual verified deliverables / 依据实际交付物申请老板结案。','write',{reason:{type:'string',minLength:8,maxLength:1200}},['reason'],(_actor,id,_key,args)=>{
      const a=binding(id);ownerInput(typeof args.reason==='string'&&args.reason.trim().length>=8&&args.reason.length<=1200&&gate.proposals.plans.get(a.goalId!)?.approved,'OWNER_GOAL_PERMISSION_CHANGED');
      db.prepare("INSERT OR IGNORE INTO owner_task_close_intents VALUES(?,?,?,?,'PENDING')").run(a.dispatchId!,a.goalId!,a.goalRevision!,args.reason);gate.goals.event(a.goalId!,'task_close_requested',{dispatchId:a.dispatchId,reason:args.reason});return {queued:true,requiresOwnerApproval:true};
    });
    register('read_artifact','Read a retained artifact owned by this agent / 读取当前执行者已保存的产物。','read',{filename:{type:'string'}},['filename'],actorArgs((actor,args)=>{const a=artifacts.forAgent(actor,args.filename);return {filename:a.filename,content:a.content,sha256:a.sha256,size_bytes:a.bytes,operation_id:a.operation_id};}));
    register('list_artifacts','List this agent’s retained artifacts / 列出当前执行者已保存的产物。','read',{},[],actorArgs(actor=>artifacts.listForAgent(actor)));
    register('LIST_WORLD_ASSETS','List owned retained files; no private execution state / 列出所属产物，不读取私有执行状态。','read',{},[],actorArgs(actor=>artifacts.listForAgent(actor)));
    register('READ_WORLD_ASSET','Read an owned file and verify its retained hash / 读取所属文件并核验已记录 hash。','read',{filename:{type:'string'}},['filename'],actorArgs((actor,args)=>artifacts.forAgent(actor,args.filename)));
    register('READ_TASK_DEPENDENCY','Read the exact verified input of this approved step, including another agent’s deliverable / 读取本批准步骤的准确依赖输入，可包含其他执行者的交付物。','read',{evidenceId:{type:'string'}},['evidenceId'],(_actor,id,_key,args)=>{
      const a=binding(id),occ=db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(a.dispatchId!),plan=gate.proposals.plans.get(a.goalId!),node=plan?.nodes.find(n=>n.key===occ?.node_key);
      if(!plan?.approved||!node)ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
      const allowed=node.dependsOn.flatMap(key=>plan.nodes.find(n=>n.key===key)!.latestEvidence);if(!allowed.includes(args.evidenceId))ownerConflict('OWNER_EVIDENCE_NOT_AUTHORIZED');
      const e=gate.goals.detail(a.goalId!).evidence.find(e=>e.id===args.evidenceId&&e.kind==='artifact'&&e.specificationRevision===a.goalRevision);if(!e)ownerConflict('OWNER_EVIDENCE_CHANGED');
      return {evidenceId:e.id,filename:e.reference.split('/').at(-1),sha256:e.sha256,size_bytes:e.bytes,content:artifacts.read(e).toString('utf8'),readOnly:true};
    });
    if(dependencies.projectRoot){
      register('LIST_GENE_ASSETS','List approved shared knowledge assets / 列出已批准的共享知识资产。','read',{},[],()=>readGeneCatalog(dependencies.projectRoot!).assets.map(({file,...asset})=>asset));
      register('READ_GENE_ASSET','Read approved shared knowledge and verify its hash; it grants no permissions / 读取已批准知识并核验 hash；知识不授予权限。','read',{id:{type:'string'}},['id'],(_a,_id,_key,args)=>loadGeneAsset(dependencies.projectRoot!,args.id));
    }
    register('transfer_artifact','Share a retained artifact with another active company agent / 将已保存产物分享给公司另一名在职执行者。','write',{filename:{type:'string'},targetAgentId:{type:'string'}},['filename','targetAgentId'],actorArgs((actor,args)=>{ownerInput(agents.get(args.targetAgentId).status==='ACTIVE','OWNER_PERSON_UNAVAILABLE');return artifacts.transfer(actor,args.targetAgentId,args.filename);}));
    register('LIST_SKILLS','List advisory methods; none grants additional permission / 列出工作方法；方法不授予额外权限。','read',{},[],actorArgs(actor=>{
      const base=dependencies.projectRoot?listSkills(this.skillContext(actor),dependencies.projectRoot):{skills:[],diagnostics:[],truncated:false};
      const saved=[] as typeof base.skills,diagnostics=base.diagnostics.filter(d=>d.ref.startsWith('gene:'));
      const rows=artifacts.listForAgent(actor).filter(a=>String(a.filename).endsWith('.skill.md'));
      for(const a of rows.slice(0,100)){const ref='body:'+String(a.filename).slice(0,-9);try{if(Number(a.bytes)>32768)throw new Error('SKILL_TOO_LARGE');const content=artifacts.forAgent(actor,String(a.filename)),parsed=parseSkillMarkdown(content.content);saved.push({ref,name:parsed.name,description:parsed.description,origin:'body',size_bytes:Number(a.bytes)});}catch(e){diagnostics.push({ref,reason:(e as Error).message});}}
      return {skills:[...base.skills.filter(s=>s.origin==='gene'),...saved],diagnostics,truncated:base.truncated||rows.length>100};
    }));
    register('READ_SKILL','Read one advisory method by its catalog reference / 按目录引用读取工作方法。','read',{ref:{type:'string'}},['ref'],actorArgs((actor,args)=>{
      if(typeof args.ref==='string'&&args.ref.startsWith('body:')){const filename=args.ref.slice(5)+'.skill.md';if(artifacts.listForAgent(actor).some(a=>a.filename===filename)){const a=artifacts.forAgent(actor,filename);if(a.bytes>32768)ownerConflict('SKILL_TOO_LARGE');const parsed=parseSkillMarkdown(a.content);return {ref:args.ref,name:parsed.name,description:parsed.description,origin:'body',content:a.content,sha256:a.sha256,size_bytes:a.bytes};}ownerConflict('SKILL_NOT_FOUND');}
      if(!dependencies.projectRoot)ownerConflict('SKILL_NOT_FOUND');return readSkill(this.skillContext(actor),dependencies.projectRoot,args.ref);
    }));
    register('LIST_EXTENSIONS','List private verified pure programs / 列出私有且已验证的纯计算程序。','read',{},[],actorArgs(actor=>this.extensions(actor).list()));
    register('RUN_EXTENSION','Run a pure JSON program without network, files or credentials / 运行不能访问网络、文件或凭据的纯 JSON 程序。','read',{id:{type:'string'},input:{}},['id','input'],actorArgs((actor,args)=>this.extensions(actor).run(args.id,args.input)));
    register('SUBMIT_EXTENSION','Validate and activate an exact pure-program revision / 校验并按准确修订启用纯计算程序。','write',{manifest:{type:'object'},expectedRevision:{type:'integer'},expectedHash:{type:['string','null']}},['manifest','expectedRevision','expectedHash'],(actor,_id,key,args)=>{
      const service=this.extensions(actor),saved=service.submit('0_0_0',args.manifest);return saved.supported?service.action(saved.id,{action:'activate',hash:saved.hash,expectedRevision:args.expectedRevision,expectedHash:args.expectedHash,idempotencyKey:key}):saved;
    });
    register('SET_EXTENSION_STATE','Change an exact private-program revision / 按准确修订变更私有程序状态。','write',{id:{type:'string'},action:{type:'string'},hash:{type:'string'},expectedRevision:{type:'integer'},expectedHash:{type:['string','null']}},['id','action','expectedRevision','expectedHash'],(actor,_id,key,args)=>{const {id,...input}=args;return this.extensions(actor).action(id,{...input,idempotencyKey:key});});
    if(dependencies.code){
      register('LIST_APP_SOURCE','List permitted 8765 source; protected control code is excluded / 列出允许访问的 8765 源码，不包含受保护控制代码。','read',{},[],()=>dependencies.code!.listFiles());
      register('READ_APP_SOURCE','Read a permitted source file and its exact base hash / 读取允许访问的源码及准确 base hash。','read',{path:{type:'string'}},['path'],(_a,_id,_key,args)=>dependencies.code!.read(args.path));
      register('SUBMIT_APP_CODE','Submit a private candidate and Owner report; no publication / 提交私有候选与老板报告，不发布。','write',{title:{type:'string'},summary:{type:'string'},files:{type:'array',items:{type:'object',properties:{path:{type:'string'},content:{type:['string','null']},baseHash:{type:['string','null']}},required:['path','content','baseHash'],additionalProperties:false}}},['title','summary','files'],(actor,_id,key,args)=>dependencies.code!.submit(actor,'0_0_0',args,key));
    }
    if(dependencies.payments)register('LIST_PAYMENT_RAILS','List configured receive-only USDT rails / 列出已配置的 USDT 只收款通道。','read',{},[],()=>dependencies.payments!.rails().filter(r=>r.status==='ENABLED').map(r=>({rail_id:r.rail_id,chain:r.chain,asset:r.asset,mint:r.mint,decimals:r.decimals,recipient_address:r.recipient_address})));
    if(dependencies.release){
      register('LIST_RELEASE_VERSIONS','Read release metadata; no maintenance authority / 读取版本信息，不授予维护权限。','read',{},[],()=>dependencies.release!.list());
      for(const name of ['ROLLBACK_RELEASE','DELETE_RELEASE'])register(name,'Separate exact Owner maintenance approval is required / 必须由老板单独批准准确维护操作。','write',{},[],()=>ownerConflict('OWNER_MAINTENANCE_APPROVAL_REQUIRED'));
    }
  }
  catalog(){return [...this.definitions.values()];}
  private skillContext(actor:string){return {workspaceRoot:this.dependencies.agents.directory(actor),pixelId:'0_0_0',runId:'',messageId:'',operationId:''};}
  private extensions(actor:string){return new InstanceExtensionService(this.dependencies.agents.directory(actor),this.dependencies.agents.scopeId(actor),this.dependencies.contracts);}
  receipt(operationId:string,attemptId?:string){const r=this.dependencies.gate.store.db.prepare("SELECT result_json FROM company_controller_tools WHERE operation_id=? AND state='DONE' AND (? IS NULL OR attempt_id=?)").get(operationId,attemptId??null,attemptId??null);return r?.result_json?JSON.parse(String(r.result_json)) as ToolResult:null;}
  async execute(attemptId:string,operationId:string,tool:string,args:Record<string,any>):Promise<ToolResult> {
    const {gate,agents}=this.dependencies,a=gate.execution!.get(attemptId),db=gate.store.db,definition=this.definitions.get(tool),hash=companyFactHash({attemptId,tool,args});
    gate.assertWorkerIntent(a.runId,attemptId);if(!definition||!operationId.startsWith(`${attemptId}:tool:`))ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
    exactKeys(args,Object.keys(definition.input_schema.properties));ownerInput(definition.input_schema.required.every((key:string)=>args[key]!==undefined),'OWNER_TOOL_INPUT_INVALID');
    const actor=String(db.prepare('SELECT person_id FROM owner_work_tasks WHERE id=?').get(a.taskId)!.person_id);ownerInput(agents.get(actor).status==='ACTIVE','OWNER_PERSON_UNAVAILABLE');
    const old=db.prepare('SELECT * FROM company_controller_tools WHERE operation_id=?').get(operationId);
    if(old){if(old.args_hash!==hash)ownerConflict('IDEMPOTENCY_CONFLICT');if(old.result_json)return JSON.parse(String(old.result_json));if(this.flights.has(operationId))return this.flights.get(operationId)!;ownerConflict('TOOL_OUTCOME_UNKNOWN');}
    db.prepare("INSERT INTO company_controller_tools VALUES(?,?,?,?,'STARTED',NULL)").run(operationId,attemptId,tool,hash);
    const run=async()=>{
      let result:ToolResult;
      try{
        const value=gate.store.transaction(()=>{
          const output=this.handlers.get(tool)!(actor,attemptId,operationId,args);
          if(!(output instanceof Promise)){const receipt:ToolResult={operation_id:operationId,tool,status:'SUCCESS',output,duration_ms:0,truncated:false,costCny:0};db.prepare("UPDATE company_controller_tools SET state='DONE',result_json=? WHERE operation_id=? AND state='STARTED'").run(JSON.stringify(receipt),operationId);return {receipt};}
          return {promise:output};
        });
        if(value.receipt)return value.receipt;
        const output=await value.promise;result={operation_id:operationId,tool,status:'SUCCESS',output,duration_ms:0,truncated:false,costCny:0};
      }
      catch(e){result={operation_id:operationId,tool,status:'FAILED',error_code:e instanceof Error?e.message:'OWNER_TOOL_FAILED',error_message:e instanceof Error?e.message:'OWNER_TOOL_FAILED',duration_ms:0,truncated:false,costCny:0};}
      db.prepare("UPDATE company_controller_tools SET state='DONE',result_json=? WHERE operation_id=? AND state='STARTED'").run(JSON.stringify(result),operationId);return result;
    };
    const promise=run();this.flights.set(operationId,promise);try{return await promise;}finally{this.flights.delete(operationId);}
  }
}
function actorArgs(handler:(actor:string,args:any)=>unknown|Promise<unknown>){return (actor:string,_attempt:string,_key:string,args:any)=>handler(actor,args);}
