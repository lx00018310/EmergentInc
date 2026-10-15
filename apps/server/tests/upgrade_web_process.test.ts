import {it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {reserveTestHttpPort} from '../../../tests/http_port.js';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {LineageStore,CurrentStore,WorldRegistryStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {LocalWorldRuntime} from '../../../supervisor/local_world_runtime.js';
// @ts-ignore Standalone maintenance script.
import {createUpgradeWeb,readUpgradeStatus} from '../../../scripts/upgrade-web.mjs';
const {JSDOM}=createRequire(resolve('frontend/package.json'))('jsdom');

/** Real isolated Git commits, real processes and full frozen validation; no model or live data. */
it.skipIf(process.env.EMERGENTINC_TEST_UPGRADE_WEB!=='1'||process.env.EMERGENTINC_CANDIDATE_MODE==='1')('merges B and appends A and B restore commits through one-click publication, retaining data and paused intent',async()=>{
  const {freezeLocalRelease,frozenReleaseHash}=await import('../../../scripts/local-release.mjs');
  const testRoot=fs.mkdtempSync(resolve('cache/v32-switch-')),project=join(testRoot,'project'),workspace=join(testRoot,'workspace'),state=join(testRoot,'owner'),releases=join(testRoot,'releases'),base=join(releases,'r1');
  const secret='isolated-v32-switch-secret-'.repeat(3),configFile=join(testRoot,'config.json');fs.mkdirSync(state,{recursive:true});
  await freezeLocalRelease(resolve('.'),project);
  fs.writeFileSync(join(project,'.gitignore'),'node_modules/\n**/dist/\n*.tsbuildinfo\n.env\n');
  const git=(...args:string[])=>execFileSync('git',args,{cwd:project,encoding:'utf8',windowsHide:true}).trim();
  const commit=(label:string)=>{git('add','-A');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m',label);return git('rev-parse','HEAD');};
  git('init','-b','main');fs.writeFileSync(join(project,'apps/server/rehearsal-version.txt'),'A');const a=commit('Isolated compatible source A');
  git('checkout','-b','develop');fs.writeFileSync(join(project,'apps/server/rehearsal-version.txt'),'B');const b=commit('Isolated compatible source B');git('checkout','main');
  await freezeLocalRelease(project,base);git('checkout','develop');const branches=git('show-ref','--heads');
  const manifestFile=join(base,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.generation=1;fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  const genome=readGenome(base),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true}),initial=lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
  const current=new CurrentStore(join(workspace,'system/generations/G0001/current.sqlite3'));current.initialize(initial,manifest.body_interface_version);current.event('v32_retained_fact',{keep:true});current.close();fs.mkdirSync(join(workspace,'system/generations/G0001/body/skills'),{recursive:true});
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,manifest.body_interface_version);registry.create({displayName:'Executor without secretary',traits:{},behaviorProfile:[]});fs.writeFileSync(join(workspace,'workspace-layout.json'),JSON.stringify({schema:1,version:23}));
  const config={ownerProjectRoot:project,workspace,stateDirectory:state,releases,activeReleaseFile:join(state,'active.json'),appUrl:`http://127.0.0.1:${await reserveTestHttpPort()}`};fs.writeFileSync(configFile,JSON.stringify(config));fs.writeFileSync(config.activeReleaseFile,JSON.stringify({directory:base}));
  const candidate={id:'r1',workspace,target:'G0001',geneHash:genome.geneHash,release:{directory:base,hash:frozenReleaseHash(base)}},candidateHash=createHash('sha256').update(JSON.stringify(candidate)).digest('hex');fs.writeFileSync(join(state,'initial-v23.json'),JSON.stringify({state:'COMMITTED',candidate,candidateHash,ownerAuthorization:{candidateHash,channel:'isolated_test'}}));
  const env={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,LOCALAPPDATA:process.env.LOCALAPPDATA,CI:'1',EMERGENTINC_OWNER_SECRET:secret,EMERGENTINC_SECURE_COOKIES:'0',EMERGENTINC_LOCAL_EVOLUTION_CONFIG:configFile,EMERGENTINC_START_PAUSED:'1'};
  const runtime=new LocalWorldRuntime({...config,ownerEnvironment:env});let app:any,dom:any,completed=false;const operations:any[]=[];
  const run=(_root:string,args:string[],output:(s:string)=>void)=>new Promise<void>((accept,reject)=>{const child=spawn(process.execPath,[join(project,'scripts/version-upgrade.mjs'),...args],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let last='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const s=String(chunk);output(s);last=(last+s).slice(-10000);});child.once('error',reject);child.once('exit',code=>code===0?accept():reject(new Error(last)));});
  try{
    await runtime.start();await runtime.healthy('G0001');app=await createUpgradeWeb({root:project,config,secret,runCommand:run});
    dom=new JSDOM((await app.inject('/')).body,{url:'http://127.0.0.1:8766/',runScripts:'outside-only'});let cookie='',poll!:()=>Promise<void>;
    dom.window.setInterval=(fn:()=>Promise<void>)=>{poll=fn;return 0;};dom.window.fetch=async(url:string,init:any={})=>{const r=await app.inject({method:init.method??'GET',url,headers:{cookie},...(init.body?{payload:JSON.parse(init.body)}:{})});if(r.headers['set-cookie'])cookie=String(r.headers['set-cookie']).split(';')[0];return {ok:r.statusCode<400,status:r.statusCode,json:async()=>r.json()};};
    await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent}})()`);const doc=dom.window.document;doc.getElementById('secret').value=secret;doc.getElementById('login-form').requestSubmit();await vi.waitFor(()=>expect(doc.getElementById('content').hidden).toBe(false));
    const done=async(action:string)=>{for(const deadline=Date.now()+900000;;){const data=(await app.inject({url:'/api/upgrades',headers:{cookie}})).json();if(data.job?.action===action&&data.job.state==='failed')throw new Error(data.job.error+'\n'+data.job.log);if(data.job?.action===action&&data.job.state==='succeeded')return data;if(Date.now()>deadline)throw new Error('TEST_OPERATION_TIMEOUT');await new Promise(r=>setTimeout(r,1000));}};
    for(let index=0;index<3;index++){
      const sha=index===0?b:index===1?a:operations[0].sourceCommit;
      await poll();doc.querySelector('button[data-sha="'+sha+'"]').click();await vi.waitFor(()=>expect(doc.getElementById('switch').disabled).toBe(false));
      expect((await app.inject({url:'/api/upgrades',headers:{cookie}})).json().busy).toBe(false);
      doc.getElementById('switch').click();await vi.waitFor(async()=>expect((await app.inject({url:'/api/upgrades',headers:{cookie}})).json().job?.state).toBe('running'),{timeout:15000});await done('switch');await poll();
      const generation='G'+String(index+2).padStart(4,'0');await runtime.checkRunning(generation);const status=readUpgradeStatus(project,config),selected=status.candidates.find((c:any)=>c.id===status.active.release_id),sourceCommit=selected.request.owner_release.source_commit;
      expect(git('rev-parse','main')).toBe(sourceCommit);expect(git('branch','--show-current')).toBe('main');expect(git('rev-parse',sourceCommit+'^{tree}')).toBe(git('rev-parse',sha+'^{tree}'));
      expect(git('merge-base','--is-ancestor',index===0?a:operations[index-1].sourceCommit,sourceCommit)).toBe('');
      const auth=await fetch(config.appUrl+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret})}),appCookie=auth.headers.get('set-cookie')!.split(';')[0];const mode=await (await fetch(config.appUrl+'/api/owner/automation',{headers:{cookie:appCookie}})).json() as any;expect(mode.desiredMode).toBe('OFF');expect(mode.reason).toBe('EVOLUTION_QUIESCED');expect(mode.budget.activatedAt).toBeNull();
      expect(control.db.prepare('SELECT COUNT(*) n FROM qianji_worlds').get()!.n).toBe(1);const facts=new DatabaseSync(join(workspace,'system/generations/G0001/current.sqlite3'),{readOnly:true});expect(facts.prepare("SELECT COUNT(*) n FROM current_events WHERE kind='v32_retained_fact'").get()!.n).toBe(1);facts.close();
      operations.push({generation,selectedCommit:sha,sourceCommit,candidateId:selected.id,candidateHash:selected.candidate.candidate_hash});
    }
    fs.writeFileSync(resolve('cache/v32-validation/switch-process-evidence.json'),JSON.stringify({passed:true,realProcesses:true,fullFrozenValidation:true,operations,mainSynced:true,historyRetained:true,dataRetained:true,paused:true},null,2));completed=true;
  }catch(error){fs.writeFileSync(resolve('cache/v32-validation/switch-process-failure.log'),String(error)+'\n'+(fs.existsSync(join(state,'server.log'))?fs.readFileSync(join(state,'server.log'),'utf8').slice(-12000):''));throw error;}
  finally{dom?.window.close();await app?.close();await runtime.stop();control.close();lineage.close();const r=relative(resolve('cache'),testRoot);if(!r||r==='..'||r.startsWith('..'+sep))throw new Error('TEST_CLEANUP_PATH_INVALID');if(completed)await fs.promises.rm(testRoot,{recursive:true,force:true,maxRetries:100,retryDelay:100});}
},2400000);
