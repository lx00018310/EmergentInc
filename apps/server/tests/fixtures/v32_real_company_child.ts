import {resolve,join} from 'node:path';
import * as fs from 'node:fs';
import {LineageStore,WorldRegistryStore} from '@emergentinc/persistence';
import {OpenAICompatibleProvider,UsageMeter} from '@emergentinc/model';
import {WorldRegistryService} from '../../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../../src/services/world_runtime_manager.js';
import {OwnerAutomationGate} from '../../src/services/owner_automation_gate.js';
import {OwnerWorkService} from '../../src/services/owner_work_service.js';
import {OwnerGoalScheduler} from '../../src/services/owner_goal_scheduler.js';
const [root,goalId,mode,clock]=process.argv.slice(2),project=resolve('.');
if(!process.env.EMERGENTINC_TEST_REAL_COMPANY_BUDGET_CNY||!process.env.MCL_API_KEY)throw new Error('EXPLICIT_REAL_VERIFICATION_BUDGET_REQUIRED');
if(clock)Date.now=()=>Number(clock); // Explicit accelerated timer in the isolated verification only.
const lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true}),control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
const meter=new UsageMeter(JSON.parse(fs.readFileSync(join(project,'resources/config/model_pricing.json'),'utf8'))),provider=new OpenAICompatibleProvider({baseUrl:process.env.MCL_BASE_URL!,apiKey:process.env.MCL_API_KEY!,timeoutMs:120000,maxRetries:0});
let work:OwnerWorkService;
const manager=new WorldRuntimeManager(registry,{schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}},{provider,usageMeter:meter,modelName:process.env.MCL_MODEL!,isMockMode:false,isModelConfigured:true,projectRoot:project,configureTools:(id,tools)=>work.registerTools(tools,id)});
const gate=new OwnerAutomationGate(control);manager.attachAutomation(gate);work=new OwnerWorkService(manager);const scheduler=new OwnerGoalScheduler(manager,work,gate);
try{
  await manager.resumeInterrupted();await scheduler.tick();const deadline=performance.now()+300000;
  for(;;){
    await work.tick();
    if(mode==='first'&&work.view().tasks.some(t=>t.state==='REPLIED')&&!manager.list().some(w=>w.running))break;
    if(mode!=='first')await scheduler.tick();
    const plan=gate.proposals.plans.get(goalId)!;
    if(mode!=='first'&&plan.nodes.every(n=>n.occurrences>=(n.trigger.kind==='interval'&&mode==='timer'?2:1))&&!manager.list().some(w=>w.running))break;
    const goal=gate.goals.get(goalId);if(['BLOCKED','FAILED','STOPPED'].includes(goal.status)||!gate.isOn())throw new Error(goal.reason??gate.view().reason??'VERIFICATION_BLOCKED');
    if(performance.now()>deadline)throw new Error('REAL_VERIFICATION_TIMEOUT');await new Promise(r=>setTimeout(r,100));
  }
  process.stdout.write(JSON.stringify({mode,goal:gate.goals.get(goalId),plan:gate.proposals.plans.get(goalId),budget:gate.budget.view()})+'\n');
}finally{await scheduler.close();await work.close();await manager.closeAll();control.close();lineage.close();}
