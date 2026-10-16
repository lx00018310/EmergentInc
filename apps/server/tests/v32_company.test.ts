import {afterEach,describe,it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer as createHttpServer} from 'node:http';
import {listenTestHttp} from '../../../tests/http_port.js';
import {createHash} from 'node:crypto';
import {WorldRegistryStore} from '@emergentinc/persistence';
import {InfrastructureFailureError,OutcomeUnknownError,UsageMeter} from '@emergentinc/model';
import {OwnerAutomationGate} from '../src/services/owner_automation_gate.js';
import {nextTaskOccurrence} from '../src/services/owner_task_plan_service.js';
import {goalFixture} from './fixtures/owner_goals.js';
import {createServer} from '../src/app.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const plan={summary:'First research, then deliver a source-backed summary',nodes:[{key:'research',title:'Research',instruction:'Retain FIRST_VERIFIED_FACT',dependsOn:[],trigger:{kind:'once'},filename:'first.md'},{key:'summary',title:'Summary',instruction:'Use the actual first result',dependsOn:['research'],trigger:{kind:'once'},filename:'second.md'}]};
describe('V32 company money, proposals and task loop',()=>{
  it('uses the configured cached-token price and keeps fractional micro-costs consistent in the company ledger',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const meter=new UsageMeter(JSON.parse(fs.readFileSync(resolve('resources/config/model_pricing.json'),'utf8')));
    f.respond(async()=>({rawText:'Actual priced fixture response',usage:{promptTokens:20,completionTokens:10,cachedTokens:10}}));await f.gate.provider(f.provider,meter).call({model:'gpt-4o-mini',messages:[],maxTokens:100,promptHash:'configured-cache-price'});
    expect(f.gate.budget.view()).toMatchObject({spentMicros:61,reservedMicros:0,unknownCalls:0});expect(f.gate.view().knownCostCny).toBe(0.000061);
    f.respond(async()=>({rawText:'Sub-micro fixture response',usage:{promptTokens:1,completionTokens:1,cachedTokens:0}}));await f.gate.provider(f.provider,meter).call({model:'glm-5.3-flash',messages:[],maxTokens:100,promptHash:'fractional-cost'});expect(f.gate.budget.view().spentMicros).toBe(62);expect(f.gate.view().knownCostCny).toBe(0.000062);
  });
  it('does not convert old token authorization to money or wake a manual pause',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.control.db.prepare("UPDATE owner_automation_control SET max_tokens=1000000000,desired_mode='ON'").run();
    expect(f.gate.budget.view()).toMatchObject({totalMicros:0,activatedAt:null});expect(f.gate.isOn()).toBe(false);
    await expect(f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],maxTokens:100,promptHash:'test'})).rejects.toThrow('OWNER_COMPANY_BUDGET_REQUIRED');
    expect(f.calls).toHaveLength(0);f.gate.budget.configure({tokenMillions:1,unitPrice:(10000)/1000000,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});f.off();f.gate.enforceLimits();expect(f.gate.view().desiredMode).toBe('OFF');
    expect(()=>f.gate.control({maxTokens:1000000000,expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()})).toThrow();
  });
  it('atomically reserves integer money on two connections and settles only the actual cost once',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();
    const otherStore=new WorldRegistryStore(f.control.db.dbPath),other=new OwnerAutomationGate(otherStore);let release!:(v:any)=>void;
    try{
      // 1026 input upper-bound tokens + 100 output at the fixture price = 1226 micros.
      f.control.db.prepare('UPDATE owner_company_budget SET total_micros=1300').run();
      f.respond(()=>new Promise(r=>{release=r;}));const request={model:'test',messages:[],maxTokens:100,promptHash:'money'};
      const first=f.gate.provider(f.provider,f.meter).call(request);expect(f.gate.budget.view().reservedMicros).toBe(1226);
      await expect(other.provider(f.provider,f.meter).call(request)).rejects.toThrow('OWNER_COMPANY_BUDGET_BUSY');expect(other.budget.view().needsRefill).toBe(false);expect(f.calls).toHaveLength(1);
      release({rawText:'Done',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});await first;
      expect(other.budget.view()).toMatchObject({spentMicros:40,reservedMicros:0,availableMicros:1260});
    }finally{otherStore.close();}
  });
  it('keeps unknown money reserved, records provably not-sent at zero, and does not repeat a dispatched call',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const request={model:'test',messages:[],maxTokens:100,promptHash:'unknown'};
    f.respond(async()=>{throw new InfrastructureFailureError('PROVABLY_NOT_SENT');});await expect(f.gate.provider(f.provider,f.meter).call(request)).rejects.toThrow();expect(f.gate.budget.view()).toMatchObject({spentMicros:0,reservedMicros:0});
    f.respond(async()=>{throw new OutcomeUnknownError('DISPATCHED');});await expect(f.gate.provider(f.provider,f.meter).call(request)).rejects.toThrow();
    expect(f.gate.budget.view()).toMatchObject({reservedMicros:1226,unknownCalls:1});
    await expect(f.gate.provider(f.provider,f.meter).call(request)).rejects.toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');expect(f.calls).toHaveLength(2);
  });
  it('executes an approved plan once, passes immutable step evidence, and waits for Owner closure',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Two-stage research','manual');
    const view=f.gate.proposals.plans.install(goal.id,plan,false),proposal=f.gate.proposals.propose('task_plan',{title:goal.title,planHash:hash(view),plan},'plan-test',goal.id);
    await f.scheduler.tick();expect(f.calls).toHaveLength(0);
    const accepted=f.gate.proposals.decide(proposal.id,{decision:'approve',hash:proposal.hash,idempotencyKey:crypto.randomUUID()});expect(accepted.state).toBe('EXECUTED');
    f.gate.proposals.decide(proposal.id,{decision:'approve',hash:proposal.hash,idempotencyKey:crypto.randomUUID()});
    let calls=0;f.respond(async request=>{calls++;if(calls===3)expect(JSON.stringify(request.messages)).toContain('FIRST_VERIFIED_FACT');return {rawText:JSON.stringify(calls%2?{operations:[{tool:'save_artifact',args:{filename:calls===1?'first.md':'second.md',content:calls===1?'FIRST_VERIFIED_FACT':'Actual second-step result using the verified first evidence'}}],send_to:'STOP'}:{owner_reply:'The actual step result has been retained.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}};});
    await f.scheduler.tick();await f.finish();
    expect(f.gate.proposals.plans.get(goal.id)!.nodes.map(n=>n.occurrences)).toEqual([1,1]);
    expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.calls).toHaveLength(4);
    const close=f.gate.proposals.list().find(p=>p.kind==='close_task')!;expect(close).toBeDefined();
    const artifact=f.gate.goals.detail(goal.id).evidence.find(e=>e.kind==='artifact')!,file=join(f.registry.directory(artifact.worldId!),artifact.reference),original=fs.readFileSync(file);fs.writeFileSync(file,'Changed after review');
    expect(()=>f.gate.proposals.decide(close.id,{decision:'approve',hash:close.hash,idempotencyKey:'changed-evidence-approval'})).toThrow('OWNER_EVIDENCE_CHANGED');fs.writeFileSync(file,original);
    f.gate.proposals.decide(close.id,{decision:'approve',hash:close.hash,idempotencyKey:crypto.randomUUID()});
    expect(f.gate.goals.get(goal.id).status).toBe('COMPLETED');await f.scheduler.tick();expect(f.calls).toHaveLength(4);
    expect(f.payments.db.prepare('SELECT COUNT(*) n FROM world_revenue_events').get()!.n).toBe(0);
  });
  it('rejects dependency cycles and preserves running and completed nodes on AI replanning',()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Replanning','manual');
    expect(()=>f.gate.proposals.plans.validate({...plan,nodes:plan.nodes.map((n,i)=>({...n,dependsOn:[i?'research':'summary']}))})).toThrow('OWNER_TASK_PLAN_CYCLE');
    f.gate.proposals.plans.install(goal.id,plan,true);f.gate.proposals.plans.claim(goal.id,'research','dispatch_fixture');
    expect(()=>f.gate.proposals.plans.reviseInternal(goal.id,{...plan,nodes:plan.nodes.map(n=>({...n,instruction:'Changed'}))},'dispatch_fixture')).toThrow('OWNER_TASK_COMPLETED_STEP_CHANGED');
    const next=f.gate.proposals.plans.reviseInternal(goal.id,{...plan,nodes:[plan.nodes[0],{...plan.nodes[1],instruction:'Use the real source and improve presentation'}]},'dispatch_fixture');expect(next.planRevision).toBe(2);expect(next.approved).toBe(true);
  });
  it('persists one overdue occurrence, does not overlap or catch up in bursts, and resumes on reopen',()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Daily observation','manual');
    const timed={summary:'Observe every five minutes',nodes:[{...plan.nodes[0],trigger:{kind:'interval',everyMinutes:5}}]};f.gate.proposals.plans.install(goal.id,timed,true);
    const first=f.gate.proposals.plans.due(goal.id)!;f.gate.proposals.plans.claim(goal.id,first.key,'dispatch_timer');
    expect(f.gate.proposals.plans.due(goal.id,Date.now()+86400000)).toBeNull();
    const now=Date.now()+86400000;f.gate.proposals.plans.complete('dispatch_timer',[],now);
    expect(f.gate.proposals.plans.get(goal.id)!.nodes[0].nextAt).toBe(now+300000);
    const store=new WorldRegistryStore(f.control.db.dbPath),reopened=new OwnerAutomationGate(store);try{expect(reopened.proposals.plans.get(goal.id)!.nodes[0]).toMatchObject({occurrences:1,nextAt:now+300000});}finally{store.close();}
  });
  it('computes weekly local-time schedules across a daylight-saving transition',()=>{
    const trigger={kind:'weekly' as const,time:'09:00',timezone:'America/New_York',weekdays:[1]};
    expect(new Date(nextTaskOccurrence(trigger,Date.parse('2026-03-07T18:00:00Z'))!).toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });
  it('reopens the completed World receipt after restart and advances without paying for its first step twice',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Restarted plan','manual');f.gate.proposals.plans.install(goal.id,plan,true);let calls=0;
    f.respond(async()=>({rawText:JSON.stringify(++calls%2?{operations:[{tool:'save_artifact',args:{filename:calls===1?'first.md':'second.md',content:'Immutable verified step '+calls}}],send_to:'STOP'}:{owner_reply:'Actual retained result',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    await f.scheduler.tick();await vi.waitFor(async()=>{await f.work.tick();expect(f.work.view().tasks[0].state).toBe('REPLIED');});await f.manager.closeAll();
    await f.scheduler.tick();await f.finish();expect(f.calls).toHaveLength(4);expect(f.gate.proposals.plans.get(goal.id)!.nodes.map(n=>n.occurrences)).toEqual([1,1]);expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');
  });
  it('continues an independent node while another waits for recruitment approval',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Independent branches','manual');f.gate.proposals.plans.install(goal.id,{...plan,nodes:[plan.nodes[0],{...plan.nodes[1],dependsOn:[]}]},true);let calls=0;
    f.respond(async()=>({rawText:JSON.stringify(++calls===1?{operations:[{tool:'REQUEST_RECRUIT',args:{role:'Specialist',reason:'The first node needs a specialist',instruction:'Complete the first node'}}],send_to:'STOP'}:calls===3?{operations:[{tool:'save_artifact',args:{filename:'second.md',content:'The independent branch completed while recruitment awaits approval'}}],send_to:'STOP'}:{owner_reply:'Actual branch status',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    await f.scheduler.tick();await f.finish();expect(f.gate.proposals.plans.get(goal.id)!.nodes.map(n=>n.state)).toEqual(['WAITING_RESOURCE','COMPLETED']);expect(f.calls).toHaveLength(4);expect(f.gate.proposals.list().some(p=>p.kind==='close_task')).toBe(false);
    const request=f.work.view().requests[0];await f.work.decide(request.id,request.hash,'reject');expect(f.gate.goals.get(goal.id).status).toBe('BLOCKED');expect(f.calls).toHaveLength(4);
  });
  it('resumes a composed plan in a second OS process using real saved tool receipts and an explicitly fake HTTP model',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.gate.budget.configure({tokenMillions:1,unitPrice:(1000000)/1000000,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});f.on();const goal=f.goal('Process restart plan','manual');f.gate.proposals.plans.install(goal.id,plan,true);let calls=0;
    const model=createHttpServer((req,res)=>{req.resume();req.on('end',()=>{const n=++calls,content=JSON.stringify(n%2?{operations:[{tool:'save_artifact',args:{filename:n===1?'first.md':'second.md',content:'Immutable HTTP fixture evidence '+n}}],send_to:'STOP'}:{owner_reply:'The actual fixture artifact is retained',send_to:'STOP'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:20,completion_tokens:10,prompt_tokens_details:{cached_tokens:0}}}));});});
    const port=await listenTestHttp(model);cleanups.push(()=>new Promise<void>(done=>model.close(()=>done())));
    const run=promisify(execFile),env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,MCL_API_KEY:'explicit-isolated-http-fixture',MCL_MODEL:'test',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,EMERGENTINC_TEST_REAL_COMPANY_BUDGET_CNY:'1'};
    for(const mode of ['first','finish'])await run(process.execPath,['--import','tsx',resolve('apps/server/tests/fixtures/v32_real_company_child.ts'),f.root,goal.id,mode],{cwd:resolve('.'),env,windowsHide:true,timeout:45000,maxBuffer:200000});
    expect(calls).toBe(4);expect(f.gate.proposals.plans.get(goal.id)!.nodes.map(n=>n.occurrences)).toEqual([1,1]);expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.gate.budget.view()).toMatchObject({reservedMicros:0,unknownCalls:0});expect(f.gate.goals.detail(goal.id).evidence.filter(e=>e.kind==='artifact')).toHaveLength(2);
  },60000);
  it('records recruitment approval while OFF without a paid call, then cancels it when its root task is stopped',async()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Retained recruitment','manual'),request=f.work.requestRecruit({role:'Specialist',reason:'Needed for this task',instruction:'Produce a report'},'Owner','queued-recruit-fixture');f.control.db.prepare('INSERT INTO owner_goal_recruits VALUES(?,?,?)').run(request.id,goal.id,goal.specificationRevision);
    await f.work.decide(request.id,request.hash,'approve');expect(f.work.view().requests[0].state).toBe('APPROVED_QUEUED');expect(f.calls).toHaveLength(0);expect(f.registry.list()).toHaveLength(2);
    f.gate.goals.action(goal.id,{action:'stop',expectedRevision:goal.revision,idempotencyKey:'stop-before-recruitment'});f.on();await f.work.tick();expect(f.work.view().requests[0].state).toBe('CANCELLED');expect(f.calls).toHaveLength(0);expect(f.registry.list()).toHaveLength(2);
  });
  it('continues beyond old token ceilings using money and produces an unapproved proposal before an unaffordable call',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();f.control.db.prepare("INSERT INTO owner_model_permits VALUES('historical-usage','initial',NULL,NULL,NULL,'SETTLED',0,2000000000,0,0)").run();
    await f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'over-old-token-ceiling',maxTokens:100});expect(f.gate.isOn()).toBe(true);expect(f.gate.view().spentTokens).toBe(2000000030);
    f.control.db.prepare('UPDATE owner_company_budget SET total_micros=100').run();await expect(f.gate.provider(f.provider,f.meter).call({model:'test',messages:[],promptHash:'unaffordable',maxTokens:100})).rejects.toBeInstanceOf(InfrastructureFailureError);
    expect(f.calls).toHaveLength(1);expect(f.gate.modelCalls()).toHaveLength(0);expect(f.gate.budget.view().needsRefill).toBe(true);expect(f.gate.proposals.list()).toHaveLength(0);
  });
  it('records node completion once when a second connection settles the occurrence before the first observer enters its transaction',()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Concurrent completion','manual');f.gate.proposals.plans.install(goal.id,plan,true);f.gate.proposals.plans.claim(goal.id,'research','concurrent-completion');const store=new WorldRegistryStore(f.control.db.dbPath),other=new OwnerAutomationGate(store),transaction=f.control.transaction.bind(f.control);
    try{
      vi.spyOn(f.control,'transaction').mockImplementationOnce(fn=>{expect(other.proposals.plans.complete('concurrent-completion',['retained-evidence'])).toBe(true);return transaction(fn);});
      expect(f.gate.proposals.plans.complete('concurrent-completion',['retained-evidence'])).toBe(false);expect(f.gate.proposals.plans.get(goal.id)!.nodes[0].occurrences).toBe(1);expect(f.gate.goals.detail(goal.id).events.filter(e=>e.kind==='task_step_completed')).toHaveLength(1);
    }finally{store.close();}
  });
  it('records HTTP recruitment approval while ON without a paid call and recovers assignment after the person was retained',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Queued HTTP approval','manual'),request=f.work.requestRecruit({role:'Specialist',reason:'Needed for this task',instruction:'Produce a report'},'Owner','http-recruit-fixture');f.control.db.prepare('INSERT INTO owner_goal_recruits VALUES(?,?,?)').run(request.id,goal.id,goal.specificationRevision);
    const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());const approve=()=>app.inject({method:'POST',url:`/api/owner/requests/${request.id}/decision`,payload:{decision:'approve',hash:request.hash}});
    expect((await approve()).json().requests[0].state).toBe('APPROVED_QUEUED');expect((await approve()).statusCode).toBe(200);expect(f.calls).toHaveLength(0);
    f.gate.goals.action(goal.id,{action:'pause',expectedRevision:goal.revision,idempotencyKey:'pause-retained-person'});f.control.db.prepare("UPDATE owner_recruit_requests SET state='APPROVED',person_id=? WHERE id=?").run(f.a.qianji_id,request.id);
    await f.work.tick();expect(f.control.db.prepare('SELECT 1 FROM owner_recruit_decisions WHERE request_id=?').get(request.id)).toBeUndefined();expect(f.gate.goals.get(goal.id).status).toBe('PAUSED');expect(f.calls).toHaveLength(0);expect(f.registry.list()).toHaveLength(2);
  });
  it('rejects a routed task revision and its recovered checkpoint after the Owner has changed the same task',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Current task','manual'),question='修改 Current task 的计划',intent={kind:'revise_task',goalId:goal.id,title:'Updated task',objective:'Updated objective',plan};
    const chat={route:async()=>{f.gate.goals.action(goal.id,{action:'stop',expectedRevision:goal.revision,idempotencyKey:'stop-during-routing'});return {intent,usage:{tokens:0,cost_cny:0}};}} as any;
    await expect(f.work.ask('stale-revise',question,[],'zh-CN',{goals:[goal]} as any,chat)).rejects.toThrow();
    await expect(f.work.ask('stale-revise',question,[],'zh-CN',{goals:[f.gate.goals.get(goal.id)]} as any,chat)).rejects.toThrow();expect(f.gate.goals.get(goal.id)).toMatchObject({status:'STOPPED',specificationRevision:1,title:'Current task'});expect(f.gate.proposals.list()).toHaveLength(0);
  });
  it('handles budget, pause, status and proposal decisions without a model',async()=>{
    const f=goalFixture();cleanups.push(f.close);const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});
    cleanups.push(()=>app.close());
    const chat=(question:string)=>app.inject({method:'POST',url:'/api/owner/chat',payload:{question,history:[],language:'zh-CN',requestKey:crypto.randomUUID()}});
    const needed=await chat('帮我做一次研究');expect(needed.json().answer).toContain('预算');expect(f.calls).toHaveLength(0);
    const budget=await chat('公司预算 1 元');expect(budget.json().companyProposal).toBeUndefined();expect(budget.json().answer).toContain('公司金额预算');
    const saved=await app.inject({method:'POST',url:'/api/owner/budget',payload:{tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:0,idempotencyKey:'direct-settings'}});expect(saved.statusCode).toBe(200);expect(f.gate.budget.view().totalMicros).toBe(1000000);
    expect((await chat('公司状态')).json().usage.tokens).toBe(0);expect((await chat('暂停')).statusCode).toBe(200);expect(f.calls).toHaveLength(0);
  });
  it('handles explicit Chinese and English recruitment approval in chat before a money budget exists',async()=>{
    const f=goalFixture();cleanups.push(f.close);const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
    for(const language of ['zh-CN','en']){
      const request=f.work.requestRecruit({role:'Specialist '+language,reason:'Needed for the task',instruction:'Produce a report'},'Owner','free-recruit-chat-'+language),question=(language==='en'?'approve recruitment request ':'批准招聘申请 ')+request.id;
      const result=await app.inject({method:'POST',url:'/api/owner/chat',payload:{question,history:[],language,requestKey:'free-recruit-chat-'+language}});expect(result.statusCode).toBe(200);expect(result.json().answer).toContain(language==='en'?'queued':'排队');expect(result.json().usage.tokens).toBe(0);expect(f.work.view().requests.find(r=>r.id===request.id)?.state).toBe('APPROVED_QUEUED');
    }
    expect(f.gate.budget.view().activatedAt).toBeNull();expect(f.calls).toHaveLength(0);expect(f.registry.list()).toHaveLength(2);
  });
  it('lets AI request closure of an ongoing task using verified results, while Owner retains the closing decision',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Ongoing delivery','manual');f.gate.proposals.plans.install(goal.id,{...plan,nodes:[plan.nodes[0],{...plan.nodes[1],trigger:{kind:'interval',everyMinutes:5}}]},true);let calls=0;
    f.respond(async()=>({rawText:JSON.stringify(++calls===1||calls===3?{operations:[{tool:'save_artifact',args:{filename:calls===1?'first.md':'second.md',content:'Verified actual delivery '+calls}}],send_to:'STOP'}:calls===4?{operations:[{tool:'REQUEST_TASK_CLOSE',args:{reason:'The retained source and summary meet the scoped internal delivery goal.'}}],send_to:'STOP'}:{owner_reply:'Actual deliverables are ready for Owner review',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    await f.scheduler.tick();await f.finish();expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');const p=f.gate.proposals.list().find(p=>p.kind==='close_task')!;expect(p.payload.reason).toContain('retained source');expect(f.calls).toHaveLength(5);
    f.gate.proposals.decide(p.id,{decision:'approve',hash:p.hash,idempotencyKey:'ongoing-close-approval'});await f.scheduler.tick();expect(f.gate.goals.get(goal.id).status).toBe('COMPLETED');expect(f.gate.proposals.plans.due(goal.id,Date.now()+86400000)).toBeNull();expect(f.calls).toHaveLength(5);
  });
  it('executes valid long instructions and carries dependency evidence without silently truncating the approved steps',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();const original=f.goal('Long task','manual'),goal=f.gate.goals.edit(original.id,{title:'T'.repeat(160),objective:'O'.repeat(1200),acceptance:original.acceptance,expectedRevision:original.revision,idempotencyKey:'long-task-revision'});
    f.gate.proposals.plans.install(goal.id,{...plan,nodes:plan.nodes.map(n=>({...n,title:n.title.padEnd(160,'T'),instruction:'I'.repeat(1600)}))},true);let calls=0;
    f.respond(async()=>({rawText:JSON.stringify(++calls%2?{operations:[{tool:'save_artifact',args:{filename:calls===1?'first.md':'second.md',content:'Actual verified source '+ 'F'.repeat(1000)}}],send_to:'STOP'}:{owner_reply:'The actual full instruction was executed',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    await f.scheduler.tick();await f.finish();expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.calls).toHaveLength(4);expect(f.work.view().tasks.some(t=>t.instruction.length>4000)).toBe(true);
  });
  it('resumes a maintenance pause from an explicit free chat command and never replays an old resume over a newer pause',async()=>{
    const f=goalFixture();cleanups.push(f.close);let paused=true,resumes=0;const app=await createServer({workspaceRoot:f.root,worlds:f.worlds,evolution:{quiesced:()=>paused,switching:()=>false,resume:async()=>{paused=false;resumes++;}} as any});cleanups.push(()=>app.close());
    const chat=(question:string,requestKey=crypto.randomUUID())=>app.inject({method:'POST',url:'/api/owner/chat',payload:{question,history:[],language:'zh-CN',requestKey}});
    expect((await app.inject({method:'POST',url:'/api/owner/budget',payload:{tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:0,idempotencyKey:'paused-settings'}})).statusCode).toBe(200);expect(paused).toBe(true);expect((await chat('继续运行','maintenance-resume')).statusCode).toBe(200);expect(paused).toBe(false);expect(resumes).toBe(1);expect(f.gate.view().desiredMode).toBe('ON');expect(f.calls).toHaveLength(0);
    await chat('暂停公司');paused=true;await chat('继续运行','maintenance-resume');expect(paused).toBe(true);expect(f.gate.view().desiredMode).toBe('OFF');expect(resumes).toBe(1);
  });
  it('keeps pause and recorded status usable during a software switch while preventing new approvals from racing its snapshots',async()=>{
    const f=goalFixture();cleanups.push(f.close);const app=await createServer({workspaceRoot:f.root,worlds:f.worlds,evolution:{quiesced:()=>true,switching:()=>true} as any});cleanups.push(()=>app.close());
    const chat=(question:string)=>app.inject({method:'POST',url:'/api/owner/chat',payload:{question,history:[],language:'zh-CN',requestKey:crypto.randomUUID()}});
    expect((await chat('公司状态')).statusCode).toBe(200);expect((await chat('暂停公司')).statusCode).toBe(200);expect((await app.inject({method:'POST',url:'/api/owner/budget',payload:{tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:0,idempotencyKey:'switch-settings'}})).statusCode).toBe(409);expect(f.gate.proposals.list()).toHaveLength(0);expect(f.gate.budget.view().activatedAt).toBeNull();expect(f.calls).toHaveLength(0);
  });
});
