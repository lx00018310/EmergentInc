import {it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {LineageStore,CurrentStore,WorldRegistryStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {LocalWorldRuntime} from '../../../supervisor/local_world_runtime.js';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {pixelReleaseToken} from '../src/services/release_maintenance_client.js';
// @ts-ignore Standalone maintenance script.
import {createUpgradeWeb,readUpgradeStatus} from '../../../scripts/upgrade-web.mjs';
const {JSDOM}=createRequire(resolve('frontend/package.json'))('jsdom');

// Explicit opt-in: real processes, offline installs and full frozen validation. Never use live data or credentials.
it.skipIf(process.env.EMERGENTINC_TEST_UPGRADE_WEB!=='1'||process.env.EMERGENTINC_CANDIDATE_MODE==='1')('operates the actual upgrade page through preparation, publication, Pixel rollback/deletion and Owner cleanup with real isolated processes',async()=>{
  const {freezeLocalRelease,frozenReleaseHash}=await import('../../../scripts/local-release.mjs');
  const root=resolve('.'),testRoot=fs.mkdtempSync(resolve('cache/upgrade-web-process-')),workspace=join(testRoot,'workspace'),state=join(testRoot,'owner'),releases=join(testRoot,'releases'),base=join(releases,'r1');
  const secret='isolated-upgrade-web-test-secret-'.repeat(2),configFile=join(testRoot,'config.json');fs.mkdirSync(state,{recursive:true});
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,LOCALAPPDATA:process.env.LOCALAPPDATA,CI:'1',EMERGENTINC_OWNER_SECRET:secret,EMERGENTINC_SECURE_COOKIES:'0',EMERGENTINC_LOCAL_EVOLUTION_CONFIG:configFile};
  const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));
  const config={ownerProjectRoot:testRoot,workspace,stateDirectory:state,releases,activeReleaseFile:join(state,'active.json'),appUrl:`http://127.0.0.1:${port}`};fs.writeFileSync(configFile,JSON.stringify(config));
  await freezeLocalRelease(root,base);fs.writeFileSync(join(base,'apps/server/upgrade-page-rehearsal.txt'),'Isolated baseline version');const file=join(base,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.generation=1;fs.writeFileSync(file,JSON.stringify(manifest));
  const genome=readGenome(base),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});const initial=lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
  const current=new CurrentStore(join(workspace,'system/generations/G0001/current.sqlite3'));current.initialize(initial,manifest.body_interface_version);current.event('upgrade_page_test_fact',{keep:true});current.close();fs.mkdirSync(join(workspace,'system/generations/G0001/body/skills'),{recursive:true});
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,manifest.body_interface_version),world=registry.create({displayName:'Isolated test',traits:{},behaviorProfile:[]});
  fs.writeFileSync(join(workspace,'workspace-layout.json'),JSON.stringify({schema:1,version:23}));fs.writeFileSync(config.activeReleaseFile,JSON.stringify({directory:base}));
  const runtime=new LocalWorldRuntime({...config,ownerEnvironment:env});let app:any,dom:any;const evidence:any[]=[];
  const run=(_root:string,args:string[],output:(s:string)=>void)=>new Promise<void>((resolveRun,reject)=>{const child=spawn(process.execPath,[join(root,'scripts/version-upgrade.mjs'),...args],{cwd:root,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});let diagnostic='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const value=String(chunk);output(value);diagnostic=(diagnostic+value).slice(-8000);});child.once('error',reject);child.once('exit',code=>code===0?resolveRun():reject(new Error(diagnostic)));});
  try{
    await runtime.start();await runtime.healthy('G0001');await runtime.resume();
    app=await createUpgradeWeb({root,config,secret,runCommand:run});await app.listen({host:'127.0.0.1',port:0});const webUrl=app.listeningOrigin;fs.writeFileSync(resolve('cache/upgrade-web-process-live.json'),JSON.stringify({isolated:true,url:webUrl.replace('127.0.0.1','localhost'),testRoot}));
    dom=new JSDOM((await app.inject('/')).body,{url:`http://localhost:${port+1}/`,runScripts:'outside-only'});let cookie='',poll!:()=>Promise<void>;
    dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};dom.window.setInterval=(fn:()=>Promise<void>)=>{poll=fn;return 0;};
    dom.window.fetch=async(url:string,init:any={})=>{const response=await fetch(webUrl+url,{...init,headers:{...init.headers,cookie,origin:webUrl}});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0];return response;};
    await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent}})()`);const doc=dom.window.document;
    doc.getElementById('secret').value=secret;doc.getElementById('login-form').requestSubmit();await vi.waitFor(()=>expect(doc.getElementById('prepare').disabled).toBe(false));
    const done=async(action:string)=>{const deadline=Date.now()+360000;for(;;){const data=(await app.inject({url:'/api/upgrades',headers:{cookie}})).json();if(data.job?.action===action&&data.job?.state==='failed')throw new Error(data.job.error+'\n'+data.job.log);if(data.job?.action===action&&data.job?.state==='succeeded')break;if(Date.now()>deadline)throw new Error('TEST_OPERATION_TIMEOUT:'+action);await new Promise(r=>setTimeout(r,1000));}await poll();const data=readUpgradeStatus(root,config);evidence.push({action,active:data.active.id,candidates:data.candidates.map((c:any)=>({id:c.id,state:c.state}))});};
    const prepare=async(label:string)=>{doc.getElementById('version').value=label;doc.getElementById('reason').value='Isolated end-to-end rehearsal / 隔离端到端验证';doc.getElementById('prepare-form').requestSubmit();await done('prepare');const row=readUpgradeStatus(root,config).candidates.find((c:any)=>c.request.owner_release.label===label);expect(row.state).toBe('VALIDATED');return row;};
    const publish=async(id:string)=>{const card=[...doc.querySelectorAll('#candidates article')].find((n:any)=>n.textContent.includes(id)) as any;const check=card.querySelector('input');expect(card.querySelector('button').disabled).toBe(true);check.click();expect(card.querySelector('button').disabled).toBe(false);card.querySelector('button').click();await done('publish');};
    const r2=await prepare('UI rehearsal 2 / 页面演练 2');await publish(r2.id);await runtime.checkRunning('G0002');
    const r3id='rehearsal-r3',r3dir=join(releases,r3id);await freezeLocalRelease(root,r3dir);fs.writeFileSync(join(r3dir,'apps/server/upgrade-page-rehearsal.txt'),'Isolated next version');const r3manifest=JSON.parse(fs.readFileSync(join(r3dir,'genome/manifest.json'),'utf8'));r3manifest.generation=3;fs.writeFileSync(join(r3dir,'genome/manifest.json'),JSON.stringify(r3manifest));
    const proposal=lineage.proposeGene('G0002','owner',{point:'Prepare third fixture',reason:'Isolated UI validation retry',effect:'Exercise the validation button'});lineage.decideProposal(proposal.id,'APPROVED');
    const supervisor=new GenerationSupervisor(state,join(workspace,'system'),releases,lineage,runtime,true);try{supervisor.submitOwnerRelease({id:r3id,base_generation:'G0002',base_release:r2.id,proposal_id:proposal.id,patch:[],owner_release:{label:'UI rehearsal 3 / 页面演练 3',reason:'Isolated validation retry',source_commit:'a'.repeat(40),release_hash:frozenReleaseHash(r3dir)}});}finally{supervisor.close();}
    await poll();doc.getElementById('en').click();const retry=[...doc.querySelectorAll('#candidates article')].find((n:any)=>n.textContent.includes(r3id)) as any;retry.querySelector('button').click();await done('validate');const r3=readUpgradeStatus(root,config).candidates.find((c:any)=>c.id===r3id);await publish(r3.id);await runtime.checkRunning('G0003');
    const headers={authorization:`Bearer ${pixelReleaseToken(secret)}`},actor={worldId:world.world_id,pixelId:'0_0_0'};
    const rollback={...actor,operationKey:'test-rollback',targetGeneration:'G0002',expectedActive:'G0003',reason:'Pixel direct rollback'};
    expect((await app.inject({method:'POST',url:'/pixel/releases/rollback',headers,payload:rollback})).statusCode).toBe(202);await done('rollback');await runtime.checkRunning('G0002');
    const newer=readUpgradeStatus(root,config).versions.find((v:any)=>v.id==='G0003');expect(newer.canDelete).toBe(true);
    const deletion={...actor,operationKey:'test-delete',releaseId:r3.id,expectedActive:'G0002',identity:newer.identity,reason:'Pixel direct deletion'};
    expect((await app.inject({method:'POST',url:'/pixel/releases/delete',headers,payload:deletion})).statusCode).toBe(202);await done('delete');expect(fs.existsSync(join(releases,r3.id))).toBe(false);
    doc.getElementById('zh').click();const target=[...doc.querySelectorAll('#history article')].find((n:any)=>n.textContent.includes('G0001')) as any;target.querySelector('button').click();doc.getElementById('maintenance-reason').value='Owner rollback with cleanup';doc.getElementById('delete-newer').checked=true;doc.getElementById('maintenance-form').requestSubmit();await done('rollback');await runtime.checkRunning('G0001');expect(fs.existsSync(join(releases,r2.id))).toBe(false);
    expect(fs.existsSync(join(state,'snapshots',r2.id,'current-before.sqlite3'))).toBe(true);expect(fs.existsSync(join(state,'frozen',`G0003-${r3.id}`,'current.sqlite3'))).toBe(true);expect(lineage.generations()).toHaveLength(3);
    const facts=new DatabaseSync(join(workspace,'system/generations/G0001/current.sqlite3'),{readOnly:true});expect(facts.prepare("SELECT * FROM current_events WHERE kind='upgrade_page_test_fact'").all()).toHaveLength(1);facts.close();
    const audit=new DatabaseSync(join(state,'evolution.sqlite3'),{readOnly:true});expect(audit.prepare("SELECT * FROM candidates WHERE state='DELETED' AND approval_hash IS NOT NULL").all()).toHaveLength(2);audit.close();
    expect((await app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload:{action:'recover'}})).statusCode).toBe(202);await done('recover');doc.getElementById('logout').click();await vi.waitFor(()=>expect(doc.getElementById('login').hidden).toBe(false));
    fs.writeFileSync(resolve('cache/upgrade-web-process-evidence.json'),JSON.stringify({passed:true,realProcesses:true,fullFrozenValidation:true,operations:evidence,dataRetained:true},null,2));
  }catch(error){fs.writeFileSync(resolve('cache/upgrade-web-process-failure.log'),String(error)+'\n'+(fs.existsSync(join(state,'server.log'))?fs.readFileSync(join(state,'server.log'),'utf8').slice(-8000):''));throw error;}
  finally{dom?.window.close();await app?.close();await new LocalWorldRuntime({...config,ownerEnvironment:env}).stop();control.close();lineage.close();const target=relative(resolve('cache'),testRoot);if(!target||target==='..'||target.startsWith('..'+sep))throw new Error('TEST_CLEANUP_PATH_INVALID');fs.rmSync(testRoot,{recursive:true,force:true});}
},900000);
