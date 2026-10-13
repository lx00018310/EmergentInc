import { afterEach, describe, expect, it } from 'vitest';
import { WorldRegistryStore } from '@emergentinc/persistence';
import { OutcomeUnknownError } from '@emergentinc/model';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { QianjiWorldGateway } from '../src/services/qianji_world_gateway.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
describe('V29 global permits',()=>{
  it('keeps cumulative usage across OFF/ON and database reopen, and approves only a higher total',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on(null,2000);
    const request={model:'test',messages:[],promptHash:'quota',maxTokens:200};
    await f.gate.provider(f.provider,f.meter).call(request);f.off();
    f.gate.control({desiredMode:'ON',expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()});
    const reopened=new WorldRegistryStore(f.control.db.dbPath),gate=new OwnerAutomationGate(reopened);
    try{
      expect(gate.view()).toMatchObject({desiredMode:'ON',maxTokens:2000,spentTokens:30});
      expect(()=>gate.control({maxTokens:1999,expectedRevision:gate.view().revision,idempotencyKey:crypto.randomUUID()})).toThrow('OWNER_BUDGET_BELOW_SPENT');
      const approval={maxTokens:3000,expectedRevision:gate.view().revision,idempotencyKey:crypto.randomUUID()};
      const approved=gate.control(approval);expect(gate.control(approval)).toEqual(approved);
      expect(approved).toMatchObject({desiredMode:'ON',maxTokens:3000,spentTokens:30});
      expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_token_quota_approved'").get()!.n).toBe(2);
    }finally{reopened.close();}
  });
  it('waits for a quota increase without switching OFF or resetting paid usage',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on(null,1200);
    f.respond(async()=>({rawText:'Paid result',usage:{promptTokens:1000,completionTokens:200,cachedTokens:0}}));
    const provider=f.gate.provider(f.provider,f.meter),request={model:'test',messages:[],promptHash:'quota',maxTokens:200};
    await provider.call(request);f.gate.enforceLimits();
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',observedState:'LIMIT_REACHED',spentTokens:1200});
    await expect(provider.call(request)).rejects.toThrow('OWNER_TOKEN_LIMIT');expect(f.calls).toHaveLength(1);
    f.gate.control({maxTokens:2400,expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()});
    expect(f.gate.isOn()).toBe(true);await provider.call(request);
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:2400,spentTokens:2400});
  });
  it('reserves the shared quota atomically and releases temporary pressure without demanding a quota increase',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on(null,2000);
    const reopened=new WorldRegistryStore(f.control.db.dbPath),other=new OwnerAutomationGate(reopened);let release!:(v:any)=>void;
    try{
      f.respond(()=>new Promise(resolve=>{release=resolve;}));
      const request={model:'test',messages:[],promptHash:'quota',maxTokens:2000};
      const first=f.gate.provider(f.provider,f.meter).call(request);
      expect(f.gate.view().reservedTokens).toBe(2000);
      await expect(other.provider(f.provider,f.meter).call(request)).rejects.toThrow('OWNER_TOKEN_LIMIT');
      expect(f.calls).toHaveLength(1);expect(f.gate.view().reason).toBeNull();
      release({rawText:'Done',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});await first;
      f.respond(async()=>({rawText:'Next',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
      await other.provider(f.provider,f.meter).call(request);
      expect(other.view()).toMatchObject({spentTokens:60,reservedTokens:0,reason:null});
    }finally{reopened.close();}
  });
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
  it('counts started rounds without a shared round ceiling, including interruptions and idempotent completion',()=>{
    const store=new WorldRegistryStore(),gate=new OwnerAutomationGate(store);cleanups.push(async()=>store.close());
    gate.control({desiredMode:'ON',runMode:'BOUNDED',requestedRounds:2,maxTokens:100000,expectedRevision:0,idempotencyKey:crypto.randomUUID()});
    for(let i=1;i<=30;i++){gate.reserveRun('world',`run-${i}`,1,1);gate.runCreated(`run-${i}`);gate.beginRound(`run-${i}`,1);gate.beginRound(`run-${i}`,1);if(i%3){gate.completeRound(`run-${i}`,1);gate.completeRound(`run-${i}`,1);}gate.finished(`run-${i}`,false);}
    expect(gate.view()).toMatchObject({startedRounds:30,reservedRounds:0,completedRounds:20});
    gate.enforceLimits();expect(gate.view()).toMatchObject({desiredMode:'ON',runMode:'CONTINUOUS',requestedRounds:null});expect(()=>gate.reserveRun('world','extra',1,1)).not.toThrow();gate.cancelRun('extra');
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
    f.gate.control({...input,maxTokens:20000,requestedRounds:10,expectedRevision:1,idempotencyKey:crypto.randomUUID()});expect(f.gate.view()).toMatchObject({startedRounds:1,spentTokens:30,maxTokens:20000,requestedRounds:null,batchId:first.batchId});
    expect(()=>f.gate.control({...input,maxTokens:29,expectedRevision:2,idempotencyKey:crypto.randomUUID()})).toThrow('OWNER_BUDGET_BELOW_SPENT');
  });
  it('does not apply a historical OFF again after a newer ON authorization',()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const input={desiredMode:'OFF',expectedRevision:1,idempotencyKey:crypto.randomUUID()};f.gate.control(input);f.on();f.gate.control(input);expect(f.gate.view().desiredMode).toBe('ON');
  });
});
