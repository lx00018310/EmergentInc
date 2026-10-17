import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {checkOwnerAutomationRollback} from './owner_automation_compatibility.js';
import {checkPaymentRollback} from './payment_compatibility.js';
import {isDeepStrictEqual} from 'node:util';

const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const installedRoot=()=>path.resolve(import.meta.dirname,path.basename(import.meta.dirname)==='dist'?'../..':'..');
async function trustedServices(){const root=installedRoot();return {
  extensions:await import(pathToFileURL(path.join(root,'apps/server/dist/services/instance_extension_service.js')).href),
  tools:await import(pathToFileURL(path.join(root,'packages/tools/dist/business/pure_skill.js')).href),
  gene:await import(pathToFileURL(path.join(root,'apps/server/dist/services/gene_catalog.js')).href),
  skills:await import(pathToFileURL(path.join(root,'apps/server/dist/services/skill_library.js')).href),
};}
/** Runs only installed trusted code over data. Never imports a candidate module into the Supervisor. */
export async function instanceCompatibility(system:string,generation:string,candidate:string,worlds:{id:string;directory:string}[]){
  const manifest=JSON.parse(fs.readFileSync(path.join(candidate,'genome/manifest.json'),'utf8')),contracts=manifest.capability_contracts;
  checkOwnerAutomationRollback(path.join(system,'control/control.sqlite3'),candidate);
  checkPaymentRollback(path.join(system,'payment/payment.sqlite3'),candidate);
  if(!contracts['world_runtime@1'])throw new Error('INSTANCE_WORLD_CONTRACT_UNSUPPORTED');
  const {extensions,tools,gene,skills}=await trustedServices(),knownPure=JSON.parse(fs.readFileSync(path.join(installedRoot(),'genome/manifest.json'),'utf8')).capability_contracts['pure_skill@1'];
  const pureCompatible=isDeepStrictEqual(knownPure,contracts['pure_skill@1']);
  const result:{schema:number;geneAssets:number;bodySkills:number;bodyHashes:string[];markdownSkills:number;markdownDiagnostics:any[];extensions:any[];v29:any;corePatches:string[]}={schema:1,geneAssets:0,bodySkills:0,bodyHashes:[],markdownSkills:0,markdownDiagnostics:[],extensions:[],v29:null,corePatches:[]};
  for(const asset of gene.readGeneCatalog(candidate).assets){const {content}=gene.loadGeneAsset(candidate,asset.id);
    if(['skill','code'].includes(asset.kind)){
      if(!pureCompatible||content.engine!=='pure-ast-json@1'||content.interface_version!==manifest.body_interface_version)throw new Error('INSTANCE_GENE_CONTRACT_UNSUPPORTED');
      tools.compilePureSkill(content.source);for(const t of content.tests)if(!isDeepStrictEqual(JSON.parse(JSON.stringify(tools.runPureSkill(content.source,t.input))),t.expected))throw new Error('INSTANCE_GENE_TEST_MISMATCH');
    }result.geneAssets++;
  }
  for(const world of [{id:'system',directory:system},...worlds]){
    const current=path.join(world.directory,'generations',generation,'current.sqlite3');
    if(fs.existsSync(current)){const db=new DatabaseSync(current,{readOnly:true});try{
      for(const row of db.prepare("SELECT c.* FROM body_candidates c JOIN body_skills s ON s.active_change_id=c.id WHERE s.state='ACTIVE'").all()){
        const candidateJson=String(row.candidate_json),program=JSON.parse(candidateJson),file=path.join(world.directory,'generations',generation,'body/skills',String(row.skill_id),String(row.id)+'.json');
        const relative=path.relative(path.join(world.directory,'generations',generation,'body/skills'),file);
        if(relative.startsWith('..')||path.isAbsolute(relative)||! /^[a-zA-Z0-9_-]+$/.test(String(row.skill_id))||! /^[a-zA-Z0-9_-]+$/.test(String(row.id)))throw new Error('INSTANCE_BODY_PATH_INVALID');
        let cursor=world.directory;for(const part of ['generations',generation,'body','skills',String(row.skill_id),String(row.id)+'.json']){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw new Error('INSTANCE_BODY_HASH_MISMATCH');}
        if(!fs.statSync(file).isFile()||fs.readFileSync(file,'utf8')!==candidateJson||hash(candidateJson)!==row.candidate_hash)throw new Error('INSTANCE_BODY_HASH_MISMATCH');
        if(manifest.body_interface_version!==program.interface_version||!pureCompatible)throw new Error('INSTANCE_BODY_CONTRACT_UNSUPPORTED');
        tools.compilePureSkill(program.source);for(const t of program.tests)if(!isDeepStrictEqual(JSON.parse(JSON.stringify(tools.runPureSkill(program.source,t.input))),t.expected))throw new Error('INSTANCE_BODY_TEST_MISMATCH');result.bodySkills++;result.bodyHashes.push(hash(candidateJson));
      }
    }finally{db.close();}}
    if(world.id==='system')continue;
    const artifacts=path.join(world.directory,'live/artifacts');if(fs.existsSync(artifacts)&&!fs.lstatSync(artifacts).isSymbolicLink())for(const pixelId of fs.readdirSync(artifacts).filter(id=>/^-?\d+_-?\d+_-?\d+$/.test(id))){
      const ctx={workspaceRoot:world.directory,pixelId},listing=skills.listSkills(ctx,candidate);
      result.markdownDiagnostics.push(...listing.diagnostics.map((d:any)=>({worldId:world.id,...d})));for(const entry of listing.skills.filter((s:any)=>s.origin==='body')){skills.readSkill(ctx,candidate,entry.ref);result.markdownSkills++;}
    }
    const service=new extensions.InstanceExtensionService(world.directory,world.id,contracts),directory=path.join(world.directory,'extensions');
    if(fs.existsSync(directory))for(const name of fs.readdirSync(directory)){
      try{const view=service.describe(name);if(view.hash&&view.requestedEnabled&&view.enabled){const v=service.version(name,view.hash);for(const test of v.manifest.tests)service.run(name,test.input);}result.extensions.push({worldId:world.id,id:name,hash:view.hash,enabled:view.enabled,requestedEnabled:view.requestedEnabled,reason:view.reason});}
      catch(error){const e=error as NodeJS.ErrnoException,message=e.message??'';
        const reason=/^EXTENSION_[A-Z_]+$/.test(message)?message:message.startsWith('PURE_')?'EXTENSION_VALIDATION_FAILED':error instanceof SyntaxError||['ENOENT','ENOTDIR','EACCES','EPERM'].includes(e.code??'')||message.includes('Symbolic links')||message==='Invalid path segment'?'EXTENSION_FILE_INVALID':null;
        if(!reason)throw error;result.extensions.push({worldId:world.id,id:name,enabled:false,reason});}
    }
    const reports=path.join(world.directory,'code-candidates');if(fs.existsSync(reports)&&fs.readdirSync(reports).length)result.corePatches.push(world.id);
  }
  const control=path.join(system,'control/control.sqlite3');if(fs.existsSync(control)){const db=new DatabaseSync(control,{readOnly:true});try{
    const has=(table:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table));
    if(has('owner_goals')){const goals=db.prepare('SELECT id,status,max_tokens,revision,specification_revision FROM owner_goals ORDER BY id').all();result.v29={goalCount:goals.length,goalStateHash:hash(JSON.stringify(goals)),control:has('owner_automation_control')?db.prepare('SELECT desired_mode,run_mode,requested_rounds,max_tokens,revision,batch_id FROM owner_automation_control').get():null};}
  }finally{db.close();}}
  result.bodyHashes.sort();return result;
}

/** Synthetic smoke workspace: no production customer rows, private files, responses or credentials. */
export async function prepareCompatibilityFixture(destination:string,target:any,manifest:any,worldIds:string[]){
  const root=installedRoot(),{LineageStore,CurrentStore,WorldRegistryStore,writeGenerationPointer}=await import(pathToFileURL(path.join(root,'packages/persistence/dist/index.js')).href);
  const {WorldRegistryService}=await import(pathToFileURL(path.join(root,'apps/server/dist/services/world_registry_service.js')).href);
  const {OwnerAutomationGate}=await import(pathToFileURL(path.join(root,'apps/server/dist/services/owner_automation_gate.js')).href);
  const system=path.join(destination,'system'),lineage=new LineageStore(path.join(system,'lineage/lineage.sqlite3'),{v23:true});
  const g=lineage.createGeneration({id:target.id,number:target.generation_no,geneHash:target.gene_hash,releaseId:target.release_id,state:'ACTIVE'});writeGenerationPointer(system,target.id);
  const current=new CurrentStore(path.join(system,'generations',target.id,'current.sqlite3'));current.initialize(g,manifest.body_interface_version);current.close();fs.mkdirSync(path.join(system,'generations',target.id,'body/skills'),{recursive:true});
  const control=new WorldRegistryStore(path.join(system,'control/control.sqlite3'));
  try{const registry=new WorldRegistryService(destination,control,lineage,manifest.body_interface_version),gate=new OwnerAutomationGate(control);
    gate.goals.create({title:'Synthetic compatibility goal',objective:'A public compatibility fixture only',acceptance:{kind:'artifact',filename:'fixture.md',minBytes:1},maxTokens:100000,idempotencyKey:'synthetic-fixture-goal'});
    for(const worldId of worldIds)registry.create({displayName:'Synthetic compatibility person',traits:{},behaviorProfile:[]},{worldId});
  }finally{control.close();lineage.close();}
  fs.writeFileSync(path.join(destination,'workspace-layout.json'),JSON.stringify({schema:1,version:34,candidate:true,synthetic:true}),{flag:'wx'});
  for(const name of ['worlds','runtime','private','assets'])fs.mkdirSync(path.join(destination,name),{recursive:true});
  fs.writeFileSync(path.join(destination,'workspace-format.json'),JSON.stringify({product:'BOSS-AFK',format:34,instanceId:randomUUID(),initializedAt:new Date().toISOString()}),{flag:'wx'});
}
