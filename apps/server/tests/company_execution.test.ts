import { afterEach, describe, expect, it } from 'vitest';
import { WorldRegistryStore } from '@emergentinc/persistence';
import type { CompanyExecutionReceipt } from '@emergentinc/protocol';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { CompanyExecutionService } from '../src/services/company_execution_service.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { checkOwnerAutomationRollback } from '../../../supervisor/owner_automation_compatibility.js';
import * as fs from 'node:fs';
import { join } from 'node:path';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
function fixture() {
  const f=goalFixture();cleanups.push(f.close);f.on();
  f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('task','request',?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(f.a.qianji_id,'Research','Retain an internal draft',Date.now(),Date.now());
  const command=f.work.execution.claim('task',f.a.world_id,1,1);
  const event=(sequence:number,kind:CompanyExecutionReceipt['kind'],extra:Partial<CompanyExecutionReceipt>={}):CompanyExecutionReceipt=>({schema:1,eventId:`event-${sequence}`,attemptId:command.attemptId,fence:command.fence,sequence,kind,...extra});
  return {...f,command,event};
}
describe('company execution controller',()=>{
  it('atomically keeps one claim/outbox across competing database connections, and allows only one launcher',()=>{
    const f=fixture(),otherStore=new WorldRegistryStore(f.control.db.dbPath);cleanups.push(async()=>otherStore.close());
    const other=new CompanyExecutionService(new OwnerAutomationGate(otherStore));
    expect(other.claim('task',f.a.world_id,1,1)).toEqual(f.command);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_execution_attempts').get()!.n).toBe(1);
    expect(f.work.execution.pending()).toHaveLength(1);
    expect(()=>other.takeDispatch(f.command.attemptId)).toThrow('OWNER_ATTEMPT_STALE');
    expect(f.work.execution.takeDispatch(f.command.attemptId)).toBe(true);
    expect(f.work.execution.takeDispatch(f.command.attemptId)).toBe(false);
  });
  it('buffers out-of-order receipts, applies each contiguous fact once, and rejects conflicting delivery',()=>{
    const f=fixture(),done=f.event(2,'completed',{reply:'Actual retained result'}),started=f.event(1,'started');
    expect(f.work.execution.receipt(done).state).toBe('DISPATCH_PENDING');
    const final=f.work.execution.receipt(started);expect(final.state).toBe('COMPLETED');
    expect(f.work.view().tasks[0]).toMatchObject({state:'REPLIED',runId:f.command.runId,reply:'Actual retained result'});
    expect(f.work.execution.receipt(done)).toEqual(final);
    expect(f.work.execution.receipt(started)).toEqual(final);
    expect(()=>f.work.execution.receipt({...done,reply:'Changed result'})).toThrow('OWNER_RECEIPT_CONFLICT');
    expect(()=>f.work.execution.receipt(f.event(3,'failed',{reason:'Late obsolete error'}))).toThrow('OWNER_ATTEMPT_TERMINAL');
    expect(f.work.execution.get(final.id)).toEqual(final);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_receipt_inbox').get()!.n).toBe(2);
  });
  it('fences obsolete attempts after a fresh authorized claim',()=>{
    const f=fixture();f.work.execution.receipt(f.event(1,'failed',{reason:'Proven request not sent'}));f.gate.cancelRun(f.command.runId);
    f.control.db.prepare("UPDATE owner_work_tasks SET state='QUEUED',run_id=NULL WHERE id='task'").run();
    const next=f.work.execution.claim('task',f.a.world_id,1,1);expect(next.fence).toBe(f.command.fence+1);
    expect(()=>f.work.execution.receipt(f.event(2,'completed',{reply:'Obsolete worker result'}))).toThrow('OWNER_ATTEMPT_STALE');
    expect(f.work.execution.forTask('task')!.id).toBe(next.attemptId);
    expect(f.work.view().tasks[0].state).toBe('QUEUED');
  });
  it('settles a late fee without rewriting the terminal delivery or manual OFF',()=>{
    const f=fixture();f.work.execution.receipt(f.event(1,'started'));f.gate.runCreated(f.command.runId);
    f.control.db.prepare("INSERT INTO owner_model_permits VALUES('late','initial',?,NULL,NULL,'UNKNOWN',200,NULL,NULL,?)").run(f.a.world_id,Date.now());
    f.gate.budget.reserve('late',516);f.work.execution.bindPermit('late',f.command.runId);
    const final=f.work.execution.receipt(f.event(2,'completed',{reply:'Already delivered'}));expect(final.accountingState).toBe('PENDING');
    f.gate.finished(f.command.runId,false);f.off();
    f.gate.reconcileCall('late',{actualTokens:30,costCny:0.00004,reason:'Verified provider receipt for the original call',expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()});
    expect(f.work.execution.get(final.id)).toMatchObject({state:'COMPLETED',accountingState:'SETTLED'});
    expect(f.work.view().tasks[0].reply).toBe('Already delivered');
    expect(f.gate.view().desiredMode).toBe('OFF');expect(f.gate.budget.view().reservedMicros).toBe(0);expect(f.gate.budget.view().spentMicros).toBe(40);
  });
  it('rolls back the task claim and outbox when authority or worker ownership fails',()=>{
    const f=fixture();
    f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('second','request2',?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(f.a.qianji_id,'Research','Other work',Date.now(),Date.now());
    expect(()=>f.work.execution.claim('second',f.a.world_id,1,1)).toThrow();
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_execution_attempts').get()!.n).toBe(1);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_run_permits').get()!.n).toBe(1);
    f.off();expect(()=>f.work.execution.claim('second',f.b.world_id,1,1)).toThrow('OWNER_AUTOMATION_OFF');
    expect(f.work.execution.pending()).toHaveLength(1);
  });
  it('refuses an older controller that cannot preserve execution ownership, without deleting its ledger',()=>{
    const f=fixture(),target=join(f.root,'rollback-code'),services=join(target,'apps/server/dist/services');
    fs.mkdirSync(services,{recursive:true});fs.mkdirSync(join(target,'resources/config'),{recursive:true});
    for(const file of ['owner_company_budget','owner_automation_gate'])fs.writeFileSync(join(services,file+'.js'),'// fixture module');
    const contract={workspace_format:34,company_money:2,currency:'CNY',money_unit:'micros'};
    fs.writeFileSync(join(target,'resources/config/company_protocol.json'),JSON.stringify(contract));
    expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).toThrow('COMPANY_ROLLBACK_DENIED_EXECUTION_PROTOCOL');
    for(const file of ['company_execution_service','company_admission_service'])fs.writeFileSync(join(services,file+'.js'),'// fixture module');
    fs.writeFileSync(join(target,'resources/config/company_protocol.json'),JSON.stringify({...contract,company_execution:1,scoped_admission:1}));
    expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).not.toThrow();
    expect(f.work.execution.get(f.command.attemptId).state).toBe('DISPATCH_PENDING');expect(f.work.execution.pending()).toHaveLength(1);
  });
  it('reclaims a prepared dispatch only after the adapter proves no private run exists',async()=>{
    const f=fixture();f.work.execution.takeDispatch(f.command.attemptId);
    await f.manager.open(f.a.world_id);
    expect(f.work.execution.get(f.command.attemptId)).toMatchObject({state:'INTERRUPTED',reason:'OWNER_DISPATCH_NOT_STARTED'});
    expect(f.work.view().tasks[0]).toMatchObject({state:'QUEUED',runId:null});
    expect(f.calls).toHaveLength(0);
    await f.work.tick();await f.finish();
    expect(f.work.view().tasks[0]).toMatchObject({state:'REPLIED'});expect(f.calls).toHaveLength(1);
    expect(f.work.execution.forTask('task')?.fence).toBe(2);
  });
});
