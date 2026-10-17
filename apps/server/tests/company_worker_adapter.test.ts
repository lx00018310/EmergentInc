import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { BUILTIN_DEFINITIONS } from '@emergentinc/tools';
import { listenTestHttp } from '../../../tests/http_port.js';
import { CompanyWorkerAdapter } from '../src/services/company_worker_adapter.js';
import { CompanyExecutionService } from '../src/services/company_execution_service.js';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { GoalOutcomeEvaluator } from '../src/services/goal_outcome_evaluator.js';
import { createServer as createApplication } from '../src/app.js';
import * as fs from 'node:fs';
import { join } from 'node:path';
import type { GoalRunBinding } from '../src/services/owner_automation_gate.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { checkOwnerAutomationRollback } from '../../../supervisor/owner_automation_compatibility.js';
import { resolve } from 'node:path';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();});
async function fixture(hangFirst=false,missingFirstUsage=false) {
  const f=goalFixture();cleanups.push(f.close);f.on();let calls=0,first!:()=>void;const requested=new Promise<void>(r=>first=r);
  const server=createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;first();if(hangFirst&&calls===1)return;
    const n=calls-(hangFirst?1:0),value=n%2?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Artifact produced with actual company money authorization.'}}],send_to:'STOP'}:{owner_reply:'The actual company draft is retained.',send_to:'STOP'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],...missingFirstUsage&&calls===1?{}:{usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}}));
  });});const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const adapter=new CompanyWorkerAdapter(f.work.execution,{workspace:f.root,meter:f.meter,environment:{MCL_API_KEY:'explicit-fake-provider-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'10000'},spec:command=>({schema:1,attemptId:command.attemptId,taskId:command.taskId,runId:command.runId,fence:command.fence,agent:{id:f.a.qianji_id,name:'Research',role:'research'},instruction:command.instruction,model:'test',maxSteps:4,maxOutputTokens:512,notSentRetries:1,tools:BUILTIN_DEFINITIONS.filter(t=>['save_artifact','read_artifact','list_artifacts'].includes(t.name))}),artifact:(...args)=>f.work.artifacts.record(...args)});
  cleanups.push(()=>adapter.close());
  function task(id='task-real-ledger',binding?:GoalRunBinding) {f.control.db.prepare("INSERT INTO owner_work_tasks VALUES(?,?,?,'Research',?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(id,id,f.a.qianji_id,'Retain an actual company draft',Date.now(),Date.now());if(binding){f.control.db.prepare("INSERT INTO owner_goal_steps VALUES(?,?,?,?,'QUEUED',0,?)").run(binding.dispatchId,binding.goalId,binding.specificationRevision,id,Date.now());f.control.db.prepare("INSERT INTO owner_goal_dispatches VALUES(?,?,?,?,NULL,?,'QUEUED',NULL)").run(binding.dispatchId,binding.goalId,binding.specificationRevision,id,f.a.world_id);}return adapter.create(id,f.a.world_id,4,binding);}
  return {...f,adapter,task,requested,calls:()=>calls};
}
describe('real company ledger with independent process adapter',()=>{
  it('rejects rollback to a controller without independent worker or model-receipt support',async()=>{
    const f=await fixture(),command=f.task(),target=join(f.root,'rollback-code'),services=join(target,'apps/server/dist/services');
    fs.mkdirSync(services,{recursive:true});fs.mkdirSync(join(target,'resources/config'),{recursive:true});
    for(const name of ['owner_company_budget','owner_automation_gate','company_execution_service','company_admission_service'])fs.writeFileSync(join(services,name+'.js'),'// fixture module');
    const contract=JSON.parse(fs.readFileSync(resolve('resources/config/company_protocol.json'),'utf8'));
    fs.writeFileSync(join(target,'resources/config/company_protocol.json'),JSON.stringify({...contract,company_workers:undefined}));
    expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).toThrow('COMPANY_ROLLBACK_DENIED_WORKER_PROTOCOL');
    fs.writeFileSync(join(target,'resources/config/company_protocol.json'),JSON.stringify(contract));
    expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).toThrow('COMPANY_ROLLBACK_DENIED_WORKER_PROTOCOL');
    for(const name of ['services/company_worker_adapter','services/company_goal_scheduler','services/company_model_ledger','execution/company_worker_entry','execution/company_worker_engine','execution/company_worker_journal','execution/company_worker_lock']){const file=join(target,'apps/server/dist',name+'.js');fs.mkdirSync(join(file,'..'),{recursive:true});fs.writeFileSync(file,'// fixture module');}
    expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).not.toThrow();
    fs.writeFileSync(join(target,'resources/config/company_protocol.json'),JSON.stringify({...contract,company_model_receipts:undefined}));expect(()=>checkOwnerAutomationRollback(f.control.db.dbPath,target)).toThrow('COMPANY_ROLLBACK_DENIED_MODEL_RECEIPTS');
    expect(f.work.execution.get(command.attemptId).state).toBe('DISPATCH_PENDING');expect(f.gate.budget.view().reservedMicros).toBeGreaterThan(0);expect(f.calls()).toBe(0);
  });
  it('reserves before launch and converges Task, Attempt and money from actual worker receipts',async()=>{
    const f=await fixture(),command=f.task();expect(f.calls()).toBe(0);expect(f.gate.budget.view().reservedMicros).toBeGreaterThan(0);
    expect(f.work.execution.pending()).toHaveLength(1);await f.adapter.start(command.attemptId);await f.adapter.wait(command.attemptId);
    expect(f.work.view().tasks[0]).toMatchObject({state:'REPLIED',reply:'The actual company draft is retained.'});
    expect(f.work.execution.get(command.attemptId)).toMatchObject({state:'COMPLETED',accountingState:'SETTLED'});
    expect(f.gate.budget.view()).toMatchObject({spentMicros:80,reservedMicros:0});expect(f.calls()).toBe(2);
    expect(f.gate.view()).toMatchObject({startedRounds:1,completedRounds:1,reservedRounds:0});
    const before=f.gate.budget.view();await f.adapter.recover(command.attemptId);expect(f.gate.budget.view()).toEqual(before);expect(f.calls()).toBe(2);
  },15000);
  it('rolls back claim, queue and money together when the first call is unaffordable',async()=>{
    const f=await fixture();f.control.db.prepare('UPDATE owner_company_budget SET total_micros=1').run();
    expect(()=>f.task()).toThrow('OWNER_COMPANY_BUDGET_EXHAUSTED');
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_execution_attempts').get()!.n).toBe(0);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_dispatch_outbox').get()!.n).toBe(0);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_model_permits').get()!.n).toBe(0);expect(f.calls()).toBe(0);
  });
  it('preserves a real unknown charge after a kill and permits an independent task for the same agent',async()=>{
    const f=await fixture(true),first=f.task();await f.adapter.start(first.attemptId);await f.requested;
    (f.adapter as any).live.get(first.attemptId).child.kill('SIGKILL');await f.adapter.wait(first.attemptId);
    const held=f.gate.budget.view().reservedMicros;expect(held).toBeGreaterThan(0);expect(f.gate.view().desiredMode).toBe('ON');
    expect(f.work.execution.get(first.attemptId)).toMatchObject({state:'BLOCKED',accountingState:'PENDING',reason:'CALL_OUTCOME_UNKNOWN'});
    const second=f.task('independent-task');await f.adapter.start(second.attemptId);await f.adapter.wait(second.attemptId);
    expect(f.work.execution.get(second.attemptId).state).toBe('COMPLETED');expect(f.calls()).toBe(3);
    expect(f.gate.budget.view()).toMatchObject({reservedMicros:held,spentMicros:80});
  },15000);
  it.each(['disconnect','kill'] as const)('retains a paid response across %s, respects OFF, and resumes without another first-step fee',async mode=>{
    const f=await fixture(),command=f.task(),response=f.gate.models.response.bind(f.gate.models);let interrupted=false;
    vi.spyOn(f.gate.models,'response').mockImplementation((...args)=>{response(...args);if(!interrupted){interrupted=true;if(mode==='kill')(f.adapter as any).live.get(command.attemptId).child.kill('SIGKILL');else f.adapter.disconnect(command.attemptId);}});
    await f.adapter.start(command.attemptId);await f.adapter.wait(command.attemptId);
    expect(f.work.execution.get(command.attemptId).state).toBe('SUSPENDED');expect(f.calls()).toBe(1);expect(f.gate.budget.view().spentMicros).toBe(40);
    f.off();await expect(f.adapter.start(command.attemptId)).rejects.toThrow('OWNER_AUTOMATION_OFF');expect(f.calls()).toBe(1);
    f.on();await f.adapter.start(command.attemptId);await f.adapter.wait(command.attemptId);
    expect(f.work.execution.get(command.attemptId).state).toBe('COMPLETED');expect(f.calls()).toBe(2);expect(f.gate.budget.view()).toMatchObject({spentMicros:80,reservedMicros:0});
  },15000);
  it('delivers with an incomplete bill, retains its reservation, and settles it independently later',async()=>{
    const f=await fixture(false,true),command=f.task();await f.adapter.start(command.attemptId);await f.adapter.wait(command.attemptId);
    expect(f.work.execution.get(command.attemptId)).toMatchObject({state:'COMPLETED',accountingState:'PENDING'});
    expect(f.work.view().tasks[0].state).toBe('REPLIED');expect(f.gate.budget.view().reservedMicros).toBeGreaterThan(0);expect(f.gate.budget.view().spentMicros).toBe(40);
    f.off();const permit=f.gate.modelCalls()[0];f.gate.reconcileCall(String(permit.id),{actualTokens:30,costCny:0.00004,reason:'Owner checked the actual original provider receipt',expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()});
    expect(f.work.execution.get(command.attemptId)).toMatchObject({state:'COMPLETED',accountingState:'SETTLED'});expect(f.gate.budget.view()).toMatchObject({spentMicros:80,reservedMicros:0});expect(f.gate.view().desiredMode).toBe('OFF');expect(f.calls()).toBe(2);
  },15000);
  it('adopts a disconnected private journal with a fresh controller only after the old child exited',async()=>{
    const f=await fixture(),command=f.task(),respond=f.gate.models.response.bind(f.gate.models);let once=false;
    vi.spyOn(f.gate.models,'response').mockImplementation((...args)=>{respond(...args);if(!once){once=true;f.adapter.disconnect(command.attemptId);}});
    await f.adapter.start(command.attemptId);await f.adapter.wait(command.attemptId);f.off();
    // Simulate OS PID recycling: this PID is alive, but belongs to this test controller.
    f.control.db.prepare('UPDATE company_worker_launches SET pid=? WHERE attempt_id=?').run(process.pid,command.attemptId);
    const gate=new OwnerAutomationGate(f.control),execution=new CompanyExecutionService(gate),adapter=new CompanyWorkerAdapter(execution,f.adapter.options);cleanups.push(()=>adapter.close());
    await adapter.recover(command.attemptId);expect(execution.get(command.attemptId).leaseOwner).toBe(execution.owner);
    expect(gate.view().desiredMode).toBe('OFF');expect(f.calls()).toBe(1);
    f.on();await adapter.start(command.attemptId);await adapter.wait(command.attemptId);
    expect(execution.get(command.attemptId).state).toBe('COMPLETED');expect(f.calls()).toBe(2);expect(gate.budget.view()).toMatchObject({spentMicros:80,reservedMicros:0});
  },15000);
  it('does not adopt or relaunch a live worker merely because its lease expired',async()=>{
    const f=await fixture(true),command=f.task();await f.adapter.start(command.attemptId);await f.requested;
    f.control.db.prepare('UPDATE company_execution_attempts SET lease_expires_at=0 WHERE id=?').run(command.attemptId);
    const gate=new OwnerAutomationGate(f.control),execution=new CompanyExecutionService(gate),adapter=new CompanyWorkerAdapter(execution,f.adapter.options);cleanups.push(()=>adapter.close());
    expect(await adapter.recover(command.attemptId)).toBe(false);await expect(adapter.start(command.attemptId)).rejects.toThrow('OWNER_PREVIOUS_WORKER_STILL_ALIVE');expect(f.calls()).toBe(1);
    expect(execution.get(command.attemptId).leaseOwner).not.toBe(execution.owner);
    (f.adapter as any).live.get(command.attemptId).child.kill('SIGKILL');await f.adapter.wait(command.attemptId);expect(execution.get(command.attemptId).accountingState).toBe('PENDING');
  },15000);
  it('retains Goal evidence and serves the verified worker artifact without opening a legacy Core',async()=>{
    const f=await fixture(),goal=f.goal(),command=f.task('goal-task',{goalId:goal.id,specificationRevision:goal.specificationRevision,dispatchId:'worker-goal-dispatch'});
    await f.adapter.start(command.attemptId);await f.adapter.wait(command.attemptId);
    expect(f.work.execution.get(command.attemptId).state).toBe('COMPLETED');
    expect(f.manager.peek(f.a.world_id)).toBeUndefined();const evaluator=new GoalOutcomeEvaluator(f.manager,f.gate.goals);
    evaluator.collect(f.gate.goals.get(goal.id),'worker-goal-dispatch',f.a.world_id,f.work.view().tasks[0].reply);
    expect(f.gate.goals.get(goal.id)).toMatchObject({status:'WAITING_APPROVAL',verifiedCount:1,evidenceCount:1});
    const evidence=f.gate.goals.detail(goal.id).evidence.find(e=>e.kind==='artifact')!;expect(evidence.worldId).toBeNull();expect(f.work.artifacts.read(evidence).toString()).toContain('actual company money');
    const app=await createApplication({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
    const url=`/api/owner/goals/${goal.id}/evidence/${encodeURIComponent(evidence.id)}`,download=await app.inject(url);expect(download.statusCode,download.body).toBe(200);expect(download.body).toContain('actual company money');
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_artifacts').get()!.n).toBe(1);
    fs.writeFileSync(join(f.adapter.directory(command.attemptId),evidence.reference),'Changed after receipt');
    expect((await app.inject(url)).statusCode).toBe(409);expect(()=>evaluator.verify(evidence)).toThrow('OWNER_EVIDENCE_CHANGED');expect(f.calls()).toBe(2);
  },15000);
});
