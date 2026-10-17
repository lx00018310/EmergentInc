import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { listenTestHttp } from '../../../tests/http_port.js';
import { goalFixture } from './fixtures/owner_goals.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();});

async function workerFixture(reply?:(body:any,req:IncomingMessage,res:ServerResponse)=>unknown){
  const f=goalFixture();cleanups.push(f.close);const requests:any[]=[];
  const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const data=JSON.parse(body);requests.push(data);if(reply)return void reply(data,req,res);
    const instruction=JSON.parse(data.messages[1].content).instruction as string;
    const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
    send(res,{operations:[{tool:'save_artifact',args:{filename,content:`Verified draft for ${instruction.slice(0,80)}`}}],owner_reply:'实际产物已保存',send_to:'STOP'});
  });});
  const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  f.work.enableWorkers({MCL_API_KEY:'v35-attention-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'2000'},f.payments);
  f.on();vi.spyOn(f.manager,'open').mockImplementation(()=>{throw new Error('LEGACY_CORE_MUST_NOT_OPEN');});
  const settle=async()=>{await vi.waitFor(async()=>{await f.scheduler.tick();if(f.work.worker!.snapshots().some(a=>f.work.worker!.isRunning(String(a.id))))throw new Error('Worker running');if(f.work.view().tasks.some(t=>t.state==='QUEUED'&&t.runId===null))throw new Error('Dispatch pending');},{timeout:12000,interval:20});};
  return {...f,requests,calls:()=>requests.length,settle};
}
function send(res:ServerResponse,value:unknown,knownUsage=true){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}],...(knownUsage?{usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}:{})}));}

describe('V35 attention actions',()=>{
  it('closes the loop: failure -> STOP_TASK -> attention item converges -> independent task continues',async()=>{
    const f=await workerFixture((body,_req,res)=>{
      const instruction=JSON.parse(body.messages[1].content).instruction as string;
      if(instruction.includes('stopping this work')){send(res,'{broken json');return;}
      const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
      send(res,{operations:[{tool:'save_artifact',args:{filename,content:'Independent result after the stopped task.'}}],owner_reply:'Independent done',send_to:'STOP'});
    });
    const stopped=f.goal('Work worth stopping this work','manual');
    await f.scheduler.tick();await f.settle();
    const stoppedTask=f.work.view().tasks.find(t=>t.goalId===stopped.id)!;
    expect(stoppedTask.state).toBe('FAILED');
    const actions=f.work.attention!.actions(stoppedTask.id);
    expect(actions.actions).toContain('STOP_TASK');
    const independent=f.goal('Independent survivor','manual');
    await f.scheduler.tick();await f.settle();
    expect(f.gate.goals.get(independent.id).status).toBe('WAITING_APPROVAL');
    // Stop the failed task; the goal converges, the independent goal is untouched.
    const result=f.work.attention!.stopTask(stoppedTask.id,{expectedRevision:f.gate.goals.get(stopped.id).revision,idempotencyKey:crypto.randomUUID(),reason:'This work is no longer needed by the owner'});
    expect(result).toMatchObject({taskId:stoppedTask.id,state:'FAILED',goalId:stopped.id,reservationsRetained:true});
    expect(f.work.view().tasks.find(t=>t.id===stoppedTask.id)!.state).toBe('FAILED');
    // Stopping an already stopped task with a fresh key conflicts.
    expect(()=>f.work.attention!.stopTask(stoppedTask.id,{expectedRevision:f.gate.goals.get(stopped.id).revision,idempotencyKey:crypto.randomUUID(),reason:'Another stop attempt here'})).toThrow();
    expect(f.gate.goals.get(independent.id).status).toBe('WAITING_APPROVAL');
    expect(f.gate.view()).toMatchObject({desiredMode:'ON'});
    // Original receipts and charges remain queryable.
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_execution_attempts WHERE task_id=?').get(stoppedTask.id)!.n).toBe(1);
  },30000);

  it('closes the loop: failure -> RETRY_TASK -> new attempt -> completes',async()=>{
    let calls=0;
    const f=await workerFixture((body,_req,res)=>{
      const instruction=JSON.parse(body.messages[1].content).instruction as string;
      if(calls===0){calls++;send(res,'{broken json');return;}
      const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
      send(res,{operations:[{tool:'save_artifact',args:{filename,content:'Successful retry result retained as evidence.'}}],owner_reply:'Retry succeeded',send_to:'STOP'});
    });
    const goal=f.goal('Retry worthy research','manual');
    await f.scheduler.tick();await f.settle();
    const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;
    expect(task.state).toBe('FAILED');
    const firstAttempt=task.attempt!.id;
    const actions=f.work.attention!.actions(task.id);
    expect(actions.actions).toContain('RETRY_TASK');
    // Stale revision is rejected.
    expect(()=>f.work.attention!.retryTask(task.id,{expectedRevision:goal.revision+99,idempotencyKey:crypto.randomUUID(),reason:'Retry with a stale revision here'})).toThrow();
    const result=f.work.attention!.retryTask(task.id,{expectedRevision:f.gate.goals.get(goal.id).revision,idempotencyKey:crypto.randomUUID(),reason:'The model outage is over; retry this work'});
    expect(result).toMatchObject({taskId:task.id,state:'QUEUED',goalId:goal.id,goalStatus:'READY'});
    await f.settle();
    expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');
    // The old attempt stays immutable; the retry created a second fenced attempt.
    expect(f.work.execution.get(firstAttempt)).toMatchObject({state:'FAILED',reason:'MODEL_RESPONSE_INVALID'});
    const attempts=f.control.db.prepare('SELECT id,fence,state FROM company_execution_attempts WHERE task_id=? ORDER BY fence').all(task.id);
    expect(attempts).toHaveLength(2);
    expect(Number(attempts[1]!.fence)).toBeGreaterThan(Number(attempts[0]!.fence));
    expect(f.work.view().tasks.find(t=>t.id===task.id)!.state).toBe('REPLIED');
  },30000);

  it('rejects retry while an unknown outcome or review is pending',async()=>{
    const f=await workerFixture((_body,_req,res)=>res.destroy());
    const goal=f.goal('Unknown outcome research','manual');
    await f.scheduler.tick();await f.settle();
    const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;
    expect(task.reason).toBe('CALL_OUTCOME_UNKNOWN');
    const actions=f.work.attention!.actions(task.id);
    expect(actions.actions).not.toContain('RETRY_TASK');
    expect(()=>f.work.attention!.retryTask(task.id,{expectedRevision:f.gate.goals.get(goal.id).revision,idempotencyKey:crypto.randomUUID(),reason:'Must not replay unknown calls'})).toThrow('OWNER_TASK_RETRY_NOT_ALLOWED');
    // The reservation is untouched by the rejected retry.
    expect(f.gate.budget.view().reservedMicros).toBeGreaterThan(0);
  },30000);
});
