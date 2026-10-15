import {describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fixture,page,cleanups} from './fixtures/upgrade_web.js';
// @ts-ignore Standalone maintenance script.
import {createUpgradeWeb} from '../../../scripts/upgrade-web.mjs';

function linearGraphPage(page:number,count=41){
  const all=Array.from({length:count},(_,index)=>{const number=count-index;return {sha:number.toString(16).padStart(40,'0'),parents:number>1?[(number-1).toString(16).padStart(40,'0')]:[],subject:'Main change '+number,author:'Tester',time:number};});
  const commits=all.slice(page*20,(page+1)*20);
  return {available:true,page,limit:20,hasMore:(page+1)*20<count,mainHead:all[0].sha,refs:[],branches:[],commits,firstParent:commits.map(c=>c.sha)};
}

describe("V32 single version switch flow",()=>{
  it.each(['zh-CN','en'])('keeps pagination clickable during polling and retains a click until the poll finishes (%s)',async lang=>{
    const f=await fixture(),{dom,doc,poll}=await page(f,lang,'',{'/api/git-graph?limit=20&page=0':linearGraphPage(0,40),'/api/git-graph?limit=20&page=1':linearGraphPage(1,40)});
    expect(dom.window.setInterval).toHaveBeenCalledWith(expect.any(Function),10000);
    const fetcher=dom.window.fetch;let releasePoll:(()=>void)|undefined,releasePage:(()=>void)|undefined,hold=true;
    dom.window.fetch=vi.fn(async(url:string,init:any)=>{const response=await fetcher(url,init);if(hold&&url==='/api/git-graph?limit=20&page=0')await new Promise<void>(resolve=>{releasePoll=resolve;});if(hold&&url==='/api/git-graph?limit=20&page=1')await new Promise<void>(resolve=>{releasePage=resolve;});return response;});
    const background=poll();
    try{
      await vi.waitFor(()=>expect(releasePoll).toBeTypeOf('function'));
      expect(doc.getElementById('next-page').disabled).toBe(false);
      expect(doc.getElementById('previous-page').disabled).toBe(true);
      doc.getElementById('next-page').click();expect(doc.getElementById('next-page').disabled).toBe(true);
      releasePoll!();await vi.waitFor(()=>expect(releasePage).toBeTypeOf('function'));
      expect(doc.getElementById('next-page').disabled).toBe(true);
      const duringNavigation=poll();hold=false;releasePage!();await Promise.all([background,duringNavigation]);
      expect(doc.getElementById('graph-window').textContent).toContain(lang==='en'?'Page 2':'第 2 页');
      expect(doc.getElementById('previous-page').disabled).toBe(false);expect(doc.getElementById('next-page').disabled).toBe(true);
      await poll();expect(doc.getElementById('previous-page').disabled).toBe(false);
      doc.getElementById('previous-page').click();await poll();
      expect(doc.getElementById('graph-window').textContent).toContain(lang==='en'?'Page 1':'第 1 页');
      expect(doc.getElementById('next-page').disabled).toBe(false);expect(f.run).not.toHaveBeenCalled();
      dom.window.fetch=vi.fn(async(url:string,init:any)=>url==='/api/git-graph?limit=20&page=1'?{ok:false,status:500,json:async()=>({detail:'UPGRADE_DATABASE_UNAVAILABLE'})}:fetcher(url,init));
      doc.getElementById('next-page').click();await poll();
      expect(doc.getElementById('next-page').disabled).toBe(false);
      expect(doc.getElementById('error').textContent).toContain(lang==='en'?'The version database is unavailable':'版本数据库不可用');
      await poll();expect(dom.window.fetch.mock.calls.filter(([url]:[string])=>url==='/api/git-graph?limit=20&page=1')).toHaveLength(1);
    }finally{hold=false;releasePoll?.();releasePage?.();await background;}
  });
  it.each(['zh-CN','en'])('pages through distinct commits without repeated local or remote main history (%s)',async lang=>{
    const f=await fixture(),responses=Object.fromEntries([0,1,2].map(index=>['/api/git-graph?limit=20&page='+index,linearGraphPage(index)])),{doc,poll}=await page(f,lang,'',responses);
    const shas=()=>Array.from(doc.querySelectorAll('button[data-sha]'),(node:any)=>node.dataset.sha);
    const first=shas();expect(first).toHaveLength(20);expect(new Set(first).size).toBe(20);
    expect(first[0]).toBe(linearGraphPage(0).mainHead);expect(doc.querySelectorAll('.branch-card')).toHaveLength(0);
    expect(doc.getElementById('logout')).toBeNull();expect(doc.getElementById('previous-page').disabled).toBe(true);
    expect(doc.getElementById('next-page').textContent).toBe(lang==='en'?'Next page':'下一页');
    doc.getElementById('next-page').click();await vi.waitFor(()=>expect(doc.getElementById('graph-window').textContent).toContain(lang==='en'?'Page 2':'第 2 页'));
    const second=shas();expect(second).toHaveLength(20);expect(second.some(sha=>first.includes(sha))).toBe(false);
    await poll();expect(shas()).toEqual(second);expect(doc.querySelectorAll('.branch-card')).toHaveLength(0);
    doc.getElementById('next-page').click();await vi.waitFor(()=>expect(doc.getElementById('graph-window').textContent).toContain(lang==='en'?'Page 3':'第 3 页'));
    expect(shas()).toHaveLength(1);expect(doc.getElementById('next-page').disabled).toBe(true);
    expect(shas().some(sha=>first.includes(sha)||second.includes(sha))).toBe(false);
    doc.getElementById('previous-page').click();await vi.waitFor(()=>expect(shas()).toEqual(second));
    expect(f.run).not.toHaveBeenCalled();
  },30000);
  it.each(['zh-CN','en'])('shows retained and active job states inside the selection panel without a selection (%s)',async lang=>{
    const f=await fixture(),graph=linearGraphPage(0),base=graph.mainHead,jobFile=path.join(f.directory,'upgrade-web-job.json');
    f.data.active.release_id='base-release';f.data.candidates=[{id:'base-release',state:'BORN',request:{owner_release:{source_commit:base}}}];
    f.data.candidates[0].validationLog='Candidate validation output';
    fs.writeFileSync(jobFile,JSON.stringify({action:'switch',state:'running',phase:'validate',git:{commit:base},log:'Interrupted validation',startedAt:1}));
    const restarted=await createUpgradeWeb({root:path.resolve('.'),config:{stateDirectory:f.directory},secret:f.secret,runCommand:f.run,status:()=>f.data,checkRunning:f.checkRunning});cleanups.push(()=>restarted.close());
    const login=await restarted.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    const status=(await restarted.inject({url:'/api/upgrades',headers:{cookie}})).json();
    const {doc,poll}=await page({...f,app:restarted,cookie},lang,'',{'/api/upgrades':status,'/api/git-graph?limit=20&page=0':graph});
    const panel=doc.getElementById('selected-commit');expect(panel.hidden).toBe(false);
    for(const id of ['job','job-state','log','validation-log','sync-git','recover','error'])expect(panel.contains(doc.getElementById(id))).toBe(true);
    expect(doc.getElementById('job-state').textContent).toContain(lang==='en'?'Interrupted':'操作中断');
    expect(doc.getElementById('log').textContent).toBe('Interrupted validation');
    expect(doc.getElementById('validation-log').textContent).toBe('Candidate validation output');expect(doc.getElementById('recover').hidden).toBe(false);
    status.busy=true;status.job.state='running';delete status.job.error;await poll();
    expect(doc.getElementById('job-state').textContent).toContain(lang==='en'?'Switching · Prepare and validate':'正在切换 · 准备并校验');
    expect(doc.getElementById('switch-state').hidden).toBe(true);
    status.busy=false;status.job.state='succeeded';await poll();
    expect(doc.getElementById('job-state').textContent).toContain(lang==='en'?'Switch completed':'切换完成');
    status.job.state='failed';status.job.error='UPGRADE_VALIDATION_FAILED';await poll();
    expect(doc.getElementById('job-state').textContent).toContain(lang==='en'?'Candidate validation failed':'候选校验失败');
    status.job.state='needs_git_sync';delete status.job.error;await poll();expect(doc.getElementById('sync-git').hidden).toBe(false);
    expect(f.run).not.toHaveBeenCalled();
  },30000);
});

describe("Owner web upgrade",()=>{
  it.each(['zh-CN','en'])('keeps a readable offline publication error in the actual page (%s)',async lang=>{
    const f=await fixture();f.checkRunning.mockRejectedValue(new Error('MAIN_SERVICE_UNAVAILABLE'));
    await f.request({action:'publish',id:'local-v24-test',hash:'a'.repeat(64)});
    await vi.waitFor(()=>expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8')).state).toBe('failed'));
    const response=await f.app.inject('/');expect(response.statusCode).toBe(200);
    expect(response.body).toBe(fs.readFileSync(path.resolve('resources/upgrade-web.html'),'utf8'));
    const {doc}=await page(f,lang,'',{'/api/git-graph?limit=20&page=0':linearGraphPage(0)});
    const message=doc.getElementById('job-state').textContent;
    expect(message).toContain(lang==='en'?'The main service is stopped or unreachable.':'主服务未启动或无法连接。');
    expect(message).toContain('EmergentInc_UI.bat');expect(message).toContain('EmergentInc_UI.sh');
    expect(message).toContain(lang==='en'?'The candidate is retained':'候选版本保留');expect(f.run).not.toHaveBeenCalled();
  });
});
