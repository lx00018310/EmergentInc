import {afterEach,expect,it,vi} from 'vitest';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createServer} from 'node:http';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {WorldRegistryStore,SqliteDatabase} from '@emergentinc/persistence';
import {initializeBossWorkspace} from '../src/boss_workspace.js';
import {CompanyAgentService} from '../src/services/company_agent_service.js';
import {listenTestHttp,reserveTestHttpPort} from '../../../tests/http_port.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
it('boots the actual company controller, executes without Worlds, and retains OFF plus verified artifacts across an OS process restart',async()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'company-bootstrap-'));cleanups.push(async()=>fs.rmSync(root,{recursive:true,force:true}));initializeBossWorkspace(resolve('.'),root);
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3'));try{new CompanyAgentService(control,root).create({id:'bootstrap-worker',name:'Research',role:'research',instruction:'Retain actual internal evidence'});}finally{control.close();}
  let calls=0;const model=createServer((req,res)=>{req.resume();req.on('end',()=>{calls++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual artifact from the production bootstrap and an independent worker process.'}}],owner_reply:'Actual startup result retained',send_to:'STOP'})}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30,prompt_tokens_details:{cached_tokens:0}}}));});});const modelPort=await listenTestHttp(model);cleanups.push(async()=>{model.closeAllConnections();await new Promise<void>(r=>model.close(()=>r()));});
  const port=await reserveTestHttpPort(),secret='explicit-synthetic-company-owner-secret',base=`http://127.0.0.1:${port}`;let cookie='';
  async function start(){
    const child=fork(resolve('apps/server/tests/fixtures/company_bootstrap_child.ts'),[],{cwd:resolve('.'),execArgv:['--import','tsx'],windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:process.env.TEMP,TMP:process.env.TMP,EMERGENTINC_WORKSPACE_ROOT:root,EMERGENTINC_OWNER_SECRET:secret,EMERGENTINC_SECURE_COOKIES:'0',EMERGENTINC_CANDIDATE_MODE:'0',HOST:'127.0.0.1',PORT:String(port),MCL_API_KEY:'explicit-fake-bootstrap-model-key',MCL_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,MCL_MODEL:'gpt-4o-mini'},stdio:['ignore','pipe','pipe','ipc']});let output='';child.stdout?.on('data',d=>output+=String(d));child.stderr?.on('data',d=>output+=String(d));const exited=once(child,'exit');cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');}await exited;});
    await vi.waitFor(async()=>{if(child.exitCode!==null)throw new Error(output);const live=await (await fetch(base+'/health/live')).json() as any;expect(live.processId,'A different process answered the reserved test port').toBe(child.pid);const health=await fetch(base+'/health/ready');expect(health.status,(await health.text())+'\n'+output).toBe(200);},{timeout:15000,interval:50});
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret})});expect(login.status).toBe(200);cookie=login.headers.get('set-cookie')!.split(';')[0];return {child,exited};
  }
  async function request(route:string,body?:unknown,method=body?'POST':'GET'){const response=await fetch(base+'/api/'+route,{method,headers:{cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();expect(response.status,JSON.stringify(value)).toBe(200);return value;}
  const first=await start(),page=await fetch(base+'/BOSS');expect(page.status,await page.text()).toBe(200);
  await request('owner/budget',{tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:0,idempotencyKey:'bootstrap-budget'});await request('owner/automation',{desiredMode:'ON',expectedRevision:0,idempotencyKey:'bootstrap-on'});
  const goal=await request('owner/goals',{title:'Retain an actual draft',objective:'Produce a real retained artifact for inspection',acceptance:{kind:'artifact',filename:'result.md',minBytes:10},idempotencyKey:'bootstrap-goal'});
  await vi.waitFor(async()=>expect((await request('owner/goals/'+goal.id)).goal.status).toBe('WAITING_APPROVAL'),{timeout:15000,interval:100});const data=await request('boss/company');expect(data.people).toHaveLength(1);expect(data.work.tasks[0].attempt).toMatchObject({state:'COMPLETED',accountingState:'SETTLED'});expect(calls).toBe(1);
  const automation=await request('owner/automation');await request('owner/automation',{desiredMode:'OFF',expectedRevision:automation.revision,idempotencyKey:'bootstrap-off'});first.child.send('shutdown');await first.exited;
  await start();expect((await request('owner/automation')).desiredMode).toBe('OFF');const detail=await request('owner/goals/'+goal.id),artifact=detail.evidence.find((e:any)=>e.kind==='artifact');const download=await fetch(base+`/api/owner/goals/${goal.id}/evidence/${encodeURIComponent(artifact.id)}`,{headers:{cookie}});expect(download.status).toBe(200);expect(await download.text()).toContain('production bootstrap');expect(calls).toBe(1);
  const db=new SqliteDatabase(join(root,'system/control/control.sqlite3'),{readOnly:true});try{expect(db.prepare('SELECT COUNT(*) n FROM qianji_worlds').get()!.n).toBe(0);expect(db.prepare('SELECT state FROM company_control_migrations WHERE version=1').get()!.state).toBe('COMPLETE');}finally{db.close();}
},40000);
