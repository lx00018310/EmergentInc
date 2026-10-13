import {afterEach,it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {InstanceExtensionService} from '../src/services/instance_extension_service.js';
import {goalFixture} from './fixtures/owner_goals.js';
import {registerWorldTools} from '../src/services/world_tools.js';
import {ToolRegistry} from '@emergentinc/tools';
import {createServer} from '../src/app.js';
import {appCodePath} from '../src/services/app_code_policy.js';
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))fs.rmSync(r,{recursive:true,force:true});});
const contracts=JSON.parse(fs.readFileSync(join(process.cwd(),'genome/manifest.json'),'utf8')).capability_contracts;
const manifest={schema:1,id:'customer-analysis',version:'1.0.0',engine:'pure-ast-json@1',requiredContracts:['pure_skill@1'],dataSchemaVersion:1,source:'export default input=>({count:input.rows.length})',tests:[{input:{rows:[]},expected:{count:0}},{input:{rows:[1]},expected:{count:1}}]};
function fixture(){const root=fs.mkdtempSync(join(tmpdir(),'v30-ext-'));roots.push(root);const a=new InstanceExtensionService(join(root,'A'),'world_A',contracts),b=new InstanceExtensionService(join(root,'B'),'world_B',contracts);fs.mkdirSync(a.directory,{recursive:true});fs.mkdirSync(b.directory,{recursive:true});return {root,a,b};}
const activate=(s:InstanceExtensionService,m:any=manifest,p=s.describe(m.id))=>{const v=s.submit('0_0_0',m);return s.action(m.id,{action:'activate',hash:v.hash,expectedRevision:p.revision,expectedHash:p.hash,idempotencyKey:crypto.randomUUID()});};
it('persists immutable versions, deduplicates submission and exact retries, rejects stale activation, rolls back and disables without touching data',()=>{
 const {a,b}=fixture(),saved=a.submit('0_0_0',manifest);expect(a.submit('0_0_0',manifest)).toEqual(saved);expect(b.list()).toEqual([]);expect(()=>b.run(manifest.id,{rows:[]})).toThrow('EXTENSION_DISABLED');
 const request={action:'activate',hash:saved.hash,expectedRevision:0,expectedHash:null,idempotencyKey:crypto.randomUUID()},p=a.action(manifest.id,request);expect(a.action(manifest.id,request)).toEqual(p);expect(a.run(manifest.id,{rows:[1,2]})).toMatchObject({worldId:'world_A',result:{count:2}});
 const next={...manifest,version:'1.1.0',source:'export default input=>({count:input.rows.length+1})',tests:manifest.tests.map(t=>({...t,expected:{count:t.expected.count+1}}))};const v=a.submit('0_0_0',next);expect(()=>a.action(manifest.id,{...request,hash:v.hash,idempotencyKey:crypto.randomUUID()})).toThrow('EXTENSION_REVISION_CONFLICT');
 const p2=a.action(manifest.id,{action:'activate',hash:v.hash,expectedRevision:p.revision,expectedHash:p.hash,idempotencyKey:crypto.randomUUID()});expect(p2.previousHash).toBe(saved.hash);
 const data=join(a.directory,'extension-data/customer-analysis/customers.json');fs.mkdirSync(join(data,'..'),{recursive:true});fs.writeFileSync(data,'{"kept":true}');
 const restored=a.action(manifest.id,{action:'rollback',expectedRevision:p2.revision,expectedHash:p2.hash,idempotencyKey:crypto.randomUUID()});expect(restored.hash).toBe(saved.hash);a.action(manifest.id,{action:'disable',expectedRevision:restored.revision,expectedHash:restored.hash,idempotencyKey:crypto.randomUUID()});expect(()=>a.run(manifest.id,{})).toThrow('EXTENSION_DISABLED');expect(fs.readFileSync(data,'utf8')).toBe('{"kept":true}');expect(a.describe(manifest.id).versions).toHaveLength(2);
});
it('preserves enabled intent but blocks execution when Core contracts change; manual disable survives a compatible Core',()=>{
 const {a}=fixture(),p=activate(a),old=new InstanceExtensionService(a.directory,a.worldId,{});expect(old.describe(manifest.id)).toMatchObject({requestedEnabled:true,enabled:false,reason:'EXTENSION_CONTRACT_UNSUPPORTED'});expect(()=>old.run(manifest.id,{rows:[]})).toThrow('EXTENSION_CONTRACT_UNSUPPORTED');
 old.action(manifest.id,{action:'disable',expectedRevision:p.revision,expectedHash:p.hash,idempotencyKey:crypto.randomUUID()});expect(a.describe(manifest.id).enabled).toBe(false);
});
it('refuses pure-host escapes and failed tests without replacing ACTIVE; unsupported host applications are archived, never imported',()=>{
 const {a}=fixture(),p=activate(a);for(const source of ['export default i=>fetch(i.url)','export default i=>process.env','import fs from "node:fs"; export default i=>fs.readFileSync(i.file)','export default i=>i.constructor.constructor("return process")()'])expect(()=>a.submit('0_0_0',{...manifest,source})).toThrow();
 expect(()=>a.submit('0_0_0',{...manifest,tests:[{input:{rows:[]},expected:{count:9}},manifest.tests[1]]})).toThrow('EXTENSION_TEST_MISMATCH');expect(a.describe(manifest.id).hash).toBe(p.hash);
 const archived=a.submit('0_0_0',{...manifest,engine:'node@1',source:'process.exit(1)'});expect(archived.reason).toBe('EXTENSION_ENGINE_UNSUPPORTED');expect(()=>a.action(manifest.id,{action:'activate',hash:archived.hash,expectedRevision:p.revision,expectedHash:p.hash,idempotencyKey:crypto.randomUUID()})).toThrow('EXTENSION_ENGINE_UNSUPPORTED');expect(a.describe(manifest.id).hash).toBe(p.hash);
 for(const id of ['../other','A','con','a/b','apps/server/src/app.ts','a:stream'])expect(()=>a.submit('0_0_0',{...manifest,id})).toThrow('EXTENSION_ID_INVALID');
 expect(()=>appCodePath('apps/server/src/services/instance_extension_service.ts')).toThrow('APP_CODE_PATH_DENIED');
});
it('rejects hash tampering and symlinks in independent versions and pointer paths',()=>{
 const {root,a}=fixture(),p=activate(a),file=join(a.directory,'extensions',manifest.id,'versions',p.hash!+'.json'),bytes=fs.readFileSync(file);fs.writeFileSync(file,'{}');expect(()=>a.run(manifest.id,{})).toThrow('EXTENSION_HASH_MISMATCH');fs.writeFileSync(file,bytes);
 const target=join(root,'outside');fs.mkdirSync(target);fs.symlinkSync(target,join(a.directory,'extensions','linked'),process.platform==='win32'?'junction':'dir');expect(()=>a.submit('0_0_0',{...manifest,id:'linked'})).toThrow('Symbolic links');
});
it('scopes agent tools to the trusted World and protects HTTP with Owner auth and global OFF while keeping inspection available',async()=>{
 const f=goalFixture();Object.assign(f.manager.genome.capability_contracts,contracts);const a=await f.manager.open(f.a.world_id),b=await f.manager.open(f.b.world_id);const toolsA=new ToolRegistry(),toolsB=new ToolRegistry();registerWorldTools(toolsA,f.a.world_id,f.worlds.promotion,f.payments);registerWorldTools(toolsB,f.b.world_id,f.worlds.promotion,f.payments);
 const ctx={workspaceRoot:a.directory,pixelId:'0_0_0',operationId:'test-extension-submit',runId:'manual'} as any;
 const submitted=await toolsA.get('SUBMIT_EXTENSION')!.handler({manifest,expectedRevision:0,expectedHash:null},ctx);expect(submitted.output).toMatchObject({enabled:true});expect((await toolsB.get('LIST_EXTENSIONS')!.handler({}, {...ctx,workspaceRoot:b.directory})).output).toEqual([]);
 await expect(toolsB.get('RUN_EXTENSION')!.handler({id:manifest.id,input:{rows:[]}},ctx)).rejects.toThrow('WORLD_TOOL_CONTEXT_CONFLICT');
 const app=await createServer({workspaceRoot:f.root,worlds:f.worlds,ownerAuth:{secret:'x'.repeat(40),secureCookies:false}});try{expect((await app.inject(`/api/worlds/${f.a.world_id}/extensions`)).statusCode).toBe(401);const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:'x'.repeat(40)}}),headers={cookie:String(login.headers['set-cookie']).split(';')[0]};expect((await app.inject({url:`/api/worlds/${f.a.world_id}/extensions`,headers})).json().items).toHaveLength(1);expect((await app.inject({method:'POST',url:`/api/worlds/${f.a.world_id}/extensions/${manifest.id}/run`,headers,payload:{input:{rows:[]}}})).statusCode).toBe(409);expect(f.lineage.activeGeneration()!.id).toBe('G0001');}finally{await app.close();await f.close();}
});
