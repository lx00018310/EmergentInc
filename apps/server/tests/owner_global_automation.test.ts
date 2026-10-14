import { afterEach, describe, expect, it } from 'vitest';
import { WorldRegistryStore } from '@emergentinc/persistence';
import { OutcomeUnknownError } from '@emergentinc/model';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { QianjiWorldGateway } from '../src/services/qianji_world_gateway.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
describe('V29 global permits',()=>{
  it('grants exactly 10M once, preserves manual OFF and usage across reopen, and reads without side effects',async()=>{
    const f=goalFixture();cleanups.push(f.close);
    expect(f.gate.view()).toMatchObject({desiredMode:'OFF',maxTokens:0,revision:0});
    f.gate.ensureAutoQuota('owner_chat',0,'initial');
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:10_000_000,revision:1});
    f.gate.ensureAutoQuota('owner_chat',0,'initial');
    await f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'quota',maxTokens:200});f.off();
    const reopened=new WorldRegistryStore(f.control.db.dbPath),gate=new OwnerAutomationGate(reopened);
    try{
      gate.ensureAutoQuota('scheduler');gate.ensureAutoQuota('retried_command',0,'initial');
      for(let i=0;i<10;i++){gate.view();gate.isOn();}
      expect(gate.view()).toMatchObject({desiredMode:'OFF',maxTokens:10_000_000,spentTokens:30,revision:2});
      gate.ensureAutoQuota('explicit_resume',0,'resume');
      expect(gate.view()).toMatchObject({desiredMode:'ON',maxTokens:10_000_000,spentTokens:30});
      expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_auto_quota_granted'").get()!.n).toBe(1);
    }finally{reopened.close();}
  });
  it('renews a low quota in the scheduler and a larger reservation by only the needed batches',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on(null,1200);f.gate.enforceLimits();
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:10_001_200});
    const provider=f.gate.provider(f.provider,f.meter),request={model:'test',messages:[],promptHash:'quota',maxTokens:21_000_000};
    await provider.call(request);
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:30_001_200,spentTokens:30,reservedTokens:0});
    expect(f.control.db.prepare("SELECT payload FROM control_events WHERE kind='owner_auto_quota_granted' ORDER BY id").all().map(r=>JSON.parse(String(r.payload)).batches)).toEqual([1,2]);
  });
  it('serializes quota checks across connections and atomically reserves concurrent calls',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on(null,1000);
    const reopened=new WorldRegistryStore(f.control.db.dbPath),other=new OwnerAutomationGate(reopened);let release!:(v:any)=>void;
    try{
      f.gate.ensureAutoQuota('first');other.ensureAutoQuota('second');
      expect(other.view().maxTokens).toBe(10_001_000);
      f.respond(()=>new Promise(resolve=>{release=resolve;}));
      const request={model:'test',messages:[],promptHash:'quota',maxTokens:2000};
      const first=f.gate.provider(f.provider,f.meter).call(request);
      expect(f.gate.view().reservedTokens).toBe(3026);
      f.respond(async()=>({rawText:'Next',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
      await other.provider(f.provider,f.meter).call(request);
      release({rawText:'Done',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});await first;
      expect(other.view()).toMatchObject({spentTokens:60,reservedTokens:0,reason:null});
      expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_auto_quota_granted'").get()!.n).toBe(1);
    }finally{reopened.close();}
  });
  it('does not renew OFF, maintenance, unresolved outcomes or beyond the hard cap',()=>{
    const f=goalFixture();cleanups.push(f.close);f.gate.ensureAutoQuota('scheduler');expect(f.gate.view().maxTokens).toBe(0);
    f.on(null,1000);f.maintenance(true);expect(()=>f.gate.ensureAutoQuota('scheduler')).toThrow('EVOLUTION_QUIESCED');
    f.maintenance(false);f.gate.addUnknownCheck(()=>true);expect(()=>f.gate.ensureAutoQuota('scheduler')).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');expect(f.gate.view().maxTokens).toBe(1000);
    const store=new WorldRegistryStore(),gate=new OwnerAutomationGate(store);cleanups.push(async()=>store.close());
    gate.control({desiredMode:'ON',maxTokens:1_000_000_000,expectedRevision:0,idempotencyKey:crypto.randomUUID()});
    store.db.prepare("INSERT INTO owner_model_permits VALUES('spent','initial',NULL,NULL,NULL,'SETTLED',0,999_900_000,1,0)").run();
    expect(()=>gate.ensureAutoQuota('scheduler')).toThrow('OWNER_TOKEN_LIMIT');expect(gate.view().maxTokens).toBe(1_000_000_000);
  });
  it('grants a single batch when independent processes race on the same SQLite ledger',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on(null,1000);
    const module=pathToFileURL(resolve('apps/server/dist/services/owner_automation_gate.js')).href;
    const persistence=pathToFileURL(resolve('packages/persistence/dist/index.js')).href;
    const code=`import {WorldRegistryStore} from ${JSON.stringify(persistence)};import {OwnerAutomationGate} from ${JSON.stringify(module)};const store=new WorldRegistryStore(${JSON.stringify(f.control.db.dbPath)});new OwnerAutomationGate(store).ensureAutoQuota('process_race');store.close();`;
    const execute=promisify(execFile);
    await Promise.all([1,2,3].map(()=>execute(process.execPath,['--input-type=module','-e',code],{windowsHide:true,timeout:15000})));
    expect(f.gate.view()).toMatchObject({maxTokens:10_001_000,spentTokens:0,reservedTokens:0});expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_auto_quota_granted'").get()!.n).toBe(1);
  },30000);
  it('defaults new World gateways to unlimited energy, preserves legacy and manual settings on reopen, and never refills neighbors',async()=>{
    const f=goalFixture();cleanups.push(f.close);expect(f.control.gatewayInfiniteEnergy(f.a.world_id)).toBe(true);
    f.control.db.prepare('DELETE FROM world_gateway_energy WHERE world_id=?').run(f.b.world_id);
    f.control.setGatewayInfiniteEnergy(f.a.world_id,false);
    const reopened=new WorldRegistryStore(f.control.db.dbPath);try{expect(reopened.gatewayInfiniteEnergy(f.a.world_id)).toBe(false);expect(reopened.gatewayInfiniteEnergy(f.b.world_id)).toBe(false);}finally{reopened.close();}
    f.on();f.control.setGatewayInfiniteEnergy(f.a.world_id,true);const runtime=await f.manager.open(f.a.world_id);
    expect(runtime.store.hasUnlimitedEnergy('0_0_0')).toBe(true);expect(runtime.store.hasUnlimitedEnergy('1_0_0')).toBe(false);f.off();expect(runtime.store.hasUnlimitedEnergy('0_0_0')).toBe(false);
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
  it('requires actual reconciliation and an explicit resume after an unknown bill, without renewing historical usage',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();f.respond(async()=>{throw new OutcomeUnknownError('Disconnected after dispatch');});
    await expect(f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'unknown',maxTokens:200})).rejects.toThrow();
    expect(()=>f.gate.ensureAutoQuota('resume',0,'resume')).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');
    const permit=f.gate.modelCalls()[0];f.gate.reconcileCall(String(permit.id),{actualTokens:30,costCny:0.1,reason:'Owner verified actual provider billing evidence',expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()});
    f.gate.ensureAutoQuota('scheduler');expect(f.gate.view().desiredMode).toBe('OFF');
    f.gate.ensureAutoQuota('explicit_owner_resume',0,'resume');expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:10_000_000,spentTokens:30,reservedTokens:0});
  });
  it('preserves usage during an explicit budget edit and deduplicates repeated ON requests',async()=>{
    const f=goalFixture();cleanups.push(f.close);const input={desiredMode:'ON',runMode:'BOUNDED',requestedRounds:7,maxTokens:1_000_000,expectedRevision:0,idempotencyKey:crypto.randomUUID()},first=f.gate.control(input);expect(f.gate.control(input)).toEqual(first);
    f.gate.reserveRun('w','permit',1,1);f.gate.runCreated('permit');f.gate.beginRound('permit',1);f.gate.completeRound('permit',1);f.gate.finished('permit',false);
    await f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'cost',maxTokens:200});
    f.gate.control({...input,maxTokens:2_000_000,requestedRounds:10,expectedRevision:1,idempotencyKey:crypto.randomUUID()});expect(f.gate.view()).toMatchObject({startedRounds:1,spentTokens:30,maxTokens:2_000_000,requestedRounds:null,batchId:first.batchId});
    expect(()=>f.gate.control({...input,maxTokens:29,expectedRevision:2,idempotencyKey:crypto.randomUUID()})).toThrow('OWNER_BUDGET_BELOW_SPENT');
  });
  it('does not apply a historical OFF again after a newer ON authorization',()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const input={desiredMode:'OFF',expectedRevision:1,idempotencyKey:crypto.randomUUID()};f.gate.control(input);f.on();f.gate.control(input);expect(f.gate.view().desiredMode).toBe('ON');
  });
});
