import {it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {reserveTestHttpPort} from '../../../tests/http_port.js';
import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {CoreStore,LineageStore,CurrentStore,writeGenerationPointer,readGenome} from '@emergentinc/persistence';

it('prepares first V23 migration from verified bytes and requires exact Owner approval without touching source',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'v23-owner-')),workspace=join(root,'workspace'),backup=join(root,'backup'),operator=join(root,'owner');
  const {dryRunV23}=await import('../../../scripts/v23-migration-dry-run.mjs');
  const {prepareV23Upgrade,approveV23Upgrade,applyV23Upgrade}=await import('../../../scripts/v23-upgrade.mjs');
  const core=new CoreStore(join(workspace,'ledger/v9_core.sqlite3')),profile=core.qianji.createProfile({qianjiId:'qj_A',careerStatus:'active'});
  core.pixels.upsertPixelAccount({pixelId:'0_0_0',energy:999,active:true,refundDeficitTokens:0,spendBlockedReason:null});core.qianji.createBinding({qianjiId:profile.qianjiId,pixelId:'0_0_0',incarnation:1});core.close();
  const nextNumber=readGenome(resolve('.')).manifest.generation,baseId=`G${String(nextNumber-1).padStart(4,'0')}`,targetId=`G${String(nextNumber).padStart(4,'0')}`;
  const lineage=new LineageStore(join(workspace,'lineage/lineage.sqlite3')),generation=lineage.createGeneration({id:baseId,number:nextNumber-1,geneHash:'5'.repeat(64),releaseId:'local-old',state:'ACTIVE'});
  const current=new CurrentStore(join(workspace,'generations/'+baseId+'/current.sqlite3'));current.initialize(generation,'1');current.close();lineage.close();writeGenerationPointer(workspace,baseId);
  fs.mkdirSync(join(workspace,'generations/'+baseId+'/body/skills'),{recursive:true});fs.mkdirSync(join(workspace,'live/pixels/0_0_0'),{recursive:true});
  fs.writeFileSync(join(workspace,'live/pixels/0_0_0/state.json'),JSON.stringify({pixel_id:'0_0_0',id:'0_0_0',energy:999,active:true,incarnation:1,generation:1}));
  fs.writeFileSync(join(workspace,'live/pixels/0_0_0/pixel.md'),'Original mind');fs.writeFileSync(join(workspace,'live/world_state.json'),'{"round":8}');
  try{
    await dryRunV23(workspace,backup,{v22Commit:'db73e0f31b675b578d7ffa566c94d4f772d340bc'});
    const original=fs.readFileSync(join(workspace,'ledger/v9_core.sqlite3'));
    const receipt=await prepareV23Upgrade(workspace,backup,operator,resolve('.'),async(_release,copy,generation)=>{
      expect(generation).toBe(targetId);expect(JSON.parse(fs.readFileSync(join(copy,'workspace-layout.json'),'utf8')).version).toBe(23);
    },async()=>{});
    expect(receipt.state).toBe('PREPARED');expect(receipt.candidate.worldCount).toBe(1);expect(receipt.candidate.base.gene_hash).toBe('5'.repeat(64));
    expect(fs.readFileSync(join(workspace,'ledger/v9_core.sqlite3'))).toEqual(original);
    await expect(applyV23Upgrade(operator,receipt.candidateHash)).rejects.toThrow('V23_EXACT_OWNER_APPROVAL_REQUIRED');
    expect(()=>approveV23Upgrade(operator,'wrong','test only')).toThrow('V23_EXACT_OWNER_APPROVAL_REQUIRED');
    expect(approveV23Upgrade(operator,receipt.candidateHash,'Explicit fixture decision only').state).toBe('APPROVED');
    fs.writeFileSync(join(receipt.candidate.release.directory,'genome/manifest.json'),'tampered');
    await expect(applyV23Upgrade(operator,receipt.candidateHash)).rejects.toThrow('V23_APPROVED_CANDIDATE_CHANGED');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
},30000);

// Actual controller processes and filesystem cutover; the tiny HTTP fixture has no model or chain.
it.each([false,true])('publishes initial V23 or restores V22 when resume fails (failure=%s)',async failResume=>{
  const root=fs.mkdtempSync(join(tmpdir(),'v23-cutover-')),workspace=join(root,'workspace'),project=join(root,'project'),operator=join(root,'owner');
  const {dryRunV23}=await import('../../../scripts/v23-migration-dry-run.mjs');
  const {prepareV23Upgrade,approveV23Upgrade,applyV23Upgrade}=await import('../../../scripts/v23-upgrade.mjs');
  const {freezeLocalRelease,ownerEnvironment}=await import('../../../scripts/local-release.mjs');
  const {approvedWorldRelease}=await import('../../../scripts/v23-approved-release.mjs');
  const {LocalWorldRuntime}=await import('../../../supervisor/local_world_runtime.js');
  fs.mkdirSync(join(project,'genome'),{recursive:true});fs.mkdirSync(join(project,'apps/server/dist'),{recursive:true});fs.mkdirSync(join(project,'resources'),{recursive:true});
  const manifest={schema_version:1,gene_hash_version:2,generation:6,body_interface_version:'1',protected_paths:['genome/**'],capability_contracts:{'world_runtime@1':true}};
  fs.writeFileSync(join(project,'genome/manifest.json'),JSON.stringify(manifest));fs.writeFileSync(join(project,'resources/fixture.json'),JSON.stringify({failResume:false}));
  fs.writeFileSync(join(project,'apps/server/dist/main.js'),`
    const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{DatabaseSync}=require('node:sqlite');
    const root=process.env.EMERGENTINC_WORKSPACE_ROOT,lock=path.join(root,'runtime/instance.lock');
    fs.mkdirSync(path.dirname(lock),{recursive:true});if(fs.existsSync(lock)){const pid=JSON.parse(fs.readFileSync(lock)).pid;try{process.kill(pid,0);throw Error('live lock');}catch(e){if(e.code!=='ESRCH')throw e;}fs.unlinkSync(lock);}
    const pending=path.join(root,'runtime/local-upgrade-pending.json');if(fs.existsSync(pending)&&JSON.parse(fs.readFileSync(pending)).token!==process.env.EMERGENTINC_LOCAL_UPGRADE_TOKEN)throw Error('pending token');
    fs.writeFileSync(lock,JSON.stringify({pid:process.pid,token:'fixture'}),{flag:'wx'});
    const app=http.createServer((req,res)=>{const life=fs.existsSync(path.join(root,'workspace-layout.json'))?path.join(root,'system'):root;
      const generation=JSON.parse(fs.readFileSync(path.join(life,'active-generation.json'))).generation_id;
      res.setHeader('Content-Type','application/json');
      if(req.url==='/health/live')res.end(JSON.stringify({alive:true,processId:process.pid}));
      else if(req.url==='/health/ready'){const db=new DatabaseSync(path.join(life,'lineage/lineage.sqlite3'),{readOnly:true});const geneHash=db.prepare('SELECT gene_hash FROM generations WHERE id=?').get(generation).gene_hash;db.close();res.end(JSON.stringify({ready:true,generation,geneHash}));}
      else if(req.url==='/api/login'){res.setHeader('Set-Cookie','owner=fixture');req.resume();res.end('{}');}
      else if(req.url==='/api/evolution/quiesce'){const db=new DatabaseSync(path.join(life,'lineage/lineage.sqlite3'));db.exec('DELETE FROM business_worker');db.close();req.resume();res.end('{}');}
      else if(req.url==='/api/evolution/resume'&&JSON.parse(fs.readFileSync(path.join(__dirname,'../../../resources/fixture.json'))).failResume){res.statusCode=503;req.resume();res.end('{}');}
      else{req.resume();res.end('{}');}
    });app.listen(Number(process.env.PORT),'127.0.0.1');
  `);
  const port=await reserveTestHttpPort();
  fs.writeFileSync(join(project,'.env'),`PORT=${port}\nEMERGENTINC_OWNER_SECRET=${randomBytes(32).toString('hex')}\nEMERGENTINC_SECURE_COOKIES=0\n`);
  const id='local-fixture-old',recordDirectory=join(workspace,'runtime/local-upgrades',id),old=await freezeLocalRelease(project,join(recordDirectory,'release'),async()=>{});
  const geneHash=readGenome(project).geneHash,core=new CoreStore(join(workspace,'ledger/v9_core.sqlite3'));core.qianji.createProfile({qianjiId:'qj_cutover',careerStatus:'active'});
  core.pixels.upsertPixelAccount({pixelId:'0_0_0',energy:999,active:true,refundDeficitTokens:0,spendBlockedReason:null});core.qianji.createBinding({qianjiId:'qj_cutover',pixelId:'0_0_0',incarnation:1});core.close();
  const lineage=new LineageStore(join(workspace,'lineage/lineage.sqlite3')),generation=lineage.createGeneration({id:'G0005',number:5,geneHash,releaseId:id,state:'ACTIVE'});
  const current=new CurrentStore(join(workspace,'generations/G0005/current.sqlite3'));current.initialize(generation,'1');current.close();lineage.close();writeGenerationPointer(workspace,'G0005');
  fs.mkdirSync(join(workspace,'generations/G0005/body/skills'),{recursive:true});fs.mkdirSync(join(workspace,'live/pixels/0_0_0'),{recursive:true});
  fs.writeFileSync(join(workspace,'live/pixels/0_0_0/state.json'),JSON.stringify({pixel_id:'0_0_0',id:'0_0_0',energy:999,active:true,incarnation:1,generation:1}));
  fs.writeFileSync(join(workspace,'live/pixels/0_0_0/pixel.md'),'Retained personality');fs.writeFileSync(join(workspace,'live/world_state.json'),'{"round":8}');
  fs.mkdirSync(join(workspace,'private'),{recursive:true});fs.writeFileSync(join(workspace,'private/owner-note.txt'),'private original');
  const c={id,scope:'windows_owner_maintenance',workspace,projectRoot:project,target:'G0005',geneHash,release:old},candidateHash=createHash('sha256').update(JSON.stringify(c)).digest('hex');
  fs.writeFileSync(join(recordDirectory,'record.json'),JSON.stringify({candidate:c,candidateHash,state:'COMMITTED',ownerAuthorization:{candidateHash}}));
  await dryRunV23(workspace,join(root,'backup'));fs.writeFileSync(join(project,'resources/fixture.json'),JSON.stringify({failResume}));
  const receipt=await prepareV23Upgrade(workspace,join(root,'backup'),operator,project,async()=>{},async()=>{});
  approveV23Upgrade(operator,receipt.candidateHash,'Fixture approval only');
  const child=spawn(process.execPath,[join(old.directory,'apps/server/dist/main.js')],{cwd:old.directory,windowsHide:true,env:{...ownerEnvironment(project),EMERGENTINC_WORKSPACE_ROOT:workspace},stdio:'ignore'});
  const config={workspace,releases:join(operator,'releases'),stateDirectory:operator,activeReleaseFile:join(operator,'active-release.json'),appUrl:`http://127.0.0.1:${port}`,ownerEnvironment:ownerEnvironment(project)};
  const waitReady=async(expected:string)=>{for(let i=0;i<100;i++){try{const response=await fetch(config.appUrl+'/health/ready',{headers:{Connection:'close'},signal:AbortSignal.timeout(500)});if((await response.json() as any).generation===expected)return;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('fixture not ready');};
  try{
    await waitReady('G0005');
    const lease=new LineageStore(join(workspace,'lineage/lineage.sqlite3'));lease.db.prepare('INSERT INTO business_worker VALUES(1,?,?)').run('new-process-lease',Date.now()+30000);lease.close();
    const added=join(workspace,'live/new-unbacked.md');fs.writeFileSync(added,'A new live fact after rehearsal');
    await expect(applyV23Upgrade(operator,receipt.candidateHash)).rejects.toThrow('V23_LIVE_FILES_CHANGED_RERUN_STAGE0');
    await waitReady('G0005');expect(fs.existsSync(workspace+'.v23-upgrade-pending.json')).toBe(false);fs.unlinkSync(added);
    if(failResume){await expect(applyV23Upgrade(operator,receipt.candidateHash)).rejects.toThrow('EVOLUTION_OWNER_ACTION_FAILED');await waitReady('G0005');
      const journal=JSON.parse(fs.readFileSync(join(operator,'initial-v23.json'),'utf8'));expect(journal.state).toBe('FAILED');expect(fs.existsSync(journal.failedWorkspace)).toBe(true);
      const restored=new LineageStore(join(workspace,'lineage/lineage.sqlite3'));try{expect(restored.activeGeneration()?.id).toBe('G0005');expect(restored.relevantMemories({kind:'generation_failure'})).toHaveLength(1);}finally{restored.close();}
      expect(fs.readFileSync(join(project,'.env'),'utf8')).not.toContain('EMERGENTINC_LOCAL_EVOLUTION_CONFIG');
    }else{
      const rename=fs.promises.rename.bind(fs.promises);let blockedOnce=false;
      const spy=vi.spyOn(fs.promises,'rename').mockImplementation(async(source,target)=>{if(process.platform==='win32'&&source===workspace&&!blockedOnce){blockedOnce=true;throw Object.assign(new Error('Temporary directory handle'),{code:'EPERM'});}return rename(source,target);});
      try{expect((await applyV23Upgrade(operator,receipt.candidateHash)).state).toBe('COMMITTED');expect(blockedOnce).toBe(process.platform==='win32');}finally{spy.mockRestore();}
      await waitReady('G0006');
      expect(approvedWorldRelease(workspace,join(operator,'owner-config.json')).generation.id).toBe('G0006');expect(fs.existsSync(workspace+'.v22-before-'+receipt.candidate.id)).toBe(true);}
    expect(fs.existsSync(workspace+'.v23-upgrade-pending.json')).toBe(false);expect(fs.existsSync(join(workspace,'runtime/local-upgrade-pending.json'))).toBe(false);
    expect(fs.readFileSync(join(workspace,'private/owner-note.txt'),'utf8')).toBe('private original');
  }finally{
    try { await new LocalWorldRuntime(config).stop(); }
    catch (error) {
      if (child.exitCode !== null || child.signalCode !== null) throw error;
      await new Promise<void>((done, reject) => { child.once('exit', () => done()); child.once('error', reject); child.kill(); });
    }
    // Windows may still be releasing a detached child's cwd handle. Synchronous retries block its exit callback.
    await fs.promises.rm(root,{recursive:true,force:true,maxRetries:100,retryDelay:100});
  }
},30000);
