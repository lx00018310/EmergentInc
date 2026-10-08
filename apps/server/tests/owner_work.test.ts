import {afterEach,describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LineageStore,WorldRegistryStore,writeGenerationPointer} from '@emergentinc/persistence';
import {UsageMeter} from '@emergentinc/model';
import {ToolRegistry,ToolRuntime} from '@emergentinc/tools';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../src/services/world_runtime_manager.js';
import {OwnerWorkService} from '../src/services/owner_work_service.js';
import {OwnerChatService} from '../src/services/owner_chat_service.js';
import {appCodePath,sourceHash,verifyAppReport} from '../src/services/app_code_policy.js';
import {proposeOwnerAction} from '../src/services/owner_actions.js';
import fastify from 'fastify';
import {registerQianjiRoutes} from '../src/routes/qianji_routes.js';
import {QianjiWorldGateway} from '../src/services/qianji_world_gateway.js';
import {OutcomeUnknownError} from '@emergentinc/model';
import {ReleaseMaintenanceClient,pixelReleaseToken} from '../src/services/release_maintenance_client.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
function fixture(maintenance?:ReleaseMaintenanceClient){
  const root=fs.mkdtempSync(join(tmpdir(),'owner-work-')),project=join(root,'project');fs.mkdirSync(join(project,'frontend/src'),{recursive:true});fs.writeFileSync(join(project,'frontend/src/sample.ts'),'export const value = 1;');
  const lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});lineage.createGeneration({id:'G0001',number:1,geneHash:'1'.repeat(64),releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(root,'system'),'G0001');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
  const person=(name:string,role:string)=>registry.create({displayName:name,title:null,roleLabel:role,traits:{},behaviorProfile:[role],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=person('一苇','架构开发'),b=person('徐观','营销');let intent:any,worldReply:any={send_to:'STOP',owner_reply:'Actual work result'};
  const calls:any[]=[];let work:OwnerWorkService;
  const provider={async call(request:any){calls.push(request);return {rawText:JSON.stringify(request.messages[0].content.startsWith('你是 Owner')?intent:request.messages[0].content.includes('人物设定编辑')?{displayName:'新同事',shortBio:'负责指定工作',appearanceSpec:'人物画像'}:worldReply),usage:{promptTokens:20,completionTokens:10}};}};
  const manager=new WorldRuntimeManager(registry,{schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}},{provider,usageMeter:new UsageMeter({models:{}}),modelName:'test',isMockMode:true,isModelConfigured:true,projectRoot:project,configureTools:(id,tools)=>work.registerTools(tools,id)});
  work=new OwnerWorkService(manager,undefined,undefined,maintenance);const chat=new OwnerChatService({projectRoot:project,workspaceRoot:root,store:control,provider,usageMeter:manager.options.usageMeter,modelName:'test',isModelConfigured:true});
  const data=()=>({people:manager.list().map(r=>({id:r.qianji_id,name:control.qianji.getProfile(r.qianji_id)!.narrative.displayName,role:control.qianji.getProfile(r.qianji_id)!.narrative.roleLabel,status:'ACTIVE',worldId:r.world_id,running:false,runStatus:'READY'})),inbox:[],work:work.view()}) as any;
  cleanups.push(async()=>{await work.close();await manager.closeAll();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  const finish=async()=>{await vi.waitFor(async()=>{await work.tick();expect(manager.list().some(w=>w.running)).toBe(false);expect(work.view().tasks.every(t=>!['RUNNING','QUEUED'].includes(t.state))).toBe(true);},{timeout:5000});};
  return {root,project,manager,registry,control,lineage,work,chat,a,b,calls,data,finish,intent:(v:any)=>intent=v,reply:(v:any)=>worldReply=v};
}
describe('Owner role dispatch and actual execution',()=>{
  it('registers live Pixel rollback/deletion tools with a scoped credential and bound actor, without exposing Owner login',async()=>{
    const secret='test-maintenance-secret'.repeat(3),requests:any[]=[],fetcher=vi.fn(async(url:any,init:any)=>{requests.push({url,init});return new Response(JSON.stringify({accepted:true,active:'G0002',versions:[]}),{headers:{'Content-Type':'application/json'}});});
    const f=fixture(new ReleaseMaintenanceClient('http://127.0.0.1:8766',secret,fetcher as any)),tools=new ToolRegistry();f.work.registerTools(tools,f.a.world_id);const runtime=new ToolRuntime(tools);
    const context={workspaceRoot:f.registry.directory(f.a.world_id),pixelId:'0_0_0',operationId:'rollback-op',round:1} as any;
    expect((await runtime.execute('LIST_RELEASE_VERSIONS',{},context)).status).toBe('SUCCESS');
    expect((await runtime.execute('ROLLBACK_RELEASE',{targetGeneration:'G0001',expectedActive:'G0002',reason:'Restore stable code',deleteNewer:true},context)).status).toBe('SUCCESS');
    expect(requests[1].url).toBe('http://127.0.0.1:8766/pixel/releases/rollback');expect(requests[1].init.headers.Authorization).toBe(`Bearer ${pixelReleaseToken(secret)}`);
    expect(JSON.parse(requests[1].init.body)).toMatchObject({worldId:f.a.world_id,pixelId:'0_0_0',operationKey:`${f.a.world_id}:rollback-op`,deleteNewer:true});
    expect((await runtime.execute('DELETE_RELEASE',{releaseId:'r2',expectedActive:'G0001',identity:'a'.repeat(64),reason:'Remove newer code'},{...context,operationId:'delete-op'})).status).toBe('SUCCESS');
    expect(requests[2].url).toBe('http://127.0.0.1:8766/pixel/releases/delete');expect(JSON.stringify(requests)).not.toContain(secret);expect(JSON.stringify(tools.renderCatalogForPrompt())).not.toContain(pixelReleaseToken(secret));
    expect((await runtime.execute('ROLLBACK_RELEASE',{targetGeneration:'G0001',expectedActive:'G0002',reason:'Wrong actor'},{...context,workspaceRoot:f.registry.directory(f.b.world_id)})).status).toBe('FAILED');
    const world=await f.manager.open(f.a.world_id);world.store.pixels.setActive('0_0_0',false);
    expect((await runtime.execute('DELETE_RELEASE',{releaseId:'r2',expectedActive:'G0001',identity:'a'.repeat(64),reason:'Inactive actor'},context)).status).toBe('FAILED');expect(requests).toHaveLength(3);
  });
  it.each(['zh-CN','en'] as const)('preserves a requested 10-round limit and the reporting task in %s',async language=>{
    const f=fixture();f.intent({kind:'dispatch',rounds:10,tasks:[{personId:f.a.qianji_id,instruction:'Run and report current work and required Owner actions'}]});
    const response=await f.work.ask('ten-rounds','很好 运行10轮 告诉我现在你们在做什么，需要我做什么',[],language,f.data(),f.chat);await f.finish();
    const run=f.manager.peek(f.a.world_id)!.store.runs.getLatestRun()!;expect(run.end_round!-run.start_round+1).toBe(10);expect(run.run_limit).toBe(100000);
    expect(response.answer).toContain(language==='en'?'10 rounds':'10 轮');expect(f.calls[0].maxTokens).toBe(131072);expect(f.work.view().tasks[0].state).toBe('REPLIED');
  });
  it('rejects invalid round counts before creating work and prevents conflicting budget retries',async()=>{
    const f=fixture();for(const rounds of [0,21,1.5,'10',null]){f.intent({kind:'dispatch',rounds,tasks:[{personId:f.a.qianji_id,instruction:'Report'}]});await expect(f.work.ask(`bad-${rounds}`,'run',[],'en',f.data(),f.chat)).rejects.toThrow('OWNER_DISPATCH_INVALID');}
    expect(f.work.view().tasks).toHaveLength(0);await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Report'}],'budget',10);await f.finish();
    await expect(f.work.dispatch([{personId:f.a.qianji_id,instruction:'Report'}],'budget',20)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('runs an existing task with its original 20-round budget without changing the legacy table layout',async()=>{
    const f=fixture();f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('old-task','old-request',?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(f.a.qianji_id,'一苇','Report the work',Date.now(),Date.now());
    await f.work.tick();await f.finish();const run=f.manager.peek(f.a.world_id)!.store.runs.getLatestRun()!;
    expect(run.end_round!-run.start_round+1).toBe(20);expect(f.work.view().tasks[0].state).toBe('REPLIED');
    expect(f.control.db.prepare('PRAGMA table_info(owner_work_tasks)').all()).toHaveLength(12);
  });
  it('exposes a cross-round SELF continuation as blocked after one round and finishes within the remaining explicit budget',async()=>{
    const f=fixture();let calls=0;f.manager.options.provider.call=async()=>({rawText:JSON.stringify(++calls===1?{message_md:'Continue source inspection and report',send_to:'SELF'}:{owner_reply:'Source catalogue reviewed',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10}});
    const runtime=await f.manager.open(f.a.world_id),gateway=new QianjiWorldGateway(f.manager),turn=await gateway.enqueue(f.a.qianji_id,'Inspect source and report','one-round');
    // A long existing chain defers its next SELF message to the next round.
    runtime.store.db.prepare('UPDATE messages SET hop=20 WHERE message_id=?').run(turn.message_id);
    await runtime.run.start({rounds:1,runBudgetTokens:100000,onRunCreated:id=>f.control.db.prepare('UPDATE world_chat_turns SET run_id=? WHERE turn_id=?').run(id,turn.turn_id)});
    await vi.waitFor(()=>expect(runtime.run.getStatus().running).toBe(false));expect((await gateway.turns(f.a.qianji_id))[0]).toMatchObject({status:'blocked',blockReason:'ROUND_LIMIT_REACHED'});
    await runtime.run.start({rounds:1,runBudgetTokens:100000-runtime.store.runs.getLatestRun()!.run_spent});await vi.waitFor(()=>expect(runtime.run.getStatus().running).toBe(false));
    expect((await gateway.turns(f.a.qianji_id))[0]).toMatchObject({status:'replied',reply:'Source catalogue reviewed'});expect(calls).toBe(2);
  });
  it.each([['',131072,'OWNER_DISPATCH_OUTPUT_LIMIT'],['',4096,'OWNER_DISPATCH_EMPTY'],['{bad',30,'OWNER_DISPATCH_INVALID']])('diagnoses rejected dispatch output without assigning or retrying it',async(raw,tokens,code)=>{
    const f=fixture();f.manager.options.provider.call=async()=>({rawText:String(raw),usage:{promptTokens:20,completionTokens:Number(tokens)}});
    await expect(f.work.ask('invalid-output','run',[],'en',f.data(),f.chat)).rejects.toThrow(String(code));expect(f.work.view().tasks).toHaveLength(0);
    expect(f.control.db.prepare('SELECT completion_tokens FROM owner_chat_calls').get()!.completion_tokens).toBe(tokens);
  });
  it('executes source reading, candidate submission and reply through the actual QIAN chat route',async()=>{
    const f=fixture(),before=f.work.code!.read('frontend/src/sample.ts');let calls=0;
    f.manager.options.provider.call=async()=>({rawText:JSON.stringify(++calls===1?{operations:[{tool:'READ_APP_SOURCE',args:{path:before.path}}],send_to:'STOP'}:calls===2?{operations:[{tool:'SUBMIT_APP_CODE',args:{title:'QIAN change',summary:'Source candidate for Owner validation',files:[{path:before.path,content:'export const value = 5;',baseHash:before.baseHash}]}}],send_to:'STOP'}:{owner_reply:'Candidate submitted for independent validation and publication approval.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10}});
    const runtime=await f.manager.open(f.a.world_id),app=fastify(),gateway=new QianjiWorldGateway(f.manager);cleanups.push(()=>app.close());
    await app.register(s=>registerQianjiRoutes(s,{store:f.control,workspaceRoot:f.root,runService:runtime.run,worlds:f.manager,gateway}),{prefix:'/api'});
    const response=await app.inject({method:'POST',url:`/api/qianji/${f.a.qianji_id}/chat`,payload:{content:'Read the application source, fix it and report a candidate',idempotencyKey:'qian-code',rounds:10,runBudgetTokens:100000}});expect(response.statusCode).toBe(202);
    await vi.waitFor(()=>expect(runtime.run.getStatus().running).toBe(false));expect((await gateway.turns(f.a.qianji_id))[0].status).toBe('replied');expect(calls).toBe(3);
    expect(f.work.code!.reports()[0].files[0].content).toBe('export const value = 5;');expect(f.work.code!.read(before.path).content).toBe(before.content);
  });
  it('shows queued QIAN turns as recovery-blocked after connection loss and refuses new runs without replaying unknown calls',async()=>{
    const f=fixture();f.manager.options.provider.call=async()=>{throw new OutcomeUnknownError('Connection reset',undefined,'ECONNRESET','response_body');};
    const runtime=await f.manager.open(f.a.world_id),gateway=new QianjiWorldGateway(f.manager);await gateway.enqueue(f.a.qianji_id,'Earlier work','earlier');
    const queued=await gateway.enqueue(f.a.qianji_id,'Fix the application','new-work');
    await runtime.run.start({rounds:10,runBudgetTokens:100000,onRunCreated:id=>f.control.db.prepare('UPDATE world_chat_turns SET run_id=? WHERE turn_id=?').run(id,queued.turn_id)});
    await vi.waitFor(()=>expect(runtime.run.getStatus().running).toBe(false));expect(runtime.store.runs.getLatestRun()!.status).toBe('STOPPED');
    expect((await gateway.turns(f.a.qianji_id)).find(t=>t.turnId===queued.turn_id)).toMatchObject({status:'blocked',blockReason:'PAUSED_RECOVERY_REQUIRED'});
    const app=fastify();cleanups.push(()=>app.close());await app.register(s=>registerQianjiRoutes(s,{store:f.control,workspaceRoot:f.root,runService:runtime.run,worlds:f.manager,gateway}),{prefix:'/api'});
    const response=await app.inject({method:'POST',url:`/api/qianji/${f.a.qianji_id}/chat`,payload:{content:'Try again',idempotencyKey:'retry',rounds:10,runBudgetTokens:100000}});expect(response.statusCode).toBe(409);expect(response.json().detail).toBe('PAUSED_RECOVERY_REQUIRED');
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM world_chat_turns').get()!.n).toBe(2);expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM model_calls').get()!.n).toBe(1);
  });
  it('routes with real roles, starts the selected World, records the actual reply and deduplicates a retry',async()=>{
    const f=fixture();f.intent({kind:'dispatch',tasks:[{personId:f.a.qianji_id,instruction:'Implement the requested architecture candidate'}]});
    const first=await f.work.ask('request1','改架构',[],'zh-CN',f.data(),f.chat);expect(first.answer).toContain('已按分工');await f.finish();
    expect(f.work.view().tasks).toMatchObject([{personId:f.a.qianji_id,state:'REPLIED',reply:'Actual work result'}]);
    expect(f.manager.peek(f.b.world_id)).toBeUndefined();expect(f.manager.peek(f.a.world_id)!.store.runs.getLatestRun()).toMatchObject({run_limit:100000});
    expect(f.calls[0].messages[1].content).toContain('架构开发');expect(f.calls[0].messages[1].content).toContain('营销');
    const count=f.calls.length;expect(await f.work.ask('request1','改架构',[],'zh-CN',f.data(),f.chat)).toEqual(first);expect(f.calls).toHaveLength(count);
    await expect(f.work.ask('request1','another command',[],'zh-CN',f.data(),f.chat)).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });
  it('queues a second assignment for the same person until their first bounded Run finishes',async()=>{
    const f=fixture();let release!:()=>void,calls=0;
    f.manager.options.provider.call=async()=>{if(++calls===1)await new Promise<void>(r=>{release=r;});return {rawText:JSON.stringify({send_to:'STOP',owner_reply:'Finished assignment'}),usage:{promptTokens:20,completionTokens:10}};};
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'First task'}],'first');await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Second task'}],'second');expect(f.control.db.prepare('SELECT COUNT(*) n FROM world_chat_turns').get()!.n).toBe(1);expect(f.work.view().tasks.find(t=>t.instruction==='Second task')).toMatchObject({state:'QUEUED',turnId:null});
    release();await f.finish();const tasks=f.work.view().tasks;expect(tasks.every(t=>t.state==='REPLIED')).toBe(true);expect(new Set(tasks.map(t=>t.runId)).size).toBe(2);
    expect(f.manager.peek(f.a.world_id)!.store.db.prepare('SELECT run_limit FROM runs').all().map(r=>r.run_limit)).toEqual([100000,100000]);
  });
  it('refills only the current gateway, enables its existing policy, and does not repeat a credit on chat retry',async()=>{
    const f=fixture(),runtime=await f.manager.open(f.a.world_id);runtime.store.db.prepare('UPDATE pixel_accounts SET energy=322').run();runtime.store.pixels.upsertPixelAccount({pixelId:'1_0_0',energy:7,active:true,refundDeficitTokens:0,spendBlockedReason:null});
    f.intent({kind:'energy',personId:f.a.qianji_id,refill:true,infinite:true});
    const response=await f.work.ask('energy1','给一苇补充能量并设置无限能量',[],'zh-CN',f.data(),f.chat);
    expect(response.energy).toMatchObject({energy:100000,pixelId:'0_0_0',infiniteEnergy:true});expect(runtime.store.pixels.getPixelAccount('1_0_0')!.energy).toBe(7);
    await f.work.ask('energy1','给一苇补充能量并设置无限能量',[],'zh-CN',f.data(),f.chat);
    expect(runtime.store.ledger.listEntriesByPixel('0_0_0').filter(e=>e.entry_type==='external_reward')).toHaveLength(1);
    expect(f.control.gatewayInfiniteEnergy(f.b.world_id)).toBe(false);
  });
  it('keeps energy-blocked work visible and obtains the real reply after an explicit refill',async()=>{
    const f=fixture(),runtime=await f.manager.open(f.a.world_id);runtime.store.db.prepare('UPDATE pixel_accounts SET energy=322').run();
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Do the work'}],'waiting');await f.finish();expect(f.work.view().tasks[0]).toMatchObject({state:'BLOCKED',reason:'WAITING_PIXEL_BUDGET'});
    await f.work.energy(f.a.qianji_id,true,true,'refill');await f.finish();expect(f.work.view().tasks[0]).toMatchObject({state:'REPLIED',reply:'Actual work result'});
  });
  it('returns a final report after a real tool feedback step, preserving the original Owner turn',async()=>{
    const f=fixture();let calls=0;
    f.manager.options.provider.call=async()=>({rawText:JSON.stringify(++calls===1?{operations:[{tool:'LIST_APP_SOURCE',args:{}}],send_to:'STOP'}:{owner_reply:'I read the source catalogue and finished the requested check.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10}});
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Inspect the actual application source catalogue and report'}],'tools');await f.finish();
    expect(calls).toBe(2);expect(f.work.view().tasks[0]).toMatchObject({state:'REPLIED',reply:'I read the source catalogue and finished the requested check.'});
    const runtime=f.manager.peek(f.a.world_id)!;expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM world_chat_continuations').get()!.n).toBe(1);
    const source=f.control.db.prepare('SELECT message_id FROM world_chat_turns').get()!.message_id;expect(runtime.store.db.prepare('SELECT message_id FROM world_outbox').get()!.message_id).toBe(source);
  });
  it('does not grant a fresh Run token budget when retrying energy-blocked work',async()=>{
    const f=fixture(),runtime=await f.manager.open(f.a.world_id);runtime.store.db.prepare('UPDATE pixel_accounts SET energy=322').run();
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Do the work'}],'limited');await f.finish();
    const old=runtime.store.runs.getLatestRun()!;runtime.store.db.prepare('UPDATE runs SET run_spent=90000 WHERE run_id=?').run(old.run_id);
    await f.work.energy(f.a.qianji_id,true,true,'refill-limited');await f.finish();expect(runtime.store.runs.getLatestRun()!.run_limit).toBe(10000);
  });
  it('performs a real read, source submission and final report across three steps without touching active source',async()=>{
    const f=fixture(),before=f.work.code!.read('frontend/src/sample.ts');let calls=0;
    f.manager.options.provider.call=async()=>({rawText:JSON.stringify(++calls===1?{operations:[{tool:'READ_APP_SOURCE',args:{path:before.path}}],send_to:'STOP'}:calls===2?{operations:[{tool:'SUBMIT_APP_CODE',args:{title:'Actual code change',summary:'Changed value after reading the source',files:[{path:before.path,content:'export const value = 3;',baseHash:before.baseHash}]}}],send_to:'STOP'}:{owner_reply:'Source candidate submitted separately to Owner; awaiting software upgrade approval.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10}});
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Read and implement the change, then report to Owner'}],'code-task');await f.finish();
    expect(calls).toBe(3);expect(f.work.view().tasks[0].state).toBe('REPLIED');expect(f.work.view().codeReports).toHaveLength(1);expect(f.work.code!.read(before.path).content).toBe(before.content);
    const report=f.work.code!.get(f.work.view().codeReports[0].id);expect(report.files[0].content).toBe('export const value = 3;');expect(report.personName).toBe('一苇');
  });
  it('creates a recruitment request, waits for exact approval, then creates one role-bearing person and executes their task',async()=>{
    const f=fixture();f.intent({kind:'recruit',role:'营销专员',reason:'需要专门负责人',instruction:'Produce a campaign and report the deliverables'});
    const response=await f.work.ask('hire1','需要营销专员',[],'en',f.data(),f.chat);const r=response.request;expect(f.registry.list()).toHaveLength(2);expect(f.work.view().requests[0].state).toBe('PENDING');
    await expect(f.work.decide(r.id,'wrong','approve')).rejects.toThrow('OWNER_REQUEST_CHANGED');expect(f.registry.list()).toHaveLength(2);
    await f.work.decide(r.id,r.hash,'approve');await f.finish();await f.work.decide(r.id,r.hash,'approve');expect(f.registry.list()).toHaveLength(3);
    const approved=f.work.view().requests[0];expect(f.control.qianji.getProfile(approved.personId!)!.narrative.roleLabel).toBe('营销专员');expect(f.work.view().tasks).toHaveLength(1);expect(f.work.view().tasks[0].state).toBe('REPLIED');
    await expect(f.work.decide(r.id,r.hash,'reject')).rejects.toThrow('OWNER_REQUEST_CHANGED');
  });
  it('applies a named recruitment decision from chat once and returns its stored response after a lost response',async()=>{
    const f=fixture(),r=f.work.requestRecruit({role:'新职责',reason:'missing expertise',instruction:'Produce a report'},'一苇','chat-hire');
    const data=f.data(),proposal=proposeOwnerAction(`批准招聘 ${r.id}`,data,'zh-CN')!;expect(proposal.proposals[0].action.type).toBe('recruit_approve');
    const hire={id:r.id,hash:r.hash,decision:'approve' as const},answer=await f.work.ask('approve1',`批准招聘 ${r.id}`,[],'zh-CN',data,f.chat,undefined,hire);await f.finish();
    expect(await f.work.cached('approve1',`批准招聘 ${r.id}`,[],'zh-CN')).toEqual(answer);expect(f.registry.list()).toHaveLength(3);
    expect(proposeOwnerAction('拒绝招聘 新职责',f.data(),'zh-CN')!.proposals).toHaveLength(0);
  });
  it('accepts recruitment requests from actual member tools with their requester and never creates a person automatically',async()=>{
    const f=fixture(),registry=new ToolRegistry();f.work.registerTools(registry,f.a.world_id);const runtime=new ToolRuntime(registry);
    const result=await runtime.execute('REQUEST_RECRUIT',{role:'设计师',reason:'需要视觉设计',instruction:'Prepare artwork'},{workspaceRoot:f.registry.directory(f.a.world_id),pixelId:'0_0_0',operationId:'member-hire',round:1} as any);
    expect(result.status).toBe('SUCCESS');expect(f.work.view().requests[0]).toMatchObject({requester:'一苇',role:'设计师',state:'PENDING'});expect(f.registry.list()).toHaveLength(2);
    const bad=await runtime.execute('REQUEST_RECRUIT',{role:'设计师',reason:'need',instruction:'draw'},{workspaceRoot:f.registry.directory(f.b.world_id),pixelId:'0_0_0',operationId:'wrong',round:1} as any);expect(bad.status).toBe('FAILED');
  });
  it('refuses forged model actions, nonexistent people and a partially invalid batch before creating work',async()=>{
    const f=fixture();f.intent({kind:'shell',command:'whoami'});await expect(f.work.ask('bad','do work',[],'en',f.data(),f.chat)).rejects.toThrow('OWNER_DISPATCH_INVALID');
    await expect(f.work.dispatch([{personId:f.a.qianji_id,instruction:'valid'},{personId:'missing',instruction:'invalid'}],'batch')).rejects.toThrow('OWNER_PERSON_UNAVAILABLE');expect(f.work.view().tasks).toHaveLength(0);
  });
  it('surfaces an unexpected worker failure and refuses new assignments instead of leaving them silently queued',async()=>{
    const f=fixture();vi.spyOn(f.work,'tick').mockRejectedValueOnce(new Error('Storage unavailable'));f.work.start();await vi.waitFor(()=>expect(f.work.view().schedulerError).toBe('Storage unavailable'));
    expect(f.work.hasFailure()).toBe(true);await expect(f.work.dispatch([{personId:f.a.qianji_id,instruction:'work'}],'error-task')).rejects.toThrow('OWNER_WORKER_FAILED');expect(f.work.view().tasks).toHaveLength(0);
  });
});
describe('8765 source candidate permission boundary',()=>{
  it.each(['scripts/upgrade-web.mjs','scripts/prepare-app-code.mjs','supervisor/protocol.ts','apps/server/src/owner_auth.ts','apps/server/src/routes/public_routes.ts','apps/server/src/services/public_store.ts','apps/server/src/services/payment_assets.ts','apps/server/src/services/app_code_policy.ts','apps/server/src/services/release_maintenance_client.ts','packages/persistence/src/core_store.ts','packages/protocol/src/types/owner.ts','package.json','pnpm-lock.yaml','genome/manifest.json','frontend/src/../../scripts/upgrade-web.mjs','Frontend/src/app.ts','frontend/src/file.ts:secret','frontend/src/CON.ts'])('denies protected/shared/alias path %s',p=>expect(()=>appCodePath(p)).toThrow('APP_CODE_PATH_DENIED'));
  it('writes real candidate source and a separate immutable report without changing the active source',async()=>{
    const f=fixture(),before=f.work.code!.read('frontend/src/sample.ts'),input={title:'Change value',summary:'Change application value to 2',files:[{path:before.path,content:'export const value = 2;',baseHash:before.baseHash}]};
    const result=await f.work.code!.submit(f.a.world_id,'0_0_0',input,'source1');const report=f.work.code!.get(result.id);
    expect(f.work.code!.read(before.path).content).toBe(before.content);expect(fs.readFileSync(join(f.registry.directory(f.a.world_id),'code-candidates',report.id,'source',before.path),'utf8')).toBe(input.files[0].content);
    verifyAppReport(report,f.project,'G0001','r1');expect(f.work.view().codeReports[0]).not.toHaveProperty('files');
    expect(await f.work.code!.submit(f.a.world_id,'0_0_0',input,'source1')).toEqual(result);
    await expect(f.work.code!.submit(f.a.world_id,'0_0_0',{...input,title:'different'},'source1')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(()=>verifyAppReport({...report,summary:'changed'},f.project,'G0001','r1')).toThrow('APP_CODE_REPORT_CHANGED');expect(()=>verifyAppReport(report,f.project,'G0002','r2')).toThrow('APP_CODE_BASE_CHANGED');
    await expect(f.work.code!.submit(f.a.world_id,'0_0_0',{...input,files:[{path:'scripts/upgrade-web.mjs',content:'bad',baseHash:null}]},'source2')).rejects.toThrow('APP_CODE_PATH_DENIED');
    expect(f.work.code!.listFiles().files).toEqual(['frontend/src/sample.ts']);
  });
  it('rejects stale source and filesystem aliases before writing a candidate',async()=>{
    const f=fixture(),before=f.work.code!.read('frontend/src/sample.ts');fs.writeFileSync(join(f.project,before.path),'changed');
    await expect(f.work.code!.submit(f.a.world_id,'0_0_0',{title:'stale',summary:'stale edit',files:[{path:before.path,content:'new',baseHash:before.baseHash}]},'stale')).rejects.toThrow('APP_CODE_BASE_CHANGED');
    fs.mkdirSync(join(f.project,'frontend/src/Alias'));expect(()=>f.work.code!.read('frontend/src/alias/file.ts')).toThrow('APP_CODE_PATH_DENIED');
  });
});
