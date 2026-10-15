import * as fs from 'node:fs';
import { join } from 'node:path';
import { LineageStore, WorldRegistryStore } from '@emergentinc/persistence';
import { UsageMeter } from '@emergentinc/model';
import { WorldRegistryService } from '../../src/services/world_registry_service.js';
import { WorldRuntimeManager } from '../../src/services/world_runtime_manager.js';
import { OwnerAutomationGate } from '../../src/services/owner_automation_gate.js';
import { OwnerWorkService } from '../../src/services/owner_work_service.js';
import { OwnerGoalScheduler } from '../../src/services/owner_goal_scheduler.js';

const [root,mode]=process.argv.slice(2),lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
const gate=new OwnerAutomationGate(control);
const halt=(worldId:string)=>{fs.writeFileSync(join(root,'recovery-ready.json'),JSON.stringify({worldId,runId:control.db.prepare('SELECT run_id FROM owner_run_permits LIMIT 1').get()!.run_id}));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
let work:OwnerWorkService,worldId='';
const manager=new WorldRuntimeManager(registry,{schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}},{modelName:'test',isMockMode:true,isModelConfigured:true,
  usageMeter:new UsageMeter({models:{test:{input_cost_per_million:1,output_cost_per_million:2,cached_cost_per_million:1,currency:'CNY'}}}),
  provider:{async call(){if(mode==='unknown')halt(worldId);return {rawText:JSON.stringify({operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Immutable draft persisted before a real process kill.'}}],send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}};}},configureTools:(id,tools)=>work.registerTools(tools,id)});
manager.attachAutomation(gate);work=new OwnerWorkService(manager);
for(const row of manager.list()){
  const runtime=await manager.open(row.world_id),commit=runtime.store.messages.commitMessage.bind(runtime.store.messages);
  runtime.store.messages.commitMessage=(id,runId)=>{if(mode==='off')gate.control({desiredMode:'OFF',expectedRevision:gate.view().revision,idempotencyKey:crypto.randomUUID()});halt(row.world_id);commit(id,runId);};
}
// Unknown mode stops before a core result receipt exists.
if(mode==='unknown'){
  const original=manager.options.provider.call;
  manager.options.provider.call=async(...args)=>{worldId=String(control.db.prepare('SELECT world_id FROM owner_run_permits LIMIT 1').get()!.world_id);return original(...args);};
}
gate.budget.authorize(100000000);gate.control({desiredMode:'ON',runMode:'BOUNDED',requestedRounds:7,expectedRevision:gate.view().revision,idempotencyKey:crypto.randomUUID()});
await new OwnerGoalScheduler(manager,work,gate).tick();
