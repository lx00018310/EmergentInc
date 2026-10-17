import {describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {cleanups,fixture} from './fixtures/upgrade_web.js';
import {DatabaseSync} from 'node:sqlite';
import {pixelReleaseToken} from '../src/services/release_maintenance_client.js';
// @ts-ignore Standalone maintenance script.
import {createUpgradeWeb,readUpgradeStatus} from '../../../scripts/upgrade-web.mjs';
// @ts-ignore Standalone maintenance script.
import {ownerReleaseInput} from '../../../scripts/version-upgrade.mjs';

describe("V32 single version switch flow",()=>{
  it('denies delegated release mutation and retains only read-only release metadata',async()=>{
    const f=await fixture(),headers={authorization:`Bearer ${pixelReleaseToken(f.secret)}`};
    expect((await f.app.inject({url:'/pixel/releases',headers})).statusCode).toBe(200);
    for(const action of ['rollback','delete'])expect((await f.app.inject({method:'POST',url:'/pixel/releases/'+action,headers,payload:{}})).statusCode).toBe(403);
    expect(f.run).not.toHaveBeenCalled();
  });
});

describe("Owner web upgrade",()=>{
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
      fs.mkdirSync(path.join(dir,'../resources/config'),{recursive:true});fs.writeFileSync(path.join(dir,'../resources/config/company_protocol.json'),JSON.stringify({workspace_format:34}));
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
