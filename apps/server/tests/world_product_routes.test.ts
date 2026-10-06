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

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function fixture(){const root=fs.mkdtempSync(join(tmpdir(),'v23-product-')),lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
  const generation=lineage.createGeneration({id:'G0001',number:1,geneHash:'1'.repeat(64),releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(root,'system'),'G0001');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B'));const genome={schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}};
  const manager=new WorldRuntimeManager(registry,genome,{provider:{async call(){return {rawText:JSON.stringify({send_to:'STOP',owner_reply:'reply from own World',reproduce:{direction:'1_0_0',initial_energy:15000}}),usage:{promptTokens:50,completionTokens:40}};}},usageMeter:new UsageMeter({models:{}}),modelName:'test',isMockMode:true,isModelConfigured:true});
  const payments=new PaymentService(join(root,'system/payment/payment.sqlite3'),control,lineage),promotion=new GenePromotionService(manager,resolve('.'),lineage),monitor=new PaymentMonitor(payments,{async call(){return {value:null};}});
  const app=await createServer({workspaceRoot:root,ownerAuth:{secret:'test-owner-secret'.repeat(4),secureCookies:false},worlds:{manager,promotion,payments,monitor,modelName:'test'}});
  const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:'test-owner-secret'.repeat(4)}});const cookie=String(login.headers['set-cookie']).split(';')[0];
  cleanups.push(async()=>{await app.close();await manager.closeAll();payments.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  const request=(method:any,url:string,payload?:any)=>app.inject({method,url,payload,headers:{cookie}});
  return {root,lineage,control,registry,manager,a,b,genome,payments,promotion,app,request,narrative,generation};
}
describe('authenticated V23 product and life integration',()=>{
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
