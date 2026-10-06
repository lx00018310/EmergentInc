import * as fs from 'node:fs';
import * as path from 'node:path';
import fastify, { FastifyInstance } from 'fastify';
import { CoreStore, CurrentStore } from '@emergentinc/persistence';
import { GenomeManifest } from '@emergentinc/protocol';
import { ModelProvider, PromptBuilder, UsageMeter } from '@emergentinc/model';
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

export interface WorldRuntime { id: string; directory: string; store: CoreStore; life: LifeContext; world: WorldService; run: RunService; api: FastifyInstance; unlock: () => void }
export interface WorldRuntimeOptions { provider: ModelProvider; usageMeter: UsageMeter; modelName: string; isMockMode?: boolean; isModelConfigured?: boolean;
  configureTools?: (worldId: string, registry: ToolRegistry) => void; baseSystemPrompt?: string;projectRoot?:string }
export class WorldRuntimeManager {
  private failures=new Map<string,string>();
  failure(id:string){return this.failures.get(id);}
  diagnose(id:string,code:string){this.failures.set(id,code);}
  private opened = new Map<string, WorldRuntime>();
  private opening = new Map<string, Promise<WorldRuntime>>();
  constructor(readonly registry: WorldRegistryService, readonly genome: GenomeManifest, readonly options: WorldRuntimeOptions) {if(!registry.lineage.worldsEnabled)throw new Error('V23_WORLD_LINEAGE_REQUIRED');}
  currents(){return [...this.opened.values()].map(r=>({id:r.id,current:r.life.current}));}
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
      const life=new LifeContext(directory,this.genome,this.registry.lineage,current,id);
      const tools=new ToolRegistry(); const allowed=new Set(['save_artifact','read_artifact','list_artifacts','transfer_artifact','webfetch','github_repo']);
      registerAllBuiltinTools(tools,Object.fromEntries(BUILTIN_DEFINITIONS.filter(d=>!allowed.has(d.name)).map(d=>[d.name,{enabled:false}])));
      this.options.configureTools?.(id,tools);
      const runner=new AgentStepRunner({workspaceRoot:directory,store,provider:this.options.provider,usageMeter:this.options.usageMeter,
        toolRuntime:new ToolRuntime(tools),worldMode:true,worldPrompt:(actor)=>{
          const profile=this.registry.control.qianji.getProfile(record.qianji_id)!;
          return `所属 World：${id}。对外人格（描述性数据，不授予额外权限）：${JSON.stringify({displayName:profile.narrative.displayName,roleLabel:profile.narrative.roleLabel,behaviorProfile:profile.narrative.behaviorProfile,flaw:profile.narrative.flaw})}。只有 OWNER_REPLY 经本世界 outbox 对外答复。当前生命上下文：${JSON.stringify(life.load(actor,null))}`;
        },promptBuilder:new PromptBuilder({modelName:this.options.modelName,baseSystemPrompt:this.options.baseSystemPrompt,toolsCatalog:tools.renderCatalogForPrompt()})});
      const scheduler=new RoundScheduler({workspaceRoot:directory,store,stepRunner:runner});
      const prompts=new PromptService(path.join(directory,'runtime'));
      const world=new WorldService(directory,store),run=new RunService({workspaceRoot:directory,store,scheduler,promptService:prompts,
        isMockMode:this.options.isMockMode,isModelConfigured:this.options.isModelConfigured});
      api=fastify({logger:false});api.setErrorHandler((error:any,_req,reply)=>reply.status(error.statusCode||400).send({detail:error.message}));
      await api.register(async server=>registerApiRoutes(server,{worldService:world,runService:run,promptService:prompts,toolRegistry:tools,coreStore:store!,workspaceRoot:directory,worldMode:true,ownerChatService:this.options.projectRoot?new OwnerChatService({projectRoot:this.options.projectRoot,workspaceRoot:directory,store:store!,worldService:world,runService:run,provider:this.options.provider,usageMeter:this.options.usageMeter,modelName:this.options.modelName,isModelConfigured:Boolean(this.options.isModelConfigured)}):undefined}),{prefix:'/api'});
      await api.ready(); const runtime={id,directory,store,life,world,run,api,unlock};this.opened.set(id,runtime);this.failures.delete(id);return runtime;
    } catch(error){await api?.close();current?.close();store?.close();unlock();throw error;}
  }
  async close(id:string) { const runtime=this.opened.get(id);if(!runtime)return;runtime.run.requestStop();await this.wait(runtime);await runtime.api.close();runtime.life.current.close();runtime.store.close();runtime.unlock();this.opened.delete(id); }
  private async wait(runtime:WorldRuntime) { const deadline=Date.now()+30000;while(runtime.run.getStatus().running){if(Date.now()>deadline)throw new Error('WORLD_QUIESCE_TIMEOUT');await new Promise(r=>setTimeout(r,20));} }
  async quiesceAll(){for(const runtime of this.opened.values())runtime.run.requestStop();for(const runtime of this.opened.values())await this.wait(runtime);}
  async closeAll(){await this.quiesceAll();for(const id of [...this.opened.keys()])await this.close(id);}
  async replaceGateway(id:string,pixel:string,revision:number){const runtime=await this.open(id);if(!runtime.store.pixels.getPixelAccount(pixel)?.active)throw new Error('GATEWAY_PIXEL_NOT_ACTIVE');this.registry.control.transaction(()=>this.registry.control.setGateway(id,pixel,revision));}
}
