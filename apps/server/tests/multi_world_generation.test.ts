import {afterEach,describe,it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LineageStore,WorldRegistryStore,CurrentStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {UsageMeter} from '@emergentinc/model';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../src/services/world_runtime_manager.js';
import {GenePromotionService,executeGeneSkill} from '../src/services/gene_promotion_service.js';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {EvolutionRuntime} from '../../../supervisor/protocol.js';

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
function fixture(){const root=fs.mkdtempSync(join(tmpdir(),'V23-多World-')),workspace=join(root,'workspace'),releases=join(root,'releases'),base=join(releases,'r1');
  fs.mkdirSync(join(base,'genome'),{recursive:true});fs.writeFileSync(join(base,'genome/manifest.json'),JSON.stringify({schema_version:1,gene_hash_version:2,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}}));
  let release=base;const genome=readGenome(base),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  const generation=lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
  const admin=new CurrentStore(join(workspace,'system/generations/G0001/current.sqlite3'));admin.initialize(generation,'1');admin.close();fs.mkdirSync(join(workspace,'system/generations/G0001/body/skills'),{recursive:true});
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,'1');
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B'));
  const options={provider:{async call(){throw new Error('NO_LLM_CALL_EXPECTED')}},usageMeter:new UsageMeter({models:{}}),modelName:'test'};
  let manager=new WorldRuntimeManager(registry,genome.manifest,options);
  const runtime:EvolutionRuntime={
    validateRelease:vi.fn(async()=>{}),quiesce:vi.fn(async()=>manager.quiesceAll()),finalDream:vi.fn(async()=>{}),
    worlds:()=>registry.list().filter(w=>w.status==='ACTIVE').map(w=>({id:w.world_id,directory:registry.directory(w.world_id)})),
    smoke:vi.fn(async(directory,candidateWorkspace,generationId)=>{
      const l=new LineageStore(join(candidateWorkspace,'system/lineage/lineage.sqlite3'),{v23:true}),c=new WorldRegistryStore(join(candidateWorkspace,'system/control/control.sqlite3'));
      const r=new WorldRegistryService(candidateWorkspace,c,l,'1'),m=new WorldRuntimeManager(r,readGenome(directory).manifest,options);
      try{for(const world of r.list())expect((await m.open(world.world_id)).life.current.meta().generation_id).toBe(generationId);
        const fresh=r.create(narrative('inheritance smoke'));const child=await m.open(fresh.world_id);expect(child.life.current.skills()).toHaveLength(0);
        expect(executeGeneSkill(directory,'shared_count',{rows:[1,2]},readGenome(directory).geneHash).result).toEqual({count:2});
      }finally{await m.closeAll();c.close();l.close();}
    }),stop:vi.fn(async()=>manager.closeAll()),switchRelease:vi.fn(async directory=>{release=directory;}),
    start:vi.fn(async()=>{manager=new WorldRuntimeManager(registry,readGenome(release).manifest,options);}),
    healthy:vi.fn(async id=>{for(const world of registry.list())expect((await manager.open(world.world_id)).life.current.meta().generation_id).toBe(id);}),
    resume:vi.fn(async()=>{}),activeRelease:()=>fs.realpathSync(release),
  };
  const supervisor=new GenerationSupervisor(join(root,'trusted'),join(workspace,'system'),releases,lineage,runtime,true);
  cleanup.push(async()=>{await manager.closeAll();supervisor.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  const prepare=async()=>{
    const service=new GenePromotionService(manager,release,lineage),body=await service.createBodySkill(a.world_id,'0_0_0',{skill_id:'count',purpose:'Count rows',
      source:'export default input=>({count:input.rows.length})',tests:[{input:{rows:[]},expected:{count:0}},{input:{rows:[1]},expected:{count:1}}],interface_version:'1'});
    await service.runBodySkill(a.world_id,'count',{rows:[1]});
    const nomination=await service.nominate(a.world_id,'0_0_0',{kind:'skill',sourcePath:`generations/G0001/body/skills/count/${body.id}.json`,metadata:{}});
    const proposal=await service.propose(String(nomination.id),{shareConsent:true,privacy:'PUBLIC',license:'MIT',genericity:'World independent JSON-only input',point:'Count rows',reason:'Reusable',effect:'Inherited by new Worlds'});
    lineage.decideProposal(String(proposal.id),'APPROVED');const patch=await service.buildPatch(String(nomination.id),'shared_count',2);
    supervisor.submit({id:'r2',base_generation:'G0001',base_release:'r1',proposal_id:String(proposal.id),patch:patch.patch});
    const validated=await supervisor.validate('r2');supervisor.approve('r2',validated.candidate.candidate_hash);return {service,nomination,patch};
  };
  return {workspace,lineage,control,registry,supervisor,runtime,a,b,narrative,prepare,manager:()=>manager,release:()=>release};
}
describe('real Supervisor with all World Currents (process adapter doubles)',()=>{
  it('migrates every World, switches one global generation and executes inherited source in an entirely new World',async()=>{
    const f=fixture(),prepared=await f.prepare();await f.supervisor.birth('r2');
    expect(f.lineage.activeGeneration()!.id).toBe('G0002');for(const world of [f.a,f.b])expect((await f.manager().open(world.world_id)).life.current.meta().generation_id).toBe('G0002');
    new GenePromotionService(f.manager(),f.release(),f.lineage).recordInherited(String(prepared.nomination.id),prepared.patch.asset,'G0002');
    const fresh=f.registry.create(f.narrative('C')),runtime=await f.manager().open(fresh.world_id);
    expect(runtime.life.current.skills()).toHaveLength(0);expect(fs.readdirSync(join(runtime.directory,'generations/G0002/body/skills'))).toEqual([]);
    expect(executeGeneSkill(f.release(),'shared_count',{rows:[1,2,3]},f.lineage.activeGeneration()!.gene_hash)).toMatchObject({origin:'gene',result:{count:3}});
    expect(f.supervisor.get('r2').state).toBe('BORN');
  },20000);
  it('abandons the entire birth when one World Current is corrupt and keeps all old Worlds runnable',async()=>{
    const f=fixture();await f.prepare();await f.manager().close(f.b.world_id);
    const file=join(f.registry.directory(f.b.world_id),'generations/G0001/current.sqlite3'),original=fs.readFileSync(file);fs.writeFileSync(file,'corrupt current');
    await expect(f.supervisor.birth('r2')).rejects.toThrow();
    expect(f.lineage.activeGeneration()!.id).toBe('G0001');expect(f.runtime.switchRelease).not.toHaveBeenCalled();
    fs.writeFileSync(file,original);expect((await f.manager().open(f.a.world_id)).life.current.meta().generation_id).toBe('G0001');expect((await f.manager().open(f.b.world_id)).life.current.meta().generation_id).toBe('G0001');
    expect(f.lineage.generation('G0002').state).toBe('FAILED');
  },20000);
  it('restores every previous Current after post-switch health failure and retains failure history',async()=>{
    const f=fixture();await f.prepare();vi.mocked(f.runtime.healthy).mockRejectedValueOnce(new Error('WORLD_HEALTH_FAILED'));
    await expect(f.supervisor.birth('r2')).rejects.toThrow('WORLD_HEALTH_FAILED');expect(f.lineage.activeGeneration()!.id).toBe('G0001');
    for(const world of [f.a,f.b])expect((await f.manager().open(world.world_id)).life.current.meta().generation_id).toBe('G0001');
    expect(f.lineage.generation('G0002').state).toBe('FAILED');expect(f.lineage.relevantMemories({kind:'generation_rollback'})).toHaveLength(1);
  },20000);
});
