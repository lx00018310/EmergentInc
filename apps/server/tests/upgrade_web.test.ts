import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

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
  const data = { active: { id: 'G0008' }, dirty: false, appUrl: 'http://127.0.0.1:8765', candidates: [{ id: 'local-v24-test', state: 'VALIDATED',
    candidate: { candidate_hash: 'a'.repeat(64), base_generation: 'G0008' }, request: { owner_release: { reason: 'Fix run state' } } }] };
  const app = await createUpgradeWeb({ root: path.resolve('.'), config: { stateDirectory: directory }, secret, runCommand: run, status: () => data, checkRunning });
  cleanups.push(async () => { await app.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { secret } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const request = (payload: unknown) => app.inject({ method: 'POST', url: '/api/upgrades', headers: { cookie }, payload });
  return { app, data, directory, run, request, cookie, checkRunning };
}

describe('Owner web upgrade', () => {
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
    cleanups.push(async()=>dom.window.close());dom.window.localStorage.setItem('emergentinc.language',lang);dom.window.setInterval=()=>0;
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
    const lineage=new DatabaseSync(lineageFile);lineage.exec("CREATE TABLE generations(id TEXT,release_id TEXT,state TEXT); INSERT INTO generations VALUES('G0014','local-safe-id','ACTIVE')");lineage.close();
    const evolution=new DatabaseSync(path.join(f.directory,'evolution.sqlite3'));evolution.exec('CREATE TABLE candidates(id TEXT,state TEXT,phase TEXT,failure_reason TEXT,created_at INTEGER,candidate_json TEXT,request_json TEXT)');
    const request={base_generation:'G0013',owner_release:{label:'统一浅灰背景 / 🚀',reason:'Changes'}};
    evolution.prepare('INSERT INTO candidates VALUES(?,?,?,?,?,?,?)').run('local-safe-id','BORN','DONE',null,1,null,JSON.stringify(request));evolution.close();
    expect(readUpgradeStatus(path.resolve('.'),{workspace,stateDirectory:f.directory,appUrl:f.data.appUrl}).active).toMatchObject({release_id:'local-safe-id',label:'统一浅灰背景 / 🚀'});
  });
  it.each(['zh-CN','en'])('accepts the reported label and renders labels safely in the actual page (%s)',async lang=>{
    const f=await fixture(),html=(await f.app.inject('/')).body;
    (f.data.candidates[0].request.owner_release as any).label='<img src=x onerror=alert(1)> 中文标签';
    const dom=new JSDOM(html,{url:'http://127.0.0.1:8766/',runScripts:'outside-only'});
    cleanups.push(async()=>dom.window.close());dom.window.localStorage.setItem('emergentinc.language',lang);dom.window.setInterval=()=>0;
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
});
