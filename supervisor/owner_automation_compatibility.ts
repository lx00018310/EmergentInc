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
    if(Number(db.prepare('PRAGMA user_version').get()!.user_version)===34&&contract?.workspace_format!==34)throw new Error('V34_ROLLBACK_DENIED_WORKSPACE_FORMAT');
    if(table('owner_company_budget')){
      const money=db.prepare('SELECT schema_version,activated_at FROM owner_company_budget WHERE id=1').get();
      if(money&&(money.activated_at!==null||Number(money.schema_version)>=2)&&(!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_company_budget.js'))||![1,2].includes(Number(money.schema_version))||!Number.isSafeInteger(contract?.company_money)||contract.company_money<Number(money.schema_version)||contract.currency!=='CNY'||contract.money_unit!=='micros'))throw new Error('V32_ROLLBACK_DENIED_COMPANY_BUDGET');
    }
    if(table('owner_task_plans')&&db.prepare('SELECT 1 FROM owner_task_plans LIMIT 1').get()&&(!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_task_plan_service.js'))||!table('owner_task_schema')||db.prepare('SELECT version FROM owner_task_schema WHERE id=1').get()!.version!==1||contract?.task_workflow!==1))throw new Error('V32_ROLLBACK_DENIED_TASK_WORKFLOW');
    const progressFacts=table('company_progress_scopes')&&Boolean(db.prepare('SELECT 1 FROM company_progress_scopes LIMIT 1').get())||table('owner_task_plans')&&Boolean(db.prepare("SELECT 1 FROM owner_task_plans WHERE json_extract(body,'$.ownerInstructions') IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(body,'$.nodes') n WHERE json_extract(n.value,'$.progressPolicy') IS NOT NULL) LIMIT 1").get());
    if(progressFacts&&(contract?.task_progress!==1||!fs.existsSync(path.join(directory,'apps/server/dist/services/company_progress_service.js'))))throw new Error('COMPANY_ROLLBACK_DENIED_TASK_PROGRESS');
    if(table('company_execution_attempts')&&db.prepare('SELECT 1 FROM company_execution_attempts LIMIT 1').get()&&(!table('company_execution_schema')||db.prepare('SELECT version FROM company_execution_schema WHERE id=1').get()!.version!==1||contract?.company_execution!==1||contract?.scoped_admission!==1||!fs.existsSync(path.join(directory,'apps/server/dist/services/company_execution_service.js'))||!fs.existsSync(path.join(directory,'apps/server/dist/services/company_admission_service.js'))))throw new Error('COMPANY_ROLLBACK_DENIED_EXECUTION_PROTOCOL');
    if(table('company_admission_blocks')&&db.prepare('SELECT 1 FROM company_admission_blocks LIMIT 1').get()&&(contract?.scoped_admission!==1||!fs.existsSync(path.join(directory,'apps/server/dist/services/company_admission_service.js'))))throw new Error('COMPANY_ROLLBACK_DENIED_ADMISSION_PROTOCOL');
    const protocols=[
      ['company_worker_launches','company_workers','COMPANY_ROLLBACK_DENIED_WORKER_PROTOCOL',['services/company_worker_adapter','services/company_goal_scheduler','execution/company_worker_entry','execution/company_worker_engine','execution/company_worker_journal','execution/company_worker_lock']],
      ['company_agents','company_agents','COMPANY_ROLLBACK_DENIED_AGENT_PROTOCOL',['services/company_agent_service']],
      ['company_model_dispatches','company_model_receipts','COMPANY_ROLLBACK_DENIED_MODEL_RECEIPTS',['services/company_model_ledger']],
      ['company_artifacts','company_artifacts','COMPANY_ROLLBACK_DENIED_ARTIFACT_PROTOCOL',['services/company_artifact_service']],
      ['company_legacy_artifacts','company_artifacts','COMPANY_ROLLBACK_DENIED_ARTIFACT_PROTOCOL',['services/company_artifact_service']],
      ['company_controller_tools','company_tools','COMPANY_ROLLBACK_DENIED_TOOL_RECEIPTS',['services/company_tool_service']]
    ] as const;
    for(const [name,flag,error,modules] of protocols)if(table(name)&&db.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get()&&(contract?.[flag]!== (flag==='company_workers'?3:1)||modules.some(file=>!fs.existsSync(path.join(directory,'apps/server/dist',file+'.js')))))throw new Error(error);
    if(table('company_execution_reviews')&&db.prepare('SELECT 1 FROM company_execution_reviews LIMIT 1').get()&&(contract?.company_recovery!==1||!fs.existsSync(path.join(directory,'apps/server/dist/services/company_recovery_service.js'))))throw new Error('COMPANY_ROLLBACK_DENIED_RECOVERY_PROTOCOL');
    if(table('company_control_migrations')&&db.prepare('SELECT 1 FROM company_control_migrations LIMIT 1').get()&&(contract?.company_control_plane!==1||['company_legacy_adapter','company_migration_service'].some(file=>!fs.existsSync(path.join(directory,'apps/server/dist/services',file+'.js')))))throw new Error('COMPANY_ROLLBACK_DENIED_CONTROL_PLANE');
    if(facts&&!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_automation_gate.js')))throw new Error('V29_ROLLBACK_DENIED_AUTOMATION_CONTROL');
  }finally{db.close();}
}
