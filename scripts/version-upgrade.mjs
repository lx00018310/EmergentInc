import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {freezeLocalRelease,frozenReleaseHash,ownerEnvironment} from './local-release.mjs';
import {LineageStore} from '../packages/persistence/dist/index.js';

const root=path.resolve(import.meta.dirname,'..');
export function ownerReleaseInput(version,reason,now=new Date()){
  if(version!==undefined&&typeof version!=='string'||typeof reason!=='string'||!reason.trim()||reason.length>1000||reason.includes('\0'))
    throw new Error('VERSION_LABEL_AND_OWNER_REASON_REQUIRED');
  const label=(version??'').trim();
  if(label.length>200||/[\u0000-\u001f\u007f]/.test(label))throw new Error('VERSION_LABEL_AND_OWNER_REASON_REQUIRED');
  return {label:label||`release-${now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,reason:reason.trim()};
}
export function upgradeConfig(projectRoot){
  const environment=ownerEnvironment(projectRoot),file=environment.EMERGENTINC_LOCAL_EVOLUTION_CONFIG;
  if(!file)throw new Error('V23_OWNER_CONFIG_REQUIRED_USE_V23_UPGRADE_FOR_V22');
  const configFile=path.resolve(projectRoot,file),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
  if(!config.ownerProjectRoot)throw new Error('OWNER_PROJECT_ROOT_REQUIRED');
  for(const key of ['workspace','releases','stateDirectory','activeReleaseFile'])config[key]=path.resolve(config.ownerProjectRoot,config[key]);
  return {configFile,config};
}
function generation(configFile,action,...args){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'scripts/v23-generation.mjs'),configFile,action,...args],{cwd:root,windowsHide:true,shell:false,stdio:'inherit'});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error('VERSION_UPGRADE_'+action.toUpperCase()+'_FAILED')));
});}
function gitOutput(args,{cwd=root,timeout=30000}={}){return execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,timeout,maxBuffer:8*1024*1024}).trim();}
/** Verifies main is an ancestor of sha (fast-forward condition) without touching any working tree. */
export function ensureFastForwardable(sha,cwd=root){gitOutput(['merge-base','--is-ancestor','main',sha],{cwd});}
/** Safely fast-forwards git main to sha; refuses when main moved, the tree is dirty or the merge is not a fast-forward. */
export function fastForwardMain(sha,expectedMainHead,cwd=root){
  const head=()=>gitOutput(['rev-parse','main'],{cwd});
  if(expectedMainHead&&head()!==expectedMainHead)throw new Error('GIT_SYNC_MAIN_MOVED');
  ensureFastForwardable(sha,cwd);
  // Fail closed when main (or any checkout of this repository here) has uncommitted changes: never dirty a developer's tree.
  if(gitOutput(['status','--porcelain'],{cwd}))throw new Error('GIT_SYNC_DIRTY_WORKTREE');
  gitOutput(['merge','--ff-only',sha],{cwd,timeout:120000});
  if(head()!==sha)throw new Error('GIT_SYNC_INCOMPLETE');
}
/** Creates a detached worktree of the pinned sha under the maintenance state directory. */
function preparePinnedCommit(shaInput){
  if(!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(shaInput))throw new Error('GIT_COMMIT_INVALID');
  const resolved=gitOutput(['rev-parse',`${shaInput}^{commit}`]);
  if(resolved!==shaInput&&resolved!==shaInput.toLowerCase())throw new Error('GIT_COMMIT_INVALID');
  const sha=resolved;
  let type;try{type=gitOutput(['cat-file','-t',sha]);}catch{throw new Error('GIT_COMMIT_NOT_FOUND');}
  if(type!=='commit')throw new Error('GIT_COMMIT_NOT_FOUND');
  const {config}=upgradeConfig(root);
  try{ensureFastForwardable(sha);}catch{throw new Error('GIT_COMMIT_NOT_FAST_FORWARDABLE');}
  const mainHead=gitOutput(['rev-parse','main']);
  const worktree=path.join(config.stateDirectory,'git-worktrees',`prepare-${randomUUID()}`);
  if(fs.existsSync(worktree))throw new Error('GIT_WORKTREE_PATH_EXISTS');
  fs.mkdirSync(path.dirname(worktree),{recursive:true});
  try{gitOutput(['worktree','add','--detach',worktree,sha],{timeout:120000});}
  catch(error){fs.rmSync(path.dirname(worktree),{recursive:true,force:true});throw error;}
  return {sourceDirectory:worktree,sourceCommit:sha,mainHeadAtPrepare:mainHead};
}
export async function versionUpgrade(args){
  const [action,...values]=args;
  if(!action||action==='help'){
    console.log(`Owner software upgrade (V23-layout workspace):
  status
  prepare <version-label> <reason> [--commit <sha>]
  validate <id>
  show <id>
  approve <id> <exact-candidate-hash>
  apply <id>
  rollback <id> <reason>
  rollback-to <target-generation> <expected-active> <reason>
  delete-release <id> <expected-active> <identity> <reason>
  delete-newer <expected-active> <reason>
  recover
Preparation freezes this clean checkout (or the pinned --commit via a detached
git worktree) and validates it. Approval binds the exact hash; apply switches
all Worlds and fast-forwards git main when the candidate was prepared from a
pinned commit.`);return;
  }
  const {configFile,config}=upgradeConfig(root);
  if(action==='prepare-code'){
    const {prepareAppCode}=await import('./prepare-app-code.mjs');
    return prepareAppCode(root,configFile,config,values[0],values[1],generation);
  }
  if(action==='status'){
    const {approvedWorldRelease}=await import('./v23-approved-release.mjs');
    const active=approvedWorldRelease(config.workspace,configFile);
    console.log(JSON.stringify({workspace:config.workspace,generation:active.generation.id,releaseId:active.generation.release_id,directory:active.directory,appUrl:config.appUrl},null,2));
    return generation(configFile,'list');
  }
  if(action==='prepare'){
    const commitIndex=values.indexOf('--commit'),commitFlag=commitIndex>=0?values.splice(commitIndex,2)[1]:undefined;
    const {label:version,reason}=ownerReleaseInput(values[0],values[1]);
    let sourceDirectory=root,sourceCommit,mainHeadAtPrepare;
    if(commitFlag){
      ({sourceDirectory,sourceCommit,mainHeadAtPrepare}=preparePinnedCommit(commitFlag));
    }else{
      if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw new Error('OWNER_RELEASE_REQUIRES_CLEAN_COMMITTED_CHECKOUT');
      sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    }
    const id=`local-${randomUUID()}`,directory=path.join(config.releases,id);
    const lineage=new LineageStore(path.join(config.workspace,'system/lineage/lineage.sqlite3'),{v23:true});
    let worktreeRemoved=false;
    try{
      const base=lineage.activeGeneration();if(!base)throw new Error('ACTIVE_GENERATION_REQUIRED');
      const number=Number(lineage.db.prepare('SELECT MAX(generation_no)+1 n FROM generations').get().n);
      await freezeLocalRelease(sourceDirectory,directory);
      const manifestFile=path.join(directory,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
      manifest.generation=number;fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
      const proposal=lineage.proposeGene(base.id,'owner',{point:`Owner software upgrade ${version}`,reason,effect:'All Worlds share the approved release; raw facts retained for later Dream'},`owner-version:${id}`);
      lineage.decideProposal(proposal.id,'APPROVED');
      const request={id,base_generation:base.id,base_release:base.release_id,proposal_id:proposal.id,patch:[],owner_release:{label:version,reason,source_commit:sourceCommit,release_hash:frozenReleaseHash(directory),
        ...(mainHeadAtPrepare?{main_head_at_prepare:mainHeadAtPrepare,git_sync_target:sourceCommit}:{})}};
      const requestFile=path.join(config.stateDirectory,id+'.request.json');fs.writeFileSync(requestFile,JSON.stringify(request,null,2),{flag:'wx'});
      await generation(configFile,'submit-owner-release',requestFile);
      await generation(configFile,'validate',id);
    }finally{
      if(commitFlag&&!worktreeRemoved){try{execFileSync('git',['worktree','remove','--force',sourceDirectory],{cwd:root,windowsHide:true});}catch{}}
      lineage.close();
    }
    return;
  }
  const translated=action==='apply'?'birth':action;
  if(!['validate','show','approve','birth','rollback','rollback-to','delete-release','delete-newer','recover'].includes(translated))throw new Error('VERSION_UPGRADE_ACTION_INVALID');
  return generation(configFile,translated,...values);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await versionUpgrade(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
