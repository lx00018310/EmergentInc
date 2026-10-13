import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {readGeneCatalog} from '../apps/server/dist/services/gene_catalog.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const fail=(code,detail='')=>{throw new Error(code+(detail?': '+detail:''));};
const sameAsset=(a,b)=>['id','version','kind','file','contentHash','license'].every(key=>a[key]===b[key]);
function regular(root,relative){
  let file=root;
  for(const segment of relative.split('/')){
    if(!segment||segment==='.'||segment==='..'||/[\\:\x00-\x1f]/.test(segment))fail('GENE_ASSET_PATH_INVALID');
    file=path.join(file,segment);if(fs.lstatSync(file).isSymbolicLink())fail('GENE_ASSET_PATH_INVALID');
  }
  if(!fs.statSync(file).isFile()||fs.statSync(file).size>1048576)fail('GENE_ASSET_FILE_INVALID');
  return file;
}
function bytesFor(release,asset){const bytes=fs.readFileSync(regular(release,'genome/'+asset.file));if(hash(bytes)!==asset.contentHash)fail('GENE_ASSET_HASH_MISMATCH',`${asset.id}@${asset.version}`);return bytes;}
function catalog(release){const value=readGeneCatalog(release);if(new Set(value.assets.map(a=>a.id.toLowerCase())).size!==value.assets.length)fail('GENE_CATALOG_INVALID');for(const a of value.assets)bytesFor(release,a);return value;}
function geneFiles(directory){
  const result={};const walk=(relative)=>{for(const item of fs.readdirSync(path.join(directory,relative),{withFileTypes:true})){
    if(relative==='genome'&&item.name==='assets')continue;
    const name=relative+'/'+item.name;if(item.isSymbolicLink())fail('CUSTOM_GENE_PATCH_NEEDS_REBASE',name);
    if(item.isDirectory())walk(name);else {let bytes=fs.readFileSync(regular(directory,name));if(name==='genome/manifest.json'){const m=JSON.parse(bytes);delete m.generation;bytes=Buffer.from(JSON.stringify(m));}result[name]=hash(bytes);}
  }};walk('genome');return result;
}
function originGene(active,source,db,stateDirectory){
  const metadata=path.join(active,'instance-compatibility.json');if(fs.existsSync(metadata))return json(metadata).sourceGene;
  if(stateDirectory&&fs.existsSync(path.join(stateDirectory,'evolution.sqlite3'))){
    const approvals=new DatabaseSync(path.join(stateDirectory,'evolution.sqlite3'),{readOnly:true});
    try{let g=db.prepare("SELECT * FROM generations WHERE state='ACTIVE'").get();while(g){
      const r=approvals.prepare("SELECT request_json FROM candidates WHERE id=? AND state IN ('BORN','ROLLED_BACK')").get(g.release_id);
      const commit=r&&JSON.parse(r.request_json).owner_release?.source_commit;
      if(commit){try{const names=execFileSync('git',['ls-tree','-r','--name-only',commit,'--','genome'],{cwd:source,encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).filter(n=>n&&!n.startsWith('genome/assets/'));
        return Object.fromEntries(names.map(name=>{let bytes=execFileSync('git',['show',`${commit}:${name}`],{cwd:source,windowsHide:true});if(name==='genome/manifest.json'){const m=JSON.parse(bytes);delete m.generation;bytes=Buffer.from(JSON.stringify(m));}return [name,hash(bytes)];}));
      }catch{fail('CUSTOM_GENE_PATCH_NEEDS_REBASE','Core origin unavailable');}}
      g=g.parent_id?db.prepare('SELECT * FROM generations WHERE id=?').get(g.parent_id):undefined;
    }}finally{approvals.close();}
  }
  // Older releases without provenance are inheritable only when their non-asset Gene equals this Core.
  return geneFiles(source);
}
/** Read-only trusted plan. Only public assets with exact birth, license and immutable-source evidence enter it. */
export function approvedGenePlan(active,workspace,source,stateDirectory){
  const db=new DatabaseSync(path.join(workspace,'system/lineage/lineage.sqlite3'),{readOnly:true});
  try{
    const generation=db.prepare("SELECT * FROM generations WHERE state='ACTIVE'").get();if(!generation||path.basename(active)!==generation.release_id)fail('CANDIDATE_BASE_CONFLICT');
    const current=catalog(active),sourceGene=geneFiles(source),origin=originGene(active,source,db,stateDirectory),actual=geneFiles(active);
    if(JSON.stringify(Object.entries(actual).sort())!==JSON.stringify(Object.entries(origin??{}).sort()))fail('CUSTOM_GENE_PATCH_NEEDS_REBASE');
    const history=[];
    const table=db.prepare("SELECT 1 FROM sqlite_master WHERE name='gene_assets'").get();
    if(table)for(const row of db.prepare(`SELECT a.id,a.kind,a.current_version,a.state,v.version,v.generation_id,v.content_hash,v.relative_path,v.license,s.candidate_id,s.source_hash,s.snapshot_hash,p.state promotion_state,p.snapshot_path,p.snapshot_hash promotion_hash,p.metadata,p.proposal_id,g.release_id,q.state proposal_state,q.target_generation_id
      FROM gene_assets a JOIN gene_asset_versions v ON v.asset_id=a.id JOIN gene_asset_sources s ON s.asset_id=a.id AND s.version=v.version JOIN gene_promotion_candidates p ON p.id=s.candidate_id JOIN generations g ON g.id=v.generation_id JOIN gene_proposals q ON q.id=p.proposal_id ORDER BY a.id,v.version`).all()){
      const review=JSON.parse(row.metadata).review;
      if(row.state!=='GENE'||row.promotion_state!=='GENE'||row.proposal_state!=='BORN'||row.target_generation_id!==row.generation_id||row.snapshot_hash!==row.promotion_hash||review?.shareConsent!==true||!['PUBLIC','INTERNAL_NO_CUSTOMER_DATA'].includes(review.privacy)||!row.license?.trim()||review.license!==row.license)fail('GENE_ASSET_PROVENANCE_CONFLICT',row.id);
      const sourceBytes=fs.readFileSync(regular(workspace,row.snapshot_path));if(hash(sourceBytes)!==row.snapshot_hash)fail('GENE_ASSET_SOURCE_CHANGED',row.id);
      const asset={id:row.id,version:row.version,kind:row.kind,file:row.relative_path,contentHash:row.content_hash,license:row.license};
      if(asset.file!==`assets/${asset.id}/${asset.version}.json`||!/^[a-zA-Z0-9_-]+$/.test(asset.id)||!/^G\d{4,}$/.test(row.generation_id)||!/^[a-zA-Z0-9_-]+$/.test(row.release_id))fail('GENE_ASSET_PROVENANCE_CONFLICT');
      const release=path.join(path.dirname(active),row.release_id);bytesFor(release,asset);
      history.push({...asset,releaseId:row.release_id,generationId:row.generation_id,candidateId:row.candidate_id,sourceHash:row.source_hash,snapshotHash:row.snapshot_hash,currentVersion:row.current_version});
    }
    if(table){const count=Number(db.prepare('SELECT COUNT(*) n FROM gene_asset_versions').get().n);if(count!==history.length||Number(db.prepare('SELECT COUNT(*) n FROM gene_assets').get().n)!==new Set(history.map(h=>h.id)).size)fail('GENE_ASSET_PROVENANCE_CONFLICT','Missing approval/source rows');}
    const inherited=current.assets.filter(a=>history.some(h=>h.id===a.id));
    const official=catalog(source).assets;
    for(const a of current.assets)if(!inherited.some(h=>h.id===a.id)&&!official.some(b=>sameAsset(a,b)))fail('GENE_ASSET_PROVENANCE_CONFLICT',a.id);
    for(const a of inherited){const h=history.find(h=>h.id===a.id&&h.version===a.version);if(!h||h.currentVersion!==a.version||h.contentHash!==a.contentHash||h.kind!==a.kind||h.license!==a.license)fail('GENE_ASSET_PROVENANCE_CONFLICT',a.id);}
    for(const h of history)if(h.version===h.currentVersion&&!inherited.some(a=>a.id===h.id))fail('GENE_ASSET_MISSING_FROM_ACTIVE',h.id);
    const fingerprint=hash(JSON.stringify({generation: generation.id,release:generation.release_id,current,history,actual}));
    return {schema:1,baseGeneration:generation.id,baseRelease:generation.release_id,fingerprint,sourceGene,inherited,history};
  }finally{db.close();}
}
/** Only writes a new private candidate, before installation, validation and final hashes. */
export function inheritApprovedGene(plan,active,candidate){
  const upstream=catalog(candidate),merged=[...upstream.assets];
  for(const a of plan.inherited){const found=merged.find(x=>x.id.toLowerCase()===a.id.toLowerCase());if(found&&(found.id!==a.id||found.version!==a.version||found.contentHash!==a.contentHash||found.kind!==a.kind||found.license!==a.license))fail('GENE_ASSET_UPSTREAM_CONFLICT',`${a.id}@${a.version}`);if(!found)merged.push(a);}
  // Historical versions remain immutable and auditable, even when they are not the active index entry.
  for(const h of plan.history){const source=path.join(path.dirname(active),h.releaseId),bytes=bytesFor(source,h),dest=path.join(candidate,'genome',h.file);fs.mkdirSync(path.dirname(dest),{recursive:true});
    if(fs.existsSync(dest)){if(hash(fs.readFileSync(regular(candidate,'genome/'+h.file)))!==h.contentHash)fail('GENE_ASSET_UPSTREAM_CONFLICT',`${h.id}@${h.version}`);}else fs.writeFileSync(dest,bytes,{flag:'wx'});
  }
  if(plan.history.length){fs.mkdirSync(path.join(candidate,'genome/assets'),{recursive:true});fs.writeFileSync(path.join(candidate,'genome/assets/index.json'),JSON.stringify({schema:1,assets:merged.sort((a,b)=>a.id.localeCompare(b.id))},null,2)+'\n');}
  fs.writeFileSync(path.join(candidate,'instance-compatibility.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  return plan;
}
export function checkInheritedGene(active,workspace,candidate,stateDirectory){
  const file=path.join(candidate,'instance-compatibility.json');if(!fs.existsSync(file)){
    const db=new DatabaseSync(path.join(workspace,'system/lineage/lineage.sqlite3'),{readOnly:true});
    try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='gene_assets'").get()&&db.prepare("SELECT 1 FROM gene_assets WHERE state='GENE' LIMIT 1").get())fail('GENE_ASSET_BASE_CHANGED','Prepare a candidate with verified inherited provenance');}finally{db.close();}
    return;
  }
  const saved=json(file),fresh=approvedGenePlan(active,workspace,candidate,stateDirectory);
  if(saved.baseGeneration!==fresh.baseGeneration||saved.baseRelease!==fresh.baseRelease||saved.fingerprint!==fresh.fingerprint)fail('GENE_ASSET_BASE_CHANGED');
  // The live approved ledger is authoritative; a candidate cannot omit checks by shortening its saved lists.
  const current=catalog(candidate);for(const h of fresh.history)bytesFor(candidate,h);
  for(const a of fresh.inherited)if(!current.assets.some(b=>sameAsset(a,b)))fail('GENE_ASSET_PROVENANCE_CONFLICT',a.id);
}
