import * as fs from 'node:fs';
import * as path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {frozenReleaseHash} from './local-release.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Owner config and approval database are outside the mutable World workspace. */
export function approvedWorldRelease(workspace,configFile){
  if(fs.existsSync(path.join(workspace,'runtime/local-upgrade-pending.json'))||fs.existsSync(workspace+'.v23-upgrade-pending.json'))throw new Error('V23_UPGRADE_RECOVERY_REQUIRED');
  const config=read(configFile);workspace=fs.realpathSync(workspace);
  if(fs.realpathSync(config.workspace)!==workspace)throw new Error('V23_OWNER_CONFIG_WORKSPACE_CONFLICT');
  const relative=path.relative(workspace,path.resolve(config.stateDirectory));if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw new Error('V23_APPROVAL_STATE_MUST_BE_OUTSIDE_WORKSPACE');
  const layout=read(path.join(workspace,'workspace-layout.json'));if(layout.schema!==1||layout.version!==23)throw new Error('V23_WORKSPACE_REQUIRED');
  const generationId=read(path.join(workspace,'system/active-generation.json')).generation_id;
  const db=new DatabaseSync(path.join(workspace,'system/lineage/lineage.sqlite3'),{readOnly:true});let generation;
  try{const rows=db.prepare("SELECT * FROM generations WHERE state='ACTIVE'").all();if(rows.length!==1||rows[0].id!==generationId)throw new Error('V23_ACTIVE_GENERATION_CONFLICT');generation=rows[0];}finally{db.close();}
  const directory=fs.realpathSync(read(config.activeReleaseFile).directory);
  if(path.basename(directory)!==generation.release_id||path.dirname(directory)!==fs.realpathSync(config.releases))throw new Error('V23_ACTIVE_RELEASE_CONFLICT');
  let releaseHash;
  const initialFile=path.join(config.stateDirectory,'initial-v23.json');
  if(fs.existsSync(initialFile)&&read(initialFile).candidate.id===generation.release_id){
    const receipt=read(initialFile),c=receipt.candidate;
    if(receipt.state!=='COMMITTED'||receipt.candidateHash!==hash(c)||receipt.ownerAuthorization?.candidateHash!==receipt.candidateHash||c.workspace!==workspace||c.target!==generation.id||c.geneHash!==generation.gene_hash||c.release.directory!==directory)throw new Error('V23_INITIAL_APPROVAL_CONFLICT');
    releaseHash=c.release.hash;
  }else{
    const approval=new DatabaseSync(path.join(config.stateDirectory,'evolution.sqlite3'),{readOnly:true});
    try{const row=approval.prepare("SELECT * FROM candidates WHERE id=? AND state='BORN'").get(generation.release_id);if(!row)throw new Error('V23_OWNER_APPROVAL_REQUIRED');
      const candidate=JSON.parse(row.candidate_json),{candidate_hash,directory:storedDirectory,...bound}=candidate;
      if(row.target_generation!==generation.id||row.approval_hash!==candidate_hash||candidate_hash!==hash(bound)||storedDirectory!==directory||candidate.gene_hash!==generation.gene_hash)throw new Error('V23_OWNER_APPROVAL_CONFLICT');
      releaseHash=candidate.candidate_release_hash;
    }finally{approval.close();}
  }
  if(frozenReleaseHash(directory)!==releaseHash)throw new Error('V23_RELEASE_INTEGRITY_FAILED');
  const control=new DatabaseSync(path.join(workspace,'system/control/control.sqlite3'),{readOnly:true});
  const verify=file=>{const current=new DatabaseSync(file,{readOnly:true});try{const meta=current.prepare('SELECT * FROM current_meta').get();if(meta?.generation_id!==generation.id||meta.gene_hash!==generation.gene_hash||meta.release_id!==generation.release_id)throw new Error('V23_CURRENT_IDENTITY_CONFLICT');}finally{current.close();}};
  try{verify(path.join(workspace,'system/generations',generation.id,'current.sqlite3'));for(const world of control.prepare("SELECT world_id,workspace_relpath FROM qianji_worlds WHERE status='ACTIVE' AND world_id NOT IN (SELECT world_id FROM world_recovery_blocks)").all()){
    if(!/^[a-zA-Z0-9_-]+$/.test(world.world_id)||world.workspace_relpath!==`worlds/${world.world_id}`)throw new Error('V23_WORLD_PATH_INVALID');
    verify(path.join(workspace,world.workspace_relpath,'generations',generation.id,'current.sqlite3'));
  }}finally{control.close();}
  return {directory,generation};
}
