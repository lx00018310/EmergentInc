import {afterEach,describe,it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LineageStore,WorldRegistryStore,CurrentStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {UsageMeter} from '@emergentinc/model';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {WorldRuntimeManager} from '../src/services/world_runtime_manager.js';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {EvolutionRuntime} from '../../../supervisor/protocol.js';
import {OwnerAutomationGate} from '../src/services/owner_automation_gate.js';
import {InstanceExtensionService} from '../src/services/instance_extension_service.js';
import {instanceCompatibility} from '../../../supervisor/instance_compatibility.js';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {evolutionHash} from '../../../supervisor/release_builder.js';
// @ts-ignore Standalone trusted Core preparation modules.
// @ts-ignore Standalone trusted Core preparation modules.
import {freezeLocalRelease,frozenReleaseHash} from '../../../scripts/local-release.mjs';

const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
function fixture(){const root=fs.mkdtempSync(join(fs.realpathSync.native(tmpdir()),'V23-多World-')),workspace=join(root,'workspace'),releases=join(root,'releases'),base=join(releases,'r1');
  fs.mkdirSync(join(base,'genome'),{recursive:true});fs.mkdirSync(workspace,{recursive:true});fs.writeFileSync(join(workspace,'workspace-format.json'),JSON.stringify({product:'BOSS-AFK',format:34,instanceId:crypto.randomUUID()}));fs.writeFileSync(join(base,'genome/manifest.json'),JSON.stringify({schema_version:1,gene_hash_version:2,generation:1,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:JSON.parse(fs.readFileSync(join(process.cwd(),'genome/manifest.json'),'utf8')).capability_contracts}));
  fs.mkdirSync(join(base,'apps/server/dist/services'),{recursive:true});fs.copyFileSync(join(process.cwd(),'apps/server/dist/services/owner_automation_gate.js'),join(base,'apps/server/dist/services/owner_automation_gate.js'));fs.copyFileSync(join(process.cwd(),'apps/server/dist/services/owner_company_budget.js'),join(base,'apps/server/dist/services/owner_company_budget.js'));fs.mkdirSync(join(base,'resources/config'),{recursive:true});fs.copyFileSync(join(process.cwd(),'resources/config/company_protocol.json'),join(base,'resources/config/company_protocol.json'));
  let release=base;const genome=readGenome(base),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  const generation=lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
  const admin=new CurrentStore(join(workspace,'system/generations/G0001/current.sqlite3'));admin.initialize(generation,'1');admin.close();fs.mkdirSync(join(workspace,'system/generations/G0001/body/skills'),{recursive:true});
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,'1');
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B'));
  const options={provider:{async call(){throw new Error('NO_LLM_CALL_EXPECTED')}},usageMeter:new UsageMeter({models:{}}),modelName:'test'};
  let manager=new WorldRuntimeManager(registry,genome.manifest,options);
  const runtime:EvolutionRuntime={
    validateRelease:vi.fn(async directory=>{fs.mkdirSync(join(directory,'apps/server/dist/services'),{recursive:true});fs.copyFileSync(join(process.cwd(),'apps/server/dist/services/owner_automation_gate.js'),join(directory,'apps/server/dist/services/owner_automation_gate.js'));fs.copyFileSync(join(process.cwd(),'apps/server/dist/services/owner_company_budget.js'),join(directory,'apps/server/dist/services/owner_company_budget.js'));fs.mkdirSync(join(directory,'resources/config'),{recursive:true});fs.copyFileSync(join(process.cwd(),'resources/config/company_protocol.json'),join(directory,'resources/config/company_protocol.json'));}),quiesce:vi.fn(async()=>manager.quiesceAll()),finalDream:vi.fn(async()=>{}),
    worlds:()=>registry.list().filter(w=>w.status==='ACTIVE').map(w=>({id:w.world_id,directory:registry.directory(w.world_id)})),
    smoke:vi.fn(async(directory,candidateWorkspace,generationId)=>{
      const l=new LineageStore(join(candidateWorkspace,'system/lineage/lineage.sqlite3'),{v23:true}),c=new WorldRegistryStore(join(candidateWorkspace,'system/control/control.sqlite3'));
      const r=new WorldRegistryService(candidateWorkspace,c,l,'1'),m=new WorldRuntimeManager(r,readGenome(directory).manifest,options);
      try{for(const world of r.list())expect((await m.open(world.world_id)).life.current.meta().generation_id).toBe(generationId);
        const fresh=r.create(narrative('inheritance smoke'));const child=await m.open(fresh.world_id);expect(child.life.current.skills()).toHaveLength(0);

      }finally{await m.closeAll();c.close();l.close();}
    }),stop:vi.fn(async()=>manager.closeAll()),switchRelease:vi.fn(async directory=>{release=directory;}),
    start:vi.fn(async()=>{manager=new WorldRuntimeManager(registry,readGenome(release).manifest,options);}),
    healthy:vi.fn(async id=>{for(const world of registry.list())expect((await manager.open(world.world_id)).life.current.meta().generation_id).toBe(id);}),
    resume:vi.fn(async()=>{}),activeRelease:()=>fs.realpathSync(release),
  };
  const supervisor=new GenerationSupervisor(join(root,'trusted'),join(workspace,'system'),releases,lineage,runtime,true);
  cleanup.push(async()=>{await manager.closeAll();supervisor.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  const prepare=async()=>{
    const proposal=lineage.proposeGene('G0001','owner',{point:'V34 software patch',reason:'Synthetic tested patch',effect:'Preserve new business facts'});lineage.decideProposal(proposal.id,'APPROVED');
    supervisor.submit({id:'r2',base_generation:'G0001',base_release:'r1',proposal_id:String(proposal.id),patch:[{path:'genome/manifest.json',content:JSON.stringify({...genome.manifest,generation:2})},{path:'genome/v34-test.txt',content:'V34 software-only change'}]});
    const validated=await supervisor.validate('r2');supervisor.approve('r2',validated.candidate.candidate_hash);return {};

  };
  return {workspace,lineage,control,registry,supervisor,runtime,a,b,narrative,prepare,manager:()=>manager,release:()=>release};
}
describe('real Supervisor with all World Currents (process adapter doubles)',()=>{
  it('retains but refuses a legacy validated or approved candidate without an instance compatibility summary',async()=>{
    const f=fixture();await f.prepare();const old={...f.supervisor.get('r2').candidate};delete old.instance_compatibility;const {candidate_hash:_,directory:__,...bound}=old;old.candidate_hash=evolutionHash(bound);
    const db=(f.supervisor as any).db;db.prepare("UPDATE candidates SET state='VALIDATED',approval_hash=NULL,candidate_json=? WHERE id='r2'").run(JSON.stringify(old));f.lineage.db.prepare('UPDATE gene_proposals SET candidate_hash=? WHERE id=?').run(old.candidate_hash,old.proposal_id);
    expect(()=>f.supervisor.approve('r2',old.candidate_hash)).toThrow('INSTANCE_ASSETS_CHANGED');await expect(f.supervisor.validate('r2')).rejects.toThrow('INSTANCE_ASSETS_CHANGED');
    db.prepare("UPDATE candidates SET state='APPROVED',approval_hash=? WHERE id='r2'").run(old.candidate_hash);await expect(f.supervisor.birth('r2')).rejects.toThrow('INSTANCE_ASSETS_CHANGED');expect(f.runtime.quiesce).not.toHaveBeenCalled();expect(f.lineage.activeGeneration()!.id).toBe('G0001');expect(fs.existsSync(f.supervisor.get('r2').directory)).toBe(true);
  },20000);
  it('updates an isolated Git Core while retaining approved Gene, two private Worlds, extension/data hashes and V29 OFF facts through upgrade and rollback',async()=>{
    const f=fixture(),prepared=await f.prepare();await f.supervisor.birth('r2');
    const gate=new OwnerAutomationGate(f.control),goal=gate.goals.create({title:'Retained goal',objective:'Keep real evidence',maxTokens:123456,acceptance:{kind:'manual',description:'Verify source evidence'},idempotencyKey:'v30-retained-goal'});gate.goals.action(goal.id,{action:'pause',expectedRevision:1,idempotencyKey:'v30-pause-goal'});
    f.control.db.prepare("INSERT INTO owner_model_permits VALUES('unknown-fixture','initial',?,?,?,'UNKNOWN',1000,NULL,NULL,?)").run(f.a.world_id,goal.id,1,Date.now());
    const a=await f.manager().open(f.a.world_id),extension=await f.manager().extensions(f.a.world_id),program={schema:1,id:'customer-analysis',version:'1.0.0',engine:'pure-ast-json@1',requiredContracts:['pure_skill@1'],dataSchemaVersion:1,source:'export default input=>({count:input.rows.length})',tests:[{input:{rows:[]},expected:{count:0}},{input:{rows:[1]},expected:{count:1}}]},saved=extension.submit('0_0_0',program);
    extension.action(program.id,{action:'activate',hash:saved.hash,expectedRevision:0,expectedHash:null,idempotencyKey:'v30-extension-active'});
    expect((await f.manager().extensions(f.b.world_id)).list()).toEqual([]);
    const data=join(a.directory,'extension-data/customer-analysis/customers.json'),markdown=join(a.directory,'live/artifacts/0_0_0/private.skill.md'),report=join(a.directory,'code-candidates/old-report/report.json');for(const file of [data,markdown,report])fs.mkdirSync(join(file,'..'),{recursive:true});fs.writeFileSync(data,'{"syntheticCustomer":"private-fixture-only"}');fs.writeFileSync(markdown,'---\nname: Private workflow\ndescription: Synthetic scoped method\n---\nDo not publish customer data.');fs.writeFileSync(report,'{"status":"CORE_PATCH_REBASE_REQUIRED","private":"retained"}');
    a.store.db.exec("CREATE TABLE v30_customer_fixture(id TEXT PRIMARY KEY,contact TEXT); INSERT INTO v30_customer_fixture VALUES('fixture','private@example.invalid')");
    a.store.runs.createRun({run_id:'checkpoint-fixture',start_round:0,requested_rounds:1,run_limit:100000,run_spent:42,run_reserved:0,genesis_revision:0,created_at:1,finished_at:2,status:'STOPPED',stop_reason:'SERVICE_SHUTDOWN',started_at:1,ended_at:2} as any);a.store.runs.createCheckpoint('checkpoint-fixture',1);a.store.runs.setResumePending('checkpoint-fixture',true);
    const checkpoint=a.store.runs.getCheckpoint('checkpoint-fixture'),goalBefore=gate.goals.get(goal.id),pointerBefore=gate.view(),digest=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),files=[data,markdown,report,join(a.directory,'extensions',program.id,'active.json'),join(a.directory,'extensions',program.id,'versions',saved.hash+'.json')],before=files.map(digest);
    const root=join(f.workspace,'..'),source=join(root,'upstream'),checkout=join(root,'pinned'),candidate=join(root,'releases/core-v30');fs.mkdirSync(join(source,'genome'),{recursive:true});fs.copyFileSync(join(root,'releases/r1/genome/manifest.json'),join(source,'genome/manifest.json'));fs.writeFileSync(join(source,'README.md'),'Core before');
    const git=(args:string[],cwd=source)=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true}).trim();git(['init','-b','main']);git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Core before']);fs.writeFileSync(join(source,'README.md'),'Core after');git(['add','.']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-m','Core after']);const sha=git(['rev-parse','HEAD']);git(['worktree','add','--detach',checkout,sha]);
    await freezeLocalRelease(checkout,candidate,async()=>{},(dir:string)=>{const file=join(dir,'genome/manifest.json'),m=JSON.parse(fs.readFileSync(file,'utf8'));m.generation=3;fs.writeFileSync(file,JSON.stringify(m));fs.mkdirSync(join(dir,'apps/server/dist/services'),{recursive:true});fs.copyFileSync(join(process.cwd(),'apps/server/dist/services/owner_automation_gate.js'),join(dir,'apps/server/dist/services/owner_automation_gate.js'));fs.copyFileSync(join(process.cwd(),'apps/server/dist/services/owner_company_budget.js'),join(dir,'apps/server/dist/services/owner_company_budget.js'));fs.mkdirSync(join(dir,'resources/config'),{recursive:true});fs.copyFileSync(join(process.cwd(),'resources/config/company_protocol.json'),join(dir,'resources/config/company_protocol.json'));});
    const proposal=f.lineage.proposeGene('G0002','owner',{point:'Core upstream',reason:'Isolated Git update',effect:'Retain instance assets'});f.lineage.decideProposal(proposal.id,'APPROVED');f.supervisor.submitOwnerRelease({id:'core-v30',base_generation:'G0002',base_release:'r2',proposal_id:proposal.id,patch:[],owner_release:{source_commit:sha,release_hash:frozenReleaseHash(candidate),reason:'Isolated upstream Core'}});const checked=await f.supervisor.validate('core-v30');expect(checked.candidate.instance_compatibility.extensions[0].enabled).toBe(true);expect(checked.candidate.instance_compatibility.corePatches).toContain(f.a.world_id);f.supervisor.approve('core-v30',checked.candidate.candidate_hash);await f.supervisor.birth('core-v30');
    expect(f.lineage.activeGeneration()!.id).toBe('G0003');expect((await f.manager().extensions(f.a.world_id)).run(program.id,{rows:[1,2]}).result).toEqual({count:2});expect(files.map(digest)).toEqual(before);expect(gate.goals.get(goal.id)).toEqual(goalBefore);expect(gate.view()).toEqual(pointerBefore);
    const reopened=await f.manager().open(f.a.world_id);expect(reopened.store.runs.getCheckpoint('checkpoint-fixture')).toEqual(checkpoint);expect(reopened.store.db.prepare('SELECT COUNT(*) n FROM v30_customer_fixture').get()!.n).toBe(1);
    const smoke=join(root,'trusted/candidate-workspaces/core-v30');expect(fs.existsSync(join(smoke,'worlds',f.a.world_id,'extension-data'))).toBe(false);expect(fs.readFileSync(join(smoke,'worlds',f.a.world_id,'live/environment.md'),'utf8')).not.toContain('private@example.invalid');
    await f.supervisor.rollback('core-v30','Isolated compatibility rollback');expect(files.map(digest)).toEqual(before);expect(gate.goals.get(goal.id)).toEqual(goalBefore);expect(gate.view().desiredMode).toBe('OFF');expect(f.control.db.prepare("SELECT state FROM owner_model_permits WHERE id='unknown-fixture'").get()!.state).toBe('UNKNOWN');expect(git(['status','--porcelain'])).toBe('');git(['worktree','remove',checkout]);console.info('V30_ISOLATED_DEMO '+JSON.stringify({upstreamCommit:sha,extensionHash:saved.hash,privateFileHashesBefore:before,privateFileHashesAfter:files.map(digest),worlds:2,goalStatePreserved:true,automation:'OFF',unknownCallsPreserved:1,checkpointTokens:42,rollback:'G0002'}));
  },30000);
  it('blocks a critical missing Gene/Body contract and reports noncritical extensions without changing their files or data',async()=>{
    const f=fixture();await f.prepare();const candidate=join(f.workspace,'../releases/r2'),file=join(candidate,'genome/manifest.json'),m=JSON.parse(fs.readFileSync(file,'utf8')),original=fs.readFileSync(file);delete m.capability_contracts['pure_skill@1'];fs.writeFileSync(file,JSON.stringify(m));await expect(instanceCompatibility(join(f.workspace,'system'),'G0001',candidate,f.runtime.worlds!())).resolves.toMatchObject({geneAssets:0});fs.writeFileSync(file,original);
    const ext=new InstanceExtensionService(f.registry.directory(f.a.world_id),f.a.world_id,m.capability_contracts);const archived=ext.submit('0_0_0',{schema:1,id:'archived-host',version:'1.0.0',engine:'node@1',requiredContracts:[],dataSchemaVersion:1,source:'process.exit(1)',tests:[{input:1,expected:1},{input:2,expected:2}]});expect(archived.reason).toBe('EXTENSION_ENGINE_UNSUPPORTED');const summary=await instanceCompatibility(join(f.workspace,'system'),'G0001',candidate,f.runtime.worlds!());expect(summary.extensions[0].enabled).toBe(false);
  },20000);
  it('migrates every World, switches one global generation and executes inherited source in an entirely new World',async()=>{
    const f=fixture(),prepared=await f.prepare();await f.supervisor.birth('r2');
    expect(f.lineage.activeGeneration()!.id).toBe('G0002');for(const world of [f.a,f.b])expect((await f.manager().open(world.world_id)).life.current.meta().generation_id).toBe('G0002');
    const fresh=f.registry.create(f.narrative('C')),runtime=await f.manager().open(fresh.world_id);
    expect(runtime.life.current.skills()).toHaveLength(0);expect(fs.readdirSync(join(runtime.directory,'generations/G0002/body/skills'))).toEqual([]);

    expect(f.supervisor.get('r2').state).toBe('BORN');
  },20000);
  it('abandons the entire birth when one World Current is corrupt and keeps all old Worlds runnable',async()=>{
    const f=fixture();await f.prepare();await f.manager().close(f.b.world_id);
    const file=join(f.registry.directory(f.b.world_id),'generations/G0001/current.sqlite3'),original=fs.readFileSync(file);fs.writeFileSync(file,'corrupt current');
    await expect(f.supervisor.birth('r2')).rejects.toThrow();
    expect(f.lineage.activeGeneration()!.id).toBe('G0001');expect(f.runtime.switchRelease).not.toHaveBeenCalled();
    fs.writeFileSync(file,original);expect((await f.manager().open(f.a.world_id)).life.current.meta().generation_id).toBe('G0001');expect((await f.manager().open(f.b.world_id)).life.current.meta().generation_id).toBe('G0001');
    expect(f.lineage.db.prepare("SELECT id FROM generations WHERE id='G0002'").get()).toBeUndefined();
  },20000);
  it('restores every previous Current after post-switch health failure and retains failure history',async()=>{
    const f=fixture();await f.prepare();vi.mocked(f.runtime.healthy).mockRejectedValueOnce(new Error('WORLD_HEALTH_FAILED'));
    await expect(f.supervisor.birth('r2')).rejects.toThrow('WORLD_HEALTH_FAILED');expect(f.lineage.activeGeneration()!.id).toBe('G0001');
    for(const world of [f.a,f.b])expect((await f.manager().open(world.world_id)).life.current.meta().generation_id).toBe('G0001');
    expect(f.lineage.generation('G0002').state).toBe('FAILED');expect(f.lineage.relevantMemories({kind:'generation_rollback'})).toHaveLength(1);
  },20000);
});
