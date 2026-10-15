import * as fs from 'node:fs';
import * as path from 'node:path';
import fastify, { FastifyInstance } from 'fastify';
import { CoreStore, CurrentStore } from '@emergentinc/persistence';
import { GenomeManifest } from '@emergentinc/protocol';
import { InfrastructureFailureError, ModelProvider, PromptBuilder, UsageMeter } from '@emergentinc/model';
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools, BUILTIN_DEFINITIONS } from '@emergentinc/tools';
import { AgentStepRunner, RoundScheduler } from '@emergentinc/runtime';
import { WorldRegistryService } from './world_registry_service.js';
import {OwnerChatService} from './owner_chat_service.js';
import { WorldService } from './world_service.js';
import { RunService } from './run_service.js';
import { PromptService } from './prompt_service.js';
import { LifeContext } from './life_context.js';
import { acquireWorkspaceLock } from '../runtime_config.js';
import { registerApiRoutes } from '../routes/api_routes.js';
import type { OwnerAutomationGate } from './owner_automation_gate.js';
import { InstanceExtensionService } from './instance_extension_service.js';

export interface WorldRuntime { id: string; directory: string; store: CoreStore; life: LifeContext; world: WorldService; run: RunService; api: FastifyInstance; unlock: () => void }
export interface WorldRuntimeOptions { provider: ModelProvider; usageMeter: UsageMeter; modelName: string; isMockMode?: boolean; isModelConfigured?: boolean;
  configureTools?: (worldId: string, registry: ToolRegistry) => void; baseSystemPrompt?: string;projectRoot?:string }
export class WorldRuntimeManager {
  automation?: OwnerAutomationGate;
  attachAutomation(gate: OwnerAutomationGate, maintenance: () => boolean = () => false) {
    this.automation = gate;
    gate.attach(maintenance, () => { for (const runtime of this.opened.values()) runtime.run.requestSuspend(); },
      () => [...this.opened.values()].some(r => { const u = r.store.getUnfinalizedOperations(); return u.unknownCalls.length > 0 || (u.startedToolExecutions.length > 0 || u.callingMessages.some(m=>['CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT'].includes(m.status)) || Boolean(r.store.db.prepare("SELECT 1 FROM effects WHERE status IN ('PENDING','UNKNOWN')").get())) && !r.run.getStatus().running; }));
    for (const r of this.opened.values()) r.run.automation = { gate, worldId: r.id };
  }
  private failures=new Map<string,string>();
  failure(id:string){return this.failures.get(id);}
  diagnose(id:string,code:string){this.failures.set(id,code);}
  private opened = new Map<string, WorldRuntime>();
  private opening = new Map<string, Promise<WorldRuntime>>();
  private recoveryEnabled = false;
  constructor(readonly registry: WorldRegistryService, readonly genome: GenomeManifest, readonly options: WorldRuntimeOptions) {if(!registry.lineage.worldsEnabled)throw new Error('V23_WORLD_LINEAGE_REQUIRED');}
  currents(){return [...this.opened.values()].map(r=>({id:r.id,current:r.life.current}));}
  peek(id:string){return this.opened.get(id);}
  async extensions(id:string){const runtime=await this.open(id);return new InstanceExtensionService(runtime.directory,id,this.genome.capability_contracts);}
  list() { return this.registry.list().map(row=>({...row,runtimeFailure:this.failures.get(row.world_id)??null,blockedReason:this.registry.control.db.prepare('SELECT reason FROM world_recovery_blocks WHERE world_id=?').get(row.world_id)?.reason??null, opened:this.opened.has(row.world_id), running:this.opened.get(row.world_id)?.run.getStatus().running??false})); }
  async open(id: string): Promise<WorldRuntime> {
    const old=this.opened.get(id); if(old)return old;
    const pending=this.opening.get(id); if(pending)return pending;
    const promise=this.create(id);this.opening.set(id,promise);
    try { return await promise; } finally { this.opening.delete(id); }
  }
  private async create(id: string) {
    if(this.registry.control.db.prepare('SELECT world_id FROM world_recovery_blocks WHERE world_id=?').get(id))throw new Error('WORLD_GENERATION_RECOVERY_REQUIRED');
    const record=this.registry.control.world(id);if(record.status!=='ACTIVE')throw new Error('WORLD_NOT_ACTIVE');
    const directory=this.registry.directory(id), identity=JSON.parse(fs.readFileSync(path.join(directory,'world.json'),'utf8'));
    if(identity.world_id!==id||identity.qianji_id!==record.qianji_id)throw new Error('WORLD_IDENTITY_CONFLICT');
    const unlock=acquireWorkspaceLock(directory);let store: CoreStore|undefined,current:CurrentStore|undefined,api:FastifyInstance|undefined;
    try {
      const active=this.registry.effectiveGeneration();
      const currentFile=path.join(directory,'generations',String(active.id),'current.sqlite3');if(!fs.existsSync(currentFile))throw new Error('WORLD_ACTIVE_CURRENT_MISSING');
      current=new CurrentStore(currentFile);
      const meta=current.meta();if(meta.generation_id!==active.id||meta.gene_hash!==active.gene_hash||meta.release_id!==active.release_id)throw new Error('WORLD_ACTIVE_GENOME_MISMATCH');
      const coreFile=path.join(directory,'ledger/v9_core.sqlite3');if(!fs.existsSync(coreFile))throw new Error('WORLD_CORE_MISSING');
      store=new CoreStore(coreFile);
      store.budgets.useCompanyMoneyBudget(runId=>Boolean(this.automation&&this.registry.control.db.prepare('SELECT 1 FROM owner_run_permits WHERE run_id=? AND world_id=?').get(runId,id)));
      store.db.exec(`CREATE TABLE IF NOT EXISTS world_chat_continuations(message_id TEXT PRIMARY KEY REFERENCES messages(message_id), turn_id TEXT NOT NULL REFERENCES world_chat_inbox(turn_id), parent_message_id TEXT NOT NULL REFERENCES messages(message_id));
        CREATE INDEX IF NOT EXISTS world_chat_continuations_turn ON world_chat_continuations(turn_id);`);
      store.setUnlimitedEnergyPolicy(pixelId=>(!this.automation||this.automation.isOn())&&(this.registry.control.gatewayInfiniteEnergy(id)||Boolean(this.automation&&this.registry.control.db.prepare("SELECT 1 FROM owner_run_permits WHERE world_id=? AND goal_id IS NOT NULL AND state='ACTIVE'").get(id)))&&this.registry.control.world(id).gateway_pixel_id===pixelId);
      const life=new LifeContext(directory,this.genome,this.registry.lineage,current,id);
      const tools=new ToolRegistry(); const allowed=new Set(['save_artifact','read_artifact','list_artifacts','transfer_artifact','webfetch','github_repo']);
      registerAllBuiltinTools(tools,Object.fromEntries(BUILTIN_DEFINITIONS.filter(d=>!allowed.has(d.name)).map(d=>[d.name,{enabled:false}])));
      this.options.configureTools?.(id,tools);
      const provider: ModelProvider = { call: (request, signal) => (this.automation ? this.automation.provider(this.options.provider, this.options.usageMeter, id,'world') : this.options.provider).call(request, signal) };
      const runner=new AgentStepRunner({workspaceRoot:directory,store,provider,usageMeter:this.options.usageMeter,
        beforeStep:input=>{
          if(!this.automation)return;
          const origin=store!.db.prepare('SELECT turn_id FROM world_chat_inbox WHERE message_id=? UNION SELECT turn_id FROM world_chat_continuations WHERE message_id=?').get(input.message.messageId,input.message.messageId);
          if(!origin)return;
          if(!this.registry.control.db.prepare('SELECT 1 FROM world_chat_turns WHERE turn_id=? AND world_id=?').get(origin.turn_id,id))throw new InfrastructureFailureError('OWNER_CHAT_RECOVERY_REQUIRED');
          const linked=this.registry.control.db.prepare('SELECT d.goal_id,d.goal_revision FROM owner_goal_dispatches d JOIN owner_work_tasks t ON t.id=d.task_id WHERE t.turn_id=?').get(origin.turn_id);
          const binding=this.automation.binding(input.trace.runId);
          if(Boolean(linked)!==Boolean(binding)||linked&&binding&&(linked.goal_id!==binding.goalId||linked.goal_revision!==binding.specificationRevision))throw new InfrastructureFailureError('OWNER_GOAL_PERMISSION_CHANGED');
        },
        toolRuntime:new ToolRuntime(tools, (name,ctx,effect) => {this.automation?.assertTool(id,name,effect);const binding=this.automation?.binding(ctx.runId);if(binding)ctx.artifactEvidenceScope=`owner-${binding.dispatchId}`;}),worldMode:true,
        shouldSuspend: () => Boolean(this.automation && (!this.automation.isOn() || (this.opened.get(id)?.run.getStatus().run_id && !this.automation.mayContinue(this.opened.get(id)!.run.getStatus().run_id)))),worldPrompt:(actor)=>{
          const profile=this.registry.control.qianji.getProfile(record.qianji_id)!;
          const infiniteEnergy=this.registry.control.gatewayInfiniteEnergy(id)&&this.registry.control.world(id).gateway_pixel_id===actor;
          return `所属 World：${id}。${infiniteEnergy?'Owner 已为当前对话入口开启无限能量，缺少能量时会自动补充；其他元胞不享有此授权。是否向邻居输送能量，仍由你按成本收益判断。执行授权和实际计费继续有效。':''}${this.automation?'所有 AI 调用共享公司人民币总预算，Token 只计量；内部执行切片由任务循环接续。人工 OFF、未知结果和维护继续阻断，不能自行扩大金额授权。':''}对外人格（描述性数据，不授予额外权限）：${JSON.stringify({displayName:profile.narrative.displayName,roleLabel:profile.narrative.roleLabel,behaviorProfile:profile.narrative.behaviorProfile,flaw:profile.narrative.flaw})}。只有 OWNER_REPLY 经本世界 outbox 对外答复。Owner 任务应实际执行并报告产出，不把承诺当成果。缺少合适负责人时使用 REQUEST_RECRUIT 提交职责、理由和初始任务，等待 Owner 批准。私有纯计算程序优先使用 LIST_EXTENSIONS、SUBMIT_EXTENSION、RUN_EXTENSION，独立保存在本 World，不改变 Core 或 Generation；Markdown 方法继续使用 LIST_SKILLS / READ_SKILL。真正修正内核时才使用 LIST_APP_SOURCE、READ_APP_SOURCE、SUBMIT_APP_CODE 修改 8765 候选源码并单独报告 Owner；8766 源码及共享模块禁止访问和修改，源码生效需要独立软件升级批准。若工具目录提供 LIST_RELEASE_VERSIONS、ROLLBACK_RELEASE、DELETE_RELEASE，只能查看版本元数据；回退和删除必须由 Owner 在独立维护界面明确确认，公司运行开关不授予维护权限。权限不足时直接向 Owner 报告阻碍，不能用招聘申请绕过禁止修改区。多步工作使用工具反馈或 SELF 继续，完成后由入口 OWNER_REPLY 回报。当前生命上下文：${JSON.stringify(life.load(actor,null))}`;
        },promptBuilder:new PromptBuilder({modelName:this.options.modelName,baseSystemPrompt:this.options.baseSystemPrompt,toolsCatalog:tools.renderCatalogForPrompt()})});
      const scheduler=new RoundScheduler({workspaceRoot:directory,store,stepRunner:runner});
      const prompts=new PromptService(path.join(directory,'runtime'));
      const world=new WorldService(directory,store),run=new RunService({workspaceRoot:directory,store,scheduler,promptService:prompts,
        isMockMode:this.options.isMockMode,isModelConfigured:this.options.isModelConfigured});
      if(this.automation)run.automation={gate:this.automation,worldId:id};
      api=fastify({logger:false});api.setErrorHandler((error:any,_req,reply)=>reply.status(error.statusCode||400).send({detail:error.message}));
      await api.register(async server=>registerApiRoutes(server,{worldService:world,runService:run,promptService:prompts,toolRegistry:tools,coreStore:store!,workspaceRoot:directory,worldMode:true,ownerChatService:this.options.projectRoot?new OwnerChatService({projectRoot:this.options.projectRoot,workspaceRoot:directory,store:store!,worldService:world,runService:run,provider,usageMeter:this.options.usageMeter,modelName:this.options.modelName,isModelConfigured:Boolean(this.options.isModelConfigured)}):undefined}),{prefix:'/api'});
      await api.ready(); const runtime={id,directory,store,life,world,run,api,unlock};this.opened.set(id,runtime);this.failures.delete(id);
      this.automation?.reconcileWorld(store,id);
      if(this.automation)for(const permit of this.registry.control.db.prepare('SELECT run_id FROM owner_run_permits WHERE world_id=?').all(id)) {
        const prior=store.db.prepare('SELECT run_id FROM runs WHERE run_id=?').get(permit.run_id);
        if(!prior){
          this.automation.cancelRun(String(permit.run_id));
          if(this.registry.control.db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_work_tasks'").get())this.registry.control.db.prepare("UPDATE owner_work_tasks SET state='QUEUED',run_id=NULL,reason=NULL WHERE run_id=? AND state='RUNNING'").run(permit.run_id);
          this.registry.control.db.prepare("UPDATE owner_goal_dispatches SET state='QUEUED',run_id=NULL WHERE run_id=?").run(permit.run_id);
          this.registry.control.db.prepare('UPDATE world_chat_turns SET run_id=NULL WHERE run_id=? AND reply IS NULL').run(permit.run_id);
        }
        else {const checkpoint=store.runs.getCheckpoint(String(permit.run_id));this.automation.reconcileRun(String(permit.run_id),(checkpoint?.next_round??0)-1,Boolean(checkpoint?.resume_pending));}
      }
      if(this.recoveryEnabled)await run.resumeInterrupted();
      return runtime;
    } catch(error){await api?.close();current?.close();store?.close();unlock();throw error;}
  }
  async close(id:string) { const runtime=this.opened.get(id);if(!runtime)return;runtime.run.requestSuspend();await this.wait(runtime);await runtime.api.close();runtime.life.current.close();runtime.store.close();runtime.unlock();this.opened.delete(id); }
  private async wait(runtime:WorldRuntime) { const deadline=Date.now()+30000;while(runtime.run.getStatus().running){if(Date.now()>deadline)throw new Error('WORLD_QUIESCE_TIMEOUT');await new Promise(r=>setTimeout(r,20));} }
  async resumeInterrupted(){this.recoveryEnabled=true;for(const runtime of this.opened.values())await runtime.run.resumeInterrupted();}
  async quiesceAll(){this.recoveryEnabled=false;for(const runtime of this.opened.values())runtime.run.requestSuspend();for(const runtime of this.opened.values())await this.wait(runtime);}
  async closeAll(){await this.quiesceAll();for(const id of [...this.opened.keys()])await this.close(id);}
  async replaceGateway(id:string,pixel:string,revision:number){const runtime=await this.open(id);if(!runtime.store.pixels.getPixelAccount(pixel)?.active)throw new Error('GATEWAY_PIXEL_NOT_ACTIVE');this.registry.control.transaction(()=>this.registry.control.setGateway(id,pixel,revision));}
}
