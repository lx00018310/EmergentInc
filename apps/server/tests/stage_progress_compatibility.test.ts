import {afterEach,expect,it} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {goalFixture} from './fixtures/owner_goals.js';
import {checkOwnerAutomationRollback} from '../../../supervisor/owner_automation_compatibility.js';
import {classifyChange} from '../../../supervisor/protocol.js';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
it('retains existing records and denies a target that cannot enforce approved partial-progress rules',()=>{
  const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Keep the original data','manual');
  f.gate.proposals.plans.install(goal.id,{summary:'An ordinary internal draft',nodes:[{key:'draft',title:'Draft',instruction:'Retain real content',filename:'result.md',trigger:{kind:'once'},dependsOn:[],progressPolicy:{requirements:[{id:'fact',description:'Required actual text',contains:'ACTUAL_FACT'}],passPercent:80,allowIncompleteFrom:[]}}]});
  const target=join(f.root,'compatible-release'),services=join(target,'apps/server/dist/services'),resources=join(target,'resources/config');
  fs.mkdirSync(services,{recursive:true});fs.mkdirSync(resources,{recursive:true});
  for(const name of ['owner_automation_gate','owner_company_budget','owner_task_plan_service'])fs.writeFileSync(join(services,name+'.js'),'// Fixture protocol presence only.');
  const file=join(resources,'company_protocol.json'),contract={workspace_format:34,task_workflow:1,company_money:2,currency:'CNY',money_unit:'micros'};
  fs.writeFileSync(file,JSON.stringify(contract));expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).toThrow('COMPANY_ROLLBACK_DENIED_TASK_PROGRESS');
  fs.writeFileSync(file,JSON.stringify({...contract,task_progress:1}));fs.writeFileSync(join(services,'company_progress_service.js'),'// Fixture protocol presence only.');
  expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).not.toThrow();
  expect(f.gate.goals.get(goal.id).specificationRevision).toBe(1);expect(f.gate.proposals.plans.get(goal.id)!.approved).toBe(false);expect(f.gate.view().desiredMode).toBe('OFF');
  expect(classifyChange(['apps/server/src/services/company_progress_service.ts'])).toBe('ROOT');
});
