import {afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {CurrentStore,readGenome} from '@emergentinc/persistence';
import {createServer} from '../src/app.js';
import {OwnerGoalScheduler} from '../src/services/owner_goal_scheduler.js';
import {bootstrapWorlds} from '../src/world_bootstrap.js';
import {reserveTestHttpPort} from '../../../tests/http_port.js';
import {goalFixture} from './fixtures/owner_goals.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();vi.unstubAllEnvs();});

it('returns saved money settings independently of later scheduler failure',async()=>{
  const f=goalFixture();cleanups.push(f.close);
  const tick=vi.spyOn(OwnerGoalScheduler.prototype,'tick').mockRejectedValue(new Error('ISOLATED_SCHEDULER_FAILED'));
  // The real server's onReady starts a 1s timer; the mocked tick would trip the scheduler
  // safety block one second into the test. Stop the timer and drive ticks manually.
  await f.scheduler.close();
  const resume=vi.spyOn(f.manager,'resumeInterrupted').mockRejectedValue(new Error('ISOLATED_RESUME_FAILED'));
  const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
  const result=await app.inject({method:'POST',url:'/api/owner/budget',payload:{tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:0,idempotencyKey:'separate-budget'}});
  expect(result.statusCode,result.body).toBe(200);expect(result.json().totalMicros).toBe(1000000);
  expect(tick).not.toHaveBeenCalled();expect(resume).not.toHaveBeenCalled();
  await expect(f.scheduler.tick()).rejects.toThrow('ISOLATED_SCHEDULER_FAILED');
  expect(f.gate.proposals.list()).toHaveLength(0);expect(f.gate.budget.view().totalMicros).toBe(1000000);
  const enabled=await app.inject({method:'POST',url:'/api/owner/automation',payload:{desiredMode:'ON',expectedRevision:f.gate.view().revision,idempotencyKey:'separate-enable'}});
  expect(enabled.statusCode,enabled.body).toBe(200);expect(enabled.json().desiredMode).toBe('ON');expect(resume).not.toHaveBeenCalled();expect(f.calls).toHaveLength(0);
});

it('authorizes money without changing tasks; only an enabled scheduler removes a money wait',async()=>{
  const f=goalFixture();cleanups.push(f.close);const goal=f.goal();f.gate.goals.state(goal.id,'BLOCKED','OWNER_COMPANY_BUDGET_EXHAUSTED');
  f.gate.budget.configure({tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:0});
  expect(f.gate.goals.get(goal.id).status).toBe('BLOCKED');expect(f.gate.view().desiredMode).toBe('OFF');
  await f.scheduler.tick();expect(f.gate.goals.get(goal.id).status).toBe('BLOCKED');
  const worlds=f.manager.list();vi.spyOn(f.manager,'list').mockImplementation(()=>worlds.map(w=>({...w,running:true})));vi.spyOn(f.manager,'resumeInterrupted').mockResolvedValue();
  f.on();await f.scheduler.tick();expect(f.gate.goals.get(goal.id).status).toBe('READY');expect(f.calls).toHaveLength(0);
});

it('funds an unopened World without resuming its suspended task; the scheduler resumes it separately',async()=>{
  const f=goalFixture();cleanups.push(f.close);f.goal();let release!:(value:any)=>void;
  f.respond(()=>f.calls.length===1?new Promise(resolve=>{release=resolve;}):Promise.resolve({rawText:JSON.stringify({owner_reply:'Actual result',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
  f.on();await f.scheduler.tick();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
  f.off();release({rawText:JSON.stringify({operations:[{tool:'save_artifact',args:{filename:'result.md',content:'A real result produced after explicit scheduling.'}}],send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});
  await vi.waitFor(()=>expect(f.manager.list().some(w=>w.running)).toBe(false));
  const world=f.manager.list().find(w=>w.opened)!,runId=f.manager.peek(world.world_id)!.run.getStatus().run_id;
  await f.manager.resumeInterrupted();await f.manager.close(world.world_id);f.on();
  f.gate.budget.configure({tokenMillions:200,unitPrice:2,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});expect(f.manager.peek(world.world_id)).toBeUndefined();expect(f.calls).toHaveLength(1);
  const runtime=await f.manager.open(world.world_id);expect(runtime.run.getStatus().running).toBe(false);expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM tool_executions').get()!.n).toBe(0);
  await f.scheduler.tick();await vi.waitFor(()=>expect(f.manager.list().some(w=>w.running)).toBe(false));
  expect(f.calls).toHaveLength(2);expect(runtime.run.getStatus().run_id).toBe(runId);expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM tool_executions').get()!.n).toBe(1);
},15000);

it('clears a resolved historical cost review without waking the company or hiding other unknown outcomes',async()=>{
  const f=goalFixture();cleanups.push(f.close);const runtime=await f.manager.open(f.a.world_id),core=runtime.store,pixelId=f.registry.control.world(f.a.world_id).gateway_pixel_id!;
  const message=core.messages.enqueueMessage({sender:'system',recipient:pixelId,content:'Retained response',roundNum:1});
  core.budgets.reserve({callId:'historical-cost',runId:'old-run',pixelId,estimatedTokens:100});
  core.settleAndStoreModelResponse({callId:'historical-cost',runId:'old-run',pixelId,messageId:message.messageId,model:'test',promptHash:'h',rawResponse:'Stored result',usage:{promptTokens:30,completionTokens:10,cachedTokens:5,actualTokens:40,costCny:null}});
  f.control.db.prepare("INSERT INTO owner_model_permits(id,batch_id,world_id,state,reserved_tokens,actual_tokens,created_at) VALUES('historical-permit','initial',?,'UNKNOWN',100,40,?)").run(f.a.world_id,Date.now());
  f.control.db.prepare("INSERT INTO owner_model_sources VALUES('historical-permit','historical-cost','world')").run();f.off();
  let otherUnknown=true;f.gate.addUnknownCheck(worldId=>worldId===f.b.world_id&&otherUnknown);
  const energy=core.pixels.getPixelAccount(pixelId)!.energy,spent=core.budgets.getGlobalBudget()!.totalSpent;
  core.resolveRecoveryOperation({kind:'model',id:'historical-cost',decision:'settle_billed',actualTokens:40,costCny:0.000209,reason:'Verified frozen pricing and stored usage'});
  await f.scheduler.tick();expect(f.gate.modelCalls()).toHaveLength(0);expect(f.gate.scopeBlocked(f.b.world_id)).toBe(true);expect(f.gate.view().desiredMode).toBe('OFF');
  otherUnknown=false;await f.scheduler.tick();expect(f.gate.view()).toMatchObject({desiredMode:'OFF',reason:null,observedState:'STOPPED',spentTokens:40,reservedTokens:0});
  expect(f.gate.budget.view()).toMatchObject({activatedAt:null,totalMicros:0,historicalCostMicros:209});
  expect(core.pixels.getPixelAccount(pixelId)!.energy).toBe(energy);expect(core.budgets.getGlobalBudget()!.totalSpent).toBe(spent);expect(f.calls).toHaveLength(0);
});
