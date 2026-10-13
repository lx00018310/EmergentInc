import {afterEach,it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {LineageStore,WorldRegistryStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {UsageMeter} from '@emergentinc/model';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../src/services/world_runtime_manager.js';
import {GenePromotionService,readGeneCatalog,executeGeneSkill} from '../src/services/gene_promotion_service.js';
// @ts-ignore Trusted standalone maintenance module.
import {approvedGenePlan,inheritApprovedGene,checkInheritedGene} from '../../../scripts/inherit-approved-gene.mjs';
// @ts-ignore Trusted standalone maintenance module.
import {freezeLocalRelease,frozenReleaseHash} from '../../../scripts/local-release.mjs';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
async function fixture(){
 const root=fs.mkdtempSync(join(tmpdir(),'v30-gene-')),source=join(root,'source'),active=join(root,'releases/r2'),workspace=join(root,'workspace');
 fs.mkdirSync(join(source,'genome'),{recursive:true});fs.copyFileSync(join(process.cwd(),'genome/manifest.json'),join(source,'genome/manifest.json'));
 const manifest=JSON.parse(fs.readFileSync(join(source,'genome/manifest.json'),'utf8'));manifest.generation=1;manifest.protected_paths=['genome/**'];fs.writeFileSync(join(source,'genome/manifest.json'),JSON.stringify(manifest));
 fs.cpSync(source,active,{recursive:true});const g=readGenome(active),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});
 lineage.createGeneration({id:'G0001',number:1,geneHash:g.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
 const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,'1'),a=registry.create({displayName:'A',traits:{},behaviorProfile:[]});
 const manager=new WorldRuntimeManager(registry,g.manifest,{provider:{async call(){throw new Error('NO_MODEL');}},usageMeter:new UsageMeter({models:{}}),modelName:'test'}),service=new GenePromotionService(manager,active,lineage);
 const runtime=await manager.open(a.world_id),file=join(runtime.directory,'live/artifacts/0_0_0/knowledge.txt');fs.mkdirSync(join(file,'..'),{recursive:true});fs.writeFileSync(file,'Public reusable knowledge; no private customers.');
 const n=await service.nominate(a.world_id,'0_0_0',{kind:'knowledge',sourcePath:'live/artifacts/0_0_0/knowledge.txt',metadata:{privacy:'PUBLIC'}}),proposal=await service.propose(String(n.id),{shareConsent:true,privacy:'PUBLIC',license:'MIT',genericity:'public knowledge',point:'Public knowledge',reason:'Reusable source',effect:'Inherited knowledge'});
 lineage.decideProposal(String(proposal.id),'APPROVED');const patch=await service.buildPatch(String(n.id),'common_knowledge',2);for(const f of patch.patch){fs.mkdirSync(join(active,f.path,'..'),{recursive:true});fs.writeFileSync(join(active,f.path),f.content!);}
 lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();lineage.createGeneration({id:'G0002',number:2,parentId:'G0001',geneHash:readGenome(active).geneHash,releaseId:'r2',state:'ACTIVE'});lineage.db.prepare("UPDATE gene_proposals SET state='BORN',target_generation_id='G0002' WHERE id=?").run(proposal.id);service.recordInherited(String(n.id),patch.asset,'G0002');
 cleanup.push(async()=>{await manager.closeAll();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});return {root,source,active,workspace,lineage,asset:patch.asset,nomination:n,service,manager,a};
}
it('inherits only approved public Gene into a copied Git candidate before installation and final hashes, leaving LIVE and Git unchanged',async()=>{
 const f=await fixture(),candidate=join(f.root,'candidate'),before=frozenReleaseHash(f.active),sourceHash=frozenReleaseHash(f.source);
 execFileSync('git',['init','-b','main'],{cwd:f.source});execFileSync('git',['add','.'],{cwd:f.source});execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','base'],{cwd:f.source});
 const plan=approvedGenePlan(f.active,f.workspace,f.source),frozen=await freezeLocalRelease(f.source,candidate,async(dir:string)=>{expect(readGeneCatalog(dir).assets).toHaveLength(1);},(dir:string)=>inheritApprovedGene(plan,f.active,dir));
 expect(frozen.hash).toBe(frozenReleaseHash(candidate));expect(frozenReleaseHash(f.active)).toBe(before);expect(execFileSync('git',['status','--porcelain'],{cwd:f.source,encoding:'utf8'})).toBe('');expect(plan.history).toHaveLength(1);expect(readGeneCatalog(candidate).assets[0]).toEqual(f.asset);
 checkInheritedGene(f.active,f.workspace,candidate);expect(fs.readFileSync(join(candidate,'genome',f.asset.file))).toEqual(fs.readFileSync(join(f.active,'genome',f.asset.file)));expect(sourceHash).toBeTruthy();
});
it.each(['nested','external'])('rechecks a %s frozen candidate against the approved Git origin and still rejects real custom Gene',async location=>{
 const f=await fixture(),state=join(f.root,'state');fs.mkdirSync(state);fs.writeFileSync(join(f.source,'genome/default.txt'),'Approved Core Gene.');fs.copyFileSync(join(f.source,'genome/default.txt'),join(f.active,'genome/default.txt'));
 const git=(args:string[])=>execFileSync('git',args,{cwd:f.source,encoding:'utf8',windowsHide:true}).trim();
 git(['init','-b','main']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','approved Core']);const commit=git(['rev-parse','HEAD']);
 const approvals=new DatabaseSync(join(state,'evolution.sqlite3'));approvals.exec('CREATE TABLE candidates(id TEXT,state TEXT,request_json TEXT)');approvals.prepare('INSERT INTO candidates VALUES(?,?,?)').run('r2','BORN',JSON.stringify({owner_release:{source_commit:commit}}));approvals.close();
 // The next official Core may change its contracts; its manifest must not replace the old origin baseline.
 const file=join(f.source,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.capability_contracts.next_contract={version:1};fs.writeFileSync(file,JSON.stringify(manifest));
 const plan=approvedGenePlan(f.active,f.workspace,f.source,state),candidate=location==='nested'?join(f.source,'cache/candidate'):join(f.root,'candidate');
 await freezeLocalRelease(f.source,candidate,async()=>{},(dir:string)=>inheritApprovedGene(plan,f.active,dir));expect(fs.existsSync(join(candidate,'.git'))).toBe(false);
 // Nested cwd exercises --full-tree; external release uses an explicit maintenance repository.
 const repository=location==='nested'?candidate:f.source;checkInheritedGene(f.active,f.workspace,candidate,state,repository);
 expect(readGeneCatalog(candidate).assets).toContainEqual(f.asset);
 fs.writeFileSync(join(f.active,'genome/default.txt'),'Unapproved custom Gene.');
 expect(()=>checkInheritedGene(f.active,f.workspace,candidate,state,repository)).toThrow('CUSTOM_GENE_PATCH_NEEDS_REBASE');
 expect(()=>approvedGenePlan(f.active,f.workspace,f.source,state)).toThrow('CUSTOM_GENE_PATCH_NEEDS_REBASE');
});
it.each(['content','version'])('rejects upstream %s conflict before any active file is changed',async(kind)=>{
 const f=await fixture(),before=frozenReleaseHash(f.active),candidate=join(f.root,'candidate'),plan=approvedGenePlan(f.active,f.workspace,f.source);fs.cpSync(f.source,candidate,{recursive:true});const a={...f.asset,version:kind==='version'?2:1,contentHash:createHash('sha256').update('different').digest('hex')};a.file=`assets/${a.id}/${a.version}.json`;fs.mkdirSync(join(candidate,'genome',a.file,'..'),{recursive:true});fs.writeFileSync(join(candidate,'genome',a.file),'different');fs.writeFileSync(join(candidate,'genome/assets/index.json'),JSON.stringify({schema:1,assets:[a]}));expect(()=>inheritApprovedGene(plan,f.active,candidate)).toThrow('GENE_ASSET_UPSTREAM_CONFLICT');expect(frozenReleaseHash(f.active)).toBe(before);
});
it('refuses tampered public source, missing provenance and non-asset custom Gene instead of silently inheriting them',async()=>{
 const f=await fixture(),snapshot=join(f.workspace,String(f.nomination.snapshot_path)),bytes=fs.readFileSync(snapshot);fs.writeFileSync(snapshot,'tampered');expect(()=>approvedGenePlan(f.active,f.workspace,f.source)).toThrow('GENE_ASSET_SOURCE_CHANGED');fs.writeFileSync(snapshot,bytes);
 f.lineage.db.prepare('DELETE FROM gene_asset_sources').run();expect(()=>approvedGenePlan(f.active,f.workspace,f.source)).toThrow('GENE_ASSET_PROVENANCE_CONFLICT');fs.writeFileSync(join(f.active,'genome/custom.json'),'{}');expect(()=>approvedGenePlan(f.active,f.workspace,f.source)).toThrow('CUSTOM_GENE_PATCH_NEEDS_REBASE');
});
it('detects changed active Gene after preparation and retains the original approved file',async()=>{
 const f=await fixture(),candidate=join(f.root,'candidate'),plan=approvedGenePlan(f.active,f.workspace,f.source);fs.cpSync(f.source,candidate,{recursive:true});inheritApprovedGene(plan,f.active,candidate);const file=join(f.active,'genome',f.asset.file),bytes=fs.readFileSync(file);fs.writeFileSync(file,'changed');expect(()=>checkInheritedGene(f.active,f.workspace,candidate)).toThrow('GENE_ASSET_HASH_MISMATCH');fs.writeFileSync(file,bytes);
});
it('refuses legacy candidates and truncated inheritance lists, while accepting identical upstream catalog fields in a different order',async()=>{
 const f=await fixture(),candidate=join(f.root,'legacy-candidate'),plan=approvedGenePlan(f.active,f.workspace,f.source);fs.cpSync(f.source,candidate,{recursive:true});
 expect(()=>checkInheritedGene(f.active,f.workspace,candidate)).toThrow('GENE_ASSET_BASE_CHANGED');
 const a=f.asset;fs.mkdirSync(join(candidate,'genome',a.file,'..'),{recursive:true});fs.copyFileSync(join(f.active,'genome',a.file),join(candidate,'genome',a.file));fs.writeFileSync(join(candidate,'genome/assets/index.json'),JSON.stringify({schema:1,assets:[{license:a.license,contentHash:a.contentHash,file:a.file,kind:a.kind,version:a.version,id:a.id}]}));
 inheritApprovedGene(plan,f.active,candidate);checkInheritedGene(f.active,f.workspace,candidate);
 const metadata=JSON.parse(fs.readFileSync(join(candidate,'instance-compatibility.json'),'utf8'));metadata.history=[];metadata.inherited=[];fs.writeFileSync(join(candidate,'instance-compatibility.json'),JSON.stringify(metadata));fs.writeFileSync(join(candidate,'genome/assets/index.json'),JSON.stringify({schema:1,assets:[]}));fs.unlinkSync(join(candidate,'genome',a.file));
 expect(()=>checkInheritedGene(f.active,f.workspace,candidate)).toThrow();expect(fs.existsSync(join(f.active,'genome',a.file))).toBe(true);
});

it('keeps approved historical files while selecting the verified current version in the inherited index',async()=>{
 const f=await fixture(),runtime=await f.manager.open(f.a.world_id);fs.writeFileSync(join(runtime.directory,'live/artifacts/0_0_0/knowledge.txt'),'Public knowledge version two.');
 const n=await f.service.nominate(f.a.world_id,'0_0_0',{kind:'knowledge',sourcePath:'live/artifacts/0_0_0/knowledge.txt',metadata:{privacy:'PUBLIC'}}),q=await f.service.propose(String(n.id),{shareConsent:true,privacy:'PUBLIC',license:'MIT',genericity:'Reusable public text',point:'Knowledge v2',reason:'Updated public knowledge',effect:'Keep both versions'});f.lineage.decideProposal(String(q.id),'APPROVED');const patch=await f.service.buildPatch(String(n.id),'common_knowledge',3),r3=join(f.root,'releases/r3');fs.cpSync(f.active,r3,{recursive:true});for(const file of patch.patch){fs.mkdirSync(join(r3,file.path,'..'),{recursive:true});fs.writeFileSync(join(r3,file.path),file.content!);}
 f.lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE state='ACTIVE'").run();f.lineage.createGeneration({id:'G0003',number:3,parentId:'G0002',geneHash:readGenome(r3).geneHash,releaseId:'r3',state:'ACTIVE'});f.lineage.db.prepare("UPDATE gene_proposals SET state='BORN',target_generation_id='G0003' WHERE id=?").run(q.id);new GenePromotionService(f.manager,r3,f.lineage).recordInherited(String(n.id),patch.asset,'G0003');
 const plan=approvedGenePlan(r3,f.workspace,f.source),candidate=join(f.root,'history-candidate');fs.cpSync(f.source,candidate,{recursive:true});inheritApprovedGene(plan,r3,candidate);expect(plan.history).toHaveLength(2);expect(readGeneCatalog(candidate).assets[0].version).toBe(2);for(const v of [1,2])expect(fs.existsSync(join(candidate,`genome/assets/common_knowledge/${v}.json`))).toBe(true);checkInheritedGene(r3,f.workspace,candidate);
});
it('keeps an asset-free old instance compatible with Core preparation and never copies its Workspace into the release',async()=>{
 const root=fs.mkdtempSync(join(tmpdir(),'v30-empty-')),source=join(root,'source'),active=join(root,'releases/r1'),workspace=join(root,'workspace');fs.mkdirSync(join(source,'genome'),{recursive:true});fs.writeFileSync(join(source,'genome/manifest.json'),JSON.stringify({schema_version:1,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{}}));fs.cpSync(source,active,{recursive:true});const lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});lineage.createGeneration({id:'G0001',number:1,geneHash:readGenome(active).geneHash,releaseId:'r1',state:'ACTIVE'});cleanup.push(async()=>{lineage.close();fs.rmSync(root,{recursive:true,force:true});});fs.mkdirSync(join(source,'workspace/private'),{recursive:true});fs.writeFileSync(join(source,'workspace/private/customer.txt'),'never copy this fixture');checkInheritedGene(active,workspace,source);const plan=approvedGenePlan(active,workspace,source),candidate=join(root,'candidate');await freezeLocalRelease(source,candidate,async()=>{},(dir:string)=>inheritApprovedGene(plan,active,dir));expect(plan.inherited).toEqual([]);expect(fs.existsSync(join(candidate,'workspace'))).toBe(false);checkInheritedGene(active,workspace,candidate);
});
