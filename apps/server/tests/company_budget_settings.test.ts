import {afterEach,expect,it} from 'vitest';
import {createServer} from '../src/app.js';
import {goalFixture} from './fixtures/owner_goals.js';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WorldRegistryStore} from '@emergentinc/persistence';
import {OwnerAutomationGate} from '../src/services/owner_automation_gate.js';
import {OwnerGoalService} from '../src/services/owner_goal_service.js';
import {QianjiWorldGateway} from '../src/services/qianji_world_gateway.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const settings=(tokenMillions=100,unitPrice=2,priceCurrency:'CNY'|'USD'='CNY',expectedRevision=0)=>({tokenMillions,unitPrice,priceCurrency,expectedRevision,idempotencyKey:crypto.randomUUID()});
it.each([['CNY',2,200000000],['USD',0.3,210000000]] as const)('directly saves a shared allowance in %s without approvals or execution',async(currency,price,amount)=>{
  const f=goalFixture();cleanups.push(f.close);const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
  const payload=settings(100,price,currency),first=await app.inject({method:'POST',url:'/api/owner/budget',payload});expect(first.statusCode,first.body).toBe(200);
  expect(first.json()).toMatchObject({totalMicros:amount,spentMicros:0,availableMicros:amount,needsRefill:false,configuration:{tokenMillions:100,unitPriceCnyMicros:amount/100}});
  const again=await app.inject({method:'POST',url:'/api/owner/budget',payload});expect(again.json()).toEqual(first.json());
  expect(f.gate.budget.view().revision).toBe(1);expect(f.gate.view().desiredMode).toBe('OFF');expect(f.gate.proposals.list()).toEqual([]);expect(f.calls).toHaveLength(0);
  expect((await app.inject({method:'POST',url:'/api/owner/budget',payload:settings(200,price,currency)})).statusCode).toBe(409);
});
it('requires a changed quantity after exhaustion and grants a fresh batch without erasing old spend',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.gate.budget.configure(settings());
  f.control.db.prepare("INSERT INTO owner_model_permits(id,batch_id,state,reserved_tokens,actual_tokens,cost_cny,created_at) VALUES('spent','initial','SETTLED',900000000,900000000,200,?)").run(Date.now());
  f.control.db.prepare("INSERT INTO owner_money_reservations VALUES('spent',200000000,200000000)").run();
  expect(f.gate.budget.view()).toMatchObject({availableMicros:0,spentMicros:200000000,needsRefill:true});
  expect(()=>f.gate.budget.configure(settings(100,3,'CNY',1))).toThrow('OWNER_BUDGET_TOKEN_CHANGE_REQUIRED');
  f.gate.budget.configure(settings(200,2,'CNY',1));
  expect(f.gate.budget.view()).toMatchObject({totalMicros:400000000,availableMicros:400000000,spentMicros:0,historicalCostMicros:200000000,needsRefill:false});
  expect(f.gate.view().spentTokens).toBe(900000000);expect(f.control.db.prepare('SELECT actual_tokens,cost_cny FROM owner_model_permits WHERE id=?').get('spent')).toEqual({actual_tokens:900000000,cost_cny:200});
});
it('refuses an unaffordable request without disabling cheaper work or creating a budget proposal',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.gate.budget.configure(settings(1,0.0001));f.on();
  await expect(f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'insufficient',maxTokens:100})).rejects.toThrow('OWNER_COMPANY_BUDGET_EXHAUSTED');
  expect(f.gate.isOn()).toBe(true);expect(f.gate.budget.view()).toMatchObject({needsRefill:false,availableMicros:100});expect(f.gate.proposals.list()).toEqual([]);expect(f.calls).toHaveLength(0);
  const cheap=new (await import('@emergentinc/model')).UsageMeter({models:{test:{input_cost_per_million:0.001,output_cost_per_million:0.001,currency:'CNY'}}});
  await f.gate.provider(f.provider,cheap).call({model:'test',messages:[],promptHash:'cheaper-independent',maxTokens:100});expect(f.calls).toHaveLength(1);expect(f.gate.view().desiredMode).toBe('ON');
});
it.each([0,10001,1.5])('rejects a token quantity outside integer 1-10000: %s',value=>{
  const f=goalFixture();cleanups.push(f.close);expect(()=>f.gate.budget.configure(settings(value))).toThrow('OWNER_MONEY_INVALID');expect(f.gate.budget.view().activatedAt).toBeNull();
});
it('runs a person at zero virtual energy using money only, without topping up the energy account',async()=>{
  const f=goalFixture();cleanups.push(f.close);const runtime=await f.manager.open(f.a.world_id),pixelId=f.control.world(f.a.world_id).gateway_pixel_id!;
  runtime.store.db.prepare('UPDATE pixel_accounts SET energy=0,active=0 WHERE pixel_id=?').run(pixelId);f.on();
  await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Return the actual result'}],'money-only-person');await f.finish();
  expect(f.work.view().tasks[0].state).toBe('REPLIED');expect(f.calls).toHaveLength(1);expect(runtime.run.getStatus().company_money_budget).toBe(true);expect(runtime.store.runs.getLatestRun()!.run_limit).toBe(0);
  expect(runtime.store.pixels.getPixelAccount(pixelId)).toMatchObject({active:true,energy:0});expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM external_reward_requests').get()!.n).toBe(0);
});
it('does not mistake an ongoing reservation for exhaustion or require a refill after settlement',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.gate.budget.configure(settings(1,0.002));f.on();let release!:(value:any)=>void;f.respond(()=>new Promise(resolve=>release=resolve));
  const provider=f.gate.provider(f.provider,f.meter),request={model:'test',messages:[],maxTokens:100,promptHash:'concurrent'};
  const first=provider.call(request);expect(f.calls).toHaveLength(1);
  expect(()=>f.gate.budget.configure(settings(1,0.000001,'CNY',1))).toThrow('OWNER_COMPANY_BUDGET_EXHAUSTED');
  await expect(provider.call(request)).rejects.toThrow('OWNER_COMPANY_BUDGET_BUSY');expect(f.gate.budget.view().needsRefill).toBe(false);expect(f.calls).toHaveLength(1);
  const held=f.gate.budget.view().reservedMicros;f.gate.budget.configure(settings(2,0.002,'CNY',1));expect(f.gate.budget.view().reservedMicros).toBe(held);
  release({rawText:'Actual result',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});await first;
  expect(f.gate.budget.view()).toMatchObject({availableMicros:3960,reservedMicros:0,needsRefill:false});expect(f.gate.isOn()).toBe(true);
});
it('resumes an existing individual-allowance wait only after company start, reusing its stored message',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.on();const runtime=await f.manager.open(f.a.world_id),turn=await new QianjiWorldGateway(f.manager).enqueue(f.a.qianji_id,'Retained old task','retained-allowance-wait');
  runtime.store.messages.updateStatus(String(turn.message_id),'WAITING_PIXEL_BUDGET');runtime.store.db.prepare('UPDATE pixel_accounts SET energy=0,active=0').run();
  f.control.db.prepare("INSERT INTO owner_work_tasks(id,request_key,person_id,person_name,instruction,state,reason,turn_id,created_at,updated_at) VALUES('old-wait','old-wait-key',?,'Research','Retained old task','BLOCKED','WAITING_PIXEL_BUDGET',?,?,?)").run(f.a.qianji_id,turn.turn_id,Date.now(),Date.now());
  f.off();f.gate.budget.configure(settings(100,2,'CNY',f.gate.budget.view().revision));await f.work.tick();expect(f.work.view().tasks[0].state).toBe('BLOCKED');expect(f.calls).toHaveLength(0);
  f.on();await f.finish();expect(f.work.view().tasks[0].state).toBe('REPLIED');expect(f.calls).toHaveLength(1);expect(f.control.db.prepare('SELECT COUNT(*) n FROM world_chat_turns').get()!.n).toBe(1);expect(runtime.store.messages.getMessage(String(turn.message_id))!.status).toBe('COMMITTED');
});
it('rejects an old money schema without backing it up or granting money',()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'v34-money-rejection-')),file=join(root,'control.sqlite3'),store=new WorldRegistryStore(file);cleanups.push(async()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});new OwnerGoalService(store);
  store.db.exec("CREATE TABLE owner_company_budget(id INTEGER PRIMARY KEY,schema_version INTEGER NOT NULL,total_micros INTEGER NOT NULL,revision INTEGER NOT NULL,activated_at INTEGER); INSERT INTO owner_company_budget VALUES(1,1,5000000,4,1);");
  expect(()=>new OwnerAutomationGate(store)).toThrow('OWNER_MONEY_SCHEMA_UNSUPPORTED');expect(fs.existsSync(file+'.pre-shared-budget.bak')).toBe(false);
  expect(store.db.prepare('SELECT schema_version,total_micros FROM owner_company_budget').get()).toMatchObject({schema_version:1,total_micros:5000000});
});
