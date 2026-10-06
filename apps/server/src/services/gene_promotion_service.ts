import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { LineageStore } from '@emergentinc/persistence';
import { lifeId, memoryPoint, BodyCandidate } from '@emergentinc/protocol';
import { compilePureSkill, runPureSkill, bodyCandidate } from '@emergentinc/tools';
import { WorldRuntimeManager } from './world_runtime_manager.js';
import { containedPath } from './safe_path.js';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export interface GeneAsset {id:string;version:number;kind:string;file:string;contentHash:string;license:string}
export interface GeneCatalog {schema:1;assets:GeneAsset[]}
export function readGeneCatalog(release:string):GeneCatalog {
  const file=path.join(release,'genome/assets/index.json');if(!fs.existsSync(file))return {schema:1,assets:[]};
  const catalog=JSON.parse(fs.readFileSync(file,'utf8'));if(catalog.schema!==1||!Array.isArray(catalog.assets))throw new Error('GENE_CATALOG_INVALID');
  for(const asset of catalog.assets){lifeId(asset.id);if(!Number.isSafeInteger(asset.version)||asset.version<1||asset.file!==`assets/${asset.id}/${asset.version}.json`||!/^[a-f0-9]{64}$/.test(asset.contentHash))throw new Error('GENE_CATALOG_INVALID');}
  return catalog;
}
export function loadGeneAsset(release:string,id:string){
  lifeId(id);const asset=readGeneCatalog(release).assets.find(a=>a.id===id);if(!asset)throw new Error('GENE_ASSET_NOT_FOUND');
  const file=containedPath(path.join(release,'genome'),...asset.file.split('/')),bytes=fs.readFileSync(file);
  if(hash(bytes)!==asset.contentHash)throw new Error('GENE_ASSET_HASH_MISMATCH');return {asset,content:JSON.parse(bytes.toString('utf8'))};
}
export function executeGeneSkill(release:string,id:string,input:unknown,geneHash:string){
  const loaded=loadGeneAsset(release,id);if(!['skill','code'].includes(loaded.asset.kind))throw new Error('GENE_ASSET_NOT_EXECUTABLE');
  return {origin:'gene',assetId:id,version:loaded.asset.version,geneHash,implementationHash:compilePureSkill(loaded.content.source).sourceHash,
    result:runPureSkill(loaded.content.source,input)};
}
export class GenePromotionService {
  constructor(readonly manager:WorldRuntimeManager,readonly release:string,readonly lineage:LineageStore){if(!lineage.worldsEnabled)throw new Error('V23_WORLD_LINEAGE_REQUIRED');}
  list(){return this.lineage.db.prepare('SELECT * FROM gene_promotion_candidates ORDER BY created_at DESC LIMIT 200').all();}
  async worldAssets(worldId:string){return (await this.manager.open(worldId)).store.db.prepare('SELECT * FROM world_shared_assets ORDER BY created_at').all();}
  async readWorldAsset(worldId:string,assetId:string){
    lifeId(assetId);const runtime=await this.manager.open(worldId),row=runtime.store.db.prepare('SELECT * FROM world_shared_assets WHERE asset_id=?').get(assetId);
    if(!row)throw new Error('WORLD_SHARED_ASSET_NOT_FOUND');const bytes=fs.readFileSync(containedPath(runtime.directory,...String(row.file).split('/')));
    if(hash(bytes)!==row.content_hash)throw new Error('WORLD_SHARED_ASSET_CHANGED');return {origin:'world_shared',worldId,assetId,kind:row.kind,content:bytes.toString('utf8'),contentHash:row.content_hash};
  }
  async promoteBodySkill(worldId:string,pixelId:string,skillId:string,metadata:Record<string,any>={}){
    lifeId(skillId);const runtime=await this.manager.open(worldId),row=runtime.life.current.db.prepare("SELECT active_change_id,successful_runs FROM body_skills WHERE skill_id=? AND state='ACTIVE'").get(skillId);
    if(!row||Number(row.successful_runs)<1)throw new Error('BODY_SUCCESS_EVIDENCE_REQUIRED');
    return this.nominate(worldId,pixelId,{kind:'skill',sourcePath:`generations/${runtime.life.current.meta().generation_id}/body/skills/${skillId}/${row.active_change_id}.json`,metadata});
  }
  get(id:string):Record<string,any>{lifeId(id);const row=this.lineage.db.prepare('SELECT * FROM gene_promotion_candidates WHERE id=?').get(id);if(!row)throw new Error('GENE_PROMOTION_NOT_FOUND');return {...row,metadata:JSON.parse(String(row.metadata))};}
  async createBodySkill(worldId:string,pixelId:string,value:unknown){
    const runtime=await this.manager.open(worldId),candidate=bodyCandidate(value,runtime.life.current.meta().body_interface_version) as BodyCandidate;
    if(!runtime.store.pixels.getPixelAccount(pixelId)?.active)throw new Error('BODY_ACTOR_NOT_ACTIVE');
    compilePureSkill(candidate.source);
    for(const test of candidate.tests)if(!isDeepStrictEqual(JSON.parse(JSON.stringify(runPureSkill(candidate.source,test.input))),test.expected))throw new Error('BODY_TEST_MISMATCH');
    const json=JSON.stringify(candidate),candidateHash=hash(json),id=`body_${candidateHash.slice(0,24)}`,current=runtime.life.current;
    const old=current.db.prepare('SELECT * FROM body_candidates WHERE id=?').get(id);if(old)return old;
    const file=containedPath(runtime.directory,'generations',String(current.meta().generation_id),'body','skills',candidate.skill_id,`${id}.json`);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,json,{flag:'wx',mode:0o600});
    try{current.db.transaction(()=>{
      const previous=current.db.prepare('SELECT active_change_id FROM body_skills WHERE skill_id=?').get(candidate.skill_id)?.active_change_id??null;
      const revision=Number(current.meta().body_revision)+1;
      current.db.prepare(`INSERT INTO body_candidates(id,skill_id,candidate_json,request_hash,candidate_hash,validation,state,previous_id,activated_at,created_at,body_revision)
        VALUES(?,?,?,?,?,?,'ACTIVE',?,?,?,?)`).run(id,candidate.skill_id,json,candidateHash,candidateHash,JSON.stringify({passed:true,creatorPixelId:pixelId,engine:'pure-ast-json@1',suiteHash:hash(JSON.stringify(candidate.tests))}),previous,Date.now(),Date.now(),revision);
      if(previous)current.db.prepare("UPDATE body_candidates SET state='RETIRED' WHERE id=? AND state='ACTIVE'").run(previous);
      current.db.prepare(`INSERT INTO body_skills VALUES(?,?,?,?,'ACTIVE',0,0,?) ON CONFLICT(skill_id) DO UPDATE SET active_change_id=excluded.active_change_id,state='ACTIVE',interface_version=excluded.interface_version,name=excluded.name,successful_runs=0,updated_at=excluded.updated_at`)
        .run(candidate.skill_id,candidate.purpose,id,candidate.interface_version,Date.now());
      current.db.prepare('UPDATE current_meta SET body_revision=? WHERE id=1').run(revision);
      current.event('body_activated',{id,skillId:candidate.skill_id,engine:'pure-ast-json@1'},pixelId);
    });}catch(error){fs.unlinkSync(file);throw error;}
    return current.db.prepare('SELECT * FROM body_candidates WHERE id=?').get(id)!;
  }
  async runBodySkill(worldId:string,id:string,input:unknown){
    lifeId(id);const runtime=await this.manager.open(worldId),skill=runtime.life.current.db.prepare("SELECT * FROM body_skills WHERE skill_id=? AND state='ACTIVE'").get(id);
    if(!skill)throw new Error('BODY_SKILL_NOT_ACTIVE');const row=runtime.life.current.db.prepare('SELECT * FROM body_candidates WHERE id=?').get(skill.active_change_id);
    const file=containedPath(runtime.directory,'generations',String(runtime.life.current.meta().generation_id),'body','skills',id,`${row!.id}.json`);
    const json=fs.readFileSync(file,'utf8');if(json!==row!.candidate_json||hash(json)!==row!.candidate_hash)throw new Error('BODY_ARTIFACT_CHANGED');
    const candidate=JSON.parse(json);let result:unknown;
    try{result=runPureSkill(candidate.source,input);}catch(error){
      const current=runtime.life.current,previous=row!.previous_id?current.db.prepare("SELECT * FROM body_candidates WHERE id=? AND state='RETIRED'").get(row!.previous_id):undefined;
      let restored:string|null=null;
      if(previous){const oldFile=containedPath(runtime.directory,'generations',String(current.meta().generation_id),'body','skills',id,`${previous.id}.json`);
        const oldJson=fs.readFileSync(oldFile,'utf8');if(oldJson!==previous.candidate_json||hash(oldJson)!==previous.candidate_hash)throw new Error('BODY_ROLLBACK_ARTIFACT_INVALID');
        if(JSON.parse(String(previous.validation)).engine!=='pure-ast-json@1')throw new Error('BODY_ROLLBACK_ENGINE_CONFLICT');restored=String(previous.id);}
      current.db.transaction(()=>{
        current.db.prepare("UPDATE body_candidates SET state='ROLLED_BACK' WHERE id=?").run(row!.id);
        if(restored)current.db.prepare("UPDATE body_candidates SET state='ACTIVE' WHERE id=?").run(restored);
        current.db.prepare('UPDATE body_skills SET active_change_id=?,state=?,failed_runs=failed_runs+1 WHERE skill_id=?').run(restored,restored?'ACTIVE':'DISABLED',id);
        current.event('body_rolled_back',{changeId:row!.id,restored,reason:error instanceof Error?error.message:'BODY_RUN_FAILED'});
      });throw error;
    }
    runtime.life.current.db.prepare('UPDATE body_skills SET successful_runs=successful_runs+1 WHERE skill_id=?').run(id);
    runtime.life.current.event('body_run_succeeded',{skillId:id,implementationHash:compilePureSkill(candidate.source).sourceHash});
    return {origin:'body',worldId,skillId:id,result};
  }
  async nominate(worldId:string,pixelId:string,request:{kind:string;sourcePath:string;metadata:Record<string,any>}){
    const runtime=await this.manager.open(worldId);if(!runtime.store.pixels.getPixelAccount(pixelId)?.active)throw new Error('NOMINATION_ACTOR_NOT_ACTIVE');
    if(!['knowledge','template','dataset','skill','code'].includes(request.kind)||!request.sourcePath||request.sourcePath.includes('\\'))throw new Error('INVALID_GENE_NOMINATION');
    const segments=request.sourcePath.split('/');if(!segments.length||segments.some(s=>!s||s==='.'||s==='..'))throw new Error('NOMINATION_PATH_INVALID');
    const bodyPrefix=`generations/${runtime.life.current.meta().generation_id}/body/skills/`;
    if(!(request.sourcePath.startsWith(`live/pixels/${pixelId}/`)||request.sourcePath.startsWith(`live/artifacts/${pixelId}/`)||request.sourcePath.startsWith(bodyPrefix)))throw new Error('NOMINATION_SOURCE_SCOPE_DENIED');
    const source=containedPath(runtime.directory,...segments),stat=fs.lstatSync(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)throw new Error('NOMINATION_REGULAR_BOUNDED_FILE_REQUIRED');
    const bytes=fs.readFileSync(source);if(bytes.length>262144)throw new Error('NOMINATION_SIZE_LIMIT');const id=`promotion_${randomUUID()}`,snapshot=containedPath(this.manager.registry.workspace,'system','evolution','promotions',id,'snapshot');
    fs.mkdirSync(path.dirname(snapshot),{recursive:true});fs.writeFileSync(snapshot,bytes,{flag:'wx',mode:0o600});
    const metadata={...(request.metadata??{}),generationId:runtime.life.current.meta().generation_id},sourceHash=hash(bytes);
    if(request.sourcePath.startsWith(bodyPrefix)){
      const body=JSON.parse(bytes.toString('utf8')),active=runtime.life.current.db.prepare("SELECT c.*,s.successful_runs FROM body_candidates c JOIN body_skills s ON s.active_change_id=c.id WHERE c.skill_id=? AND c.state='ACTIVE' AND s.state='ACTIVE'").get(body.skill_id);
      if(!active||String(active.candidate_hash)!==sourceHash||Number(active.successful_runs)<1)throw new Error('BODY_SUCCESS_EVIDENCE_REQUIRED');
      const validation=JSON.parse(String(active.validation));Object.assign(metadata,{bodyCandidateId:active.id,successfulRuns:active.successful_runs,creatorPixelId:validation.creatorPixelId,engine:validation.engine});
    }
    if(!metadata||Array.isArray(metadata)||typeof metadata!=='object'||Buffer.byteLength(JSON.stringify(metadata))>8000)throw new Error('NOMINATION_METADATA_INVALID');
    this.lineage.db.prepare('INSERT INTO gene_promotion_candidates VALUES(?,?,?,?,?,?,?,?,?,\'NOMINATED\',NULL,?)')
      .run(id,worldId,pixelId,request.kind,request.sourcePath,sourceHash,path.relative(this.manager.registry.workspace,snapshot).replaceAll('\\','/'),sourceHash,JSON.stringify(metadata),Date.now());
    this.lineage.lifeEvent(String(runtime.life.current.meta().generation_id),'gene_asset_nominated',{id,kind:request.kind,sourceHash},`nomination:${id}`,pixelId,worldId);
    return this.get(id);
  }
  private snapshot(candidate:Record<string,any>){
    const file=containedPath(this.manager.registry.workspace,...String(candidate.snapshot_path).split('/')),bytes=fs.readFileSync(file);
    if(hash(bytes)!==candidate.snapshot_hash)throw new Error('GENE_SNAPSHOT_CHANGED');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(/-----BEGIN.*PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{16,}|(?:api[_-]?key|private[_-]?key|seed[_ ]phrase|mnemonic)\s*["']?\s*[:=]\s*["']?[a-zA-Z0-9+/=_ -]{8,}/i.test(text))throw new Error('GENE_SECRET_SCAN_REJECTED');
    return text;
  }
  async propose(id:string,review:{shareConsent:boolean;privacy:string;license:string;point:string;reason:string;effect:string;genericity:string}){
    const candidate=this.get(id);if(candidate.state!=='NOMINATED')throw new Error('PROMOTION_ALREADY_PROPOSED');
    if(review.shareConsent!==true||!['PUBLIC','INTERNAL_NO_CUSTOMER_DATA'].includes(review.privacy)||typeof review.license!=='string'||!review.license.trim()||!review.genericity?.trim()||candidate.metadata.privacy==='CUSTOMER_PRIVATE')throw new Error('GENE_PRIVACY_AND_LICENSE_REVIEW_REQUIRED');
    const text=this.snapshot(candidate);
    if(['skill','code'].includes(String(candidate.kind))){const program=candidate.kind==='skill'?JSON.parse(text):{source:text,tests:candidate.metadata.tests};
      compilePureSkill(program.source);if(!Array.isArray(program.tests)||program.tests.length<2)throw new Error('GENE_GENERALITY_TESTS_REQUIRED');
      for(const test of program.tests)if(!isDeepStrictEqual(JSON.parse(JSON.stringify(runPureSkill(program.source,test.input))),test.expected))throw new Error('GENE_TEST_MISMATCH');}
    if(candidate.kind==='dataset')JSON.parse(text);
    const generation=String(this.lineage.activeGeneration()!.id),point=memoryPoint({point:review.point,reason:review.reason,effect:review.effect});
    const runtime=await this.manager.open(String(candidate.world_id)),sharedFile=containedPath(runtime.directory,'live','shared',candidate.id+'.json');
    fs.mkdirSync(path.dirname(sharedFile),{recursive:true});if(!fs.existsSync(sharedFile))fs.writeFileSync(sharedFile,text,{flag:'wx'});
    if(hash(fs.readFileSync(sharedFile))!==candidate.snapshot_hash)throw new Error('WORLD_SHARED_ASSET_CHANGED');
    runtime.store.db.prepare('INSERT OR IGNORE INTO world_shared_assets VALUES(?,?,?,?,?,?)').run(candidate.id,candidate.pixel_id,candidate.kind,path.relative(runtime.directory,sharedFile).replaceAll('\\','/'),candidate.snapshot_hash,Date.now());
    return this.lineage.db.transaction(()=>{
      this.lineage.lifeEvent(generation,'world_asset_shared',{id,snapshotHash:candidate.snapshot_hash,license:review.license},`sharing:${id}`,String(candidate.pixel_id),String(candidate.world_id));
      const proposal=candidate.proposal_id?this.lineage.proposal(String(candidate.proposal_id)):this.lineage.proposeGene(generation,'owner',point,`promotion:${id}`);
      if(proposal.state!=='PROPOSED')throw new Error('PROMOTION_DIRECTION_STATE_CONFLICT');
      this.lineage.db.prepare("UPDATE gene_promotion_candidates SET state='GENE_CANDIDATE',proposal_id=?,metadata=? WHERE id=?")
        .run(proposal.id,JSON.stringify({...candidate.metadata,review}),id);return proposal;
    });
  }
  async buildPatch(id:string,assetId:string,nextGeneration:number,generalize?:(input:unknown)=>Promise<unknown>){
    lifeId(assetId);const candidate=this.get(id),proposal=this.lineage.proposal(String(candidate.proposal_id));
    if(candidate.state!=='GENE_CANDIDATE'||proposal.state!=='APPROVED')throw new Error('OWNER_GENE_DIRECTION_REQUIRED');
    const text=this.snapshot(candidate),catalog=readGeneCatalog(this.release),old=catalog.assets.find(a=>a.id===assetId);
    if(old&&old.kind!==candidate.kind)throw new Error('GENE_ASSET_KIND_CONFLICT');
    const version=(old?.version??0)+1;let content=['skill','code'].includes(String(candidate.kind))
      ?(candidate.kind==='skill'?JSON.parse(text):{source:text,tests:candidate.metadata.tests})
      :{format:candidate.kind,content:candidate.kind==='dataset'?JSON.parse(text):text};
    const world=this.manager.registry.control.world(String(candidate.world_id));
    if(['skill','code'].includes(String(candidate.kind))){
      const program=content as any;
      if(program.source.includes(world.world_id)||program.source.includes(world.qianji_id)){
        if(!generalize)throw new Error('GENE_GENERALIZER_REQUIRED');
        const value=bodyCandidate(await generalize({genome:JSON.parse(fs.readFileSync(path.join(this.release,'genome/manifest.json'),'utf8')),need:'去个体化：使用输入参数替换 World/人物/客户常量；保留通用能力，禁止加入身份、凭据或其他权限。',snapshot:program,review:candidate.metadata.review}),String(this.manager.registry.interfaceVersion));
        content=value;
      }
      const generic=content as any;compilePureSkill(generic.source);if(generic.tests.length<2)throw new Error('GENE_GENERALITY_TESTS_REQUIRED');
      for(const test of generic.tests)if(!isDeepStrictEqual(JSON.parse(JSON.stringify(runPureSkill(generic.source,test.input))),test.expected))throw new Error('GENE_TEST_MISMATCH');
      content={source:generic.source,tests:generic.tests,interface_version:this.manager.registry.interfaceVersion,purpose:candidate.metadata.review.point,permissions:[],engine:'pure-ast-json@1'};
    }
    const encoded=JSON.stringify(content);
    if(encoded.includes(world.world_id)||encoded.includes(world.qianji_id))throw new Error('GENE_NOT_GENERIC');
    const relative=`assets/${assetId}/${version}.json`,asset:GeneAsset={id:assetId,version,kind:String(candidate.kind),file:relative,contentHash:hash(encoded),license:candidate.metadata.review.license};
    const manifest=JSON.parse(fs.readFileSync(path.join(this.release,'genome/manifest.json'),'utf8'));manifest.generation=nextGeneration;
    this.lineage.db.prepare('UPDATE gene_promotion_candidates SET metadata=? WHERE id=?').run(JSON.stringify({...candidate.metadata,pendingAsset:asset}),id);
    return {proposalId:proposal.id,asset,candidateId:id,patch:[{path:`genome/${relative}`,content:encoded},
      {path:'genome/assets/index.json',content:JSON.stringify({schema:1,assets:[...catalog.assets.filter(a=>a.id!==assetId),asset]})},
      {path:'genome/manifest.json',content:JSON.stringify(manifest,null,2)}]};
  }
  recordInherited(candidateId:string,asset:GeneAsset,generationId:string){
    const candidate=this.get(candidateId);const generation=this.lineage.generation(generationId);if(generation.state!=='ACTIVE')throw new Error('GENE_GENERATION_NOT_ACTIVE');
    const proposal=this.lineage.proposal(String(candidate.proposal_id));
    if(proposal.state!=='BORN'||proposal.target_generation_id!==generationId)throw new Error('GENE_BIRTH_EVIDENCE_REQUIRED');
    const loaded=loadGeneAsset(this.release,asset.id);if(JSON.stringify(loaded.asset)!==JSON.stringify(asset))throw new Error('GENE_ASSET_PROVENANCE_CONFLICT');
    if(candidate.state==='GENE')return;
    this.lineage.db.transaction(()=>{
      this.lineage.db.prepare(`INSERT INTO gene_assets VALUES(?,?,?,'GENE') ON CONFLICT(id) DO UPDATE SET current_version=excluded.current_version`).run(asset.id,asset.kind,asset.version);
      this.lineage.db.prepare('INSERT INTO gene_asset_sources VALUES(?,?,?,?,?,?,?)').run(asset.id,asset.version,candidate.world_id,candidate.metadata.creatorPixelId??candidate.pixel_id,candidate.id,candidate.source_hash,candidate.snapshot_hash);
      this.lineage.db.prepare('INSERT INTO gene_asset_versions VALUES(?,?,?,?,?,?)').run(asset.id,asset.version,generationId,asset.contentHash,asset.file,asset.license);
      this.lineage.db.prepare("UPDATE gene_promotion_candidates SET state='GENE' WHERE id=?").run(candidateId);
      this.lineage.lifeEvent(generationId,'gene_asset_inherited',{assetId:asset.id,version:asset.version,origin:'gene'},`gene-asset:${asset.id}:${asset.version}`);
    });
  }
  reconcileInherited(){for(const row of this.list()){
    if(row.state!=='GENE_CANDIDATE'||!row.proposal_id)continue;const proposal=this.lineage.proposal(String(row.proposal_id)),candidate=this.get(String(row.id));
    if(proposal.state==='BORN'&&proposal.target_generation_id===this.lineage.activeGeneration()?.id&&candidate.metadata.pendingAsset)
      this.recordInherited(String(row.id),candidate.metadata.pendingAsset,String(proposal.target_generation_id));
  }}
}
