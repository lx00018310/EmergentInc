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
