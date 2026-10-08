import {afterEach,describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {LineageStore,CurrentStore,writeGenerationPointer} from '@emergentinc/persistence';
// @ts-ignore Standalone Owner launcher.
import {applicationUrl,browserCommand,waitForWebReady} from '../../../scripts/launch-approved.mjs';
// @ts-ignore Standalone Owner release helper.
import {freezeLocalRelease} from '../../../scripts/local-release.mjs';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function fixture(){
  const root=fs.mkdtempSync(join(tmpdir(),'launcher-ready-')),project=join(root,'project'),workspace=join(root,'workspace');
  for(const dir of ['genome','apps/server/dist','packages/persistence/dist','frontend/dist'])fs.mkdirSync(join(project,dir),{recursive:true});
  const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));
  vi.stubEnv('EMERGENTINC_WORKSPACE_ROOT',workspace);vi.stubEnv('PORT',String(port));vi.stubEnv('HOST','127.0.0.1');
  for(const key of ['EMERGENTINC_LOCAL_EVOLUTION_CONFIG','EMERGENTINC_ACTIVE_GENERATION_FILE','EMERGENTINC_CANDIDATE_MODE','EMERGENTINC_LOCAL_UPGRADE_TOKEN'])vi.stubEnv(key,'');
  const geneHash='1'.repeat(64),pidFile=join(root,'fixture-pid.json');vi.stubEnv('FIXTURE_PID_FILE',pidFile);
  fs.writeFileSync(join(project,'package.json'),'{"type":"module"}');fs.writeFileSync(join(project,'genome/manifest.json'),'{}');fs.writeFileSync(join(project,'frontend/dist/index.html'),'<html>ready</html>');
  fs.writeFileSync(join(project,'packages/persistence/dist/index.js'),`export function readGenome(){return {geneHash:'${geneHash}'}}`);
  fs.writeFileSync(join(project,'apps/server/dist/main.js'),`
    import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';
    writeFileSync(process.env.FIXTURE_PID_FILE,JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));
    if(process.argv.includes('--exit-before-ready'))process.exit(7);
    const began=Date.now();let readyChecks=0,homeChecks=0;
    const server=createServer((req,res)=>{
      res.setHeader('Content-Type','application/json');
      if(req.url==='/health/live')res.end(JSON.stringify({alive:true,processId:process.pid}));
      else if(req.url==='/health/ready'){readyChecks++;const ready=Date.now()-began>=200;res.statusCode=ready?200:503;res.end(JSON.stringify({ready,generation:'G0001'}));}
      else if(req.url==='/'){homeChecks++;res.statusCode=Date.now()-began>=700?200:503;res.setHeader('Content-Type','text/html');res.end('<html>Actual homepage</html>');}
      else if(req.url==='/stop'){res.setHeader('Connection','close');res.end('{}');server.close(()=>process.exit(0));}
      else res.end(JSON.stringify({readyChecks,homeChecks}));
    });server.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
  `);
  const id='local-launcher-test',recordDirectory=join(workspace,'runtime/local-upgrades',id),release=await freezeLocalRelease(project,join(recordDirectory,'release'),async()=>{});
  const lineage=new LineageStore(join(workspace,'lineage/lineage.sqlite3')),generation=lineage.createGeneration({id:'G0001',number:1,geneHash,releaseId:id,state:'ACTIVE'});
  const current=new CurrentStore(join(workspace,'generations/G0001/current.sqlite3'));current.initialize(generation,'1');current.close();lineage.close();writeGenerationPointer(workspace,'G0001');
  const candidate={id,scope:'windows_owner_initialization',workspace,projectRoot:project,target:'G0001',geneHash,release},hash=createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
  fs.writeFileSync(join(recordDirectory,'record.json'),JSON.stringify({candidate,candidateHash:hash,state:'COMMITTED',ownerAuthorization:{candidateHash:hash}}));
  cleanups.push(async()=>{if(fs.existsSync(pidFile)){const pid=JSON.parse(fs.readFileSync(pidFile,'utf8')).pid;try{process.kill(pid);}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}}
    const target=fs.realpathSync(root);if(relative(tmpdir(),target).startsWith('..'))throw new Error('Unsafe fixture cleanup');fs.rmSync(target,{recursive:true,force:true});});
  return {root,project,pidFile,port};
}
function startLauncher(f:Awaited<ReturnType<typeof fixture>>,args:string[],timeout=5000,browserFails=false){
  const record=join(f.root,'opened.json'),error=join(f.root,'error.txt'),file=join(f.root,'runner.mjs');
  // Native Node resolves the frozen release's file URLs; Vite does not load modules outside its root.
  fs.writeFileSync(file,`
    import {launchApproved} from ${JSON.stringify(pathToFileURL(resolve('scripts/launch-approved.mjs')).href)};
    import {writeFileSync} from 'node:fs';
    try{process.exitCode=await launchApproved(${JSON.stringify(f.project)},${JSON.stringify(args)},{startupTimeoutMs:${timeout},openPage:async(url)=>{
      const live=await(await fetch(url+'health/live')).json(),ready=await(await fetch(url+'health/ready')).json(),home=await fetch(url);
      writeFileSync(${JSON.stringify(record)},JSON.stringify({url,live,ready,status:home.status,body:await home.text()}));
      if(${browserFails})throw new Error('Browser unavailable');
    }});}catch(e){writeFileSync(${JSON.stringify(error)},e.message);process.exitCode=1;}
  `);
  const runner=spawn(process.execPath,[file],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let diagnostics='';runner.stdout.on('data',d=>diagnostics+=d);runner.stderr.on('data',d=>diagnostics+=d);
  const finished=new Promise<number|null>((done,reject)=>{runner.once('error',reject);runner.once('exit',done);});
  cleanups.push(async()=>{if(fs.existsSync(f.pidFile)){const pid=JSON.parse(fs.readFileSync(f.pidFile,'utf8')).pid;try{process.kill(pid);}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;}}
    if(runner.exitCode===null&&runner.signalCode===null)runner.kill();await finished;});
  return {record,error,finished,diagnostics:()=>diagnostics};
}
describe('approved UI launcher readiness',()=>{
  it('opens only after the spawned process, approved generation and actual homepage are ready',async()=>{
    const f=await fixture(),run=startLauncher(f,['--open-browser','--mock']);await vi.waitFor(()=>expect(fs.existsSync(run.record),run.diagnostics()).toBe(true),{timeout:4000});
    const opened=JSON.parse(fs.readFileSync(run.record,'utf8')),owned=JSON.parse(fs.readFileSync(f.pidFile,'utf8'));
    expect(opened.url).toBe(`http://127.0.0.1:${f.port}/`);expect(opened.live.processId).toBe(owned.pid);expect(opened.ready).toMatchObject({ready:true,generation:'G0001'});expect(opened.status).toBe(200);expect(opened.body).toContain('Actual homepage');expect(owned.args).toEqual(['--mock']);
    await fetch(opened.url+'stop');expect(await run.finished).toBe(0);
  });
  it('does not open a page when the process fails before becoming ready',async()=>{
    const f=await fixture(),run=startLauncher(f,['--open-browser','--exit-before-ready']);expect(await run.finished).toBe(1);expect(fs.readFileSync(run.error,'utf8')).toContain('EXITED_BEFORE_READY');expect(fs.existsSync(run.record)).toBe(false);
  });
  it('does not open a page or leave a new server behind when startup times out',async()=>{
    const f=await fixture(),run=startLauncher(f,['--open-browser'],300);expect(await run.finished).toBe(1);expect(fs.readFileSync(run.error,'utf8')).toContain('READY_TIMEOUT');expect(fs.existsSync(run.record)).toBe(false);
    const pid=JSON.parse(fs.readFileSync(f.pidFile,'utf8')).pid;expect(()=>process.kill(pid,0)).toThrow();
  });
  it('keeps the service foreground when opening the browser fails',async()=>{
    const f=await fixture(),run=startLauncher(f,['--open-browser'],5000,true);await vi.waitFor(()=>expect(fs.existsSync(run.record),run.diagnostics()).toBe(true),{timeout:4000});
    const pid=JSON.parse(fs.readFileSync(f.pidFile,'utf8')).pid;expect(()=>process.kill(pid,0)).not.toThrow();await fetch(`http://127.0.0.1:${f.port}/stop`);expect(await run.finished).toBe(0);
  });
  it('uses the configured port and handles Linux desktop and headless sessions explicitly',()=>{
    expect(applicationUrl({PORT:'9000',HOST:'0.0.0.0'})).toBe('http://127.0.0.1:9000/');expect(applicationUrl({HOST:'::1'})).toBe('http://[::1]:8765/');
    expect(()=>applicationUrl({PORT:'0'})).toThrow('PORT_INVALID');expect(()=>applicationUrl({HOST:'user@localhost'})).toThrow('HOST_INVALID');
    expect(browserCommand('http://127.0.0.1:8765/','linux',{DISPLAY:':0'})).toEqual(['xdg-open',['http://127.0.0.1:8765/']]);expect(browserCommand('http://127.0.0.1:8765/','linux',{})).toBeNull();
  });
  it('refuses to open an unrelated listening process or an unexpected generation',async()=>{
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response(JSON.stringify({alive:true,processId:999})));
    await expect(waitForWebReady('http://127.0.0.1:8765/',42,'G0001')).rejects.toThrow('PROCESS_IDENTITY_CONFLICT');
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({alive:true,processId:42}))).mockResolvedValueOnce(new Response(JSON.stringify({ready:true,generation:'G0002'})));
    await expect(waitForWebReady('http://127.0.0.1:8765/',42,'G0001')).rejects.toThrow('GENERATION_CONFLICT');
  });
});

const gitBash='C:/Program Files/Git/bin/bash.exe';
describe.runIf(process.platform==='win32'&&fs.existsSync(gitBash))('Linux shell launcher under Git Bash (no deployment)',()=>{
  it.each([0,2,1])('forwards args, builds only for an empty workspace and stops on invalid approval (check=%s)',async(status)=>{
    const root=fs.mkdtempSync(join(tmpdir(),'launcher-shell-')),project=join(root,'project with spaces'),bin=join(root,'bin'),log=join(root,'events');fs.mkdirSync(project);fs.mkdirSync(bin);fs.copyFileSync(resolve('EmergentInc_UI.sh'),join(project,'EmergentInc_UI.sh'));
    fs.writeFileSync(join(bin,'node'),`#!/usr/bin/env bash\nprintf '%s\\0' node "$@" END >> "$LAUNCHER_LOG"\nif [ "\${2:-}" = --check ]; then exit ${status}; fi\nexit 0\n`);
    fs.writeFileSync(join(bin,'npm'),`#!/usr/bin/env bash\nprintf '%s\\0' npm "$@" END >> "$LAUNCHER_LOG"\nexit 0\n`);
    try{
      let exit=0;try{execFileSync(gitBash,['--noprofile','--norc','-c','export PATH="$(cygpath -u "$1"):$PATH"; export LAUNCHER_LOG="$(cygpath -u "$2")"; bash "$(cygpath -u "$3")" --mock "argument with spaces"','test',bin,log,join(project,'EmergentInc_UI.sh')],{windowsHide:true,stdio:'pipe'});}catch(e){exit=(e as any).status;}
      const events=fs.readFileSync(log,'utf8').split('\0').filter(Boolean);expect(exit).toBe(status===1?1:0);expect(events.includes('npm')).toBe(status===2);
      if(status!==1)expect(events.slice(-6)).toEqual(['node','scripts/launch-approved.mjs','--open-browser','--mock','argument with spaces','END']);else expect(events).not.toContain('--open-browser');
    }finally{const target=fs.realpathSync(root);if(relative(tmpdir(),target).startsWith('..'))throw new Error('Unsafe fixture cleanup');fs.rmSync(target,{recursive:true,force:true});}
  });
});
