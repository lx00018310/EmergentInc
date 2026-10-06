import * as fs from 'node:fs';
import * as path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {freezeLocalRelease,frozenReleaseHash,ownerEnvironment} from './local-release.mjs';
import {LineageStore} from '../packages/persistence/dist/index.js';

const root=path.resolve(import.meta.dirname,'..');
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
export async function versionUpgrade(args){
  const [action,...values]=args;
  if(!action||action==='help'){
    console.log('Owner software upgrade (V23-layout workspace):\n  status\n  prepare <version-label> <reason>\n  show <id>\n  approve <id> <exact-candidate-hash>\n  apply <id>\n  rollback <id> <reason>\n  recover\nPreparation freezes this clean checkout and validates it. Approval binds the exact hash; apply switches all Worlds.');return;
  }
  const {configFile,config}=upgradeConfig(root);
  if(action==='status'){
    const {approvedWorldRelease}=await import('./v23-approved-release.mjs');
    const active=approvedWorldRelease(config.workspace,configFile);
    console.log(JSON.stringify({workspace:config.workspace,generation:active.generation.id,releaseId:active.generation.release_id,directory:active.directory,appUrl:config.appUrl},null,2));
    return generation(configFile,'list');
  }
  if(action==='prepare'){
    const [version,reason]=values;
    if(!/^v\d+(?:[._-][a-zA-Z0-9]+)*$/.test(version??'')||!reason?.trim()||reason.length>1000)throw new Error('VERSION_LABEL_AND_OWNER_REASON_REQUIRED');
    if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw new Error('OWNER_RELEASE_REQUIRES_CLEAN_COMMITTED_CHECKOUT');
    const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
    const id=`local-${version}-${randomUUID()}`,directory=path.join(config.releases,id);
    const lineage=new LineageStore(path.join(config.workspace,'system/lineage/lineage.sqlite3'),{v23:true});
    try{
      const base=lineage.activeGeneration();if(!base)throw new Error('ACTIVE_GENERATION_REQUIRED');
      const number=Number(lineage.db.prepare('SELECT MAX(generation_no)+1 n FROM generations').get().n);
      await freezeLocalRelease(root,directory);
      const manifestFile=path.join(directory,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
      manifest.generation=number;fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
      const proposal=lineage.proposeGene(base.id,'owner',{point:`Owner software upgrade ${version}`,reason,effect:'All Worlds share the approved release; raw facts retained for later Dream'},`owner-version:${id}`);
      lineage.decideProposal(proposal.id,'APPROVED');
      const request={id,base_generation:base.id,base_release:base.release_id,proposal_id:proposal.id,patch:[],owner_release:{reason,source_commit:sourceCommit,release_hash:frozenReleaseHash(directory)}};
      const requestFile=path.join(config.stateDirectory,id+'.request.json');fs.writeFileSync(requestFile,JSON.stringify(request,null,2),{flag:'wx'});
      await generation(configFile,'submit-owner-release',requestFile);
      await generation(configFile,'validate',id);
    }finally{lineage.close();}
    return;
  }
  const translated=action==='apply'?'birth':action;
  if(!['show','approve','birth','rollback','recover'].includes(translated))throw new Error('VERSION_UPGRADE_ACTION_INVALID');
  return generation(configFile,translated,...values);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{await versionUpgrade(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}
