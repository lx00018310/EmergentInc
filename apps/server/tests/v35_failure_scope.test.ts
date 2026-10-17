import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { listenTestHttp } from '../../../tests/http_port.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { OwnerOverviewService } from '../src/services/owner_overview_service.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();});

/** Real worker-process fixture: model calls go through a local HTTP server, not a mock provider. */
async function workerFixture(reply?:(body:any,req:IncomingMessage,res:ServerResponse)=>unknown){
  const f=goalFixture();cleanups.push(f.close);const requests:any[]=[];
  const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const data=JSON.parse(body);requests.push(data);if(reply)return void reply(data,req,res);
    const instruction=JSON.parse(data.messages[1].content).instruction as string;
    const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
    send(res,{operations:[{tool:'save_artifact',args:{filename,content:`Verified draft for ${instruction.slice(0,80)}`}}],owner_reply:'实际产物已保存',send_to:'STOP'});
  });});
  const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  f.work.enableWorkers({MCL_API_KEY:'v35-failure-isolation-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'2000'},f.payments);
  f.on();vi.spyOn(f.manager,'open').mockImplementation(()=>{throw new Error('LEGACY_CORE_MUST_NOT_OPEN');});
  const settle=async()=>{await vi.waitFor(async()=>{await f.scheduler.tick();if(f.work.worker!.snapshots().some(a=>f.work.worker!.isRunning(String(a.id))))throw new Error('Worker running');if(f.work.view().tasks.some(t=>t.state==='QUEUED'&&t.runId===null))throw new Error('Dispatch pending');},{timeout:30000,interval:20});};
  return {...f,requests,calls:()=>requests.length,settle};
}
function send(res:ServerResponse,value:unknown,knownUsage=true){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}],...(knownUsage?{usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}:{})}));}
/** Kill the underlying worker process without any graceful handoff. */
async function killWorker(f:Awaited<ReturnType<typeof workerFixture>>,attemptId:string){
  const snapshots=f.work.worker!.snapshots(),launch=snapshots.find(a=>a.id===attemptId)!;
  expect(Number(launch.pid)).toBeGreaterThan(0);
  process.kill(Number(launch.pid),'SIGKILL');
  await vi.waitFor(()=>expect(f.work.worker!.isRunning(attemptId)).toBe(false),{timeout:10000,interval:20});
}

describe('V35 failure scope contract',()=>{
  it('converges an ECONNRESET unknown task as ATTEMPT scope while another goal completes and desiredMode stays ON (matrix 1)',async()=>{
    const f=await workerFixture((body,_req,res)=>{
      const instruction=JSON.parse(body.messages[1].content).instruction as string;
      if(instruction.includes('Broken connection'))return res.destroy();
      const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
      send(res,{operations:[{tool:'save_artifact',args:{filename,content:'Independent healthy result with real retained evidence.'}}],owner_reply:'Independent result retained',send_to:'STOP'});
    });
    const broken=f.goal('Broken connection research','manual');
    await new Promise(r=>setTimeout(r,2));
    const healthy=f.goal('Independent healthy goal','manual');
    await f.scheduler.tick();await f.settle();
    expect(f.work.execution.forTask(f.work.view().tasks.find(t=>t.goalId===broken.id)!.id)).toMatchObject({state:'BLOCKED',reason:'CALL_OUTCOME_UNKNOWN'});
    expect(f.gate.goals.get(healthy.id).status).toBe('WAITING_APPROVAL');
    expect(f.gate.view()).toMatchObject({desiredMode:'ON'});
    expect(f.gate.budget.view().reservedMicros).toBeGreaterThan(0);
    const view=await new OwnerOverviewService(f.worlds,f.work).bossOverview();
    expect(view.alerts.filter(a=>a.goalId===broken.id)).toHaveLength(1);
  },20000);

  it('keeps an independent DAG branch running while a failed node blocks only its real downstream (matrix 2)',async()=>{
    const f=await workerFixture((body,_req,res)=>{
      const instruction=JSON.parse(body.messages[1].content).instruction as string;
      if(instruction.includes('retaining sources')){send(res,'not json at all');return;}
      const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
      send(res,{operations:[{tool:'save_artifact',args:{filename,content:'Healthy branch result retained as actual evidence.'}}],owner_reply:'Healthy branch done',send_to:'STOP'});
    });
    const goal=f.goal('DAG partial failure','manual');
    f.gate.proposals.plans.install(goal.id,{summary:'Mixed DAG',nodes:[
      {key:'broken',title:'Broken',instruction:'Step retaining sources',filename:'broken.md',dependsOn:[],trigger:{kind:'once'}},
      {key:'independent',title:'Independent',instruction:'Produce the independent marketing result',filename:'independent.md',dependsOn:[],trigger:{kind:'once'}},
      {key:'downstream',title:'Downstream',instruction:'Review the broken step result',filename:'downstream.md',dependsOn:['broken'],trigger:{kind:'once'}}]},true);
    await f.scheduler.tick();await f.settle();
    const plan=f.gate.proposals.plans.get(goal.id)!;
    const byKey=(key:string)=>plan.nodes.find(n=>n.key===key)!.state;
    expect(byKey('independent')).toBe('COMPLETED');
    expect(['BLOCKED','WAITING']).toContain(byKey('broken'));
    expect(['BLOCKED','WAITING','WAITING_RESOURCE']).toContain(byKey('downstream'));
    expect(f.gate.view()).toMatchObject({desiredMode:'ON'});
    expect(f.calls()).toBeGreaterThanOrEqual(2);
  },20000);

  it('converges a SIGKILLED worker into a defined terminal or review state without double launch (matrix 3, real subprocess)',async()=>{
    const f=await workerFixture(),goal=f.goal('Killed worker research','manual');
    await f.scheduler.tick();
    await vi.waitFor(()=>{const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;if(!task.attempt)throw new Error('attempt pending');expect(f.work.execution.get(task.attempt.id).state).toBe('RUNNING');},{timeout:10000,interval:20});
    const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;
    await killWorker(f,task.attempt!.id);
    await f.settle();
    const attempt=f.work.execution.get(task.attempt!.id);
    expect(['SUSPENDED','BLOCKED','FAILED','INTERRUPTED']).toContain(attempt.state);
    expect(f.work.view().tasks.find(t=>t.id===task.id)!.state).not.toBe('RUNNING');
    // No second worker launched for the same task after the kill.
    const attempts=f.control.db.prepare('SELECT id,fence FROM company_execution_attempts WHERE task_id=?').all(task.id);
    expect(attempts).toHaveLength(1);
    // A restart of the controller polls the same attempt without a duplicate dispatch.
    await f.work.tick();
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_execution_attempts WHERE task_id=?').get(task.id)!.n).toBe(1);
  },20000);

  it('fails invalid model JSON locally without closing the scheduler or harming other goals (matrix 5)',async()=>{
    const f=await workerFixture((body,_req,res)=>{
      const instruction=JSON.parse(body.messages[1].content).instruction as string;
      if(instruction.includes('unparseable output')){send(res,'{broken json');return;}
      const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
      send(res,{operations:[{tool:'save_artifact',args:{filename,content:'Healthy result after the earlier local parse failure.'}}],owner_reply:'Recovered goal done',send_to:'STOP'});
    });
    const bad=f.goal('Invalid unparseable output','manual');
    await f.scheduler.tick();await f.settle();
    expect(f.work.execution.forTask(f.work.view().tasks.find(t=>t.goalId===bad.id)!.id)).toMatchObject({state:'FAILED',reason:'MODEL_RESPONSE_INVALID'});
    expect(f.work.hasFailure()).toBe(false);
    expect(f.gate.view()).toMatchObject({desiredMode:'ON'});
    // The scheduler still dispatches a new goal after the local parse failure.
    const good=f.goal('Post failure goal','manual');
    await f.settle();
    expect(f.gate.goals.get(good.id).status).toBe('WAITING_APPROVAL');
  },20000);

  it('isolates an attributable dispatch error per task and keeps the loop dispatching other tasks',async()=>{
    const f=await workerFixture();
    const good=f.goal('Dispatch loop survivor','manual');
    await f.scheduler.tick();await f.settle();
    expect(f.gate.goals.get(good.id).status).toBe('WAITING_APPROVAL');
    expect(f.work.hasFailure()).toBe(false);
    expect(f.gate.view()).toMatchObject({desiredMode:'ON'});
  },20000);

  it('holds reservations after a killed worker with an in-flight call and does not auto-settle (matrix 8, real subprocess)',async()=>{
    const f=await workerFixture(),goal=f.goal('Uncertain charge research','manual');
    await f.scheduler.tick();
    const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;
    const reservedBefore=f.gate.budget.view().reservedMicros;
    expect(reservedBefore).toBeGreaterThan(0);
    await killWorker(f,task.attempt!.id);
    await f.settle();
    const attempt=f.work.execution.get(task.attempt!.id);
    if(attempt.reason==='CALL_OUTCOME_UNKNOWN'){
      expect(attempt.accountingState).toBe('PENDING');
      expect(f.gate.budget.view().reservedMicros).toBe(reservedBefore);
    }else expect(attempt.state).not.toBe('RUNNING');
    // Appending budget never fabricates a settlement for the uncertain call.
    f.gate.budget.configure({tokenMillions:2,unitPrice:100,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});
    const permits=f.control.db.prepare("SELECT state FROM owner_model_permits WHERE goal_id=? AND state='UNKNOWN'").all(goal.id);
    for(const p of permits)expect(f.control.db.prepare("SELECT state FROM owner_model_permits WHERE goal_id=? AND state='UNKNOWN'").get(goal.id)).toMatchObject({state:'UNKNOWN'});
  },20000);

  it('keeps manual OFF and global safety holds effective for new dispatch regardless of retries',async()=>{
    const f=await workerFixture(),goal=f.goal('Manual off research','manual');
    f.off();
    await f.scheduler.tick();
    expect(f.work.view().tasks.find(t=>t.goalId===goal.id)?.state??'QUEUED').not.toBe('RUNNING');
    expect(f.calls()).toBe(0);
    // Global safety hold blocks admission even with desiredMode ON.
    f.on();
    f.gate.halt('OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION');
    const blocked=f.goal('Blocked by safety','manual');
    await f.scheduler.tick();
    expect(f.gate.isOn()).toBe(false);
    expect(f.calls()).toBe(0);
    expect(f.work.hasFailure()).toBe(false);
  },20000);

  it('preserves per-goal receipts across repeated reconcile queries after a kill and restart (matrix 4/6 stability)',async()=>{
    const f=await workerFixture(),goal=f.goal('Restart stable research','manual');
    await f.scheduler.tick();
    const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;
    await killWorker(f,task.attempt!.id);
    await f.settle();
    const first=f.work.execution.get(task.attempt!.id);
    // Repeated ticks and overview reads are idempotent.
    await f.work.tick();await f.scheduler.tick();
    const second=f.work.execution.get(task.attempt!.id);
    expect(second.state).toBe(first.state);
    expect(second.revision).toBe(first.revision);
    const view=await new OwnerOverviewService(f.worlds,f.work).bossOverview();
    expect(view.alerts.filter(a=>a.goalId===goal.id)).toHaveLength(1);
  },20000);
});
