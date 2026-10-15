import {expect,it} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorldRegistryStore} from '@emergentinc/persistence';
import {OwnerAutomationGate} from '../src/services/owner_automation_gate.js';
import {checkOwnerAutomationRollback} from '../../../supervisor/owner_automation_compatibility.js';
import {classifyChange} from '../../../supervisor/protocol.js';
it('blocks rollback to a release without the gate once Owner has made a V29 decision, retaining OFF and every ledger row',()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'v29-rollback-')),store=new WorldRegistryStore(join(root,'control.sqlite3')),gate=new OwnerAutomationGate(store),release=join(root,'older-release');
  try{
    expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).not.toThrow();
    gate.control({desiredMode:'OFF',expectedRevision:0,idempotencyKey:crypto.randomUUID()});
    expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).toThrow('V29_ROLLBACK_DENIED_AUTOMATION_CONTROL');
    expect(gate.view().desiredMode).toBe('OFF');expect(store.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_automation_changed'").get()!.n).toBe(1);
    fs.mkdirSync(join(release,'apps/server/dist/services'),{recursive:true});fs.writeFileSync(join(release,'apps/server/dist/services/owner_automation_gate.js'),'// Compatible gate module presence; release integrity is checked separately by Supervisor.');
    expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).not.toThrow();expect(classifyChange(['apps/server/src/services/owner_automation_gate.ts'])).toBe('ROOT');
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});
it('rejects a commit without the exact money protocol even when a similarly named service exists',()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'v32-money-contract-')),store=new WorldRegistryStore(join(root,'control.sqlite3')),gate=new OwnerAutomationGate(store),release=join(root,'release');
  try{
    gate.budget.authorize(1000000);fs.mkdirSync(join(release,'apps/server/dist/services'),{recursive:true});for(const name of ['owner_automation_gate','owner_company_budget'])fs.writeFileSync(join(release,'apps/server/dist/services',name+'.js'),'// Fixture module presence only.');
    expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).toThrow('V32_ROLLBACK_DENIED_COMPANY_BUDGET');fs.mkdirSync(join(release,'resources/config'),{recursive:true});fs.writeFileSync(join(release,'resources/config/company_protocol.json'),JSON.stringify({company_money:1,currency:'CNY',money_unit:'micros'}));expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).not.toThrow();expect(gate.budget.view().totalMicros).toBe(1000000);
    store.db.prepare('UPDATE owner_company_budget SET schema_version=2').run();expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).toThrow('V32_ROLLBACK_DENIED_COMPANY_BUDGET');
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});
it('retains pending task records and refuses a target without their workflow protocol',()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'v32-task-contract-')),store=new WorldRegistryStore(join(root,'control.sqlite3')),gate=new OwnerAutomationGate(store),release=join(root,'release');
  try{
    const goal=gate.goals.create({title:'Retain task',objective:'Retain the exact task',acceptance:{kind:'manual',description:'Owner reviews the artifact'},idempotencyKey:'workflow-contract-fixture'});gate.proposals.plans.install(goal.id,{summary:'Produce one internal artifact',nodes:[{key:'deliver',title:'Deliver',instruction:'Retain an actual artifact',dependsOn:[],trigger:{kind:'once'},filename:'result.md'}]});
    fs.mkdirSync(join(release,'apps/server/dist/services'),{recursive:true});for(const name of ['owner_automation_gate','owner_task_plan_service'])fs.writeFileSync(join(release,'apps/server/dist/services',name+'.js'),'// Fixture module presence only.');expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).toThrow('V32_ROLLBACK_DENIED_TASK_WORKFLOW');
    fs.mkdirSync(join(release,'resources/config'),{recursive:true});fs.writeFileSync(join(release,'resources/config/company_protocol.json'),JSON.stringify({task_workflow:1}));expect(()=>checkOwnerAutomationRollback(store.db.dbPath,release)).not.toThrow();expect(gate.proposals.plans.get(goal.id)?.approved).toBe(false);
  }finally{store.close();fs.rmSync(root,{recursive:true,force:true});}
});
