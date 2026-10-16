import {afterEach,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {CurrentStore,readGenome} from '@emergentinc/persistence';
import {createServer} from '../src/app.js';
import {LifeContext} from '../src/services/life_context.js';
import {BusinessService} from '../src/services/business_service.js';
import {BodyGrowthService} from '../src/services/body_growth_service.js';
import {DreamService} from '../src/services/dream_service.js';
import {MemoryGate} from '../src/services/memory_gate.js';
import {OwnerGoalScheduler} from '../src/services/owner_goal_scheduler.js';
import {bootstrapWorlds} from '../src/world_bootstrap.js';
import {reserveTestHttpPort} from '../../../tests/http_port.js';
import {goalFixture} from './fixtures/owner_goals.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();vi.unstubAllEnvs();});

it('returns saved money settings independently of later scheduler failure',async()=>{
  const f=goalFixture();cleanups.push(f.close);
  const tick=vi.spyOn(OwnerGoalScheduler.prototype,'tick').mockRejectedValue(new Error('ISOLATED_SCHEDULER_FAILED'));
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

it('keeps Gene approval successful and retries preparation separately without repeating approval',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'separate-gene-'));cleanups.push(async()=>{fs.rmSync(root,{recursive:true,force:true});});
  const genome=readGenome(resolve('.')),life=LifeContext.open(root,genome.manifest,genome.geneHash,'r1');cleanups.push(async()=>life.close());
  const prepare=vi.fn().mockRejectedValueOnce(new Error('ISOLATED_PREPARATION_FAILED')).mockResolvedValue({id:'prepared-request'});
  const app=await createServer({workspaceRoot:root,runtimeMode:'business',businessService:new BusinessService(life.lineage),ownerAuth:{secret:'s'.repeat(40),secureCookies:false},evolution:{life,body:new BodyGrowthService(life),dream:new DreamService(life),memoryGate:new MemoryGate(life.lineage,()=>String(life.current.meta().generation_id)),prepareProposal:prepare}});cleanups.push(()=>app.close());
  const proposal=life.lineage.proposeGene(String(life.current.meta().generation_id),'owner',{point:'Reusable direction',reason:'Actual review',effect:'Next candidate'},'separate-direction'),url='/api/evolution/proposals/'+proposal.id;
  const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:'s'.repeat(40)}}),headers={cookie:String(login.headers['set-cookie']).split(';')[0]};
  expect((await app.inject({method:'POST',url:url+'/prepare',payload:{expectedGeneration:proposal.generation_id}})).statusCode).toBe(401);
  expect((await app.inject({method:'POST',url:url+'/prepare',headers,payload:{expectedGeneration:proposal.generation_id}})).statusCode).toBe(409);expect(prepare).not.toHaveBeenCalled();
  const approved=await app.inject({method:'POST',url:url+'/decision',headers,payload:{decision:'APPROVED',expectedGeneration:proposal.generation_id,expectedState:'PROPOSED'}});
  expect(approved.statusCode).toBe(200);expect(approved.json().state).toBe('APPROVED');expect(prepare).not.toHaveBeenCalled();
  const payload={expectedGeneration:proposal.generation_id};
  const failed=await app.inject({method:'POST',url:url+'/prepare',headers,payload});expect(failed.statusCode,failed.body).toBe(500);expect(life.lineage.proposal(proposal.id).state).toBe('APPROVED');
  const retry=await app.inject({method:'POST',url:url+'/prepare',headers,payload});expect(retry.statusCode,retry.body).toBe(200);expect(retry.json().id).toBe('prepared-request');
  expect(life.lineage.db.prepare("SELECT COUNT(*) n FROM life_events WHERE kind='owner_gene_decision'").get()!.n).toBe(1);
  expect((await app.inject({method:'POST',url:url+'/prepare',headers,payload:{expectedGeneration:'G9999'}})).statusCode).toBe(409);expect(prepare).toHaveBeenCalledTimes(2);
  let finish!:(value:unknown)=>void;prepare.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const first=app.inject({method:'POST',url:url+'/prepare',headers,payload}),second=app.inject({method:'POST',url:url+'/prepare',headers,payload});
  const pending=Promise.all([first,second]);await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));finish({id:'shared-request'});
  expect((await pending).map(r=>r.json().id)).toEqual(['shared-request','shared-request']);expect(prepare).toHaveBeenCalledTimes(3);
});

it('retries a partial service start before ending maintenance, without duplicate timers or paid work',async()=>{
  const f=goalFixture();cleanups.push(f.close);const {manifest,geneHash}=readGenome(resolve('.'));
  fs.writeFileSync(join(f.root,'workspace-layout.json'),JSON.stringify({schema:1,version:23}));
  f.lineage.db.prepare("UPDATE generations SET gene_hash=? WHERE id='G0001'").run(geneHash);
  const current=new CurrentStore(join(f.root,'system/generations/G0001/current.sqlite3'));current.initialize(f.lineage.generation('G0001'),manifest.body_interface_version);current.close();
  for(const world of f.registry.list()){const c=new CurrentStore(join(f.registry.directory(world.world_id),'generations/G0001/current.sqlite3'));c.db.prepare('UPDATE current_meta SET gene_hash=?,body_interface_version=?').run(geneHash,manifest.body_interface_version);c.close();}
  for(const [name,value] of Object.entries({EMERGENTINC_CANDIDATE_MODE:'0',EMERGENTINC_START_PAUSED:'1',EMERGENTINC_RELEASE_ID:'r1',MCL_API_KEY:'',EMERGENT_MOCK_MODE:'0',PORT:String(await reserveTestHttpPort())}))vi.stubEnv(name,value);
  const intervals=vi.spyOn(globalThis,'setInterval'),start=vi.spyOn(BusinessService.prototype,'start');start.mockImplementationOnce(()=>{throw new Error('ISOLATED_SERVICE_START_FAILED');});
  const signals=new Map(['SIGINT','SIGTERM'].map(s=>[s,new Set(process.listeners(s))]));
  const app=await bootstrapWorlds(resolve('.'),{workspaceRoot:f.root,host:'127.0.0.1',ownerAuth:{secret:'s'.repeat(40),secureCookies:false},trustLoopbackProxy:false} as any,()=>{});cleanups.push(async()=>{await app.close();for(const [signal,prior] of signals)for(const listener of process.listeners(signal))if(!prior.has(listener))process.removeListener(signal,listener);});
  const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:'s'.repeat(40)}}),headers={cookie:String(login.headers['set-cookie']).split(';')[0]};
  const first=await app.inject({method:'POST',url:'/api/evolution/resume',headers,payload:{}});expect(first.statusCode,first.body).toBe(500);
  expect((await app.inject({url:'/api/owner/automation',headers})).json().reason).toBe('EVOLUTION_QUIESCED');const partial=intervals.mock.calls.length;
  const retry=await app.inject({method:'POST',url:'/api/evolution/resume',headers,payload:{}});expect(retry.statusCode,retry.body).toBe(200);expect(intervals.mock.calls.length).toBe(partial+1);
  const complete=intervals.mock.calls.length;expect((await app.inject({method:'POST',url:'/api/evolution/resume',headers,payload:{}})).statusCode).toBe(200);expect(intervals.mock.calls.length).toBe(complete);
  expect((await app.inject({method:'POST',url:'/api/evolution/quiesce',headers,payload:{}})).statusCode).toBe(200);
  expect((await app.inject({url:'/api/owner/automation',headers})).json().reason).toBe('EVOLUTION_QUIESCED');
  expect((await app.inject({method:'POST',url:'/api/evolution/resume',headers,payload:{}})).statusCode).toBe(200);expect(intervals.mock.calls.length).toBe(complete+3);
  const automation=(await app.inject({url:'/api/owner/automation',headers})).json();expect(automation.desiredMode).toBe('OFF');expect(automation.reason).toBeNull();expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_model_permits').get()!.n).toBe(0);
},15000);

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
  f.control.db.prepare("INSERT INTO owner_model_sources VALUES('historical-permit','historical-cost','world')").run();f.gate.halt('OWNER_OUTCOME_REVIEW_REQUIRED');
  let otherUnknown=true;f.gate.addUnknownCheck(()=>otherUnknown);
  const energy=core.pixels.getPixelAccount(pixelId)!.energy,spent=core.budgets.getGlobalBudget()!.totalSpent;
  core.resolveRecoveryOperation({kind:'model',id:'historical-cost',decision:'settle_billed',actualTokens:40,costCny:0.000209,reason:'Verified frozen pricing and stored usage'});
  await f.scheduler.tick();expect(f.gate.modelCalls()).toHaveLength(0);expect(f.gate.view().reason).toBe('OWNER_OUTCOME_REVIEW_REQUIRED');
  otherUnknown=false;await f.scheduler.tick();expect(f.gate.view()).toMatchObject({desiredMode:'OFF',reason:null,observedState:'STOPPED',spentTokens:40,reservedTokens:0});
  expect(f.gate.budget.view()).toMatchObject({activatedAt:null,totalMicros:0,historicalCostMicros:209});
  expect(core.pixels.getPixelAccount(pixelId)!.energy).toBe(energy);expect(core.budgets.getGlobalBudget()!.totalSpent).toBe(spent);expect(f.calls).toHaveLength(0);
});
