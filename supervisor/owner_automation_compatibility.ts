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
    if(facts&&!fs.existsSync(path.join(directory,'apps/server/dist/services/owner_automation_gate.js')))throw new Error('V29_ROLLBACK_DENIED_AUTOMATION_CONTROL');
  }finally{db.close();}
}
