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
  it('does not install gateway energy replenishment in company mode',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const runtime=await f.manager.open(f.a.world_id);
    expect(runtime.store.hasUnlimitedEnergy('0_0_0')).toBe(false);expect(runtime.store.hasUnlimitedEnergy('1_0_0')).toBe(false);
    runtime.store.db.prepare('UPDATE pixel_accounts SET energy=0').run();runtime.store.ensureUnlimitedEnergy('0_0_0',500,'no-auto-refill');
    expect(runtime.store.pixels.getPixelAccount('0_0_0')!.energy).toBe(0);
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
    gate.budget.configure({tokenMillions:1,unitPrice:(100000000)/1000000,priceCurrency:'CNY',expectedRevision:gate.budget.view().revision});gate.control({desiredMode:'ON',runMode:'BOUNDED',requestedRounds:2,expectedRevision:0,idempotencyKey:crypto.randomUUID()});
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
    expect(()=>f.gate.ensureRunning('resume',0,'resume')).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');
    const permit=f.gate.modelCalls()[0];f.gate.reconcileCall(String(permit.id),{actualTokens:30,costCny:0.1,reason:'Owner verified actual provider billing evidence',expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()});
    f.gate.ensureRunning('scheduler');expect(f.gate.view()).toMatchObject({desiredMode:'OFF',reason:null,observedState:'STOPPED'});
    f.gate.ensureRunning('explicit_owner_resume',0,'resume');expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:0,spentTokens:30,reservedTokens:0});
  });
  it('does not apply a historical OFF again after a newer ON authorization',()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const input={desiredMode:'OFF',expectedRevision:1,idempotencyKey:crypto.randomUUID()};f.gate.control(input);f.on();f.gate.control(input);expect(f.gate.view().desiredMode).toBe('ON');
  });
});
