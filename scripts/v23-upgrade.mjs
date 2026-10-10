import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {LineageStore,CurrentStore,WorldRegistryStore,readGenome,writeGenerationPointer} from '../packages/persistence/dist/index.js';
import {GenerationMigrator} from '../supervisor/dist/generation_migrator.js';
import {LocalWorldRuntime} from '../supervisor/dist/local_world_runtime.js';
import {migrateV23Copy} from './v23-world-migrate.mjs';
import {freezeLocalRelease,frozenReleaseHash,ownerEnvironment,approvedLocalRelease} from './local-release.mjs';
import {dataFingerprint,copyTreeNew} from './local-upgrade.mjs';
import {workspaceManifest} from './v23-migration-dry-run.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
// This process lease is not a business fact. Its schema remains bound; no other rows are excluded.
export const v23SourceFingerprint=(file,relative)=>dataFingerprint(file,relative==='lineage/lineage.sqlite3'?['business_worker']:[]);
function save(file,value){fs.writeFileSync(file+'.next',JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(file+'.next',file);}
function directoryHash(root){const entries=[];const walk=relative=>{const file=path.join(root,relative),stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw new Error('V23_DATA_SYMLINK_FORBIDDEN');
  if(stat.isDirectory())for(const name of fs.readdirSync(file).sort()){if(!relative&&name==='runtime')continue;if(/\.sqlite3-(wal|shm)$/.test(name)&&!relative.startsWith('system/legacy/v22/raw/'))continue;walk(relative?relative+'/'+name:name);}
  else if(stat.isFile())entries.push([relative,relative.endsWith('.sqlite3')&&!relative.includes('/raw/')?dataFingerprint(file):fileHash(file)]);else throw new Error('V23_DATA_SPECIAL_FILE');};walk('');return hash(entries);}
function outside(source,destination){const relative=path.relative(source,destination);if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('V23_OPERATOR_DIRECTORY_MUST_BE_OUTSIDE_WORKSPACE');}
function verifySourceFiles(candidate){
  const roots=['ledger','lineage','generations','live','assets','private','active-generation.json'];
  const before=read(path.join(candidate.stage0,'source-before.json')).filter(e=>roots.some(root=>e.path===root||e.path.startsWith(root+'/')));
  const actual=[];for(const root of roots){const file=path.join(candidate.workspace,root);if(!fs.existsSync(file))continue;
    const stat=fs.lstatSync(file);if(!stat.isDirectory()||stat.isSymbolicLink())actual.push({path:root,type:stat.isSymbolicLink()?'LINK':'FILE',sha256:stat.isSymbolicLink()?undefined:fileHash(file)});
    else{actual.push({path:root,type:'DIRECTORY'});actual.push(...workspaceManifest(file).map(e=>({...e,path:root+'/'+e.path})));}
  }
  const normalize=entries=>entries.filter(e=>! /\.sqlite3-(wal|shm|journal)$/.test(e.path)).map(e=>({path:e.path,type:e.type,...(e.sha256&&!Object.hasOwn(candidate.baseline,e.path)?{sha256:e.sha256}:{})})).sort((a,b)=>a.path.localeCompare(b.path));
  if(hash(normalize(before))!==hash(normalize(actual)))throw new Error('V23_LIVE_FILES_CHANGED_RERUN_STAGE0');
}
async function smoke(release,workspace,generation){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(release,'supervisor/candidate_harness.mjs'),'smoke',release,workspace,generation],{
  cwd:release,windowsHide:true,shell:false,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},stdio:'ignore'});const timer=setTimeout(()=>child.kill(),30000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('V23_SOURCE_UPGRADE_SMOKE_FAILED'));});});}
async function validateInitialRelease(release,workspace,generation){
  const stateDirectory=path.dirname(path.dirname(release)),runtime=new LocalWorldRuntime({workspace,releases:path.dirname(release),stateDirectory,
    activeReleaseFile:path.join(stateDirectory,'active-release.json'),appUrl:'http://127.0.0.1:1',ownerEnvironment:{EMERGENTINC_OWNER_SECRET:randomBytes(32).toString('hex')}});
  await runtime.validateRelease(release);await smoke(release,workspace,generation);
}

/** Build everything first. This prepares a reviewable copy and never changes the live workspace. */
export async function prepareV23Upgrade(workspace,stage0,operatorDirectory,projectRoot=path.resolve('.'),validate=validateInitialRelease,install){
  workspace=fs.realpathSync(workspace);stage0=fs.realpathSync(stage0);operatorDirectory=path.resolve(operatorDirectory);outside(workspace,operatorDirectory);
  if(fs.existsSync(operatorDirectory))throw new Error('V23_NEW_OPERATOR_DIRECTORY_REQUIRED');
  const report=read(path.join(stage0,'report.json')),old=report.inventory.activeGeneration;
  if(!report.sourceUnchanged||report.rehearsal.conflicts.length)throw new Error('V23_VERIFIED_STAGE0_REQUIRED');
  const rawActive=old.id?old:old.active;const active=rawActive?{id:rawActive.id,gene_hash:rawActive.gene_hash??rawActive.geneHash,release_id:rawActive.release_id??rawActive.releaseId,generation_no:rawActive.generation_no??rawActive.number}:undefined;if(!active?.id)throw new Error('V23_BASE_GENERATION_REQUIRED');
  const id='local-v23-'+randomBytes(8).toString('hex'),release=await freezeLocalRelease(projectRoot,path.join(operatorDirectory,'releases',id),install),genome=readGenome(release.directory);
  const source=report.backup.databases.find(d=>d.source===`generations/${active.id}/current.sqlite3`),shared=report.backup.databases.find(d=>d.source==='lineage/lineage.sqlite3');
  if(!source||!shared||source.tables.some(t=>t.table==='current_events'&&t.rows>0)||shared.tables.some(t=>t.table==='business_events'&&t.rows>0))throw new Error('V23_SOURCE_FINAL_DREAM_REQUIRED');
  const prepared=path.join(operatorDirectory,'prepared-workspace');await migrateV23Copy(stage0,prepared,release.directory);
  const system=path.join(prepared,'system'),lineage=new LineageStore(path.join(system,'lineage/lineage.sqlite3'),{v23:true}),control=new WorldRegistryStore(path.join(system,'control/control.sqlite3'));
  let target;
  try{
    const next=Number(lineage.db.prepare('SELECT MAX(generation_no)+1 n FROM generations').get().n);if(genome.manifest.generation!==next)throw new Error('V23_MANIFEST_GENERATION_REQUIRED');
    target=`G${String(next).padStart(4,'0')}`;const generation=lineage.createGeneration({id:target,number:next,parentId:active.id,geneHash:genome.geneHash,releaseId:id});
    for(const root of [system,...control.worlds().map(w=>path.join(prepared,w.workspace_relpath))]){
      const from=new CurrentStore(path.join(root,'generations',active.id,'current.sqlite3'),{readOnly:true}),to=new CurrentStore(path.join(root,'generations',target,'current.sqlite3'));
      try{to.initialize(generation,genome.manifest.body_interface_version);new GenerationMigrator().migrate(from,to,path.join(root,'generations',active.id,'body/skills'),path.join(root,'generations',target,'body/skills'));}finally{from.close();to.close();}
    }writeGenerationPointer(system,target);
  }finally{control.close();lineage.close();}
  await validate(release.directory,prepared,target);if(readGenome(release.directory).geneHash!==genome.geneHash)throw new Error('V23_GENE_CHANGED_DURING_VALIDATION');
  release.hash=frozenReleaseHash(release.directory);
  const baseline=Object.fromEntries(report.backup.databases.map(d=>[d.source,v23SourceFingerprint(path.join(stage0,'backup/snapshots',d.source),d.source)]));
  const candidate={schema:1,id,scope:'windows_owner_v23',workspace,projectRoot:fs.realpathSync(projectRoot),base:active,target,geneHash:genome.geneHash,release,
    operatorDirectory,prepared,stage0,baseline,baselinePolicy:'BUSINESS_WORKER_LEASE_ONLY',projectionHash:directoryHash(prepared),rawManifestHash:report.backup.rawManifestHash,
    validation:validate===validateInitialRelease?'FIXED_FULL_RELEASE_CHECKS':'CUSTOM_TEST_VALIDATOR',
    finalDream:{policy:'V22_OWNER_MAINTENANCE_RECEIPTS_RETAINED',currentFacts:0,businessFacts:0},worldCount:report.inventory.qianjiCount};
  const receipt={candidate,candidateHash:hash(candidate),state:'PREPARED',ownerAuthorization:null};save(path.join(operatorDirectory,'initial-v23.json'),receipt);return receipt;
}
export function approveV23Upgrade(directory,exactHash,reason){const file=path.join(directory,'initial-v23.json'),receipt=read(file);if(receipt.candidateHash!==hash(receipt.candidate)||exactHash!==receipt.candidateHash||!reason?.trim())throw new Error('V23_EXACT_OWNER_APPROVAL_REQUIRED');
  if(!['PREPARED','APPROVED'].includes(receipt.state))throw new Error('V23_UPGRADE_NOT_APPROVABLE');receipt.state='APPROVED';receipt.ownerAuthorization={channel:'explicit_owner_cli',candidateHash:exactHash,reason};save(file,receipt);return receipt;}

async function renameStoppedWorkspace(source,target){
  for(let attempt=0;;attempt++){
    try{await fs.promises.rename(source,target);return;}
    catch(error){if(process.platform!=='win32'||!['EPERM','EBUSY'].includes(error.code)||attempt>=19)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
  }
}
/** Approval is bound to both code and the preserved projection. Any new live fact forces a new rehearsal. */
export async function applyV23Upgrade(directory,exactHash){
  const receiptFile=path.join(directory,'initial-v23.json'),receipt=read(receiptFile),c=receipt.candidate;
  if(receipt.state!=='APPROVED'||receipt.candidateHash!==hash(c)||receipt.ownerAuthorization?.candidateHash!==exactHash||receipt.candidateHash!==exactHash)throw new Error('V23_EXACT_OWNER_APPROVAL_REQUIRED');
  if(frozenReleaseHash(c.release.directory)!==c.release.hash||directoryHash(c.prepared)!==c.projectionHash)throw new Error('V23_APPROVED_CANDIDATE_CHANGED');
  const env=ownerEnvironment(c.projectRoot),base=`http://127.0.0.1:${env.PORT||8765}`,lockFile=path.join(c.workspace,'runtime/instance.lock');let cookie,stopped=false,moved=false,published=false,sourceExited=false;
  const backup=c.workspace+'.v22-before-'+c.id;if(fs.existsSync(backup))throw new Error('V23_BACKUP_DESTINATION_EXISTS');
  const request=async(url,body)=>{const response=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Connection:'close',...(cookie?{cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:'error'});await response.arrayBuffer();if(!response.ok)throw new Error('V23_OWNER_ACTION_FAILED');if(url==='/api/login')cookie=response.headers.get('set-cookie')?.split(';')[0];};
  const envFile=path.join(c.projectRoot,'.env'),originalEnv=fs.existsSync(envFile)?fs.readFileSync(envFile,'utf8'):undefined;let envModified=false;
  const previous=approvedLocalRelease(c.workspace);if(previous.generation.id!==c.base.id||previous.generation.gene_hash!==c.base.gene_hash)throw new Error('V23_LIVE_BASE_CHANGED');
  const token=randomBytes(32).toString('hex'),guard=c.workspace+'.v23-upgrade-pending.json',pending=root=>path.join(root,'runtime/local-upgrade-pending.json');
  fs.writeFileSync(guard,JSON.stringify({id:c.id,token,receiptFile}),{flag:'wx',mode:0o600});
  const clearPending=root=>{const file=pending(root);if(fs.existsSync(file)&&read(file).token===token)fs.unlinkSync(file);};
  let runtime;
  try{
    const ready=await fetch(base+'/health/ready',{headers:{Connection:'close'},signal:AbortSignal.timeout(3000)}),identity=await ready.json();
    if(!ready.ok||identity.ready!==true||identity.generation!==c.base.id||identity.geneHash!==c.base.gene_hash)throw new Error('V23_LIVE_BASE_IDENTITY_CONFLICT');
    await request('/api/login',{secret:env.EMERGENTINC_OWNER_SECRET});await request('/api/evolution/quiesce',{});
    const sourceLineage=new DatabaseSync(path.join(c.workspace,'lineage/lineage.sqlite3'),{readOnly:true});try{
      if(sourceLineage.prepare('SELECT COUNT(*) n FROM business_worker').get().n!==0)throw new Error('V23_BUSINESS_WORKER_NOT_QUIESCED');
    }finally{sourceLineage.close();}
    for(const [relative,fingerprint] of Object.entries(c.baseline))if(v23SourceFingerprint(path.join(c.workspace,relative),relative)!==fingerprint)throw new Error('V23_LIVE_DATA_CHANGED_RERUN_STAGE0');
    verifySourceFiles(c);
    fs.writeFileSync(pending(c.workspace),JSON.stringify({id:c.id,token}),{flag:'wx',mode:0o600});
    const locked=read(lockFile);if(!Number.isSafeInteger(locked.pid)||locked.pid<=0)throw new Error('V23_LIVE_LOCK_INVALID');process.kill(locked.pid);stopped=true;
    for(let i=0;i<150;i++){try{process.kill(locked.pid,0);}catch(error){if(error.code==='ESRCH'){sourceExited=true;break;}throw error;}await new Promise(r=>setTimeout(r,100));}if(!sourceExited)throw new Error('V23_SERVER_STOP_TIMEOUT');
    const privateRoot=path.join(c.workspace,'private');if(fs.existsSync(privateRoot))copyTreeNew(privateRoot,path.join(c.prepared,'private'));
    const lineage=new LineageStore(path.join(c.prepared,'system/lineage/lineage.sqlite3'),{v23:true});try{
      const proposal=lineage.proposeGene(c.base.id,'owner',{point:'首次 V23 世界化升级',reason:'Owner 执行已审核的 V23 整改计划并批准准确候选',effect:'保留人物和旧历史，启用 World、Gene 晋升及链上核验'},c.id);
      lineage.decideProposal(proposal.id,'APPROVED');lineage.db.transaction(()=>{
        lineage.db.prepare("UPDATE generations SET state='RETIRED',retired_at=? WHERE id=?").run(Date.now(),c.base.id);
        lineage.db.prepare("UPDATE generations SET state='ACTIVE',born_at=? WHERE id=?").run(Date.now(),c.target);
        lineage.db.prepare("UPDATE gene_proposals SET state='BORN',target_generation_id=?,candidate_hash=? WHERE id=?").run(c.target,exactHash,proposal.id);
        lineage.lifeEvent(c.target,'generation_birth',{previous:c.base.id,release:c.id,candidateHash:exactHash,worldCount:c.worldCount},`v23-birth:${c.id}`);
      });
    }finally{lineage.close();}
    if(path.resolve(backup)!==path.resolve(c.workspace+'.v22-before-'+c.id)||path.dirname(backup)!==path.dirname(c.workspace))throw new Error('V23_BACKUP_PATH_INVALID');
    fs.mkdirSync(path.join(c.prepared,'runtime'),{recursive:true});fs.writeFileSync(pending(c.prepared),JSON.stringify({id:c.id,token}),{flag:'wx',mode:0o600});
    receipt.state='APPLYING';save(receiptFile,receipt);await renameStoppedWorkspace(c.workspace,backup);moved=true;fs.renameSync(c.prepared,c.workspace);published=true;
    const activeReleaseFile=path.join(directory,'active-release.json'),configFile=path.join(directory,'owner-config.json');save(activeReleaseFile,{directory:c.release.directory});
    const config={workspace:c.workspace,releases:path.join(directory,'releases'),stateDirectory:directory,activeReleaseFile,appUrl:base,ownerProjectRoot:c.projectRoot};save(configFile,config);
    runtime=new LocalWorldRuntime({...config,ownerEnvironment:{...env,EMERGENTINC_LOCAL_UPGRADE_TOKEN:token}});await runtime.start();await runtime.healthy(c.target);
    receipt.state='COMMITTED';receipt.backup=backup;receipt.configFile=configFile;save(receiptFile,receipt);
    if(fs.existsSync(envFile)){let text=fs.readFileSync(envFile,'utf8');text=text.replace(/^EMERGENTINC_LOCAL_EVOLUTION_CONFIG=.*\r?\n?/gm,'');fs.writeFileSync(envFile,text.replace(/\s*$/,'')+'\nEMERGENTINC_LOCAL_EVOLUTION_CONFIG='+configFile+'\n');envModified=true;}
    await runtime.resume();
    clearPending(c.workspace);clearPending(backup);fs.unlinkSync(guard);
    return receipt;
  }catch(error){
    if(stopped&&!sourceExited){receipt.state='RECOVERY_REQUIRED';receipt.failure=error.message;save(receiptFile,receipt);throw error;}
    if(published){try{await runtime.stop();}catch(stopError){receipt.state='RECOVERY_REQUIRED';receipt.failure=stopError.message;save(receiptFile,receipt);throw stopError;}const failed=c.workspace+'.v23-failed-'+c.id;if(fs.existsSync(failed))throw new Error('V23_FAILED_ARCHIVE_EXISTS');
      if(path.dirname(failed)!==path.dirname(c.workspace))throw new Error('V23_FAILED_ARCHIVE_PATH_INVALID');
      const failedLineage=new LineageStore(path.join(c.workspace,'system/lineage/lineage.sqlite3'),{v23:true});try{
        failedLineage.db.prepare("UPDATE generations SET state='FAILED',failure_reason=? WHERE id=?").run(error.message,c.target);
        failedLineage.db.prepare("UPDATE gene_proposals SET state='FAILED' WHERE source_ref=?").run(c.id);
      }finally{failedLineage.close();}
      fs.renameSync(c.workspace,failed);receipt.failedWorkspace=failed;}
    if(moved)fs.renameSync(backup,c.workspace);if(envModified&&originalEnv!==undefined)fs.writeFileSync(envFile,originalEnv);
    if(stopped){const lineage=new LineageStore(path.join(c.workspace,'lineage/lineage.sqlite3'));try{
      lineage.remember(c.base.id,'generation_failure',{point:'首次 V23 升级失败',reason:error.message,effect:`恢复旧代；${c.target} 失败副本和准确候选记录保留`},`v23-upgrade-failed:${c.id}`);
      lineage.lifeEvent(c.base.id,'generation_failure',{targetGeneration:c.target,candidateHash:exactHash,failedWorkspace:receipt.failedWorkspace??null},`v23-upgrade-failed:${c.id}`);
    }finally{lineage.close();}}
    clearPending(c.workspace);if(fs.existsSync(guard)&&read(guard).token===token)fs.unlinkSync(guard);
    receipt.state=stopped?'FAILED':'APPROVED';receipt.failure=error.message;save(receiptFile,receipt);
    if(stopped){const log=fs.openSync(path.join(directory,'v22-restored.log'),'a');try{const child=spawn(process.execPath,[path.join(previous.directory,'apps/server/dist/main.js')],{cwd:previous.directory,windowsHide:true,detached:true,shell:false,stdio:['ignore',log,log],env:{...env,EMERGENTINC_WORKSPACE_ROOT:c.workspace,EMERGENTINC_RELEASE_ID:previous.generation.release_id}});child.unref();}finally{fs.closeSync(log);}}
    else if(cookie)await request('/api/evolution/resume',{});throw error;
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const [action,...args]=process.argv.slice(2);let result;
  if(action==='prepare')result=await prepareV23Upgrade(...args);else if(action==='approve')result=approveV23Upgrade(...args);else if(action==='apply')result=await applyV23Upgrade(...args);else throw new Error('Usage: v23-upgrade prepare <workspace> <verified-stage0> <new-owner-directory> | approve <owner-directory> <exact-hash> <reason> | apply <owner-directory> <exact-hash>');
  console.log(JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
