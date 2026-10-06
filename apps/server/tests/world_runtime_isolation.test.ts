import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LineageStore, WorldRegistryStore,writeGenerationPointer } from '@emergentinc/persistence';
import { UsageMeter } from '@emergentinc/model';
import { WorldRegistryService } from '../src/services/world_registry_service.js';
import { WorldRuntimeManager } from '../src/services/world_runtime_manager.js';
import { QianjiWorldGateway } from '../src/services/qianji_world_gateway.js';

const cleanups: (()=>Promise<void>)[]=[];
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
function fixture(){
  const root=fs.mkdtempSync(join(tmpdir(),'V23-worlds-')),lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
  lineage.createGeneration({id:'G0005',number:5,geneHash:'5'.repeat(64),releaseId:'r5',state:'ACTIVE'});
  writeGenerationPointer(join(root,'system'),'G0005');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3'));
  const registry=new WorldRegistryService(root,control,lineage,'1');
  const narrative=(name:string)=>({displayName:name,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B'));
  const requests:any[]=[];
  const manager=new WorldRuntimeManager(registry,{schema_version:1,generation:5,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}},
    {provider:{async call(request){requests.push(request);return {rawText:JSON.stringify({send_to:'STOP',owner_reply:'World A received the request'}),usage:{promptTokens:15,completionTokens:8}}}},
      usageMeter:new UsageMeter({models:{}}),modelName:'test',isMockMode:true,isModelConfigured:true});
  cleanups.push(async()=>{await manager.closeAll();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,lineage,control,registry,manager,a,b,requests,gateway:new QianjiWorldGateway(manager)};
}
describe('V23 World registry and genuine runtime isolation',()=>{
  it('creates one World per identity, permits repeated coordinates, and keeps separate files, accounts, messages and Currents',async()=>{
    const f=fixture(),a=await f.manager.open(f.a.world_id),b=await f.manager.open(f.b.world_id);
    expect(a.store.pixels.getPixelAccount('0_0_0')).toBeTruthy();expect(b.store.pixels.getPixelAccount('0_0_0')).toBeTruthy();
    a.life.current.setWorkingState('0_0_0',{only:'A'},true);
    expect(b.life.current.state('0_0_0')).toBeNull();
    await f.gateway.enqueue(f.a.qianji_id,'private-A-question','question1');
    expect(a.store.db.prepare('SELECT COUNT(*) n FROM messages').get()!.n).toBe(1);
    expect(b.store.db.prepare('SELECT COUNT(*) n FROM messages').get()!.n).toBe(0);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM messages').get()!.n).toBe(0);
    expect(a.store.qianji.listProfiles()).toHaveLength(0);
    expect((await a.api.inject('/api/qianji')).statusCode).toBe(404);
    expect((await a.api.inject('/api/pixels/..%2F..%2Fother/mind')).statusCode).not.toBe(200);
    await f.manager.close(f.a.world_id);
    expect(f.lineage.activeGeneration()!.id).toBe('G0005');expect(b.store.pixels.getPixelAccount('0_0_0')).toBeTruthy();
  });
  it('queues idempotently and projects a real scheduler OWNER_REPLY only from the owning World outbox',async()=>{
    const f=fixture(),a=await f.manager.open(f.a.world_id);
    a.store.pixels.upsertPixelAccount({pixelId:'0_0_0',energy:20000,active:true,refundDeficitTokens:0,spendBlockedReason:null});
    const first=await f.gateway.enqueue(f.a.qianji_id,'please reply','idempotent');
    expect((await f.gateway.enqueue(f.a.qianji_id,'please reply','idempotent')).turn_id).toBe(first.turn_id);
    await expect(f.gateway.enqueue(f.a.qianji_id,'different','idempotent')).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await a.run.start({rounds:1,runBudgetTokens:10000});
    const deadline=Date.now()+4000;while(a.run.getStatus().running&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
    const turns=await f.gateway.turns(f.a.qianji_id);
    expect(turns[0]).toMatchObject({reply:'World A received the request',worldId:f.a.world_id,bindingId:null});
    expect(await f.gateway.turns(f.b.qianji_id)).toHaveLength(0);
    expect(f.requests).toHaveLength(1);
    expect(JSON.stringify(f.requests[0])).toContain(f.a.world_id);
    expect(JSON.stringify(f.requests[0])).not.toContain(f.b.world_id);
  });
  it('keeps identity after gateway death, validates replacement and rolls back failed creation',async()=>{
    const f=fixture(),a=await f.manager.open(f.a.world_id);a.store.pixels.setActive('0_0_0',false);
    expect(f.control.qianji.getProfile(f.a.qianji_id)!.careerStatus).toBe('active');
    await expect(f.gateway.enqueue(f.a.qianji_id,'question','dead')).rejects.toThrow('WORLD_GATEWAY_NOT_AVAILABLE');
    await expect(f.manager.replaceGateway(f.a.world_id,'0_0_0',0)).rejects.toThrow('GATEWAY_PIXEL_NOT_ACTIVE');
    const count=f.registry.list().length;
    expect(()=>f.registry.create({displayName:'invalid',title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null},
      {qianjiId:f.a.qianji_id,worldId:'world_conflicting'})).toThrow();
    expect(f.registry.list()).toHaveLength(count);expect(fs.existsSync(join(f.root,'worlds/world_conflicting'))).toBe(false);
  });
});
