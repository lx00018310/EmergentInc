import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import { LineageStore, WorldRegistryStore, writeGenerationPointer } from '@emergentinc/persistence';
import { UsageMeter, type ModelProvider } from '@emergentinc/model';
import type { PreparedModelRequest } from '@emergentinc/protocol';
import { WorldRegistryService } from '../../src/services/world_registry_service.js';
import { WorldRuntimeManager } from '../../src/services/world_runtime_manager.js';
import { OwnerWorkService } from '../../src/services/owner_work_service.js';
import { OwnerAutomationGate } from '../../src/services/owner_automation_gate.js';
import { OwnerGoalScheduler } from '../../src/services/owner_goal_scheduler.js';
import { PaymentService } from '../../src/services/payment_service.js';
import { PaymentMonitor } from '../../src/services/payment_monitor.js';
import { GenePromotionService } from '../../src/services/gene_promotion_service.js';

export function goalFixture() {
  const root=fs.mkdtempSync(join(tmpdir(),'v29-goals-'));
  const lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
  lineage.createGeneration({id:'G0001',number:1,geneHash:'1'.repeat(64),releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(root,'system'),'G0001');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
  const person=(name:string,role:string)=>registry.create({displayName:name,title:null,roleLabel:role,traits:{},behaviorProfile:[role],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=person('Research','research'),b=person('Marketing','marketing');
  const calls:PreparedModelRequest[]=[];
  let respond:(r:PreparedModelRequest)=>Promise<any>=async()=>({rawText:JSON.stringify({owner_reply:'A report is not proof of business success.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});
  const provider:ModelProvider={call:async(r)=>{calls.push(r);return respond(r);}};
  const meter=new UsageMeter({models:{test:{input_cost_per_million:1,output_cost_per_million:2,cached_cost_per_million:1,currency:'CNY'}}});
  let work:OwnerWorkService,maintenance=false;
  const manager=new WorldRuntimeManager(registry,{schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}},{provider,usageMeter:meter,modelName:'test',isMockMode:true,isModelConfigured:true,configureTools:(id,tools)=>work.registerTools(tools,id)});
  const gate=new OwnerAutomationGate(control);manager.attachAutomation(gate,()=>maintenance);
  work=new OwnerWorkService(manager,()=>maintenance);
  const payments=new PaymentService(join(root,'system/payment/payment.sqlite3'),control,lineage),scheduler=new OwnerGoalScheduler(manager,work,gate,payments);
  const worlds={manager,promotion:new GenePromotionService(manager,root,lineage),payments,monitor:new PaymentMonitor(payments),provider,meter,modelName:'test',ownerWork:work};
  const on=(rounds:number|null=7,_legacyTokens=10_000_000,key=crypto.randomUUID())=>{if(gate.budget.view().activatedAt===null)gate.budget.authorize(100_000_000);return gate.control({desiredMode:'ON',expectedRevision:gate.view().revision,idempotencyKey:key});};
  const off=()=>gate.control({desiredMode:'OFF',expectedRevision:gate.view().revision,idempotencyKey:crypto.randomUUID()});
  const goal=(title='Research draft',kind:'artifact'|'manual'='artifact')=>gate.goals.create({title,objective:title,maxTokens:1_000_000,acceptance:kind==='artifact'?{kind,filename:'result.md',minBytes:10}:{kind,description:'Three real customers with independently verified payment evidence'},idempotencyKey:crypto.randomUUID()});
  const finish=async()=>{await vi.waitFor(async()=>{await work.tick();await scheduler.tick();expectIdle();},{timeout:8000,interval:10});};
  function expectIdle(){if(manager.list().some(w=>w.running)||control.db.prepare("SELECT 1 FROM owner_goal_dispatches d JOIN owner_goals g ON g.id=d.goal_id WHERE d.state IN ('QUEUED','RUNNING') AND g.status IN ('RUNNING','READY')").get())throw new Error('Still advancing');}
  const close=async(preserve=false)=>{off();await scheduler.close();await work.close();await manager.closeAll();payments.close();control.close();lineage.close();if(!preserve)fs.rmSync(root,{recursive:true,force:true});};
  return {root,registry,lineage,control,manager,gate,work,scheduler,worlds,payments,a,b,calls,meter,provider,on,off,goal,finish,close,respond:(fn:typeof respond)=>respond=fn,maintenance:(v:boolean)=>maintenance=v};
}
