import * as fs from 'node:fs';
import * as path from 'node:path';
import { CoreStore,CurrentStore,LineageStore,WorldRegistryStore,readGenome } from '@emergentinc/persistence';
import { OpenAICompatibleProvider,UsageMeter,ModelProvider } from '@emergentinc/model';
import { runtimeConfig } from './runtime_config.js';
import { createServer } from './app.js';
import { LifeContext } from './services/life_context.js';
import { WorldRegistryService } from './services/world_registry_service.js';
import { WorldRuntimeManager } from './services/world_runtime_manager.js';
import { GenePromotionService } from './services/gene_promotion_service.js';
import { PaymentService } from './services/payment_service.js';
import { PaymentMonitor } from './services/payment_monitor.js';
import { registerWorldTools } from './services/world_tools.js';
import { BusinessService } from './services/business_service.js';
import { BusinessConnections } from './services/business_connections.js';
import { BodyGrowthService } from './services/body_growth_service.js';
import { DreamService } from './services/dream_service.js';
import { MemoryGate } from './services/memory_gate.js';

/** V23 is an explicit workspace format. Never reinterpret a V22 database at normal startup. */
export async function bootstrapWorlds(projectRoot:string,config:ReturnType<typeof runtimeConfig>,unlock:()=>void){
  const workspace=config.workspaceRoot,system=path.join(workspace,'system'),candidate=process.env.EMERGENTINC_CANDIDATE_MODE==='1';
  const layout=JSON.parse(fs.readFileSync(path.join(workspace,'workspace-layout.json'),'utf8'));
  if(layout.schema!==1||layout.version!==23)throw new Error('UNSUPPORTED_WORKSPACE_LAYOUT');
  const {manifest,geneHash}=readGenome(projectRoot);
  for(const file of ['lineage/lineage.sqlite3','control/control.sqlite3'])if(!fs.existsSync(path.join(system,file)))throw new Error('V23_REQUIRED_DATABASE_MISSING');
  const lineage=new LineageStore(path.join(system,'lineage/lineage.sqlite3'),{v23:true});
  const control=new WorldRegistryStore(path.join(system,'control/control.sqlite3'));
  const registry=new WorldRegistryService(workspace,control,lineage,manifest.body_interface_version,candidate?undefined:process.env.EMERGENTINC_ACTIVE_GENERATION_FILE),active=registry.effectiveGeneration();
  if(active.gene_hash!==geneHash||active.release_id!==(process.env.EMERGENTINC_RELEASE_ID??active.release_id))throw new Error('ACTIVE_GENOME_MISMATCH: V23 requires an approved generation upgrade');
  const current=new CurrentStore(path.join(system,'generations',String(active.id),'current.sqlite3'));
  if(current.meta().gene_hash!==geneHash||current.meta().generation_id!==active.id||current.meta().release_id!==active.release_id)throw new Error('GLOBAL_CURRENT_IDENTITY_CONFLICT');
  const life=new LifeContext(system,{...manifest,generation:Number(active.generation_no)},lineage,current),modelName=process.env.MCL_DECISION_MODEL||process.env.MCL_MODEL||'gpt-4o-mini';
  const modelConfigured=!candidate&&Boolean(process.env.MCL_API_KEY && process.env.MCL_API_KEY!=='mock-key' && !process.env.MCL_API_KEY.includes('CONFIGURE_ME'));
  const mock=!candidate&&(process.argv.includes('--mock')||process.env.EMERGENT_MOCK_MODE==='1');
  const provider:ModelProvider=modelConfigured?new OpenAICompatibleProvider({baseUrl:process.env.MCL_BASE_URL||'https://api.openai.com/v1',apiKey:process.env.MCL_API_KEY!}):{
    async call(){if(!mock)throw new Error('MODEL_NOT_CONFIGURED');return {rawText:JSON.stringify({message_md:'[MOCK_SANDBOX] World runtime ready',send_to:'STOP'}),usage:{promptTokens:50,completionTokens:20}};}};
  const usageMeter=new UsageMeter(JSON.parse(fs.readFileSync(path.join(projectRoot,'resources/config/model_pricing.json'),'utf8')));
  const pricingFile=path.join(workspace,'private/business_model_pricing.json'),prices=!candidate&&fs.existsSync(pricingFile)?JSON.parse(fs.readFileSync(pricingFile,'utf8')):{models:{}};
  const business=new BusinessService(lineage,modelConfigured?provider:undefined,modelName,prices.models?.[modelName],candidate?undefined:new BusinessConnections(lineage,path.join(workspace,'private/business-connections')));
  const body=new BodyGrowthService(life);business.attachLife(life,body);
  const payments=new PaymentService(path.join(system,'payment/payment.sqlite3'),control,lineage),monitor=new PaymentMonitor(payments);
  let promotion:GenePromotionService;
  const manager=new WorldRuntimeManager(registry,{...manifest,generation:Number(active.generation_no)},{provider,usageMeter,modelName,isModelConfigured:modelConfigured,isMockMode:mock,
    projectRoot,baseSystemPrompt:fs.readFileSync(path.join(projectRoot,'resources/prompts/v9_system_prompt.md'),'utf8'),configureTools:(id,tools)=>registerWorldTools(tools,id,promotion,payments)});
  promotion=new GenePromotionService(manager,projectRoot,lineage);
  for(const world of manager.list().filter(w=>w.status==='ACTIVE'&&!w.blockedReason)){
    try{await manager.open(world.world_id);}catch(error){const e=error as any;if(candidate||!['WORLD_ACTIVE_CURRENT_MISSING','CURRENT_NOT_INITIALIZED','WORLD_ACTIVE_GENOME_MISMATCH','WORLD_IDENTITY_CONFLICT','WORLD_CORE_MISSING'].includes(e.message)&&!['ERR_SQLITE_ERROR'].includes(e.code))throw error;manager.diagnose(world.world_id,e.code==='ERR_SQLITE_ERROR'?'WORLD_DATABASE_UNAVAILABLE':e.message);}
  }
  const dream=new DreamService(life,candidate?undefined:business.lifeModel.bind(business),process.env.EMERGENTINC_DREAM_TIME,process.env.EMERGENTINC_DREAM_TIMEZONE,()=>manager.currents());
  const memoryGate=new MemoryGate(lineage,()=>String(current.meta().generation_id));
  let paused=candidate||process.env.EMERGENTINC_START_PAUSED==='1'||active.state!=='ACTIVE';
  const preparePromotion=async(proposalId:string)=>{
    const row=lineage.db.prepare('SELECT id,snapshot_hash,kind FROM gene_promotion_candidates WHERE proposal_id=?').get(proposalId);if(!row)return;
    const file=path.join(system,'evolution/requests',proposalId+'.json');if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
    const next=Number(lineage.db.prepare('SELECT MAX(generation_no)+1 n FROM generations').get()!.n),patch=await promotion.buildPatch(String(row.id),`${row.kind}_${String(row.snapshot_hash).slice(0,24)}`,next,async input=>JSON.parse(await business.lifeModel("body",`gene-generalize-${row.id}`,input)));
    const request={id:'gene_'+String(row.snapshot_hash).slice(0,16)+'_'+proposalId.slice(-12),base_generation:active.id,base_release:active.release_id,proposal_id:proposalId,patch:patch.patch};
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(request,null,2),{flag:'wx'});return request;
  };
  const evolution={life,body,dream,memoryGate,onProposalApproved:preparePromotion,beforeProposalDecision:(id:string,decision:string)=>{
    const candidate=lineage.db.prepare('SELECT state FROM gene_promotion_candidates WHERE proposal_id=?').get(id);if(decision==='APPROVED'&&candidate&&candidate.state!=='GENE_CANDIDATE')throw new Error('PROMOTION_POLICY_REVIEW_REQUIRED');
  },worldOverview:()=>manager.list().map(row=>{const current=manager.currents().find(w=>w.id===row.world_id)?.current;return {...row,...(current?{current:current.meta(),skills:current.skills()}: {})};}),
    quiesced:()=>paused,recoveryOrigin:process.env.EMERGENTINC_RECOVERY_ORIGIN,
    quiesce:async()=>{paused=true;await manager.quiesceAll();await monitor.stop();await dream.stop();await business.stop();},
    resume:async()=>{if(candidate||lineage.activeGeneration()?.id!==current.meta().generation_id)throw new Error('GENERATION_NOT_ACTIVE');if(!paused)return;paused=false;promotion.reconcileInherited();monitor.start();dream.start();business.start({exclusiveWorkspaceLockHeld:true});}};
  const legacyFile=path.join(system,'legacy/v22/snapshots/ledger/v9_core.sqlite3'),legacy=fs.existsSync(legacyFile)?new CoreStore(legacyFile,{readOnly:true}):undefined;
  const app=await createServer({workspaceRoot:workspace,runtimeMode:'business',ownerAuth:config.ownerAuth,trustLoopbackProxy:config.trustLoopbackProxy,development:process.env.EMERGENT_DEV==='1',allowedOrigins:(process.env.EMERGENT_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean),businessService:business,evolution,
    worlds:{manager,promotion,payments,monitor,legacy,provider:modelConfigured?provider:undefined,meter:usageMeter,modelName},frontendDistDir:path.join(projectRoot,'frontend/dist')});
  app.addHook('onClose',async()=>{paused=true;await monitor.stop();await dream.stop();await business.stop();await manager.closeAll();legacy?.close();payments.close();control.close();life.close();unlock();});
  for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close();});
  await app.listen({port:Number(process.env.PORT||8765),host:config.host});
  if(!paused){promotion.reconcileInherited();payments.deliverMemories();monitor.start();dream.start();business.start({exclusiveWorkspaceLockHeld:true});}
  console.log(`[EmergentInc V23] ${active.id}, ${registry.list().length} Worlds, http://${config.host}:${process.env.PORT||8765}`);
  return app;
}
