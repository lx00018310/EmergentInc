import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { pixelReleaseToken } from '../src/services/release_maintenance_client.js';

// The web maintenance process uses the same compiled Owner authentication as the launcher.
// @ts-ignore Standalone maintenance script.
import { createUpgradeWeb, readUpgradeStatus, runUpgradeCommand, readGitGraph, readGitCommit } from '../../../scripts/upgrade-web.mjs';
// @ts-ignore Standalone maintenance script.
import { ownerReleaseInput, ensureFastForwardable, fastForwardMain } from '../../../scripts/version-upgrade.mjs';
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
  cleanups.push(async()=>{await vi.waitFor(()=>expect(dom.window.upgradeTestIdle?.()).toBe(true));dom.window.close();});let poll!:()=>Promise<void>,browserCookie=f.cookie;
  dom.window.localStorage.setItem('emergentinc.language',lang);
  dom.window.setInterval=(callback:()=>Promise<void>)=>{poll=callback;return 0;};
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.fetch=vi.fn(async(url:string,init:any={})=>{if(!init.method&&url in responses)return {ok:true,status:200,json:async()=>responses[url]};const response=await f.app.inject({method:init.method??'GET',url,headers:{cookie:browserCookie},...(init.body?{payload:JSON.parse(init.body)}:{})});if(response.headers['set-cookie'])browserCookie=String(response.headers['set-cookie']).split(';')[0];return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};});
  await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent};let selections=0;const select=selectCommit;selectCommit=async(...args)=>{selections++;try{return await select(...args);}finally{selections--;}};window.upgradeTestIdle=()=>!refreshing&&!sending&&!selections;})()`);
  return {dom,doc:dom.window.document,poll:()=>poll()};
}

describe('V32 single version switch flow',()=>{
  it.each(['zh-CN','en'])('automatically prepares a selected commit, binds exact approval, and draws both real Git DAGs (%s)',async lang=>{
    const repo=gitRepo(),f=await fixture(),graph=readGitGraph(repo.directory),data={...f.data,busy:false};
    data.candidates[0].request.owner_release.source_commit=repo.tip;
    const {doc,poll}=await page(f,lang,'',{'/api/upgrades':data,'/api/git-graph':graph,['/api/git-commit/'+repo.first]:readGitCommit(repo.directory,repo.first),['/api/git-commit/'+repo.tip]:readGitCommit(repo.directory,repo.tip)});
    expect(doc.querySelectorAll('.graph-edge').length).toBeGreaterThanOrEqual(4);expect(doc.querySelectorAll('[data-sha="'+repo.tip+'"]').length).toBeGreaterThanOrEqual(2);
    for(const id of ['prepare','prepare-commit','rollback','delete','version','reason','recover','commit-form'])expect(doc.getElementById(id)).toBeNull();
    doc.querySelector('li[data-sha="'+repo.first+'"]').click();await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());
    expect(f.run.mock.calls[0][1]).toEqual(['prepare','add SKILL.md','add SKILL.md','--commit',repo.first]);
    data.candidates[0].request.owner_release.source_commit=repo.first;await vi.waitFor(async()=>{await poll();expect(doc.getElementById('switch').disabled).toBe(false);});
    doc.getElementById('switch').click();await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(3));await vi.waitFor(async()=>{await poll();expect(doc.getElementById('switch').disabled).toBe(false);});
    expect(f.run.mock.calls.slice(1).map(c=>c[1][0])).toEqual(['approve','apply']);expect(f.run.mock.calls[1][1]).toContain('a'.repeat(64));
    expect(doc.getElementById('secret').value).toBe('');
  },30000);
  it('keeps stale candidates unapprovable, preserves errors, and requires no second preparation click',async()=>{
    const repo=gitRepo(),f=await fixture(),data={...f.data,busy:false};data.candidates[0].request.owner_release.source_commit=repo.tip;data.candidates[0].request.base_generation='G0007';
    const {dom,doc,poll}=await page(f,'en','',{'/api/upgrades':data,'/api/git-graph':readGitGraph(repo.directory),['/api/git-commit/'+repo.tip]:readGitCommit(repo.directory,repo.tip)});
    doc.querySelector('li[data-sha="'+repo.tip+'"]').click();await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());expect(doc.getElementById('switch').disabled).toBe(true);
    doc.getElementById('error').textContent='Actual failure';await poll();expect(doc.getElementById('error').textContent).toBe('Actual failure');expect(f.run).toHaveBeenCalledOnce();
    expect(dom.window.document.querySelectorAll('svg')).toHaveLength(2);
  },30000);
  it('denies delegated release mutation and retains only read-only release metadata',async()=>{
    const f=await fixture(),headers={authorization:`Bearer ${pixelReleaseToken(f.secret)}`};
    expect((await f.app.inject({url:'/pixel/releases',headers})).statusCode).toBe(200);
    for(const action of ['rollback','delete'])expect((await f.app.inject({method:'POST',url:'/pixel/releases/'+action,headers,payload:{}})).statusCode).toBe(403);
    expect(f.run).not.toHaveBeenCalled();
  });
  it('publishes an exact candidate without moving Git branches or requiring fast-forward history',async()=>{
    const repo=gitRepo();repo.commit('main moved','main.txt');const before=repo.run('show-ref','--heads'),f=await fixture();
    f.data.candidates[0].request.owner_release={source_commit:repo.tip,reason:'Switch to compatible earlier code',main_head_at_prepare:repo.base,git_sync_target:repo.tip};
    const app=await createUpgradeWeb({root:repo.directory,config:{stateDirectory:f.directory},secret:f.secret,runCommand:f.run,status:()=>f.data,checkRunning:f.checkRunning});cleanups.push(()=>app.close());
    const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload:{action:'publish',id:'local-v24-test',hash:'b'.repeat(64)}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload:{action:'publish',id:'local-v24-test',hash:'a'.repeat(64)}})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledTimes(2));expect(repo.run('show-ref','--heads')).toBe(before);
  },30000);
});

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
  it('reads an interrupted job after restart and offers explicit recovery',async()=>{
    const f=await fixture();fs.writeFileSync(path.join(f.directory,'upgrade-web-job.json'),JSON.stringify({action:'rollback',targetGeneration:'G0007',state:'running',startedAt:Date.now(),log:'Before restart'}));
    const app=await createUpgradeWeb({root:path.resolve('.'),config:{stateDirectory:f.directory},secret:f.secret,runCommand:f.run,status:()=>f.data,checkRunning:f.checkRunning});cleanups.push(()=>app.close());
    const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({url:'/api/upgrades',headers:{cookie}})).json().job).toMatchObject({state:'interrupted',error:'UPGRADE_INTERRUPTED_CHECK_RECOVERY'});
    expect((await app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload:{action:'recover'}})).statusCode).toBe(202);await vi.waitFor(()=>expect(f.run).toHaveBeenCalledWith(path.resolve('.'),['recover'],expect.any(Function)));
  });

  it('does not create a missing database during status inspection',async()=>{
    const f=await fixture(),workspace=path.join(f.directory,'missing');expect(()=>readUpgradeStatus(path.resolve('.'),{workspace,stateDirectory:f.directory,appUrl:f.data.appUrl})).toThrow('UPGRADE_DATABASE_UNAVAILABLE');expect(fs.existsSync(workspace)).toBe(false);
  });

});

function gitRepo(){
  const directory=fs.mkdtempSync(path.join(tmpdir(),'upgrade-git-'));
  const run=(...args:string[])=>{const {execFileSync}=require('node:child_process') as typeof import('node:child_process');return execFileSync('git',args,{cwd:directory,encoding:'utf8',windowsHide:true}).trim();};
  const commit=(message:string,file='file.txt')=>{fs.writeFileSync(path.join(directory,file),message);run('add',file);run('-c','user.name=Tester','-c','user.email=t@example.com','commit','-m',message);return run('rev-parse','HEAD');};
  run('init','-b','main');run('-c','user.name=Tester','-c','user.email=t@example.com','commit','--allow-empty','-m','root');
  const base=commit('base');
  run('checkout','-b','feature/skills');
  const first=commit('add SKILL.md');
  const tip=commit('polish SKILL.md');
  run('checkout','main');
  cleanups.push(()=>fs.rmSync(directory,{recursive:true,force:true}));
  return {directory,run,commit,base,first,tip};
}

describe('V27 dual-tree git upgrade', () => {
  it('shows real branches and tags without counting internal tool checkpoint refs as development',()=>{
    const repo=gitRepo();repo.run('checkout','-b','scratch');const checkpoint=repo.commit('internal checkpoint','scratch.txt');repo.run('update-ref','refs/cline/checkpoints/test/1',checkpoint);repo.run('checkout','main');repo.run('branch','-D','scratch');repo.run('tag','approved-base',repo.base);
    let graph=readGitGraph(repo.directory);expect(graph.commits.map((c:any)=>c.sha)).not.toContain(checkpoint);expect(graph.refs.map((r:any)=>r.ref)).toContain('refs/tags/approved-base');expect(graph.refs.map((r:any)=>r.ref)).not.toContain('refs/cline/checkpoints/test/1');
    repo.run('branch','feature/restored',checkpoint);graph=readGitGraph(repo.directory);expect(graph.commits.map((c:any)=>c.sha)).toContain(checkpoint);expect(repo.run('rev-parse','refs/cline/checkpoints/test/1')).toBe(checkpoint);
  },30000);

  it('fast-forwards main from a development checkout without changing the checked-out branch',()=>{
    const repo=gitRepo();repo.run('checkout','feature/skills');const current=repo.run('rev-parse','HEAD');
    fastForwardMain(repo.tip,repo.base,repo.directory);expect(repo.run('rev-parse','main')).toBe(repo.tip);expect(repo.run('branch','--show-current')).toBe('feature/skills');expect(repo.run('rev-parse','HEAD')).toBe(current);expect(repo.run('status','--porcelain')).toBe('');
  },30000);

  it.each([false,true])('preserves a dirty development checkout while syncing main (separate main checkout: %s)',checkedOutMain=>{
    const repo=gitRepo();repo.run('checkout','feature/skills');
    let mainDirectory:string|undefined;
    if(checkedOutMain){mainDirectory=fs.mkdtempSync(path.join(tmpdir(),'upgrade-main-clean-'));repo.run('worktree','add',mainDirectory,'main');const dir=mainDirectory;cleanups.push(async()=>{repo.run('worktree','remove','--force',dir);});}
    fs.writeFileSync(path.join(repo.directory,'file.txt'),'Owner staged edit');repo.run('add','file.txt');fs.writeFileSync(path.join(repo.directory,'file.txt'),'Owner unstaged edit');fs.writeFileSync(path.join(repo.directory,'private-draft.txt'),'Owner untracked draft');
    const before={head:repo.run('rev-parse','HEAD'),status:repo.run('status','--porcelain'),index:repo.run('ls-files','--stage'),staged:repo.run('show',':file.txt')};
    fastForwardMain(repo.tip,repo.base,repo.directory);
    expect(repo.run('rev-parse','main')).toBe(repo.tip);expect(repo.run('branch','--show-current')).toBe('feature/skills');
    expect({head:repo.run('rev-parse','HEAD'),status:repo.run('status','--porcelain'),index:repo.run('ls-files','--stage'),staged:repo.run('show',':file.txt')}).toEqual(before);
    expect(fs.readFileSync(path.join(repo.directory,'file.txt'),'utf8')).toBe('Owner unstaged edit');expect(fs.readFileSync(path.join(repo.directory,'private-draft.txt'),'utf8')).toBe('Owner untracked draft');
    if(mainDirectory)expect(fs.readFileSync(path.join(mainDirectory,'file.txt'),'utf8')).toBe('polish SKILL.md');
  },30000);

  it('updates a separately checked-out main worktree and refuses its uncommitted changes',()=>{
    const repo=gitRepo();repo.run('checkout','feature/skills');const mainDirectory=fs.mkdtempSync(path.join(tmpdir(),'upgrade-main-checkout-'));
    repo.run('worktree','add',mainDirectory,'main');cleanups.push(async()=>{repo.run('worktree','remove','--force',mainDirectory);});
    fs.writeFileSync(path.join(mainDirectory,'dirty.txt'),'Keep owner work');expect(()=>fastForwardMain(repo.tip,repo.base,repo.directory)).toThrow('GIT_SYNC_DIRTY_WORKTREE');expect(repo.run('rev-parse','main')).toBe(repo.base);fs.unlinkSync(path.join(mainDirectory,'dirty.txt'));
    fastForwardMain(repo.tip,repo.base,repo.directory);expect(fs.readFileSync(path.join(mainDirectory,'file.txt'),'utf8')).toBe('polish SKILL.md');expect(repo.run('branch','--show-current')).toBe('feature/skills');expect(repo.run('rev-parse','main')).toBe(repo.tip);
  },30000);

  it('reports divergent ahead/behind counts and merge file changes against the first parent',()=>{
    const repo=gitRepo();repo.commit('main advances','main.txt');const detail=readGitCommit(repo.directory,repo.tip);expect(detail.fastForwardable).toBe(false);expect(detail.ahead).toBe(2);expect(detail.behind).toBe(1);
    repo.run('-c','user.name=Tester','-c','user.email=t@example.com','merge','--no-ff','feature/skills','-m','merge for details');const merged=readGitCommit(repo.directory,repo.run('rev-parse','HEAD'));expect(merged.files).toEqual([{status:'M',name:'file.txt'}]);expect(readGitCommit(repo.directory,repo.run('rev-list','--max-parents=0','main')).files).toEqual([]);
  },30000);

  it('exposes a bounded read-only graph and commit details with FF feasibility, but only after login',async()=>{
    const repo=gitRepo(),f=await fixture();
    const graphApp=await createUpgradeWeb({root:repo.directory,config:{stateDirectory:f.directory},secret:f.secret,runCommand:f.run,status:()=>f.data,checkRunning:f.checkRunning});
    cleanups.push(async()=>{await graphApp.close();});
    expect((await graphApp.inject('/api/git-graph')).statusCode).toBe(401);
    const login=await graphApp.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    const graph=await graphApp.inject({url:'/api/git-graph',headers:{cookie}});
    expect(graph.statusCode).toBe(200);
    const value=graph.json();
    expect(value.available).toBe(true);expect(value.mainHead).toBe(repo.base);expect(value.commits.length).toBeGreaterThanOrEqual(3);
    const tipCommit=value.commits.find((c:any)=>c.sha===repo.tip);
    expect(tipCommit).toMatchObject({subject:'polish SKILL.md'});expect(tipCommit.parents).toEqual([repo.first]);
    expect(value.refs.map((r:any)=>r.ref)).toEqual(expect.arrayContaining(['refs/heads/main','refs/heads/feature/skills']));
    expect((await graphApp.inject({url:'/api/git-graph?limit=10000',headers:{cookie}})).json().limit).toBeLessThanOrEqual(500);
    const detail=(await graphApp.inject({url:'/api/git-commit/'+repo.tip,headers:{cookie}})).json();
    expect(detail.fastForwardable).toBe(true);expect(detail.mainHead).toBe(repo.base);expect(detail.behind).toBe(0);expect(detail.ahead).toBe(2);
    expect(new Set(detail.includedCommits)).toEqual(new Set([repo.first,repo.tip]));
    expect(detail.files.map((file:any)=>file.name)).toContain('file.txt');
    expect((await graphApp.inject({url:'/api/git-commit/'+encodeURIComponent('../../evil'),headers:{cookie}})).statusCode).toBe(400);
    expect((await graphApp.inject({url:'/api/git-commit/'+'f'.repeat(40),headers:{cookie}})).statusCode).toBe(404);
    // No repo: graph reports unavailable instead of crashing; release status still works.
    const empty=fs.mkdtempSync(path.join(tmpdir(),'upgrade-nogit-'));cleanups.push(()=>fs.rmSync(empty,{recursive:true,force:true}));
    expect(readGitGraph(empty).available).toBe(false);
  },30000);

  it('prepares a candidate from a pinned fast-forwardable commit and refuses diverged or invalid SHAs',async()=>{
    const repo=gitRepo();
    // A branch cut from the current main tip is still fast-forwardable until main advances.
    repo.run('checkout','-b','other');const side=repo.commit('side work','other.txt');repo.run('checkout','main');
    expect(()=>ensureFastForwardable(side,repo.directory)).not.toThrow();
    repo.commit('main advanced','main-file.txt');
    expect(()=>ensureFastForwardable(side,repo.directory)).toThrow();
    const f=await fixture(),commands:any[]=[];
    const app=await createUpgradeWeb({root:repo.directory,config:{stateDirectory:f.directory},secret:f.secret,
      runCommand:async(_root:any,args:any[],output:any)=>{commands.push(args);output('ok');},status:()=>f.data,checkRunning:f.checkRunning});
    cleanups.push(async()=>{await app.close();});
    const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    const post=(payload:unknown)=>app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload});
    expect((await post({action:'prepare',version:'Skills',reason:'V27 flow',sourceCommit:'not-a-sha'})).statusCode).toBe(400);
    const before=repo.run('show-ref','--heads');
    expect((await post({action:'prepare',version:'Earlier side',reason:'x',sourceCommit:side})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(commands).toHaveLength(1));
    await vi.waitFor(async()=>expect((await app.inject({url:'/api/upgrades',headers:{cookie}})).json().busy).toBe(false));
    expect((await post({action:'prepare',version:'Earlier tip',reason:'x',sourceCommit:repo.tip})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(commands).toHaveLength(2));expect(repo.run('show-ref','--heads')).toBe(before);
    // A fresh repo where main has not advanced accepts the pinned FF tip.
    const fresh=gitRepo(),freshCommands:any[]=[];
    const app2=await createUpgradeWeb({root:fresh.directory,config:{stateDirectory:f.directory},secret:f.secret,
      runCommand:async(_root:any,args:any[],output:any)=>{freshCommands.push(args);output('ok');},status:()=>f.data,checkRunning:f.checkRunning});
    cleanups.push(async()=>{await app2.close();});
    const login2=await app2.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie2=String(login2.headers['set-cookie']).split(';')[0];
    const post2=(payload:unknown)=>app2.inject({method:'POST',url:'/api/upgrades',headers:{cookie:cookie2},payload});
    expect((await post2({action:'prepare',version:'Skills',reason:'V27 flow',sourceCommit:fresh.tip})).statusCode).toBe(202);
    await vi.waitFor(()=>expect(freshCommands).toHaveLength(1));
    expect(freshCommands[0]).toEqual(['prepare','Skills','V27 flow','--commit',fresh.tip]);
    // HEAD-based prepare still refuses a dirty checkout; pinned prepare works from a detached worktree regardless.
    const dirtyApp=await createUpgradeWeb({root:fresh.directory,config:{stateDirectory:f.directory},secret:f.secret,
      runCommand:async()=>{},status:()=>({...f.data,dirty:true}),checkRunning:f.checkRunning});
    cleanups.push(async()=>{await dirtyApp.close();});
    const dirtyLogin=await dirtyApp.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),dirtyCookie=String(dirtyLogin.headers['set-cookie']).split(';')[0];
    expect((await dirtyApp.inject({method:'POST',url:'/api/upgrades',headers:{cookie:dirtyCookie},payload:{action:'prepare',version:'x',reason:'y'}})).statusCode).toBe(409);
    expect((await dirtyApp.inject({method:'POST',url:'/api/upgrades',headers:{cookie:dirtyCookie},payload:{action:'prepare',version:'x',reason:'y',sourceCommit:fresh.tip}})).statusCode).toBe(202);
  },30000);

  it('fast-forwards git main only when the recorded expectations still hold',()=>{
    const repo=gitRepo();
    expect(()=>fastForwardMain(repo.tip,repo.base,repo.directory)).not.toThrow();
    expect(repo.run('rev-parse','main')).toBe(repo.tip);
    // main moved past the recorded expectation: refuse without touching history.
    const moved=repo.commit('main advanced');
    repo.run('checkout','-b','late');const late=repo.commit('late work','late.txt');repo.run('checkout','main');
    const beyond=repo.commit('main moved again');
    expect(()=>fastForwardMain(late,moved,repo.directory)).toThrow('GIT_SYNC_MAIN_MOVED');
    expect(repo.run('rev-parse','main')).toBe(beyond);
    // A non-fast-forwardable target is refused and main is untouched.
    const divergedRepo=gitRepo();divergedRepo.run('checkout','-b','side');const side=divergedRepo.commit('side work','side.txt');
    divergedRepo.run('checkout','main');divergedRepo.commit('main advanced','main-file.txt');
    expect(()=>fastForwardMain(side,divergedRepo.base,divergedRepo.directory)).toThrow();
    expect(divergedRepo.run('rev-parse','main')).not.toBe(side);
  },30000);
});
