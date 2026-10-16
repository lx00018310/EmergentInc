import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** A pre-V29 release cannot enforce persisted Goal/OFF authorizations. Never discard their ledger to allow rollback. */
export function checkOwnerAutomationRollback(controlFile:string,directory:string){
  if(!fs.existsSync(controlFile))return;
  const db=new DatabaseSync(controlFile,{readOnly:true});
  try{
    const table=(name:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    const facts=table('owner_goals')&&Boolean(db.prepare('SELECT 1 FROM owner_goals LIMIT 1').get()) ||
      table('owner_run_permits')&&Boolean(db.prepare('SELECT 1 FROM owner_run_permits LIMIT 1').get()) ||
      table('control_events')&&Boolean(db.prepare("SELECT 1 FROM control_events WHERE kind='owner_automation_changed' LIMIT 1").get());
    const file=path.join(directory,'resources/config/company_protocol.json');let contract:any=null;if(fs.existsSync(file)){try{contract=JSON.parse(fs.readFileSync(file,'utf8'));}catch{contract=null;}}
    if(table('owner_company_budget')){
      const money=db.prepare('SELECT schema_version,activated_at FROM owner_company_budget WHERE id=1').get();
      if(money&&(money.activated_at!==null||Number(money.schema_version)>=2)&&(!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_company_budget.js'))||![1,2].includes(Number(money.schema_version))||!Number.isSafeInteger(contract?.company_money)||contract.company_money<Number(money.schema_version)||contract.currency!=='CNY'||contract.money_unit!=='micros'))throw new Error('V32_ROLLBACK_DENIED_COMPANY_BUDGET');
    }
    if(table('owner_task_plans')&&db.prepare('SELECT 1 FROM owner_task_plans LIMIT 1').get()&&(!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_task_plan_service.js'))||!table('owner_task_schema')||db.prepare('SELECT version FROM owner_task_schema WHERE id=1').get()!.version!==1||contract?.task_workflow!==1))throw new Error('V32_ROLLBACK_DENIED_TASK_WORKFLOW');
    if(facts&&!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_automation_gate.js')))throw new Error('V29_ROLLBACK_DENIED_AUTOMATION_CONTROL');
  }finally{db.close();}
}
