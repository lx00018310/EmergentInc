import {afterEach,describe,expect,it,vi} from 'vitest';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {SqliteDatabase} from '@emergentinc/persistence';
import {goalFixture} from './fixtures/owner_goals.js';
import {CompanyLegacyAdapter} from '../src/services/company_legacy_adapter.js';
import {OwnerAutomationGate} from '../src/services/owner_automation_gate.js';
import {OwnerGoalScheduler} from '../src/services/owner_goal_scheduler.js';
import {OwnerOverviewService} from '../src/services/owner_overview_service.js';
import {listenTestHttp} from '../../../tests/http_port.js';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();});
async function fixture(mode:'on'|'off'|'unknown'){
  const f=goalFixture();cleanups.push(f.close);const goal=f.goal();
  const child=spawn(process.execPath,['--import','tsx',resolve('apps/server/tests/fixtures/owner_goal_recovery_child.ts'),f.root,mode],{cwd:resolve('.'),windowsHide:true,stdio:['ignore','ignore','pipe']});const exited=once(child,'exit');let errors='';child.stderr.on('data',data=>errors+=data);
  cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
  await vi.waitFor(()=>{if(child.exitCode!==null)throw new Error(errors);expect(fs.existsSync(join(f.root,'recovery-ready.json'))).toBe(true);},{timeout:10000});child.kill('SIGKILL');await exited;
  const saved=JSON.parse(fs.readFileSync(join(f.root,'recovery-ready.json'),'utf8')),gate=new OwnerAutomationGate(f.control);f.manager.attachAutomation(gate);
  let newCalls=0;const server=createServer((req,res)=>{req.resume();req.on('end',()=>{newCalls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({owner_reply:'An independent new worker result',send_to:'STOP'})}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));});});const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  f.work.enableWorkers({MCL_API_KEY:'explicit-fake-legacy-migration-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`},f.payments);
  const legacy=f.work.legacy=new CompanyLegacyAdapter(f.manager,f.work.execution),scheduler=new OwnerGoalScheduler(f.manager,f.work,gate,f.payments);cleanups.push(()=>scheduler.close());
  return {...f,gate,goal,saved,legacy,scheduler,newCalls:()=>newCalls};
}
describe('explicit old-state recovery adapter',()=>{
  it('transfers a provably unsent legacy inbox intent exactly once without leaving executable old messages',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const instruction='Retain the one authorized internal result',turn=await f.work.gateway.enqueue(f.a.qianji_id,instruction,'unsent-company-intent');
    f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('unsent-task','unsent-request',?,'Research',?,'QUEUED',?,NULL,NULL,NULL,?,?)").run(f.a.qianji_id,instruction,turn.turn_id,Date.now(),Date.now());
    await f.manager.closeAll();f.off();f.work.enableWorkers({},f.payments);const adapter=new CompanyLegacyAdapter(f.manager,f.work.execution);
    adapter.migrate();adapter.migrate();expect(f.control.db.prepare("SELECT state,turn_id,run_id FROM owner_work_tasks WHERE id='unsent-task'").get()).toMatchObject({state:'QUEUED',turn_id:null,run_id:null});
    const core=new SqliteDatabase(join(f.registry.directory(f.a.world_id),'ledger/v9_core.sqlite3'),{readOnly:true});try{expect(core.prepare('SELECT status,abandoned_reason FROM messages WHERE message_id=?').get(turn.message_id)).toMatchObject({status:'ABANDONED',abandoned_reason:'COMPANY_INTENT_MIGRATED'});expect(core.prepare("SELECT COUNT(*) n FROM recovery_decisions WHERE decision_id='company-intent:unsent-task'").get()!.n).toBe(1);}finally{core.close();}
    expect(f.gate.view().desiredMode).toBe('OFF');expect(f.calls).toHaveLength(0);expect(f.manager.list().every(a=>!a.opened)).toBe(true);
  });
  it('imports a killed unknown run, preserves its real reservation, converges its Goal and allows independent new work by the same agent',async()=>{
    const f=await fixture('unknown'),held=f.gate.budget.view().reservedMicros;expect(held).toBeGreaterThan(0);
    expect(f.legacy.migrate()).toBe(1);expect(f.legacy.migrate()).toBe(0);await f.scheduler.tick();
    expect(f.work.execution.forRun(f.saved.runId)).toMatchObject({state:'BLOCKED',accountingState:'PENDING',reason:'CALL_OUTCOME_UNKNOWN'});expect(f.gate.goals.get(f.goal.id)).toMatchObject({status:'BLOCKED',reason:'CALL_OUTCOME_UNKNOWN'});expect(f.work.view().tasks.find(t=>t.goalId===f.goal.id)!.state).toBe('BLOCKED');
    expect(Boolean(f.manager.peek(f.saved.worldId))).toBe(false);expect(f.gate.budget.view().reservedMicros).toBe(held);expect(f.calls).toHaveLength(0);
    const person=f.control.world(f.saved.worldId).qianji_id;await f.work.dispatch([{personId:person,instruction:'Report an independent internal result'}],'independent-after-migration',1);
    const task=f.work.view().tasks.find(t=>!t.goalId)!;await f.work.worker!.wait(task.attempt!.id);expect(f.work.view().tasks.find(t=>t.id===task.id)!.state).toBe('REPLIED');expect(f.newCalls()).toBe(1);expect(f.calls).toHaveLength(0);expect(f.gate.budget.view().reservedMicros).toBe(held);expect(f.gate.view().desiredMode).toBe('ON');
  },20000);
  it('records an explicit abandonment even when the killed call has no model-call row, retaining unknown money',async()=>{
    const f=await fixture('unknown');f.legacy.migrate();const held=f.gate.budget.view().reservedMicros,permit=f.gate.modelCalls()[0];
    f.gate.goals.action(f.goal.id,{action:'stop',expectedRevision:f.gate.goals.get(f.goal.id).revision,idempotencyKey:'stop-legacy-unknown'});
    expect((await new OwnerOverviewService(f.worlds,f.work).bossOverview()).alerts.filter(a=>a.goalId===f.goal.id)).toHaveLength(1);
    const runtime=await f.manager.open(f.saved.worldId);expect(runtime.store.modelCalls.getModelCall(String(permit.source_id))).toBeNull();
    const reservation=runtime.store.db.prepare('SELECT message_id FROM reservations WHERE call_id=?').get(permit.source_id)!;
    runtime.store.resolveRecoveryOperation({kind:'model',id:String(permit.source_id),decision:'abandon',reason:'Owner discards the unknown result without replay or a billing claim.'});
    f.gate.reconcileWorld(runtime.store,f.saved.worldId);
    expect(runtime.store.messages.getMessage(String(reservation.message_id))!.status).toBe('ABANDONED');expect(f.gate.modelCalls()).toHaveLength(0);expect(f.gate.modelCalls(true)[0]).toMatchObject({state:'UNKNOWN',actual_tokens:null,cost_cny:null,reviewed:1});
    expect(f.gate.budget.view().reservedMicros).toBe(held);expect(f.gate.goals.hasPendingOutcome(f.goal.id)).toBe(false);expect(f.calls).toHaveLength(0);
    expect((await new OwnerOverviewService(f.worlds,f.work).bossOverview()).alerts.filter(a=>a.goalId===f.goal.id)).toHaveLength(0);
  },20000);
  it('keeps a migrated settled unknown attempt reviewable in recovery and clears the blocked goal after abandonment',async()=>{
    // The production dead end: the legacy call kept its core model_call row with an unknown
    // outcome, the bill was settled through the old world recovery path, yet the company
    // ledger still carried CALL_OUTCOME_UNKNOWN and the recovery projection skipped
    // attempts without a worker launch.
    const f=await fixture('unknown');f.legacy.migrate();const attempt=f.work.execution.forRun(f.saved.runId)!;expect(attempt.reason).toBe('CALL_OUTCOME_UNKNOWN');
    const runtime=await f.manager.open(f.saved.worldId),callId=String(f.gate.modelCalls(true)[0].source_id);
    const reservation=runtime.store.db.prepare('SELECT run_id,pixel_id,message_id FROM reservations WHERE call_id=?').get(callId)!;
    runtime.store.db.prepare(`INSERT INTO model_calls(call_id,run_id,pixel_id,message_id,model,prompt_tokens,completion_tokens,actual_tokens,cost_cny,outcome,created_at) VALUES(?,?,?,?,?,?,?,?,?, 'CALL_OUTCOME_UNKNOWN',?)`)
      .run(callId,String(reservation.run_id),String(reservation.pixel_id),reservation.message_id,'test',20,10,null,null,Date.now()/1000);
    runtime.store.resolveRecoveryOperation({kind:'model',id:callId,decision:'settle_billed',reason:'Owner approved the suggested verified settlement values.',actualTokens:0,costCny:0.00004});
    f.gate.reconcileWorld(runtime.store,f.saved.worldId);
    expect(f.gate.modelCalls()).toHaveLength(0);expect(f.gate.goals.get(f.goal.id)).toMatchObject({status:'BLOCKED',reason:'CALL_OUTCOME_UNKNOWN'});
    const attemptId=f.work.execution.forRun(f.saved.runId)!.id;expect(f.control.db.prepare('SELECT 1 FROM company_worker_launches WHERE attempt_id=?').get(attemptId)).toBeUndefined();
    const recovery=f.work.recovery!.view();expect(recovery.attempts.map(a=>a.id)).toContain(attemptId);
    const facts=recovery.attempts.find(a=>a.id===attemptId)!;
    await expect(f.work.recovery!.abandon(attemptId,{hash:'f'.repeat(64),reason:'A changed fact hash cannot abandon the attempt',idempotencyKey:'legacy-abandon-stale'})).rejects.toThrow('OWNER_RECOVERY_CHANGED');
    const app=await (await import('../src/app.js')).createServer({workspaceRoot:f.root,worlds:f.worlds});try{
      const result=await app.inject({method:'POST',url:`/api/owner/execution-recovery/${attemptId}/abandon`,payload:{hash:facts.hash,reason:'Owner abandons the settled unknown result and keeps the bill',idempotencyKey:'legacy-abandon-settled'}});
      expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({decision:'ABANDONED',reservationRetained:true});
    }finally{await app.close();}
    expect(f.control.db.prepare("SELECT decision FROM company_execution_reviews WHERE attempt_id=?").get(attemptId)).toMatchObject({decision:'ABANDONED'});
    expect(f.work.recovery!.view().attempts).toHaveLength(0);
    expect(f.work.view().tasks.find(t=>t.goalId===f.goal.id)!.reason).toBeNull();
    // The running company converges the abandoned dispatch itself; the goal alert must clear.
    await f.scheduler.tick();
    const overview=await new OwnerOverviewService(f.worlds,f.work).bossOverview();
    expect(overview.alerts.filter(a=>a.goalId===f.goal.id)).toHaveLength(0);
    expect(['READY','RUNNING','WAITING_RESOURCE','WAITING_APPROVAL']).toContain(f.gate.goals.get(f.goal.id).status);
  },20000);
  it.each(['on','off'] as const)('reuses a legacy paid response/tool receipt after migration and respects explicit %s',async mode=>{
    const f=await fixture(mode),file=join(f.registry.directory(f.saved.worldId),'ledger/v9_core.sqlite3'),core=new SqliteDatabase(file,{readOnly:true});let before:unknown;
    try{before=core.prepare("SELECT result FROM tool_executions WHERE tool='save_artifact'").all();}finally{core.close();}
    f.legacy.migrate();await f.scheduler.tick();
    if(mode==='off'){expect(f.calls).toHaveLength(0);expect(f.gate.view().desiredMode).toBe('OFF');expect(f.work.execution.forRun(f.saved.runId)!.state).toBe('SUSPENDED');f.on();}
    await vi.waitFor(async()=>{await f.scheduler.tick();expect(f.gate.goals.get(f.goal.id).status).toBe('WAITING_APPROVAL');},{timeout:10000,interval:20});
    expect(f.calls).toHaveLength(1);expect(f.newCalls()).toBe(0);expect(f.work.execution.forRun(f.saved.runId)).toMatchObject({state:'COMPLETED',accountingState:'SETTLED'});
    const final=new SqliteDatabase(file,{readOnly:true});try{expect(final.prepare("SELECT result FROM tool_executions WHERE tool='save_artifact'").all()).toEqual(before);}finally{final.close();}
    expect(f.gate.goals.detail(f.goal.id).evidence.some(e=>e.kind==='artifact')).toBe(true);expect(f.gate.budget.view().spentMicros).toBe(80);
  },20000);
});
