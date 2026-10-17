import {afterEach,expect,it} from 'vitest';
import {OutcomeUnknownError} from '@emergentinc/model';
import {goalFixture} from './fixtures/owner_goals.js';
import {createServer} from '../src/app.js';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});

it.each(['abandon','settle_reserved'] as const)('uses the World %s decision once, retaining unknown-cost money without blocking the company',async decision=>{
  const f=goalFixture();cleanups.push(f.close);f.on();f.respond(async()=>{throw new OutcomeUnknownError('Socket disconnected while reading response');});
  await f.work.dispatch([{personId:f.a.qianji_id,instruction:'An actual task with an interrupted response'}],'review-one-outcome');await f.finish();
  const permit=f.gate.modelCalls()[0],runtime=f.manager.peek(f.a.world_id)!,source=f.control.db.prepare('SELECT source_id FROM owner_model_sources WHERE permit_id=?').get(permit.id)!,before=f.gate.budget.view();
  expect(before.reservedMicros).toBeGreaterThan(0);expect(f.gate.scopeBlocked(f.a.world_id)).toBe(true);expect(f.gate.view().desiredMode).toBe('ON');
  runtime.store.resolveRecoveryOperation({kind:'model',id:String(source.source_id),decision,reason:'Owner handles this particular interrupted outcome'});
  await f.scheduler.tick();await f.scheduler.tick();
  expect(f.gate.view()).toMatchObject({desiredMode:'ON',observedState:'IDLE',reason:null,unknownCostCalls:1});
  expect(f.gate.budget.view()).toMatchObject({spentMicros:0,reservedMicros:before.reservedMicros,availableMicros:before.availableMicros,unknownCalls:1});
  expect(f.gate.modelCalls()).toHaveLength(0);expect(f.gate.modelCalls(true)).toMatchObject([{id:permit.id,reviewed:1,state:'UNKNOWN',actual_tokens:null,cost_cny:null}]);
  expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_model_outcome_reviewed'").get()!.n).toBe(1);
  const call=runtime.store.modelCalls.getModelCall(String(source.source_id))!;expect(runtime.store.messages.getMessage(call.messageId!)!.status).toBe('ABANDONED');expect(f.calls).toHaveLength(1);
  // Funding remains independent; the historical unknown charge stays reserved across the new batch.
  f.gate.budget.configure({tokenMillions:200,unitPrice:2,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});expect(f.gate.budget.view().reservedMicros).toBe(before.reservedMicros);f.on();expect(f.gate.isOn()).toBe(true);
  f.respond(async()=>({rawText:JSON.stringify({owner_reply:'A different task completed',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
  await f.work.dispatch([{personId:f.b.qianji_id,instruction:'A different task'}],'another-world-task');await f.finish();expect(f.work.view().tasks.find(t=>t.personId===f.b.qianji_id)!.state).toBe('REPLIED');expect(f.calls).toHaveLength(2);
  expect(runtime.store.messages.getMessage(call.messageId!)!.status).toBe('ABANDONED');
});
it('does not clear a different unknown call after one outcome was reviewed',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.on();f.respond(async()=>{throw new OutcomeUnknownError('Interrupted response');});
  await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Review only this call'}],'isolated-review');await f.finish();
  const permit=f.gate.modelCalls()[0],source=f.control.db.prepare('SELECT source_id FROM owner_model_sources WHERE permit_id=?').get(permit.id)!;
  f.manager.peek(f.a.world_id)!.store.resolveRecoveryOperation({kind:'model',id:String(source.source_id),decision:'abandon',reason:'Only this outcome is handled'});
  f.control.db.prepare("INSERT INTO owner_model_permits(id,batch_id,state,reserved_tokens,created_at) VALUES('other-unknown','initial','UNKNOWN',100,?)").run(Date.now());
  await f.scheduler.tick();expect(f.gate.modelCalls().map(p=>p.id)).toEqual(['other-unknown']);expect(f.gate.view().reason).toBeNull();expect(()=>f.on()).not.toThrow();expect(f.gate.budget.view().unknownCalls).toBe(1);
});
it('reuses a legacy abandonment receipt and settles its late bill independently exactly once through the company API',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.on();f.respond(async()=>{throw new OutcomeUnknownError('Synthetic response loss');});await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Retain the exact unknown outcome'}],'late-bill-after-abandon');await f.finish();
  const permit=f.gate.modelCalls()[0],source=f.control.db.prepare('SELECT source_id FROM owner_model_sources WHERE permit_id=?').get(permit.id)!,held=f.gate.budget.view().reservedMicros;
  const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());const payload={kind:'model',id:source.source_id,decision:'abandon',reason:'Owner discards this unknown result without claiming its bill',idempotencyKey:'abandon-late-bill'};
  const invalid=await app.inject({method:'POST',url:`/api/owner/recovery/${f.a.world_id}`,payload:{...payload,unexpected:true}});expect(invalid.statusCode).toBe(400);expect(f.manager.peek(f.a.world_id)!.store.db.prepare('SELECT COUNT(*) n FROM recovery_decisions').get()!.n).toBe(0);
  const first=await app.inject({method:'POST',url:`/api/owner/recovery/${f.a.world_id}`,payload}),again=await app.inject({method:'POST',url:`/api/owner/recovery/${f.a.world_id}`,payload});expect(first.statusCode,first.body).toBe(200);expect(again.json()).toEqual(first.json());expect(f.gate.budget.view().reservedMicros).toBe(held);expect((await app.inject('/api/owner/automation/calls')).json().items[0]).toMatchObject({id:permit.id,reviewed:1});
  const bill={actualTokens:30,costCny:0.00004,reason:'The actual late provider receipt is verified',expectedRevision:f.gate.view().revision,idempotencyKey:'late-bill-exact-receipt'};
  for(let n=0;n<2;n++){const response=await app.inject({method:'POST',url:`/api/owner/automation/calls/${permit.id}/reconcile`,payload:bill});expect(response.statusCode,response.body).toBe(200);}
  expect(f.gate.budget.view()).toMatchObject({reservedMicros:0,spentMicros:40});expect(f.manager.peek(f.a.world_id)!.store.db.prepare('SELECT COUNT(*) n FROM recovery_decisions').get()!.n).toBe(1);expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_model_usage_reconciled'").get()!.n).toBe(1);expect(f.calls).toHaveLength(1);expect(f.gate.view().desiredMode).toBe('ON');
});
it.each(['en','zh-CN'] as const)('shows a reviewed cost reservation without claiming company startup is blocked (%s)',async language=>{
  const f=goalFixture();cleanups.push(f.close);f.on();f.respond(async()=>{throw new OutcomeUnknownError('Interrupted response');});
  await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Handled outcome'}],'chat-reviewed-outcome');await f.finish();
  const permit=f.gate.modelCalls()[0],source=f.control.db.prepare('SELECT source_id FROM owner_model_sources WHERE permit_id=?').get(permit.id)!;
  f.manager.peek(f.a.world_id)!.store.resolveRecoveryOperation({kind:'model',id:String(source.source_id),decision:'abandon',reason:'Owner has handled this outcome'});await f.scheduler.tick();
  const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
  const calls=await app.inject('/api/owner/automation/calls');expect(calls.json().items[0]).toMatchObject({id:permit.id,reviewed:1});
  const chat=await app.inject({method:'POST',url:'/api/owner/chat',payload:{question:language==='en'?'company status':'公司状态',history:[],language,requestKey:'reviewed-status-'+language}});
  expect(chat.statusCode,chat.body).toBe(200);expect(chat.json().answer).toContain(language==='en'?'without blocking company startup':'不阻止公司启动');expect(chat.json().answer).not.toContain(language==='en'?'Execution stays paused until verified':'核对前保持暂停');expect(f.calls).toHaveLength(1);
});
