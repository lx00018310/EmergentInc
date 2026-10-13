import * as fs from 'node:fs';
import * as path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {compilePureSkill,runPureSkill} from '../../../../packages/tools/dist/business/pure_skill.js';
import {containedPath} from './safe_path.js';

export interface ExtensionManifest {schema:1;id:string;version:string;engine:string;requiredContracts:string[];dataSchemaVersion:number;source:string;tests:{input:unknown;expected:unknown}[]}
interface Pointer {revision:number;hash:string|null;previousHash:string|null;enabled:boolean;lastRequest?:{key:string;hash:string}}
const digest=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const error=(code:string):never=>{throw Object.assign(new Error(code),{statusCode:code==='EXTENSION_REVISION_CONFLICT'?409:400});};
const id=(value:unknown)=>{if(typeof value!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(value)||/^(con|prn|aux|nul|com\d|lpt\d)$/.test(value))error('EXTENSION_ID_INVALID');return value as string;};
const checkedHash=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))error('EXTENSION_HASH_INVALID');return value as string;};

/** File-backed pure programs; no host imports, data access, generation changes or execution engine of its own. */
export class InstanceExtensionService {
  constructor(readonly directory:string,readonly worldId:string,readonly contracts:Record<string,unknown>){}
  private file(extensionId:string,...parts:string[]){return containedPath(this.directory,'extensions',id(extensionId),...parts);}
  private read(file:string){if(!fs.existsSync(file))error('EXTENSION_FILE_INVALID');const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>262144)error('EXTENSION_FILE_INVALID');return fs.readFileSync(file,'utf8');}
  private pointer(extensionId:string):Pointer {
    const file=this.file(extensionId,'active.json');if(!fs.existsSync(file))return {revision:0,hash:null,previousHash:null,enabled:false};
    const p=JSON.parse(this.read(file));if(!Number.isSafeInteger(p.revision)||p.revision<1||typeof p.enabled!=='boolean'||p.hash!==null&&!/^[a-f0-9]{64}$/.test(p.hash)||p.previousHash!==null&&!/^[a-f0-9]{64}$/.test(p.previousHash))error('EXTENSION_POINTER_INVALID');return p;
  }
  private manifest(value:any):ExtensionManifest {
    if(!value||Array.isArray(value)||Object.keys(value).some(k=>!['schema','id','version','engine','requiredContracts','dataSchemaVersion','source','tests'].includes(k))||value.schema!==1)error('EXTENSION_MANIFEST_INVALID');
    id(value.id);
    if(typeof value.version!=='string'||! /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/.test(value.version)||value.version.length>80||typeof value.engine!=='string'||value.engine.length>80||!Array.isArray(value.requiredContracts)||value.requiredContracts.length>16||!value.requiredContracts.every((c:unknown)=>typeof c==='string'&&/^[a-z_]+@\d+$/.test(c))||new Set(value.requiredContracts).size!==value.requiredContracts.length||!Number.isSafeInteger(value.dataSchemaVersion)||value.dataSchemaVersion<1||typeof value.source!=='string'||Buffer.byteLength(value.source)>65536||!Array.isArray(value.tests)||value.tests.length<2||value.tests.length>16||Buffer.byteLength(JSON.stringify(value))>240000)error('EXTENSION_MANIFEST_INVALID');
    for(const t of value.tests)if(!t||Object.keys(t).sort().join(',')!=='expected,input')error('EXTENSION_MANIFEST_INVALID');
    return {schema:1,id:value.id,version:value.version,engine:value.engine,requiredContracts:[...value.requiredContracts].sort(),dataSchemaVersion:value.dataSchemaVersion,source:value.source,tests:value.tests};
  }
  private reason(m:ExtensionManifest):string|null {
    if(m.engine!=='pure-ast-json@1')return 'EXTENSION_ENGINE_UNSUPPORTED';
    const contract=this.contracts['pure_skill@1'] as any;
    if((this.contracts['extension@1'] as any)?.engine!==m.engine||!m.requiredContracts.includes('pure_skill@1')||m.requiredContracts.some(c=>!this.contracts[c])||!contract||contract.engine!==m.engine||['network','host_files','credentials','child_process','package_install'].some(k=>contract[k]!==false)||contract.input!=='JSON'||contract.output!=='JSON'||contract.max_source_bytes!==65536||contract.max_json_bytes!==65536||contract.max_steps!==20000)return 'EXTENSION_CONTRACT_UNSUPPORTED';
    return null;
  }
  private validate(m:ExtensionManifest){compilePureSkill(m.source);for(const t of m.tests)if(!isDeepStrictEqual(JSON.parse(JSON.stringify(runPureSkill(m.source,t.input))),t.expected))error('EXTENSION_TEST_MISMATCH');}
  version(extensionId:string,hash:string){
    const json=this.read(this.file(extensionId,'versions',checkedHash(hash)+'.json'));if(digest(json)!==hash)error('EXTENSION_HASH_MISMATCH');
    const value=JSON.parse(json),manifest=this.manifest(value.manifest);if(value.worldId!==this.worldId||manifest.id!==extensionId||typeof value.creatorPixelId!=='string'||! /^-?\d+_-?\d+_-?\d+$/.test(value.creatorPixelId))error('EXTENSION_WORLD_CONFLICT');return {...value,manifest};
  }
  submit(pixelId:string,value:unknown){
    if(! /^-?\d+_-?\d+_-?\d+$/.test(pixelId))error('EXTENSION_ACTOR_INVALID');const manifest=this.manifest(value),reason=this.reason(manifest);
    // Unsupported host programs are archived as data; pure programs must pass the existing interpreter and tests.
    if(manifest.engine==='pure-ast-json@1')this.validate(manifest);
    const json=JSON.stringify({manifest,worldId:this.worldId,creatorPixelId:pixelId}),hash=digest(json),file=this.file(manifest.id,'versions',hash+'.json');fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file)){if(this.read(file)!==json)error('EXTENSION_HASH_MISMATCH');}else fs.writeFileSync(file,json,{flag:'wx',mode:0o600});
    return {id:manifest.id,hash,version:manifest.version,reason,supported:reason===null};
  }
  describe(extensionId:string){
    const p=this.pointer(extensionId),versionsDir=this.file(extensionId,'versions'),versions=fs.existsSync(versionsDir)?fs.readdirSync(versionsDir).filter(n=>/^[a-f0-9]{64}\.json$/.test(n)).map(n=>{const hash=n.slice(0,-5),v=this.version(extensionId,hash);return {hash,version:v.manifest.version,creatorPixelId:v.creatorPixelId,engine:v.manifest.engine,requiredContracts:v.manifest.requiredContracts,dataSchemaVersion:v.manifest.dataSchemaVersion,reason:this.reason(v.manifest)};}):[];
    const current=p.hash?versions.find(v=>v.hash===p.hash):undefined;if(p.hash&&!current)error('EXTENSION_FILE_INVALID');
    const reason=current?.reason??null;return {id:extensionId,worldId:this.worldId,...p,requestedEnabled:p.enabled,enabled:p.enabled&&!reason,reason,versions};
  }
  list(){const root=containedPath(this.directory,'extensions');if(!fs.existsSync(root))return [];return fs.readdirSync(root).sort().map(name=>{try{return this.describe(id(name));}catch(e){return {id:name,worldId:this.worldId,revision:0,hash:null,previousHash:null,requestedEnabled:false,enabled:false,reason:e instanceof Error?e.message:'EXTENSION_FILE_INVALID',versions:[]};}});}
  action(extensionId:string,input:any){
    if(!input||Object.keys(input).some(k=>!['action','hash','expectedRevision','expectedHash','idempotencyKey'].includes(k))||!['activate','disable','rollback'].includes(input.action)||!Number.isSafeInteger(input.expectedRevision)||typeof input.idempotencyKey!=='string'||! /^[\w:-]{8,180}$/.test(input.idempotencyKey))error('EXTENSION_INPUT_INVALID');
    const p=this.pointer(extensionId),requestHash=digest(JSON.stringify(input));if(p.lastRequest&&p.lastRequest.key===input.idempotencyKey){if(p.lastRequest.hash!==requestHash)error('EXTENSION_REVISION_CONFLICT');return this.describe(extensionId);}
    if(input.expectedRevision!==p.revision||input.expectedHash!==p.hash)error('EXTENSION_REVISION_CONFLICT');
    let hash=p.hash,previousHash=p.previousHash,enabled=false;
    if(input.action!=='disable'){
      hash=input.action==='rollback'?p.previousHash:checkedHash(input.hash);if(!hash)error('EXTENSION_PREVIOUS_VERSION_MISSING');
      const version=this.version(extensionId,hash!);const reason=this.reason(version.manifest);if(reason)error(reason);this.validate(version.manifest);enabled=true;if(hash!==p.hash)previousHash=p.hash;
    }
    const next:Pointer={revision:p.revision+1,hash,previousHash,enabled,lastRequest:{key:input.idempotencyKey,hash:requestHash}},file=this.file(extensionId,'active.json'),temporary=this.file(extensionId,`active-${randomUUID()}.tmp`);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(temporary,JSON.stringify(next),{flag:'wx',mode:0o600});try{fs.renameSync(temporary,file);}catch(e){fs.unlinkSync(temporary);throw e;}return this.describe(extensionId);
  }
  run(extensionId:string,input:unknown){const p=this.pointer(extensionId);if(!p.enabled||!p.hash)error('EXTENSION_DISABLED');const v=this.version(extensionId,p.hash!),reason=this.reason(v.manifest);if(reason)error(reason);this.validate(v.manifest);return {origin:'extension',worldId:this.worldId,id:extensionId,hash:p.hash,version:v.manifest.version,result:runPureSkill(v.manifest.source,input)};}
}
