import {DatabaseSync,backup} from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import type {OwnerWorkService} from './owner_work_service.js';
import type {PaymentService} from './payment_service.js';
import {CompanyLegacyAdapter} from './company_legacy_adapter.js';
import {companyProcessBirth} from '../execution/company_worker_lock.js';
import {containedPath} from './safe_path.js';
import {companyFactHash} from './company_fact_hash.js';

const hash=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const preserved=['owner_company_proposals','owner_control_requests','owner_recruit_requests','owner_money_reservations','owner_goal_revisions','owner_task_plans','owner_task_plan_versions','owner_work_run_limits','orders','public_products'];
interface MigrationSnapshot {schema:1;files:{relative:string;sha256:string}[];preserved:Record<string,string>;paymentPreserved:Record<string,string>;control:{desired_mode:unknown;reason:unknown};explicitIntent:string|null;explicitEventId:number|null;pending:{id:unknown;state:unknown;reserved_micros:unknown;actual_tokens:unknown;cost_cny:unknown}[]}
function table(db:{prepare:DatabaseSync['prepare']},name:string){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));}
function tableHash(db:{prepare:DatabaseSync['prepare']},name:string){return companyFactHash(db.prepare(`SELECT * FROM ${name}`).all().map(r=>JSON.stringify(r)).sort());}
function directory(workspace:string){return containedPath(workspace,'system','migrations','company-control-v1');}
function readSnapshot(workspace:string){const root=directory(workspace),file=containedPath(root,'before.json'),manifest=JSON.parse(fs.readFileSync(containedPath(root,'before.sha256.json'),'utf8'));if(hash(file)!==manifest.sha256)throw new Error('COMPANY_MIGRATION_SNAPSHOT_CHANGED');const snapshot=JSON.parse(fs.readFileSync(file,'utf8')) as MigrationSnapshot;if(snapshot.schema!==1)throw new Error('COMPANY_MIGRATION_SCHEMA_UNSUPPORTED');for(const f of snapshot.files)if(hash(containedPath(root,...f.relative.split('/')))!==f.sha256)throw new Error('COMPANY_MIGRATION_SNAPSHOT_CHANGED');return snapshot;}

/** Called with the instance lock held and before constructing controllers that mutate recovery state. */
export async function prepareCompanyMigration(workspace:string){
  const file=containedPath(workspace,'system','control','control.sqlite3'),db=new DatabaseSync(file,{readOnly:true});
  try{
    if(table(db,'company_control_migrations')&&db.prepare("SELECT 1 FROM company_control_migrations WHERE version=1 AND state='COMPLETE'").get())return;
    const root=directory(workspace);if(fs.existsSync(root)){if(!fs.existsSync(containedPath(root,'before.json')))throw new Error('COMPANY_MIGRATION_SNAPSHOT_INCOMPLETE');readSnapshot(workspace);return;}
    const worlds=db.prepare('SELECT world_id,workspace_relpath FROM qianji_worlds ORDER BY world_id').all();
    for(const w of worlds){const lock=containedPath(workspace,...String(w.workspace_relpath).split('/'),'runtime','instance.lock');if(fs.existsSync(lock)){const pid=JSON.parse(fs.readFileSync(lock,'utf8')).pid;if(await companyProcessBirth(pid))throw new Error('OWNER_PREVIOUS_WORKER_STILL_ALIVE');}}
    if(table(db,'company_worker_launches'))for(const w of db.prepare("SELECT pid,process_birth FROM company_worker_launches WHERE state NOT IN ('READY','EXITED') AND pid IS NOT NULL").all()){const birth=await companyProcessBirth(Number(w.pid));if(birth&&(typeof w.process_birth!=='string'||birth===w.process_birth))throw new Error('OWNER_PREVIOUS_WORKER_STILL_ALIVE');}
    fs.mkdirSync(root,{recursive:true});
    const sources=['system/control/control.sqlite3','system/payment/payment.sqlite3','system/lineage/lineage.sqlite3',...worlds.map(w=>String(w.workspace_relpath)+'/ledger/v9_core.sqlite3')],files=[] as MigrationSnapshot['files'];
    for(const relative of sources){const source=containedPath(workspace,...relative.split('/')),target=containedPath(root,...relative.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});const input=new DatabaseSync(source,{readOnly:true});try{await backup(input,target);}finally{input.close();}const copied=new DatabaseSync(target,{readOnly:true});try{if(copied.prepare('PRAGMA integrity_check').get()!.integrity_check!=='ok')throw new Error('COMPANY_MIGRATION_SNAPSHOT_INVALID');}finally{copied.close();}files.push({relative,sha256:hash(target)});}
    const control=table(db,'owner_automation_control')?db.prepare('SELECT desired_mode,reason FROM owner_automation_control WHERE id=1').get()!:{desired_mode:'OFF',reason:null},event=db.prepare("SELECT id,payload FROM control_events WHERE kind='owner_automation_changed' ORDER BY id DESC LIMIT 1").get();
    const paymentCopy=new DatabaseSync(containedPath(root,'system','payment','payment.sqlite3'),{readOnly:true});let paymentPreserved:Record<string,string>;
    try{paymentPreserved=Object.fromEntries(paymentCopy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'payment_%' ORDER BY name").all().map(r=>[String(r.name),tableHash(paymentCopy,String(r.name))]));}finally{paymentCopy.close();}
    const pending=table(db,'owner_model_permits')?db.prepare("SELECT p.id,p.state,r.reserved_micros,p.actual_tokens,p.cost_cny FROM owner_model_permits p LEFT JOIN owner_money_reservations r ON r.permit_id=p.id WHERE p.state IN ('SENT','UNKNOWN') ORDER BY p.id").all():[];
    const snapshot:MigrationSnapshot={schema:1,files,paymentPreserved,preserved:Object.fromEntries(preserved.filter(n=>table(db,n)).map(n=>[n,tableHash(db,n)])),control:{desired_mode:control.desired_mode,reason:control.reason},explicitIntent:event?JSON.parse(String(event.payload)).desiredMode??null:null,explicitEventId:event?Number(event.id):null,pending:pending as MigrationSnapshot['pending']};
    const before=containedPath(root,'before.json');fs.writeFileSync(before,JSON.stringify(snapshot,null,2),{flag:'wx',mode:0o600});fs.writeFileSync(containedPath(root,'before.sha256.json'),JSON.stringify({sha256:hash(before)}),{flag:'wx',mode:0o600});
  }finally{db.close();}
}
export function activateCompanyControl(work:OwnerWorkService,environment:Record<string,string|undefined>,payments:PaymentService){
  const {control}=work.manager.registry,db=control.db,workspace=work.manager.registry.workspace,gate=work.manager.automation!;
  const already=table(db,'company_control_migrations')&&db.prepare("SELECT 1 FROM company_control_migrations WHERE version=1 AND state='COMPLETE'").get();
  const snapshot=already?undefined:readSnapshot(workspace);
  if(snapshot&&!snapshot.paymentPreserved)throw new Error('COMPANY_MIGRATION_SNAPSHOT_INCOMPLETE');
  control.transaction(()=>{
    work.enableWorkers(environment,payments);work.legacy=new CompanyLegacyAdapter(work.manager,work.execution);
    if(already)return;
    work.legacy.migrate();
    for(const [name,expected] of Object.entries(snapshot!.preserved))if(tableHash(db,name)!==expected)throw new Error('COMPANY_MIGRATION_DATA_CHANGED');
    for(const [name,expected] of Object.entries(snapshot!.paymentPreserved))if(tableHash(payments.db as any,name)!==expected)throw new Error('COMPANY_MIGRATION_DATA_CHANGED');
    for(const p of snapshot!.pending){const current=db.prepare('SELECT p.state,r.reserved_micros,p.actual_tokens,p.cost_cny FROM owner_model_permits p LEFT JOIN owner_money_reservations r ON r.permit_id=p.id WHERE p.id=?').get(p.id as string);if(!current||current.reserved_micros!==p.reserved_micros||current.actual_tokens!==p.actual_tokens||current.cost_cny!==p.cost_cny||p.state==='UNKNOWN'&&current.state!=='UNKNOWN')throw new Error('COMPANY_MIGRATION_MONEY_CHANGED');}
    // Only the old automatic unknown-outcome OFF may recover an explicit retained ON intent.
    const latest=db.prepare("SELECT id FROM control_events WHERE kind='owner_automation_changed' ORDER BY id DESC LIMIT 1").get();
    if(snapshot!.control.desired_mode==='OFF'&&snapshot!.control.reason==='OWNER_OUTCOME_REVIEW_REQUIRED'&&snapshot!.explicitIntent==='ON'&&(latest?Number(latest.id):null)===snapshot!.explicitEventId){
      db.prepare("UPDATE owner_automation_control SET desired_mode='ON',reason=NULL,revision=revision+1,updated_at=? WHERE id=1 AND desired_mode='OFF' AND reason='OWNER_OUTCOME_REVIEW_REQUIRED'").run(Date.now());
      db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('company_legacy_intent_migrated',NULL,?,?)").run(JSON.stringify({source:'last explicit owner_automation_changed',desiredMode:'ON'}),Date.now());
    }
    if(gate.budget.view().availableMicros>0)db.prepare('UPDATE owner_company_budget SET refill_required=0 WHERE id=1 AND refill_required=1').run();
    db.exec("CREATE TABLE IF NOT EXISTS company_control_migrations(version INTEGER PRIMARY KEY,state TEXT NOT NULL,report_json TEXT NOT NULL,created_at INTEGER NOT NULL)");
    const report={version:1,snapshotDirectory:'system/migrations/company-control-v1',preserved:snapshot!.preserved,paymentPreserved:snapshot!.paymentPreserved,pending:snapshot!.pending,agents:work.agents!.list().length,legacyRuns:Number(db.prepare('SELECT COUNT(*) n FROM company_legacy_runs').get()!.n),desiredMode:gate.view().desiredMode};
    db.prepare("INSERT INTO company_control_migrations VALUES(1,'COMPLETE',?,?)").run(JSON.stringify(report),Date.now());
  });
}
