import {afterAll,afterEach,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
// @ts-ignore Standalone maintenance script.
import {createUpgradeWeb} from '../../../../scripts/upgrade-web.mjs';
const {JSDOM}=createRequire(path.resolve('frontend/package.json'))('jsdom');
export const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function removeFixture(directory:string){
  const relative=path.relative(fs.realpathSync(tmpdir()),fs.realpathSync(directory));
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('TEST_CLEANUP_PATH_INVALID');
  fs.rmSync(directory,{recursive:true,force:true});
}
export async function fixture(root=path.resolve('.')) {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'upgrade-web-'));
  const secret = 'test-upgrade-owner-secret'.repeat(3);
  const run = vi.fn(async (_root: string, _args: string[], output: (text: string) => void) => { output('checked'); });
  const checkRunning = vi.fn(async (_generation: string) => {});
  const data:any = { active: { id: 'G0008' }, versions:[{id:'G0007',generation_no:7,release_id:'old',label:'Previous version',available:true,canRollback:true}],afterRollback:false,dirty: false, appUrl: 'http://127.0.0.1:8765', candidates: [{ id: 'local-v24-test', state: 'VALIDATED',identity:'a'.repeat(64),canDelete:false,
    candidate: { candidate_hash: 'a'.repeat(64), base_generation: 'G0008' }, request: { base_generation:'G0008', owner_release: { reason: 'Fix run state' } } }] };
  const app = await createUpgradeWeb({ root, config: { stateDirectory: directory }, secret, runCommand: run, status: () => data, checkRunning });
  cleanups.push(async () => { await app.close(); removeFixture(directory); });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { secret } });
  const cookie = String(login.headers['set-cookie']).split(';')[0];
  const request = (payload: unknown) => app.inject({ method: 'POST', url: '/api/upgrades', headers: { cookie }, payload });
  return { app, data, directory, run, request, cookie, checkRunning,secret };
}

export async function page(f:Awaited<ReturnType<typeof fixture>>,lang='zh-CN',query='',responses:Record<string,any>={}) {
  const dom=new JSDOM(fs.readFileSync(path.resolve('resources/upgrade-web.html'),'utf8'),{url:'http://127.0.0.1:8766/'+query,runScripts:'outside-only'});
  cleanups.push(async()=>{await vi.waitFor(()=>expect(dom.window.upgradeTestIdle?.()).toBe(true));dom.window.close();});let poll!:()=>Promise<void>,browserCookie=f.cookie;
  dom.window.localStorage.setItem('emergentinc.language',lang);
  dom.window.setInterval=vi.fn((callback:()=>Promise<void>)=>{poll=callback;return 0;});
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  dom.window.fetch=vi.fn(async(url:string,init:any={})=>{if(!init.method&&url in responses)return {ok:true,status:200,json:async()=>responses[url]};const response=await f.app.inject({method:init.method??'GET',url,headers:{cookie:browserCookie},...(init.body?{payload:JSON.parse(init.body)}:{})});if(response.headers['set-cookie'])browserCookie=String(response.headers['set-cookie']).split(';')[0];return {ok:response.statusCode<400,status:response.statusCode,json:async()=>response.json()};});
  await dom.window.eval(`(async()=>{${dom.window.document.querySelector('script').textContent};let selections=0;const select=selectCommit;selectCommit=async(...args)=>{selections++;try{return await select(...args);}finally{selections--;}};window.upgradeTestIdle=()=>!refreshing&&!sending&&!selections;})()`);
  return {dom,doc:dom.window.document,poll:async()=>{await poll();await vi.waitFor(()=>expect(dom.window.upgradeTestIdle()).toBe(true),{timeout:5000});}};
}

function repoCommands(directory:string){
  const run=(...args:string[])=>execFileSync('git',args,{cwd:directory,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim();
  const commit=(message:string,file='file.txt')=>{fs.writeFileSync(path.join(directory,file),message);run('add',file);run('-c','user.name=Tester','-c','user.email=t@example.com','commit','-m',message);return run('rev-parse','HEAD');};
  const commitMany=(messages:string[])=>{
    const ref=run('symbolic-ref','HEAD'),parent=run('rev-parse','HEAD'),time=Math.floor(Date.now()/1000);
    const input=messages.map((message,index)=>[
      'commit '+ref,'committer Tester <t@example.com> '+(time+index)+' +0000',
      'data '+Buffer.byteLength(message),message,...(index===0?['from '+parent]:[]),
      'M 100644 inline file.txt','data '+Buffer.byteLength(message),message,''
    ].join('\n')).join('\n')+'\ndone\n';
    execFileSync('git',['fast-import','--quiet','--done'],{cwd:directory,input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']});
    // Only the disposable fixture checkout is reset to the imported history.
    run('reset','--hard','HEAD');
  };
  return {directory,run,commit,commitMany};
}
let template:{directory:string;base:string;first:string;tip:string}|undefined;
afterAll(()=>{if(template)removeFixture(template.directory);});
export function gitRepo(){
  if(!template){
    const original=repoCommands(fs.mkdtempSync(path.join(tmpdir(),'upgrade-git-template-'))),{run,commit}=original;
    run('init','-b','main');run('config','user.name','Tester');run('config','user.email','t@example.com');
    run('commit','--allow-empty','-m','root');const base=commit('base');
    run('checkout','-b','feature/skills');const first=commit('add SKILL.md'),tip=commit('polish SKILL.md');run('checkout','main');
    template={directory:original.directory,base,first,tip};
  }
  const directory=fs.mkdtempSync(path.join(tmpdir(),'upgrade-git-'));
  fs.cpSync(template.directory,directory,{recursive:true});
  cleanups.push(async()=>removeFixture(directory));
  return {...repoCommands(directory),base:template.base,first:template.first,tip:template.tip};
}

export async function switchFixture(repo:ReturnType<typeof gitRepo>){
  const f=await fixture(repo.directory);f.data.active.release_id='base-release';
  f.data.candidates=[{id:'base-release',state:'BORN',request:{owner_release:{source_commit:repo.base}}}];
  f.run.mockImplementation(async(_root,args,output)=>{
    output(args[0]+'\n');
    if(args[0]==='prepare')f.data.candidates.push({id:'prepared-'+f.data.candidates.length,state:'VALIDATED',candidate:{candidate_hash:'a'.repeat(64),base_generation:f.data.active.id},request:{base_generation:f.data.active.id,owner_release:{source_commit:args.at(-1)}}});
    if(args[0]==='apply'){const candidate=f.data.candidates.find((c:any)=>c.id===args[1]);candidate.state='BORN';f.data.active={id:'G'+(Number(f.data.active.id.slice(1))+1).toString().padStart(4,'0'),release_id:candidate.id};}
  });
  const done=async(state='succeeded')=>vi.waitFor(()=>{const record=JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8'));expect(record,record.error).toMatchObject({state});});
  const select=(sha=repo.tip,mode?:string)=>f.request({action:'switch',sourceCommit:sha,mode,expectedMain:repo.run('rev-parse','main'),expectedActive:f.data.active.id});
  return {...f,done,select};
}
