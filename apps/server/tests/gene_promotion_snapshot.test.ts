import {afterEach,describe,it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LineageStore,WorldRegistryStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {UsageMeter} from '@emergentinc/model';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../src/services/world_runtime_manager.js';
import {GenePromotionService,executeGeneSkill} from '../src/services/gene_promotion_service.js';

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
function fixture(){const root=fs.mkdtempSync(join(tmpdir(),'gene-promotion-')),release=join(root,'release'),workspace=join(root,'workspace');
  fs.mkdirSync(join(release,'genome'),{recursive:true});fs.writeFileSync(join(release,'genome/manifest.json'),JSON.stringify({schema_version:1,gene_hash_version:2,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}}));
  const genome=readGenome(release),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});
  writeGenerationPointer(join(workspace,'system'),'G0001');
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,'1');
  const narrative=(name:string)=>({displayName:name,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),manager=new WorldRuntimeManager(registry,genome.manifest,{provider:{async call(){throw new Error('NO_MODEL_CALL_EXPECTED')}},usageMeter:new UsageMeter({models:{}}),modelName:'test'});
  const service=new GenePromotionService(manager,release,lineage);
  cleanup.push(async()=>{await manager.closeAll();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,workspace,release,lineage,control,registry,narrative,a,manager,service};
}
const review={shareConsent:true,privacy:'PUBLIC',license:'MIT',point:'公共计数能力',reason:'多个输入验证通过',effect:'新世界直接继承',genericity:'仅依赖 JSON rows，不依赖 World、Pixel 或客户身份'};
describe('V23 promotion snapshot and common inheritance',()=>{
  it('requires real successful use, shares only in its original World, generalizes identifiers and rolls back a failed Body revision',async()=>{
    const f=fixture(),runtime=await f.manager.open(f.a.world_id),b=f.registry.create(f.narrative('B'));
    const base={skill_id:'ratio',purpose:'ratio',interface_version:'1',source:'export default i=>({ratio:i.n / i.d})',tests:[{input:{n:2,d:2},expected:{ratio:1}},{input:{n:4,d:2},expected:{ratio:2}}]};
    const first=await f.service.createBodySkill(f.a.world_id,'0_0_0',base);
    await expect(f.service.promoteBodySkill(f.a.world_id,'0_0_0','ratio')).rejects.toThrow('BODY_SUCCESS_EVIDENCE_REQUIRED');
    await f.service.runBodySkill(f.a.world_id,'ratio',{n:4,d:2});
    const bound={...base,source:`export default i=>({ratio:i.n / i.d, world:'${f.a.world_id}'})`,tests:base.tests.map(t=>({...t,expected:{...t.expected,world:f.a.world_id}}))};
    await f.service.createBodySkill(f.a.world_id,'0_0_0',bound);await f.service.runBodySkill(f.a.world_id,'ratio',{n:2,d:2});
    const nomination=await f.service.promoteBodySkill(f.a.world_id,'0_0_0','ratio');const proposal=await f.service.propose(String(nomination.id),review);
    expect((await f.service.readWorldAsset(f.a.world_id,String(nomination.id))).origin).toBe('world_shared');
    await expect(f.service.readWorldAsset(b.world_id,String(nomination.id))).rejects.toThrow('WORLD_SHARED_ASSET_NOT_FOUND');
    f.lineage.decideProposal(String(proposal.id),'APPROVED');
    await expect(f.service.buildPatch(String(nomination.id),'common_ratio',2)).rejects.toThrow('GENE_GENERALIZER_REQUIRED');
    const patch=await f.service.buildPatch(String(nomination.id),'common_ratio',2,async()=>base);
    expect(patch.patch[0]!.content).not.toContain(f.a.world_id);expect(JSON.parse(patch.patch[0]!.content!).permissions).toEqual([]);
    await expect(f.service.runBodySkill(f.a.world_id,'ratio',{n:1,d:0})).rejects.toThrow();
    expect(runtime.life.current.db.prepare('SELECT active_change_id FROM body_skills WHERE skill_id=?').get('ratio')!.active_change_id).toBe(first.id);
    expect(await f.service.runBodySkill(f.a.world_id,'ratio',{n:6,d:2})).toMatchObject({result:{ratio:3}});
  });
  it('freezes a generated skill, requires human direction, publishes generic source and executes it in a fresh World without copying Body',async()=>{
    const f=fixture(),candidate={skill_id:'row_count',purpose:'count rows',source:'export default input=>({count:input.rows.length})',
      tests:[{input:{rows:[1]},expected:{count:1}},{input:{rows:[1,2,3]},expected:{count:3}}],interface_version:'1'};
    const created=await f.service.createBodySkill(f.a.world_id,'0_0_0',candidate),runtime=await f.manager.open(f.a.world_id);
    await f.service.runBodySkill(f.a.world_id,'row_count',{rows:[1,2]});
    const path=`generations/G0001/body/skills/row_count/${created.id}.json`;
    const nomination=await f.service.nominate(f.a.world_id,'0_0_0',{kind:'skill',sourcePath:path,metadata:{privacy:'INTERNAL'}});
    const proposal=await f.service.propose(String(nomination.id),review);
    await expect(f.service.buildPatch(String(nomination.id),'common_count',2)).rejects.toThrow('OWNER_GENE_DIRECTION');
    f.lineage.decideProposal(String(proposal.id),'APPROVED');const patch=await f.service.buildPatch(String(nomination.id),'common_count',2);
    for(const file of patch.patch){fs.mkdirSync(join(f.release,file.path,'..'),{recursive:true});fs.writeFileSync(join(f.release,file.path),file.content);}
    const next=readGenome(f.release);expect(next.geneHash).not.toBe(runtime.life.current.meta().gene_hash);
    f.lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();
    f.lineage.createGeneration({id:'G0002',number:2,parentId:'G0001',geneHash:next.geneHash,releaseId:'r2',state:'ACTIVE'});
    writeGenerationPointer(join(f.workspace,'system'),'G0002');
    f.lineage.db.prepare("UPDATE gene_proposals SET state='BORN',target_generation_id='G0002' WHERE id=?").run(proposal.id);
    f.service.recordInherited(String(nomination.id),patch.asset,'G0002');
    const b=f.registry.create(f.narrative('B')),fresh=await f.manager.open(b.world_id);
    expect(fresh.life.current.skills()).toHaveLength(0);
    expect(fs.readdirSync(join(fresh.directory,'generations/G0002/body/skills'))).toEqual([]);
    expect(executeGeneSkill(f.release,'common_count',{rows:[1,2,3,4]},next.geneHash)).toMatchObject({origin:'gene',geneHash:next.geneHash,result:{count:4}});
    expect(f.lineage.db.prepare('SELECT world_id FROM gene_asset_sources').get()!.world_id).toBe(f.a.world_id);
    expect(f.lineage.db.prepare('SELECT state FROM gene_assets').get()!.state).toBe('GENE');
  });
  it('uses the frozen document even when Body changes later; refuses snapshot tampering and private/customer content',async()=>{
    const f=fixture(),runtime=await f.manager.open(f.a.world_id),source=join(runtime.directory,'live/pixels/0_0_0/notes.md');
    fs.writeFileSync(source,'Generic reusable knowledge.');const nominate=(metadata:any={})=>f.service.nominate(f.a.world_id,'0_0_0',{kind:'knowledge',sourcePath:'live/pixels/0_0_0/notes.md',metadata});
    const frozen=await nominate();fs.writeFileSync(source,'Different private body revision.');
    const proposal=await f.service.propose(String(frozen.id),review);f.lineage.decideProposal(String(proposal.id),'APPROVED');
    expect((await f.service.buildPatch(String(frozen.id),'knowledge',2)).patch[0]!.content).toContain('Generic reusable knowledge.');
    const privateCandidate=await nominate({privacy:'CUSTOMER_PRIVATE'});await expect(f.service.propose(String(privateCandidate.id),review)).rejects.toThrow('PRIVACY');
    const tampered=await nominate();fs.writeFileSync(join(f.workspace,String(tampered.snapshot_path)),'changed');await expect(f.service.propose(String(tampered.id),review)).rejects.toThrow('SNAPSHOT_CHANGED');
    fs.writeFileSync(source,'api_key="abcdefghijklmnop123456789"');const secret=await nominate();await expect(f.service.propose(String(secret.id),review)).rejects.toThrow('SECRET_SCAN');
  });
  it('refuses traversal and another World source; scopes memory by World while keeping shared Gene history',async()=>{
    const f=fixture(),b=f.registry.create(f.narrative('B')),runtime=await f.manager.open(f.a.world_id);
    await expect(f.service.nominate(f.a.world_id,'0_0_0',{kind:'code',sourcePath:'../../system/lineage/lineage.sqlite3',metadata:{}})).rejects.toThrow('PATH');
    await expect(f.service.nominate(f.a.world_id,'0_0_0',{kind:'code',sourcePath:`worlds/${b.world_id}/live/program.js`,metadata:{}})).rejects.toThrow('SCOPE');
    f.lineage.remember('G0001','private',{point:'B secret',reason:'private',effect:'retain'},'b-memory','0_0_0',4,'gate',b.world_id);
    f.lineage.remember('G0001','private',{point:'A memory',reason:'private',effect:'retain'},'a-memory','0_0_0',4,'gate',f.a.world_id);
    const memories=runtime.life.load('0_0_0',{}).memories;expect(memories.map(r=>r.point)).toContain('A memory');expect(memories.map(r=>r.point)).not.toContain('B secret');
  });
});
