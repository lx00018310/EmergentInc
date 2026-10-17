import {afterEach,describe,expect,it} from 'vitest';
import {createServer} from 'node:http';
import {listenTestHttp} from '../../../tests/http_port.js';
import {goalFixture} from './fixtures/owner_goals.js';
import {createServer as application} from '../src/app.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(){
  const f=goalFixture();cleanups.push(f.close);let calls=0,requested!:()=>void;const request=new Promise<void>(r=>requested=r),server=createServer((req,_res)=>{req.resume();req.on('end',()=>{calls++;requested();});});const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  f.work.enableWorkers({MCL_API_KEY:'explicit-fake-recovery-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`},f.payments);f.on();return {...f,request,calls:()=>calls};
}
describe('Owner execution and safety recovery',()=>{
  it.each([false,true])('stops an unknown execution independently of its billing state, with exact replay guards (bill verified=%s)',async verified=>{
    const f=await fixture(),goal=f.goal();await f.scheduler.tick();await f.request;const task=f.work.view().tasks[0],a=task.attempt!;
    (f.work.worker as any).live.get(a.id).child.kill('SIGKILL');await f.work.worker!.wait(a.id);await f.scheduler.tick();f.off();const held=f.gate.budget.view().reservedMicros,permit=f.gate.modelCalls()[0];
    const before=f.work.recovery!.view().attempts[0];if(verified){f.gate.reconcileCall(String(permit.id),{actualTokens:30,costCny:0.00004,reason:'Synthetic original provider receipt verified',expectedRevision:f.gate.view().revision,idempotencyKey:'verify-before-outcome'});await expect(f.work.recovery!.abandon(a.id,{hash:before.hash,reason:'Owner checked the original uncertain execution',idempotencyKey:'stale-outcome'})).rejects.toThrow('OWNER_RECOVERY_CHANGED');}
    expect(()=>f.gate.goals.action(goal.id,{action:'reopen',expectedRevision:f.gate.goals.get(goal.id).revision,idempotencyKey:'cannot-reopen-unknown'})).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');
    const review=f.work.recovery!.view().attempts[0],input={hash:review.hash,reason:'Owner abandons this exact uncertain execution',idempotencyKey:'stop-exact-uncertain-work'};
    const app=await application({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());const result=await app.inject({method:'POST',url:`/api/owner/execution-recovery/${a.id}/abandon`,payload:input});expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({replayed:false,reservationRetained:true});
    expect((await app.inject({method:'POST',url:`/api/owner/execution-recovery/${a.id}/abandon`,payload:input})).json()).toEqual(result.json());expect(f.work.recovery!.view().attempts).toHaveLength(0);
    expect(f.work.execution.get(a.id).state).toBe('BLOCKED');expect(f.gate.view().desiredMode).toBe('OFF');expect(f.gate.budget.view()).toMatchObject(verified?{spentMicros:40,reservedMicros:0}:{spentMicros:0,reservedMicros:held});
    f.gate.goals.action(goal.id,{action:'reopen',expectedRevision:f.gate.goals.get(goal.id).revision,idempotencyKey:'explicit-reopen-after-review'});await f.scheduler.tick();expect(f.calls()).toBe(1);expect(f.gate.view().desiredMode).toBe('OFF');
  },15000);
  it('acknowledges only the exact settled provider overrun receipt and preserves manual OFF',async()=>{
    const f=await fixture(),call=f.gate.models.prepare({model:'test',messages:[],maxTokens:100,promptHash:'safety-fixture',auditCallId:'safety-fixture' },f.meter,{sourceKind:'owner_chat'});
    f.gate.models.response(call.permitId,{rawText:'Actual synthetic receipt',usage:{promptTokens:50000,completionTokens:10000,cachedTokens:0}});expect(f.gate.admission.reason()).toBe('OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION');f.off();
    const hold=f.work.recovery!.view().holds[0];expect(hold.canAcknowledge).toBe(true);const input={hash:hold.hash,reason:'Owner verified the exact synthetic provider receipt',idempotencyKey:'acknowledge-exact-provider-receipt'};
    expect(()=>f.work.recovery!.acknowledge(hold.id,{...input,hash:'f'.repeat(64),idempotencyKey:'changed-receipt'})).toThrow('OWNER_RECOVERY_CHANGED');
    expect(f.work.recovery!.acknowledge(hold.id,input)).toMatchObject({acknowledged:true,desiredMode:'OFF'});expect(f.work.recovery!.acknowledge(hold.id,input)).toMatchObject({acknowledged:true});expect(f.gate.budget.view().spentMicros).toBe(70000);expect(f.gate.admission.reason()).toBeNull();expect(f.calls()).toBe(0);
  });
  it('does not clear an unrelated or unverified safety hold through generic acknowledgement',async()=>{
    const f=await fixture();f.gate.halt('UNVERIFIED_CONTROL_INVARIANT');const hold=f.work.recovery!.view().holds[0];expect(hold.canAcknowledge).toBe(false);expect(()=>f.work.recovery!.acknowledge(hold.id,{hash:hold.hash,reason:'Generic acknowledgement cannot verify this invariant',idempotencyKey:'generic-hold-denied'})).toThrow('OWNER_SAFETY_RECEIPT_REQUIRED');expect(f.gate.admission.reason()).toBe('UNVERIFIED_CONTROL_INVARIANT');
  });
});
