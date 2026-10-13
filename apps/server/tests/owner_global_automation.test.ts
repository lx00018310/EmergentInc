import { afterEach, describe, expect, it } from 'vitest';
import { WorldRegistryStore } from '@emergentinc/persistence';
import { OutcomeUnknownError } from '@emergentinc/model';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { QianjiWorldGateway } from '../src/services/qianji_world_gateway.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
describe('V29 global permits',()=>{
  it('reuses the same inbox message after a crash between World and control persistence, without a second paid task',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const gateway=new QianjiWorldGateway(f.manager),first=await gateway.enqueue(f.a.qianji_id,'One durable task','stable-key');
    f.control.db.prepare('DELETE FROM world_chat_turns WHERE turn_id=?').run(first.turn_id);
    const second=await gateway.enqueue(f.a.qianji_id,'One durable task','stable-key');expect(second.turn_id).toBe(first.turn_id);expect(second.message_id).toBe(first.message_id);
    expect(f.manager.peek(f.a.world_id)!.store.db.prepare('SELECT COUNT(*) n FROM world_chat_inbox').get()!.n).toBe(1);expect(f.calls).toHaveLength(0);
  });
  it('releases a prepared permit and restores its durable task only after proving no core Run exists',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();await f.manager.open(f.a.world_id);f.gate.reserveRun(f.a.world_id,'never-created',1,1);
    f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('task-prepare','request-prepare',?,?,?,'RUNNING',NULL,'never-created',NULL,NULL,?,?)").run(f.a.qianji_id,'Research','Durable prepared task',Date.now(),Date.now());
    await f.manager.close(f.a.world_id);await f.manager.open(f.a.world_id);expect(f.gate.view().reservedRounds).toBe(0);expect(f.work.view().tasks[0]).toMatchObject({state:'QUEUED',runId:null});expect(f.calls).toHaveLength(0);
  });
  it('defaults OFF, blocks manual Runs and old queued Owner work, and stays idle without spending on an empty list',async()=>{
    const f=goalFixture();cleanups.push(f.close);const runtime=await f.manager.open(f.a.world_id);
    await expect(runtime.run.start({rounds:1,runBudgetTokens:100000})).rejects.toThrow('OWNER_AUTOMATION_OFF');
    f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('old-task','old-key',?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(f.a.qianji_id,'Research','Do work',Date.now(),Date.now());
    await f.work.tick();expect(f.calls).toHaveLength(0);expect(f.work.view().tasks[0].turnId).toBeNull();
    f.control.db.prepare("DELETE FROM owner_work_tasks WHERE id='old-task'").run();f.on();await f.scheduler.tick();expect(f.gate.view()).toMatchObject({observedState:'IDLE',startedRounds:0,spentTokens:0});expect(f.calls).toHaveLength(0);
  });
  it('reserves and counts exactly 10000 distinct started rounds, including interruptions; repeated starts/completions never double-charge',()=>{
    const store=new WorldRegistryStore(),gate=new OwnerAutomationGate(store);cleanups.push(async()=>store.close());
    gate.control({desiredMode:'ON',runMode:'BOUNDED',requestedRounds:10000,maxTokens:100000,expectedRevision:0,idempotencyKey:crypto.randomUUID()});
    for(let i=1;i<=10000;i++){gate.reserveRun('world',`run-${i}`,1,1);gate.runCreated(`run-${i}`);gate.beginRound(`run-${i}`,1);gate.beginRound(`run-${i}`,1);if(i%3){gate.completeRound(`run-${i}`,1);gate.completeRound(`run-${i}`,1);}gate.finished(`run-${i}`,false);}
    expect(gate.view()).toMatchObject({startedRounds:10000,reservedRounds:0,completedRounds:6667});
    gate.enforceLimits();expect(gate.view()).toMatchObject({desiredMode:'OFF',observedState:'LIMIT_REACHED'});expect(()=>gate.reserveRun('world','extra',1,1)).toThrow('OWNER_AUTOMATION_OFF');
  },60000);
  it('holds unknown model charges after a timeout and refuses restart or budget reset',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();f.respond(async()=>{throw new OutcomeUnknownError('Connection reset after dispatch');});
    const provider=f.gate.provider(f.provider,f.meter);await expect(provider.call({model:'test',messages:[{role:'user',content:'Test'}],promptHash:'hash',maxTokens:200})).rejects.toThrow();
    expect(f.gate.view()).toMatchObject({desiredMode:'OFF',observedState:'BLOCKED'});expect(f.gate.view().reservedTokens).toBeGreaterThan(0);expect(()=>f.on()).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');expect(f.calls).toHaveLength(1);
  });
  it('does not treat missing prices/usage as free work and does not permit maintenance to be awakened',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();f.maintenance(true);await expect(f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'x',maxTokens:10})).rejects.toThrow('EVOLUTION_QUIESCED');
    f.maintenance(false);await expect(f.gate.provider(f.provider,f.meter).call({model:'missing',messages:[],promptHash:'x',maxTokens:10})).rejects.toThrow('MODEL_PRICE_REQUIRED');expect(f.calls).toHaveLength(0);
    f.respond(async()=>({rawText:'Unknown usage'}));await f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'x',maxTokens:10});expect(f.gate.view()).toMatchObject({desiredMode:'OFF',observedState:'BLOCKED'});
  });
  it('preserves usage during an explicit budget edit and deduplicates repeated ON requests',async()=>{
    const f=goalFixture();cleanups.push(f.close);const input={desiredMode:'ON',runMode:'BOUNDED',requestedRounds:7,maxTokens:10000,expectedRevision:0,idempotencyKey:crypto.randomUUID()},first=f.gate.control(input);expect(f.gate.control(input)).toEqual(first);
    f.gate.reserveRun('w','permit',1,1);f.gate.runCreated('permit');f.gate.beginRound('permit',1);f.gate.completeRound('permit',1);f.gate.finished('permit',false);
    await f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'cost',maxTokens:200});
    f.gate.control({...input,maxTokens:20000,requestedRounds:10,expectedRevision:1,idempotencyKey:crypto.randomUUID()});expect(f.gate.view()).toMatchObject({startedRounds:1,spentTokens:30,maxTokens:20000,requestedRounds:10,batchId:first.batchId});
    expect(()=>f.gate.control({...input,maxTokens:29,expectedRevision:2,idempotencyKey:crypto.randomUUID()})).toThrow('OWNER_BUDGET_BELOW_SPENT');
  });
  it('does not apply a historical OFF again after a newer ON authorization',()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const input={desiredMode:'OFF',expectedRevision:1,idempotencyKey:crypto.randomUUID()};f.gate.control(input);f.on();f.gate.control(input);expect(f.gate.view().desiredMode).toBe('ON');
  });
});
