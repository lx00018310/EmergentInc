import {afterEach,describe,expect,it} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {LineageStore,WorldRegistryStore,CurrentStore,writeGenerationPointer} from '@emergentinc/persistence';
import {UsageMeter} from '@emergentinc/model';
import {ToolRegistry,ToolRuntime} from '@emergentinc/tools';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../src/services/world_runtime_manager.js';
import {GenePromotionService} from '../src/services/gene_promotion_service.js';
import {PaymentService} from '../src/services/payment_service.js';
import {PaymentMonitor} from '../src/services/payment_monitor.js';
import {registerWorldTools} from '../src/services/world_tools.js';
import {DreamService} from '../src/services/dream_service.js';
import {LifeContext} from '../src/services/life_context.js';
import {createServer} from '../src/app.js';
import {BusinessService} from '../src/services/business_service.js';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function fixture(owner=false){const root=fs.mkdtempSync(join(tmpdir(),'v23-product-')),lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
  const generation=lineage.createGeneration({id:'G0001',number:1,geneHash:'1'.repeat(64),releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(root,'system'),'G0001');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B'));const genome={schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}};
  const manager=new WorldRuntimeManager(registry,genome,{provider:{async call(){return {rawText:JSON.stringify({send_to:'STOP',owner_reply:'reply from own World',reproduce:{direction:'1_0_0',initial_energy:15000}}),usage:{promptTokens:50,completionTokens:40}};}},usageMeter:new UsageMeter({models:{}}),modelName:'test',isMockMode:true,isModelConfigured:true});
  const payments=new PaymentService(join(root,'system/payment/payment.sqlite3'),control,lineage),promotion=new GenePromotionService(manager,resolve('.'),lineage),monitor=new PaymentMonitor(payments,{async call(){return {value:null};}});
  const business=owner?new BusinessService(lineage):undefined;
  const app=await createServer({workspaceRoot:root,runtimeMode:owner?'business':'legacy',businessService:business,ownerAuth:{secret:'test-owner-secret'.repeat(4),secureCookies:false},worlds:{manager,promotion,payments,monitor,modelName:'test'}});
  const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:'test-owner-secret'.repeat(4)}});const cookie=String(login.headers['set-cookie']).split(';')[0];
  cleanups.push(async()=>{await app.close();await manager.closeAll();payments.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  const request=(method:any,url:string,payload?:any)=>app.inject({method,url,payload,headers:{cookie}});
  return {root,lineage,control,registry,manager,a,b,genome,payments,promotion,app,request,narrative,generation};
}
describe('authenticated V23 product and life integration',()=>{
  it('projects blocked messages and Tips without running or changing ledgers',async()=>{
    const f=await fixture(),runtime=await f.manager.open(f.a.world_id);
    expect((await f.app.inject('/api/owner/overview')).statusCode).toBe(401);
    const {QianjiWorldGateway}=await import('../src/services/qianji_world_gateway.js');
    const turn=await new QianjiWorldGateway(f.manager).enqueue(f.a.qianji_id,'need energy','owner-read');
    runtime.store.messages.updateStatus(String(turn.message_id),'WAITING_PIXEL_BUDGET' as any);
    fs.writeFileSync(join(runtime.directory,'live/pixels/0_0_0/tips.md'),'Public reminder');
    const ledger=runtime.store.db.prepare('SELECT COUNT(*) n FROM ledger_entries').get()!.n;
    const overview=await f.request('GET','/api/owner/overview');expect(overview.statusCode,overview.body).toBe(200);
    // V28: waiting runs need human verification, not one-click decisions, so they surface as alerts.
    const data=overview.json();expect(data.summary).toMatchObject({qianjiCount:2,runningWorlds:0,inboxCount:0,currentGeneration:'G0001'});
    expect(data.alerts.some((a:any)=>a.kind==='run'&&a.summary.includes('WAITING_PIXEL_BUDGET'))).toBe(true);
    expect(data.activity.find((a:any)=>a.type==='Tips').summary).toContain('Public reminder');
    expect(data.inbox.some((i:any)=>i.type==='Tips')).toBe(false);
    expect(data.activity.map((a:any)=>a.createdAt)).toEqual(data.activity.map((a:any)=>a.createdAt).sort((a:number,b:number)=>b-a));
    expect(data.availability).toEqual({business:false,upgrade:'not_configured'});
    expect(runtime.run.getStatus().running).toBe(false);expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM ledger_entries').get()!.n).toBe(ledger);
    runtime.store.messages.updateStatus(String(turn.message_id),'COMMITTED' as any);
    expect((await f.request('GET','/api/owner/overview')).json().inbox).toHaveLength(0);
    runtime.store.messages.updateStatus(String(turn.message_id),'ABANDONED' as any);
    expect((await f.request('GET','/api/owner/overview')).json().alerts.some((a:any)=>a.summary.includes('ABANDONED'))).toBe(true);
    runtime.store.db.prepare("INSERT INTO recovery_decisions VALUES('decision','message',?,'abandon','Owner resolved','{}',?)").run(turn.message_id,Date.now()/1000);
    expect((await f.request('GET','/api/owner/overview')).json().inbox).toHaveLength(0);
  });
  it('creates finite proposals without sending and rejects arbitrary actions and forged history',async()=>{
    const f=await fixture();
    const response=await f.request('POST','/api/owner/chat',{question:'问所有人现在最大的风险是什么',history:[],language:'zh-CN'});
    expect(response.statusCode,response.body).toBe(200);expect(response.json().proposals[0].action).toMatchObject({type:'qianji_chat',message:'现在最大的风险是什么'});
    expect(response.json().proposals[0].action.targets).toHaveLength(2);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM world_chat_turns').get()!.n).toBe(0);expect(f.manager.list().some(w=>w.opened||w.running)).toBe(false);
    expect((await f.request('POST','/api/owner/chat',{question:'test',history:[{role:'system',content:'arbitrary action'}],language:'en'})).statusCode).toBe(400);
    expect((await f.request('POST','/api/owner/actions',{type:'shell',command:'whoami'})).statusCode).toBe(404);
  });
  it('shows pending business versions and denies a stale rejection before mutation',async()=>{
    const f=await fixture(true),plan={title:'Market report',objective:'Understand demand',audience:'Owner',hypothesis:'Demand exists',metric:{name:'Signals',baseline:'0',target:'10',evidence:'Report'},stopCondition:'Done',expiresAt:Date.now()+86400000,budgetMicros:1000000,currency:'CNY',actions:[{capability:'data_report',version:'1',datasetId:'sales',purpose:'Summarize'}],resources:['dataset:sales']};
    f.lineage.db.prepare("INSERT INTO business_plans VALUES('plan-test','Demand',1,'AWAITING_APPROVAL',?)").run(Date.now());
    f.lineage.db.prepare("INSERT INTO business_plan_revisions VALUES('plan-test',1,?,?,?)").run('a'.repeat(64),JSON.stringify(plan),Date.now());
    const data=(await f.request('GET','/api/owner/overview')).json();expect(data.inbox[0].actions[0].action.plan).toMatchObject({id:'plan-test',revision:1,hash:'a'.repeat(64)});
    const proposal=await f.request('POST','/api/owner/chat',{question:'批准刚才那个营销方案',history:[],language:'zh-CN'});expect(proposal.json().proposals[0].action.type).toBe('business_plan_approve');
    expect(f.lineage.getPlan('plan-test').state).toBe('AWAITING_APPROVAL');
    expect((await f.request('POST','/api/business/plans/plan-test/revoke',{revision:2,hash:'a'.repeat(64)})).statusCode).toBe(409);
    expect(f.lineage.getPlan('plan-test').state).toBe('AWAITING_APPROVAL');
    expect((await f.request('POST','/api/business/plans/plan-test/revoke',{revision:1,hash:'a'.repeat(64)})).statusCode).toBe(200);
    expect((await f.request('GET','/api/owner/overview')).json().inbox).toHaveLength(0);
  });
  it('authorizes infinite energy only for the current gateway, persists it across runtime reopen and follows gateway replacement',async()=>{
    const f=await fixture(),a=await f.manager.open(f.a.world_id),b=await f.manager.open(f.b.world_id);
    a.store.db.prepare('UPDATE pixel_accounts SET energy=10').run();
    b.store.db.prepare('UPDATE pixel_accounts SET energy=10').run();
    a.store.pixels.upsertPixelAccount({pixelId:'1_0_0',energy:0,active:false,refundDeficitTokens:0,spendBlockedReason:null});
    const url=`/api/qianji/${f.a.qianji_id}/infinite-energy`;
    expect((await f.app.inject({method:'PUT',url,payload:{enabled:true}})).statusCode).toBe(401);
    expect((await f.request('PUT',url,{enabled:'true'})).statusCode).toBe(400);
    expect((await f.request('PUT',url,{enabled:true})).statusCode).toBe(200);
    f.manager.options.provider.call=async()=>({rawText:JSON.stringify({send_to:'STOP',owner_reply:'done',energy_transfer:[{target:'1_0_0',amount:120000}]}),usage:{promptTokens:50,completionTokens:40}});
    const chat=await f.request('POST',`/api/qianji/${f.a.qianji_id}/chat`,{content:'choose whether to help',idempotencyKey:'unlimited',rounds:1,runBudgetTokens:100000});
    expect(chat.statusCode,chat.body).toBe(202);
    while(a.run.getStatus().running)await new Promise(r=>setTimeout(r,10));
    expect((await f.request('GET',`/api/qianji/${f.a.qianji_id}/chat`)).json().items[0].status).toBe('replied');
    expect(a.store.pixels.getPixelAccount('1_0_0')).toMatchObject({energy:120000,active:true});
    expect(b.store.pixels.getPixelAccount('0_0_0')?.energy).toBe(10);
    expect(a.store.ledger.listEntriesByPixel('1_0_0').filter(entry=>entry.entry_type==='external_reward')).toHaveLength(0);
    await f.manager.close(f.a.world_id);const reopened=await f.manager.open(f.a.world_id);
    expect((await f.request('GET',`/api/qianji/${f.a.qianji_id}`)).json().world.infiniteEnergy).toBe(true);
    expect((await f.request('PUT',`/api/worlds/${f.a.world_id}/gateway`,{pixel_id:'1_0_0',expected_revision:0})).statusCode).toBe(200);
    reopened.store.db.prepare('UPDATE pixel_accounts SET energy=10').run();
    reopened.store.ensureUnlimitedEnergy('0_0_0',500,'old-gateway');
    reopened.store.ensureUnlimitedEnergy('1_0_0',500,'new-gateway');
    expect(reopened.store.pixels.getPixelAccount('0_0_0')?.energy).toBe(10);
    expect(reopened.store.pixels.getPixelAccount('1_0_0')?.energy).toBe(100000);
    await f.request('PUT',url,{enabled:false});
    reopened.store.db.prepare("UPDATE pixel_accounts SET energy=10 WHERE pixel_id='1_0_0'").run();
    reopened.store.ensureUnlimitedEnergy('1_0_0',500,'disabled');
    expect(reopened.store.pixels.getPixelAccount('1_0_0')?.energy).toBe(10);
  });
  it('stops a 100-round run when Pixel energy cannot fund a call and reports blocked chat',async()=>{
    const f=await fixture(),runtime=await f.manager.open(f.a.world_id);
    runtime.store.db.prepare('UPDATE pixel_accounts SET energy=322').run();
    const response=await f.request('POST',`/api/qianji/${f.a.qianji_id}/chat`,{content:'work',idempotencyKey:'low-energy',rounds:1,runBudgetTokens:100000});
    expect(response.statusCode,response.body).toBe(202);
    while(runtime.run.getStatus().running)await new Promise(r=>setTimeout(r,10));
    const chat=await f.request('GET',`/api/qianji/${f.a.qianji_id}/chat`);
    expect(chat.json().items[0].status).toBe('blocked');
    await runtime.run.start({rounds:100,runBudgetTokens:100000});
    while(runtime.run.getStatus().running)await new Promise(r=>setTimeout(r,10));
    expect(runtime.run.getStatus()).toMatchObject({completed_rounds:1,model_calls_completed:0,stop_reason:'NO_ACTIVE_MESSAGES',result_status:'STOPPED'});
    runtime.store.db.prepare('UPDATE pixel_accounts SET energy=100000').run();
    await runtime.run.start({rounds:1,runBudgetTokens:100000});
    while(runtime.run.getStatus().running)await new Promise(r=>setTimeout(r,10));
    expect((await f.request('GET',`/api/qianji/${f.a.qianji_id}/chat`)).json().items[0].status).toBe('replied');
  });
  it.each([
    ['COMMITTED','no_reply'],['QUEUED','queued'],['WAITING_PIXEL_BUDGET','blocked'],
    ['WAITING_RUN_BUDGET','blocked'],['WAITING_EXECUTION_BUDGET','blocked'],
    ['CALL_OUTCOME_UNKNOWN','blocked'],['AWAITING_SETTLEMENT','blocked'],
    ['ABANDONED','blocked'],['MODEL_RESPONSE_INVALID','failed'],['PROCESSING','blocked'],
  ])('maps World message status %s to chat status %s after a run stops',async(messageStatus,status)=>{
    const f=await fixture(),runtime=await f.manager.open(f.a.world_id);
    const {QianjiWorldGateway}=await import('../src/services/qianji_world_gateway.js');
    const gateway=new QianjiWorldGateway(f.manager),turn=await gateway.enqueue(f.a.qianji_id,'work','status');
    runtime.store.messages.updateStatus(String(turn.message_id),messageStatus as any);
    expect((await gateway.turns(f.a.qianji_id))[0].status).toBe(status);
  });
  it('runs only the selected World, reproduces cells without new Qianji, and keeps identities after gateway death',async()=>{
    const f=await fixture();expect((await f.app.inject('/api/worlds')).statusCode).toBe(401);
    const response=await f.request('POST',`/api/qianji/${f.a.qianji_id}/chat`,{content:'work',idempotencyKey:'turn',rounds:1,runBudgetTokens:80000});expect(response.statusCode,response.body).toBe(202);
    const a=await f.manager.open(f.a.world_id),b=await f.manager.open(f.b.world_id);while(a.run.getStatus().running)await new Promise(r=>setTimeout(r,10));
    expect((await f.request('GET',`/api/qianji/${f.a.qianji_id}/chat`)).json().items[0].reply).toBe('reply from own World');
    expect(a.store.pixels.getPixelAccount('1_0_0')?.active).toBe(true);expect(b.store.pixels.getPixelAccount('1_0_0')).toBeNull();expect(f.control.qianji.listProfiles()).toHaveLength(2);
    expect((await f.request('GET','/api/qianji')).json().items.every((item:any)=>item.currentBinding===null&&item.world.world_id)).toBe(true);
    expect((await f.request('GET',`/api/worlds/${f.a.world_id}/api/qianji`)).statusCode).toBe(403);
    a.store.pixels.setActive('0_0_0',false);
    expect((await f.request('PUT',`/api/worlds/${f.a.world_id}/gateway`,{pixel_id:'1_0_0',expected_revision:0})).statusCode).toBe(200);
    expect(f.control.qianji.getProfile(f.a.qianji_id)!.careerStatus).toBe('active');
  });
  it('recruits directly into its own World with no global Pixel and scopes installed tools to the owning runtime',async()=>{
    const f=await fixture(),one=await f.request('POST','/api/qianji/recruit',{idempotencyKey:'recruit'});expect(one.statusCode,one.body).toBe(201);
    const two=await f.request('POST','/api/qianji/recruit',{idempotencyKey:'recruit'});expect(two.json().profile.qianjiId).toBe(one.json().profile.qianjiId);
    expect(f.registry.list()).toHaveLength(3);expect(f.control.db.prepare('SELECT COUNT(*) n FROM pixel_accounts').get()!.n).toBe(0);
    const tools=new ToolRegistry();registerWorldTools(tools,f.a.world_id,f.promotion,f.payments);
    const result=await new ToolRuntime(tools).execute('CREATE_BODY_SKILL',{candidate:{skill_id:'count',purpose:'count',source:'export default i=>i.length',tests:[{input:[],expected:0}],interface_version:'1'}},
      {workspaceRoot:f.registry.directory(f.b.world_id),pixelId:'0_0_0',runId:'r',messageId:'m',operationId:'op'});
    expect(result.status).toBe('FAILED');expect(result.error_message).toContain('WORLD_TOOL_CONTEXT_CONFLICT');
    expect(tools.has('APPROVE_GENE')).toBe(false);expect(tools.has('CONFIGURE_PAYMENT_RAIL')).toBe(false);
  });
  it('aggregates per-World Current facts once and stores Dream memories with their original World scope',async()=>{
    const f=await fixture(),a=await f.manager.open(f.a.world_id),b=await f.manager.open(f.b.world_id),admin=new CurrentStore(join(f.root,'system/generations/G0001/current.sqlite3'));
    admin.initialize(f.generation,'1');a.life.current.setWorkingState('0_0_0',{secret:'A'},true);b.life.current.setWorkingState('0_0_0',{secret:'B'},true);
    let calls=0;const dream=new DreamService(new LifeContext(join(f.root,'system'),f.genome,f.lineage,admin),async(_purpose,_key,input:any)=>{
      calls++;expect(input.facts.filter((fact:any)=>fact.source==='current').map((fact:any)=>fact.world_id).sort()).toEqual([f.a.world_id,f.b.world_id].sort());
      return JSON.stringify({memories:[{world_id:f.a.world_id,point:'A result',reason:'A work',effect:'A remembers'}],gene_proposals:[]});},'03:00','Asia/Shanghai',()=>f.manager.currents());
    try{await dream.run();expect((await dream.run()).status).toBe('SKIPPED');expect(calls).toBe(1);
      expect(f.lineage.relevantMemories({worldId:f.a.world_id})).toHaveLength(1);expect(f.lineage.relevantMemories({worldId:f.b.world_id})).toHaveLength(0);
    }finally{admin.close();}
  });
});
