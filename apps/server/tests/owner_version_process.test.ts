import {it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {LineageStore,WorldRegistryStore,CurrentStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {LocalWorldRuntime} from '../../../supervisor/local_world_runtime.js';
import {releaseHash} from '../../../supervisor/release_builder.js';

/** An actual archived V23 release is supplied explicitly; never use the live Workspace or credentials. */
it.skipIf(!process.env.EMERGENTINC_TEST_V23_RELEASE||process.env.EMERGENTINC_CANDIDATE_MODE==='1')('upgrades real V23 processes without a model and restores schema-compatible V23 after rollback or startup failure',async()=>{
  const {freezeLocalRelease}=await import('../../../scripts/local-release.mjs');
  fs.mkdirSync(resolve('cache'),{recursive:true});const root=fs.mkdtempSync(resolve('cache/owner-version-process-'));
  const workspace=join(root,'workspace'),state=join(root,'owner'),releases=join(root,'releases'),base=join(releases,'r1');fs.mkdirSync(state,{recursive:true});
  await freezeLocalRelease(resolve(process.env.EMERGENTINC_TEST_V23_RELEASE!),base);
  const manifest=JSON.parse(fs.readFileSync(join(base,'genome/manifest.json'),'utf8'));manifest.generation=1;fs.writeFileSync(join(base,'genome/manifest.json'),JSON.stringify(manifest));
  const genome=readGenome(base),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  const initial=lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
  const admin=new CurrentStore(join(workspace,'system/generations/G0001/current.sqlite3'));admin.initialize(initial,'1');admin.event('unprocessed_real_test_fact',{keep:true});admin.close();fs.mkdirSync(join(workspace,'system/generations/G0001/body/skills'),{recursive:true});
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,'1');
  const worlds=['A','B','C'].map(displayName=>registry.create({displayName,traits:{},behaviorProfile:[]}));
  fs.writeFileSync(join(workspace,'workspace-layout.json'),JSON.stringify({schema:1,version:23}));
  const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));
  const activeReleaseFile=join(state,'active.json');fs.writeFileSync(activeReleaseFile,JSON.stringify({directory:base}));
  const runtime=new LocalWorldRuntime({workspace,releases,stateDirectory:state,activeReleaseFile,appUrl:`http://127.0.0.1:${port}`,ownerEnvironment:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
    EMERGENTINC_OWNER_SECRET:randomBytes(32).toString('hex'),EMERGENTINC_SECURE_COOKIES:'0'}});
  const supervisor=new GenerationSupervisor(state,join(workspace,'system'),releases,lineage,runtime,true);
  const prepare=async(id:string,number:number)=>{
    const directory=join(releases,id);await freezeLocalRelease(resolve('.'),directory);
    const file=join(directory,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.generation=number;fs.writeFileSync(file,JSON.stringify(manifest));
    const proposal=lineage.proposeGene('G0001','owner',{point:'Upgrade V24',reason:'Explicit isolated process rehearsal',effect:'Preserve all Worlds and facts'});lineage.decideProposal(proposal.id,'APPROVED');
    supervisor.submitOwnerRelease({id,base_generation:'G0001',base_release:'r1',proposal_id:proposal.id,patch:[],owner_release:{reason:'Explicit isolated rehearsal',source_commit:'a'.repeat(40),release_hash:releaseHash(directory)}});
    const c=await supervisor.validate(id);supervisor.approve(id,c.candidate.candidate_hash);
  };
  const paymentVersion=()=>{const db=new DatabaseSync(join(workspace,'system/payment/payment.sqlite3'),{readOnly:true});try{return db.prepare('PRAGMA user_version').get()!.user_version;}finally{db.close();}};
  try{
    await runtime.start();await runtime.healthy('G0001');await runtime.resume();expect(paymentVersion()).toBe(2);
    await prepare('r2',2);await supervisor.birth('r2');expect(paymentVersion()).toBe(3);
    expect((await (await fetch(runtime.config.appUrl+'/api/public/products')).json() as any).items.every((product:any)=>!product.product_enabled)).toBe(true);
    for(const world of worlds){const current=new CurrentStore(join(registry.directory(world.world_id),'generations/G0002/current.sqlite3'),{readOnly:true});try{expect(current.meta().generation_id).toBe('G0002');}finally{current.close();}}
    expect(lineage.db.prepare("SELECT * FROM dream_runs WHERE status='COMPLETED'").all()).toHaveLength(0);
    await supervisor.rollback('r2','Explicit rollback rehearsal');expect(paymentVersion()).toBe(2);expect(lineage.activeGeneration()?.id).toBe('G0001');
    await prepare('r3',3);const healthy=runtime.healthy.bind(runtime);let failed=false;
    runtime.healthy=async generation=>{await healthy(generation);if(generation==='G0003'&&!failed){failed=true;throw new Error('INJECTED_V24_STARTUP_FAILURE');}};
    await expect(supervisor.birth('r3')).rejects.toThrow('INJECTED_V24_STARTUP_FAILURE');
    expect(paymentVersion()).toBe(2);expect(lineage.activeGeneration()?.id).toBe('G0001');expect(supervisor.get('r3').phase).toBe('RESTORED');
    const ready=await (await fetch(runtime.config.appUrl+'/health/ready')).json() as any;expect(ready.version).toBe('v23-world-1');
    const archived=new CurrentStore(join(state,'snapshots/r2/current-before.sqlite3'),{readOnly:true});try{expect(archived.db.prepare("SELECT * FROM current_events WHERE kind='unprocessed_real_test_fact'").all()).toHaveLength(1);}finally{archived.close();}
  }catch(error){const diagnostics=String(error)+'\n'+JSON.stringify(supervisor.list())+'\n'+fs.readFileSync(join(state,'server.log'),'utf8').slice(-3000)+'\n'+fs.readdirSync(state).filter(name=>name.startsWith('validation-')).map(name=>name+'\n'+fs.readFileSync(join(state,name),'utf8').slice(-12000)).join('\n');fs.writeFileSync(resolve('cache/owner-version-failure.log'),diagnostics);throw new Error(diagnostics);}
  finally{await runtime.stop();supervisor.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});}
},600000);
