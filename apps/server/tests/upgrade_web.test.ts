import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pixelReleaseToken } from '../src/services/release_maintenance_client.js';

// The web maintenance process uses the same compiled Owner authentication as the launcher.
// @ts-ignore Standalone maintenance script.
import { createUpgradeWeb, readUpgradeStatus } from '../../../scripts/upgrade-web.mjs';
// @ts-ignore Standalone maintenance script.
import { ownerReleaseInput } from '../../../scripts/version-upgrade.mjs';
const {JSDOM}=createRequire(path.resolve('frontend/package.json'))('jsdom');

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'upgrade-web-'));
  const secret = 'test-upgrade-owner-secret'.repeat(3);
  const run = vi.fn(async (_root: string, _args: string[], output: (text: string) => void) => { output('checked'); });
  const checkRunning = vi.fn(async (_generation: string) => {});
  const data:any = { active: { id: 'G0008' }, versions:[{id:'G0007',generation_no:7,release_id:'old',label:'Previous version',available:true,canRollback:true}],afterRollback:false,dirty: false, appUrl: 'http://127.0.0.1:8765', candidates: [{ id: 'local-v24-test', state: 'VALIDATED',identity:'a'.repeat(64),canDelete:false,
    candidate: { candidate_hash: 'a'.repeat(64), base_generation: 'G0008' }, request: { base_generation:'G0008', owner_release: { reason: 'Fix run state' } } }] };
  const app = await createUpgradeWeb({ root: path.resolve('.'), config: { stateDirectory: directory }, secret, runCommand: run, status: () => data, checkRunning });
  cleanups.push(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { secret } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const request = (payload: unknown) => app.inject({ method: 'POST', url: '/api/upgrades', headers: { cookie }, payload });
  return { app, data, directory, run, request, cookie, checkRunning,secret };
}

async function page(f:Awaited<ReturnType<typeof fixture>>,lang='zh-CN',query='',responses:Record<string,any>={}) {
  const dom=new JSDOM((await f.app.inject('/')).body,{url:'http://127.0.0.1:8766/'+query,runScripts:'outside-only'});
  cleanups.push(async()=>dom.window.close());let poll!:()=>Promise<void>,browserCookie=f.cookie;
  dom.window.localStorage.setItem('emergentinc.language',lang);
  dom.window.setInterval=(callback:()=>Promise<void>)=>{poll=callback;return 0;};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.fetch=vi.fn(async(url:string,init:any={})=>{if(url in responses)return {ok:true,status:200,json:async()=>responses[url]};const response=await f.app.inject({method:init.method??'GET',url,headers:{cookie:browserCookie},...(init.body?{payload:JSON.parse(init.body)}:{})});if(response.headers['set-cookie'])browserCookie=String(response.headers['set-cookie']).split(';')[0];return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};});
  await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent}})()`);
  return {dom,doc:dom.window.document,poll:()=>poll()};
}

describe('Owner web upgrade', () => {
  it('rolls back to the selected history without publication approval and denies stale targets',async()=>{
    const f=await fixture();expect((await f.request({action:'rollback',targetGeneration:'G0007',expectedActive:'G0006',reason:'Undo regression'})).statusCode).toBe(409);
    expect((await f.request({action:'rollback',targetGeneration:'G0007',expectedActive:'G0008',reason:'Undo regression'})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());expect(f.run.mock.calls[0][1]).toEqual(['rollback-to','G0007','G0008','Undo regression']);expect(f.checkRunning).toHaveBeenCalledWith('G0008');
  });
  it('allows only listed newer code deletions after rollback and binds their identity',async()=>{
    const f=await fixture(),body={action:'delete',releaseId:'local-v24-test',expectedActive:'G0008',identity:'a'.repeat(64),reason:'Remove later code'};
    expect((await f.request(body)).statusCode).toBe(409);f.data.candidates[0].canDelete=true;
    expect((await f.request({...body,identity:'b'.repeat(64)})).statusCode).toBe(409);expect((await f.request(body)).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());expect(f.run.mock.calls[0][1]).toEqual(['delete-release','local-v24-test','G0008','a'.repeat(64),'Remove later code']);expect(f.checkRunning).not.toHaveBeenCalled();
  });
  it('delegates only rollback and deletion to Pixel credentials, preserves request identity and hides private status',async()=>{
    const f=await fixture(),authorization=`Bearer ${pixelReleaseToken(f.secret)}`,headers={authorization};
    expect((await f.app.inject('/pixel/releases')).statusCode).toBe(401);expect((await f.app.inject({url:'/pixel/releases',headers:{authorization:'Bearer '+'b'.repeat(64)}})).statusCode).toBe(401);
    const listing=await f.app.inject({url:'/pixel/releases',headers});expect(listing.statusCode).toBe(200);expect(listing.body).not.toMatch(/secret|validationLog|directory|owner_release|request_hash/);
    expect((await f.app.inject({method:'POST',url:'/api/upgrades',headers,payload:{action:'publish'}})).statusCode).toBe(401);
    expect((await f.app.inject({method:'POST',url:'/pixel/releases/publish',headers,payload:{action:'publish'}})).statusCode).toBe(404);
    const payload={targetGeneration:'G0007',expectedActive:'G0008',reason:'Return to stable code',deleteNewer:true,worldId:'world_a',pixelId:'0_0_0',operationKey:'world_a:op1'};
    const post=(body:any)=>f.app.inject({method:'POST',url:'/pixel/releases/rollback',headers,payload:body});
    expect((await post({...payload,command:'whoami'})).statusCode).toBe(400);expect((await post(payload)).statusCode).toBe(202);await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(2));
    expect(f.run.mock.calls.map(c=>c[1])).toEqual([['rollback-to','G0007','G0008','Pixel world_a/0_0_0: Return to stable code'],['delete-newer','G0007','Pixel world_a/0_0_0: Return to stable code']]);
    expect((await post(payload)).statusCode).toBe(202);expect(f.run).toHaveBeenCalledTimes(2);expect((await post({...payload,reason:'Changed request'})).statusCode).toBe(409);
    expect((await f.app.inject({url:'/pixel/releases',headers})).body).not.toMatch(/checked|validationLog|requestHash/);
  });
  it.each(['zh-CN','en'])('renders the Owner link, rollback and deletion controls and sends their exact targets in %s',async lang=>{
    const f=await fixture();f.data.afterRollback=true;f.data.candidates[0].canDelete=true;
    const dom=new JSDOM((await f.app.inject('/')).body,{url:'http://127.0.0.1:8766/',runScripts:'outside-only'});cleanups.push(async()=>dom.window.close());
    dom.window.localStorage.setItem('emergentinc.language',lang);dom.window.setInterval=()=>0;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.fetch=async(url:string,init:any={})=>{const response=await f.app.inject({method:init.method??'GET',url,headers:{cookie:f.cookie},...(init.body?{payload:JSON.parse(init.body)}:{})});return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};};
    await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent}})()`);const doc=dom.window.document;
    expect(doc.getElementById('back').textContent).toBe(lang==='en'?'Back to Owner':'返回 Owner');expect(doc.getElementById('back').href).toBe('http://127.0.0.1:8765/OWNER');
    expect(doc.querySelector('#history button').disabled).toBe(false);
    expect(doc.querySelector('#history button').textContent).toBe(lang==='en'?'Roll back to this version':'回退到此版本');doc.querySelector('#history button').click();expect(doc.getElementById('maintenance-dialog').open).toBe(true);doc.getElementById('maintenance-reason').value='Undo regression';doc.getElementById('maintenance-form').requestSubmit();await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());
    expect(f.run.mock.calls[0][1]).toEqual(['rollback-to','G0007','G0008','Undo regression']);
    await vi.waitFor(()=>expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8')).state).toBe('succeeded'));
    await vi.waitFor(()=>expect([...doc.querySelectorAll('#candidates button')].find((b:any)=>b.textContent===(lang==='en'?'Delete this code version':'删除此代码版本')).disabled).toBe(false));
    [...doc.querySelectorAll('#candidates button')].find((b:any)=>b.textContent===(lang==='en'?'Delete this code version':'删除此代码版本')).click();doc.getElementById('maintenance-reason').value='Undo regression';doc.getElementById('maintenance-form').requestSubmit();await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(2));
    expect(f.run.mock.calls[1][1]).toEqual(['delete-release','local-v24-test','G0008','a'.repeat(64),'Undo regression']);
  });
  it('blocks approval when the main service is offline and allows an explicit retry after startup',async()=>{
    const f=await fixture();f.checkRunning.mockRejectedValueOnce(new Error('MAIN_SERVICE_UNAVAILABLE'));
    const publish={action:'publish',id:'local-v24-test',hash:'a'.repeat(64)};
    expect((await f.request(publish)).statusCode).toBe(202);
    await vi.waitFor(()=>expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8'))).toMatchObject({state:'failed',error:'MAIN_SERVICE_UNAVAILABLE'}));
    expect(f.run).not.toHaveBeenCalled();expect(f.data.candidates[0].state).toBe('VALIDATED');
    expect((await f.request(publish)).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(2));
    expect(f.checkRunning).toHaveBeenCalledWith('G0008');
    expect(f.run.mock.calls.map(call=>call[1][0])).toEqual(['approve','apply']);
  });
  it.each(['zh-CN','en'])('keeps a readable offline publication error in the actual page (%s)',async lang=>{
    const f=await fixture();f.checkRunning.mockRejectedValue(new Error('MAIN_SERVICE_UNAVAILABLE'));
    await f.request({action:'publish',id:'local-v24-test',hash:'a'.repeat(64)});
    await vi.waitFor(()=>expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8')).state).toBe('failed'));
    const dom=new JSDOM((await f.app.inject('/')).body,{url:'http://127.0.0.1:8766/',runScripts:'outside-only'});
    cleanups.push(async()=>dom.window.close());dom.window.localStorage.setItem('emergentinc.language',lang);dom.window.setInterval=()=>0;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
    dom.window.fetch=async(url:string)=>{const response=await f.app.inject({url,headers:{cookie:f.cookie}});return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};};
    await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent}})()`);
    const message=dom.window.document.getElementById('job-state').textContent;
    expect(message).toContain(lang==='en'?'The main service is stopped or unreachable.':'主服务未启动或无法连接。');
    expect(message).toContain('EmergentInc_UI.bat');expect(message).toContain('EmergentInc_UI.sh');
    expect(message).toContain(lang==='en'?'The candidate is retained':'候选版本保留');expect(f.run).not.toHaveBeenCalled();
  });
  it('requires an independent Owner session for source reports and prepares them without publication',async()=>{
    const f=await fixture(),id=`code_${'a'.repeat(32)}`,hash='b'.repeat(64);
    expect((await f.app.inject(`/api/code-reports/${id}`)).statusCode).toBe(401);
    expect((await f.app.inject({method:'POST',url:'/api/upgrades',payload:{action:'prepare-code',id,hash}})).statusCode).toBe(401);
    expect((await f.request({action:'prepare-code',id:'../secret',hash})).statusCode).toBe(400);
    expect((await f.request({action:'prepare-code',id,hash})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(1));expect(f.run.mock.calls[0][1]).toEqual(['prepare-code',id,hash]);
    expect(f.run.mock.calls.flatMap(c=>c[1])).not.toContain('approve');expect(f.run.mock.calls.flatMap(c=>c[1])).not.toContain('apply');
  });
  it('exposes only read-only candidate metadata to Mission Control',async()=>{
    const f=await fixture(),response=await f.app.inject('/status');expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({service:'owner-upgrade',active:'G0008',busy:false,candidates:[{id:'local-v24-test',state:'VALIDATED',hash:'a'.repeat(64),baseGeneration:'G0008'}]});
    expect(response.body).not.toMatch(/validationLog|request_json|projectRoot|stateDirectory|owner_release/);expect(f.run).not.toHaveBeenCalled();
    expect((await f.app.inject({method:'POST',url:'/status',payload:{action:'publish'}})).statusCode).toBe(404);
  });
  it('requires an independent Owner session and rejects cross-origin actions', async () => {
    const f = await fixture();
    expect(f.cookie.startsWith('emergent_upgrade_owner=')).toBe(true);
    expect((await f.app.inject('/api/upgrades')).statusCode).toBe(401);
    expect((await f.app.inject({ method: 'POST', url: '/api/upgrades', headers: { cookie: f.cookie, origin: 'https://example.com' }, payload: { action: 'recover' } })).statusCode).toBe(403);
    expect(f.run).not.toHaveBeenCalled();
  });
  it('accepts only the reviewed exact candidate and serializes approval and publication', async () => {
    const f = await fixture();
    expect((await f.request({ action: 'publish', id: 'local-v24-test', hash: 'b'.repeat(64) })).statusCode).toBe(409);
    expect(f.run).not.toHaveBeenCalled();
    let finish!: () => void;
    f.run.mockImplementationOnce(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
    expect((await f.request({ action: 'publish', id: 'local-v24-test', hash: 'a'.repeat(64) })).statusCode).toBe(202);
    expect((await f.request({ action: 'recover' })).statusCode).toBe(409);
    expect((await f.app.inject('/health/live')).statusCode).toBe(200);
    finish();
    await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(path.join(f.directory, 'upgrade-web-job.json'), 'utf8')).state).toBe('succeeded'));
    expect(f.run.mock.calls.map(call => call[1])).toEqual([['approve', 'local-v24-test', 'a'.repeat(64)], ['apply', 'local-v24-test']]);
  });
  it('rejects dirty sources and invalid actions before executing any command', async () => {
    const f = await fixture();
    f.data.dirty = true;
    expect((await f.request({ action: 'prepare', version: 'v24-fixes', reason: 'Fix run state' })).statusCode).toBe(409);
    expect((await f.request({ action: 'prepare', version: 'bad\0label', reason: 'test' })).statusCode).toBe(400);
    expect((await f.request({ action: 'shell', command: 'whoami' })).statusCode).toBe(400);
    expect(f.run).not.toHaveBeenCalled();
  });
  it.each(['v25-owner-work-统一浅灰背景','我的发布 / 25.1 & "测试" 🚀','../../任意标签'])('accepts a free-text label as one argument: %s',async label=>{
    const f=await fixture();
    expect((await f.request({action:'prepare',version:label,reason:'统一浅灰背景'})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(1));
    expect(f.run.mock.calls[0][1]).toEqual(['prepare',label,'统一浅灰背景']);
    expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8')).version).toBe(label);
  });
  it.each(['', '   ', undefined])('generates a timestamp label for an empty version (%s)',async version=>{
    const f=await fixture();expect((await f.request({action:'prepare',version,reason:'Changes'})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(1));expect(f.run.mock.calls[0][1][1]).toMatch(/^release-\d{8}T\d{6}Z$/);
    expect(f.run.mock.calls[0][1][2]).toBe('Changes');
  });
  it('keeps the change description required and bounds invalid input without format restrictions',async()=>{
    const f=await fixture();
    for(const payload of [{version:'中文',reason:' '},{version:42,reason:'Changes'},{version:'x'.repeat(201),reason:'Changes'},{version:'x',reason:'bad\0reason'}])
      expect((await f.request({action:'prepare',...payload})).statusCode).toBe(400);
    expect(f.run).not.toHaveBeenCalled();
    expect(ownerReleaseInput('', ' Changes ',new Date('2026-10-08T06:00:00Z'))).toEqual({label:'release-20261008T060000Z',reason:'Changes'});
  });
  it('reads the active display label independently from its internal release ID',async()=>{
    const f=await fixture(),workspace=path.join(f.directory,'workspace'),lineageFile=path.join(workspace,'system/lineage/lineage.sqlite3');
    fs.mkdirSync(path.dirname(lineageFile),{recursive:true});
    const lineage=new DatabaseSync(lineageFile);lineage.exec("CREATE TABLE generations(id TEXT,generation_no INTEGER,parent_id TEXT,release_id TEXT,state TEXT); INSERT INTO generations VALUES('G0014',14,'G0013','local-safe-id','ACTIVE')");lineage.close();
    const evolution=new DatabaseSync(path.join(f.directory,'evolution.sqlite3'));evolution.exec('CREATE TABLE candidates(id TEXT,state TEXT,phase TEXT,failure_reason TEXT,created_at INTEGER,target_generation TEXT,request_hash TEXT,candidate_json TEXT,request_json TEXT); CREATE TABLE events(sequence INTEGER,kind TEXT,payload TEXT)');
    const request={base_generation:'G0013',owner_release:{label:'统一浅灰背景 / 🚀',reason:'Changes'}};
    evolution.prepare('INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?)').run('local-safe-id','BORN','DONE',null,1,'G0014','hash',null,JSON.stringify(request));evolution.close();
    expect(readUpgradeStatus(path.resolve('.'),{workspace,stateDirectory:f.directory,appUrl:f.data.appUrl}).active).toMatchObject({release_id:'local-safe-id',label:'统一浅灰背景 / 🚀'});
  });
  it('derives rollback and deletion eligibility from actual generation order and retained restore history',async()=>{
    const f=await fixture(),workspace=path.join(f.directory,'workspace'),releases=path.join(f.directory,'releases'),file=path.join(workspace,'system/lineage/lineage.sqlite3');fs.mkdirSync(path.dirname(file),{recursive:true});
    const lineage=new DatabaseSync(file);lineage.exec("CREATE TABLE generations(id TEXT,generation_no INTEGER,parent_id TEXT,release_id TEXT,state TEXT); INSERT INTO generations VALUES('G0001',1,NULL,'r1','RETIRED'),('G0002',2,'G0001','r2','RETIRED'),('G0003',3,'G0002','r3','ACTIVE')");
    const evolution=new DatabaseSync(path.join(f.directory,'evolution.sqlite3'));evolution.exec('CREATE TABLE candidates(id TEXT,state TEXT,phase TEXT,failure_reason TEXT,created_at INTEGER,target_generation TEXT,request_hash TEXT,candidate_json TEXT,request_json TEXT); CREATE TABLE events(sequence INTEGER,kind TEXT,payload TEXT)');
    for(let number=1;number<=4;number++){const id=`r${number}`,dir=path.join(releases,id,'genome');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({generation:number,capability_contracts:{'instance_payment@1':true}}));
      if(number>1)evolution.prepare('INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?,?)').run(id,number===4?'VALIDATED':'BORN',null,null,number,number===4?null:`G000${number}`,'b'.repeat(64),JSON.stringify({candidate_hash:'a'.repeat(64)}),JSON.stringify({base_generation:`G000${number-1}`,base_release:`r${number-1}`,...(number===4?{owner_release:{label:'A future candidate'}}:{})}));
    }
    const config={workspace,releases,stateDirectory:f.directory,appUrl:f.data.appUrl};let result=readUpgradeStatus(path.resolve('.'),config);
    expect(result.versions.find(v=>v.id==='G0001').canRollback).toBe(true);expect(result.candidates[0].canDelete).toBe(false);
    lineage.exec("UPDATE generations SET state='ROLLED_BACK' WHERE id='G0003'; UPDATE generations SET state='ACTIVE' WHERE id='G0002'");
    evolution.exec("UPDATE candidates SET state='ROLLED_BACK' WHERE id='r3'");evolution.prepare("INSERT INTO events VALUES(1,'generation_restored',?)").run(JSON.stringify({generation:'G0003',previous:'G0002'}));
    result=readUpgradeStatus(path.resolve('.'),config);expect(result.afterRollback).toBe(true);expect(result.versions.find(v=>v.id==='G0003')).toMatchObject({canDelete:true,identity:'a'.repeat(64),canRollback:false});
    expect(result.versions.find(v=>v.id==='G0002').canDelete).toBe(false);expect(result.versions.find(v=>v.id==='G0001').canDelete).toBe(false);expect(result.candidates.find(c=>c.id==='r4').canDelete).toBe(true);
    lineage.close();evolution.close();
  });
  it.each(['zh-CN','en'])('accepts the reported label and renders labels safely in the actual page (%s)',async lang=>{
    const f=await fixture(),html=(await f.app.inject('/')).body;
    (f.data.candidates[0].request.owner_release as any).label='<img src=x onerror=alert(1)> 中文标签';
    const dom=new JSDOM(html,{url:'http://127.0.0.1:8766/',runScripts:'outside-only'});
    cleanups.push(async()=>dom.window.close());dom.window.localStorage.setItem('emergentinc.language',lang);dom.window.setInterval=()=>0;dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
    dom.window.fetch=async(url:string,init:any={})=>{const response=await f.app.inject({method:init.method??'GET',url,headers:{cookie:f.cookie},...(init.body?{payload:JSON.parse(init.body)}:{})});return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};};
    await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent}})()`);
    const input=dom.window.document.getElementById('version'),reason=dom.window.document.getElementById('reason');
    expect(input.hasAttribute('required')).toBe(false);expect(input.hasAttribute('pattern')).toBe(false);expect(input.placeholder).toBe(lang==='en'?'Leave blank to generate a label':'留空自动生成');
    expect(dom.window.document.querySelector('#candidates h3').textContent).toBe('<img src=x onerror=alert(1)> 中文标签');expect(dom.window.document.querySelector('#candidates img')).toBeNull();
    input.value='v25-owner-work-统一浅灰背景';reason.value='统一浅灰背景';expect(input.checkValidity()).toBe(true);
    dom.window.document.getElementById('prepare-form').requestSubmit();
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(1));expect(f.run.mock.calls[0][1]).toEqual(['prepare','v25-owner-work-统一浅灰背景','统一浅灰背景']);
  });
  it('preserves command failures for review and does not retry publication', async () => {
    const f = await fixture();
    f.run.mockRejectedValueOnce(new Error('validation failed'));
    expect((await f.request({ action: 'prepare', version: 'v24-fixes', reason: 'Fix run state' })).statusCode).toBe(202);
    await vi.waitFor(() => expect(JSON.parse(fs.readFileSync(path.join(f.directory, 'upgrade-web-job.json'), 'utf8')).state).toBe('failed'));
    expect(f.run).toHaveBeenCalledTimes(1);
    const status = (await f.app.inject({ url: '/api/upgrades', headers: { cookie: f.cookie } })).json();
    expect(status.job.error).toBe('validation failed');
    expect(status.busy).toBe(false);
  });
  it.each(['zh-CN','en'])('keeps publication at the top and preserves controls and errors across actual polling (%s)',async lang=>{
    const f=await fixture(),{dom,doc,poll}=await page(f,lang);
    expect(doc.getElementById('publish-section').compareDocumentPosition(doc.getElementById('history-section'))&4).toBe(4);
    const card=doc.querySelector('#candidates article'),check=card.querySelector('input'),button=card.querySelector('button'),details=card.querySelector('details');
    expect(button.disabled).toBe(true);check.click();details.open=true;details.dispatchEvent(new dom.window.Event('toggle'));check.focus();
    await poll();expect(doc.querySelector('#candidates input')).toBe(check);expect(doc.activeElement).toBe(check);expect(details.open).toBe(true);expect(button.disabled).toBe(false);
    f.data.candidates[0].candidate.candidate_hash='b'.repeat(64);button.click();
    await vi.waitFor(()=>expect(doc.getElementById('error').textContent).toContain(lang==='en'?'identifier changed':'标识已变化'));
    await poll();expect(doc.getElementById('error').textContent).toContain(lang==='en'?'identifier changed':'标识已变化');
    expect(doc.querySelector('#candidates input').checked).toBe(false);expect(f.run).not.toHaveBeenCalled();
    doc.querySelector('#history button').click();doc.getElementById('maintenance-reason').value='Kept during polling';
    await poll();expect(doc.getElementById('maintenance-dialog').open).toBe(true);expect(doc.getElementById('maintenance-reason').value).toBe('Kept during polling');
    doc.getElementById('maintenance-cancel').click();expect(doc.getElementById('maintenance-dialog').open).toBe(false);expect(f.run).not.toHaveBeenCalled();
  });
  it.each(['zh-CN','en'])('requires a reason inside the target dialog and supports rollback with cleanup (%s)',async lang=>{
    const f=await fixture(),{doc,poll}=await page(f,lang);doc.querySelector('#history button').click();
    expect(doc.getElementById('maintenance-target').textContent).toContain('G0007');expect(doc.getElementById('maintenance-form').checkValidity()).toBe(false);
    doc.getElementById('maintenance-form').requestSubmit();expect(f.run).not.toHaveBeenCalled();
    doc.getElementById('maintenance-reason').value='Rollback and clean';doc.getElementById('delete-newer').checked=true;doc.getElementById('maintenance-form').requestSubmit();
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(2));expect(f.run.mock.calls.map(c=>c[1][0])).toEqual(['rollback-to','delete-newer']);
    await poll();expect(doc.getElementById('job-title').textContent).toContain(lang==='en'?'Most recent operation':'最近一次操作');
    expect(doc.getElementById('job-time').textContent).toContain('G0007');
  });
  it('offers validation retry only for the unchanged submitted candidate on the active base',async()=>{
    const f=await fixture(),row=f.data.candidates[0];row.state='SUBMITTED';row.candidate=null;
    expect((await f.request({action:'validate',id:row.id,expectedActive:'G0008',identity:'b'.repeat(64)})).statusCode).toBe(409);
    const {doc}=await page(f);expect(doc.querySelector('#candidates button').textContent).toBe('重新校验此版本');doc.querySelector('#candidates button').click();
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());expect(f.run.mock.calls[0][1]).toEqual(['validate',row.id]);
    row.request.base_generation='G0007';expect((await f.request({action:'validate',id:row.id,expectedActive:'G0008',identity:row.identity})).statusCode).toBe(409);
  });
  it('shows an external maintenance lock as busy and rejects conflicting actions',async()=>{
    const f=await fixture(),lock=path.join(f.directory,'operator.lock');fs.writeFileSync(lock,JSON.stringify({pid:process.pid}));
    expect((await f.app.inject({url:'/api/upgrades',headers:{cookie:f.cookie}})).json().busy).toBe(true);
    expect((await f.request({action:'recover'})).statusCode).toBe(409);const {doc,poll}=await page(f);
    expect(doc.querySelector('#history button').disabled).toBe(true);fs.unlinkSync(lock);await poll();expect(doc.querySelector('#history button').disabled).toBe(false);expect(f.run).not.toHaveBeenCalled();
  });
  it.each(['zh-CN','en'])('separates stale candidates and logs out and restores the login form (%s)',async lang=>{
    const f=await fixture();f.data.candidates.push({...f.data.candidates[0],id:'old-candidate',request:{...f.data.candidates[0].request,base_generation:'G0007'}});
    const {doc,poll}=await page(f,lang);expect(doc.querySelectorAll('#candidates article')).toHaveLength(1);expect(doc.querySelector('#archived-candidates').textContent).toContain(lang==='en'?'based on an old version':'基于旧版本');
    expect(doc.querySelectorAll('#archived-candidates button')).toHaveLength(0);doc.getElementById('logout').click();
    await vi.waitFor(()=>expect(doc.getElementById('login').hidden).toBe(false));await poll();expect(doc.getElementById('content').hidden).toBe(true);
    doc.getElementById('secret').value='bad';doc.getElementById('login-form').requestSubmit();await vi.waitFor(()=>expect(doc.getElementById('error').textContent).toBe(lang==='en'?'Invalid Owner secret.':'Owner 口令错误。'));
    doc.getElementById('secret').value=f.secret;doc.getElementById('login-form').requestSubmit();await vi.waitFor(()=>expect(doc.getElementById('content').hidden).toBe(false));expect(doc.getElementById('error').textContent).toBe('');
  });
  it('prevents overlapping polling and distinguishes network failures from login rejection',async()=>{
    const f=await fixture(),{dom,doc,poll}=await page(f);let finish!:(r:any)=>void;
    dom.window.fetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const running=poll();await poll();
    expect(dom.window.fetch.mock.calls.filter(([url]:[string])=>url==='/api/upgrades')).toHaveLength(2);
    finish({ok:true,status:200,json:async()=>({...f.data,job:null,busy:false})});await running;
    dom.window.fetch.mockRejectedValueOnce(new Error('Failed to fetch'));await poll();expect(doc.getElementById('error').textContent).toBe('无法连接升级服务。');await poll();expect(doc.getElementById('error').textContent).toBe('');
  });
  it('reads an interrupted job after restart and offers explicit recovery',async()=>{
    const f=await fixture();fs.writeFileSync(path.join(f.directory,'upgrade-web-job.json'),JSON.stringify({action:'rollback',targetGeneration:'G0007',state:'running',startedAt:Date.now(),log:'Before restart'}));
    const app=await createUpgradeWeb({root:path.resolve('.'),config:{stateDirectory:f.directory},secret:f.secret,runCommand:f.run,status:()=>f.data,checkRunning:f.checkRunning});cleanups.push(()=>app.close());
    const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({url:'/api/upgrades',headers:{cookie}})).json().job).toMatchObject({state:'interrupted',error:'UPGRADE_INTERRUPTED_CHECK_RECOVERY'});
    expect((await app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload:{action:'recover'}})).statusCode).toBe(202);await vi.waitFor(()=>expect(f.run).toHaveBeenCalledWith(path.resolve('.'),['recover'],expect.any(Function)));
  });

  it.each(['zh-CN','en'])('reviews source reports, binds their hash and clears approval on logout (%s)',async lang=>{
    const f=await fixture(),id='code_'+ 'a'.repeat(32),hash='b'.repeat(64),report={id,hash,title:'Source report',personName:'Pixel',baseGeneration:'G0008',summary:'Change source',files:[{path:'apps/server/example.ts',content:'export const example=1;'},{path:'apps/server/obsolete.ts',content:null}]};
    const {doc,poll}=await page(f,lang,`?report=${id}&reportHash=${hash}`,{['/api/code-reports/'+id]:report});
    const section=doc.getElementById('code-report');expect(section.hidden).toBe(false);expect(section.textContent).toContain(lang==='en'?'Delete file':'删除文件');
    expect(section.querySelector('button').disabled).toBe(true);section.querySelector('input').click();section.querySelector('button').click();
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());expect(f.run.mock.calls[0][1]).toEqual(['prepare-code',id,hash]);
    await vi.waitFor(()=>expect(section.querySelector('button').disabled).toBe(false));doc.getElementById('logout').click();await vi.waitFor(()=>expect(doc.getElementById('login').hidden).toBe(false));expect(section.hidden).toBe(true);
    doc.getElementById('secret').value=f.secret;doc.getElementById('login-form').requestSubmit();await vi.waitFor(()=>expect(doc.getElementById('content').hidden).toBe(false));await poll();expect(section.querySelector('input').checked).toBe(false);expect(section.querySelector('button').disabled).toBe(true);
  });
  it.each(['zh-CN','en'])('rejects a changed source report and keeps its error across polling (%s)',async lang=>{
    const f=await fixture(),id='code_'+ 'a'.repeat(32),{doc,poll}=await page(f,lang,`?report=${id}&reportHash=${'b'.repeat(64)}`,{['/api/code-reports/'+id]:{id,hash:'c'.repeat(64)}});
    const section=doc.getElementById('code-report');expect(section.hidden).toBe(false);expect(section.textContent).toContain(lang==='en'?'verification ID changed':'校验标识已变化');expect(section.querySelector('button')).toBeNull();await poll();expect(section.hidden).toBe(false);expect(f.run).not.toHaveBeenCalled();
  });
  it.each(['zh-CN','en'])('executes recovery from the failed-operation button and reports an expired session (%s)',async lang=>{
    const f=await fixture();f.run.mockRejectedValueOnce(new Error('GENE_HASH_MUST_CHANGE'));await f.request({action:'prepare',version:'No change',reason:'Test'});
    await vi.waitFor(()=>expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8')).state).toBe('failed'));
    const {doc,poll}=await page(f,lang);expect(doc.getElementById('job-state').textContent).toContain(lang==='en'?'no code changes':'没有可发布的代码改动');expect(doc.getElementById('recover').hidden).toBe(false);doc.getElementById('recover').click();await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(2));expect(f.run.mock.calls[1][1]).toEqual(['recover']);
    await f.app.inject({method:'POST',url:'/api/logout',headers:{cookie:f.cookie}});await poll();expect(doc.getElementById('login').hidden).toBe(false);expect(doc.getElementById('error').textContent).toBe(lang==='en'?'Your session expired. Log in again.':'登录已过期，请重新登录。');
  });

});
