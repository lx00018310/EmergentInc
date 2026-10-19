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

describe("Commit pipeline progress and instant rollback",()=>{
  it.each(['zh-CN','en'])('renders per-commit pipeline cells from persistent records and selection details (%s)',async lang=>{
    const f=await fixture(),graph=linearGraphPage(0),failed=graph.commits[1].sha,born=graph.commits[0].sha;
    f.data.active.release_id='base-release';
    f.data.candidates=[
      {id:'base-release',state:'BORN',request:{owner_release:{source_commit:graph.mainHead}}},
      {id:'local-failed',state:'SUBMITTED',created_at:200,failure_reason:'UPGRADE_VALIDATION_FAILED',request:{owner_release:{source_commit:failed}},outcome:{kind:'gene_validation_failed',at:200,reason:'UPGRADE_VALIDATION_FAILED'}},
      {id:'local-born',state:'BORN',created_at:100,request:{owner_release:{source_commit:born}},outcome:{kind:'generation_born',at:100,reason:null}}];
    // /api/upgrades is served by the real app, so the persistent record must be written to disk.
    fs.writeFileSync(path.join(f.directory,'commit-pipeline.json'),JSON.stringify({[graph.commits[2].sha]:{step:'merge',reason:'GIT_MERGE_CONFLICT',at:300}}));
    const {doc,poll}=await page(f,lang,'',{'/api/git-graph?limit=20&page=0':graph});
    await poll();
    const failedNode=doc.querySelector(`button[data-sha="${failed}"] .pipeline`);
    expect(failedNode).not.toBeNull();
    const failedCells=failedNode!.querySelectorAll('i');
    expect(failedCells).toHaveLength(6);
    expect(failedNode!.querySelectorAll('i.done')).toHaveLength(2); // merge + freeze passed
    expect(failedNode!.querySelectorAll('i.fail')).toHaveLength(1); // validate failed
    const bornNode=doc.querySelector(`button[data-sha="${born}"] .pipeline`);
    expect(bornNode!.querySelectorAll('i.done')).toHaveLength(5); // publication alone does not prove Git sync
    const conflictSha=graph.commits[2].sha;
    const conflictCommit=doc.querySelector(`button[data-sha="${conflictSha}"]`);
    const conflictNode=conflictCommit?.querySelector('.pipeline')??null;
    expect(conflictNode,`commit ${conflictSha} rendered=${Boolean(conflictCommit)}`).not.toBeNull();
    expect(conflictNode!.querySelectorAll('i.fail')).toHaveLength(1); // merge conflict, step 1 red
    // Selecting the failed commit shows the labelled six-step grid and the failure reason.
    doc.querySelector(`button[data-sha="${failed}"]`).click();
    await vi.waitFor(()=>expect(doc.getElementById('selected-pipeline').hidden).toBe(false),{timeout:5000});
    expect(doc.getElementById('selected-pipeline').querySelectorAll('.pipeline-step')).toHaveLength(6);
    expect(doc.getElementById('pipeline-reason').hidden).toBe(false);
    expect(doc.getElementById('pipeline-reason').textContent).toContain(lang==='en'?'Candidate validation failed':'候选校验失败');
    expect(f.run).not.toHaveBeenCalled();
  },30000);
  it.each(['zh-CN','en'])('shows only confirmed stages, refreshes live attempts and really hides stale cells (%s)',async lang=>{
    const f=await fixture(),graph=linearGraphPage(0),target=graph.commits[1].sha,untouched=graph.commits[2].sha;
    const data:any={...f.data,active:{...f.data.active,release_id:'base'},busy:false,job:null,commitPipeline:{},candidates:[{id:'base',state:'BORN',request:{owner_release:{source_commit:graph.mainHead}}},{id:'current',state:'VALIDATED',created_at:10,request:{owner_release:{source_commit:target}},outcome:{kind:'gene_candidate_validated',at:20}}]};
    const {dom,doc,poll}=await page(f,lang,'',{'/api/upgrades':data,'/api/git-graph?limit=20&page=0':graph});
    const stages=()=>Array.from(doc.querySelectorAll(`button[data-sha="${target}"] .pipeline i`),(cell:any)=>cell.className);
    expect(stages()).toEqual(['done','done','done','','','']);
    data.candidates[1].outcome={kind:'owner_exact_candidate_approved',at:30};await poll();
    expect(stages()).toEqual(['done','done','done','done','','']);
    data.candidates[1].outcome={kind:'generation_born',at:40};await poll();
    expect(stages()).toEqual(['done','done','done','done','done','']);
    data.commitPipeline[target]={step:'sync',state:'done',at:50,reason:null};await poll();expect(stages().filter(s=>s==='done')).toHaveLength(6);
    data.job={action:'switch',state:'running',phase:'validate',startedAt:60,git:{commit:target}};data.busy=true;await poll();
    expect(stages()).toEqual(['done','running','','','','']); // a new freeze must not reuse the old candidate
    data.candidates.push({id:'retry',created_at:70,state:'SUBMITTED',request:{owner_release:{source_commit:target}}});await poll();
    expect(stages()).toEqual(['done','done','running','','','']);
    data.job.phase='publish';await poll();expect(stages()).toEqual(['done','done','done','done','running','']);
    data.busy=false;data.job=null;await poll();
    doc.querySelector(`button[data-sha="${target}"]`).click();await vi.waitFor(()=>expect(doc.getElementById('selected-pipeline').hidden).toBe(false));
    expect(doc.getElementById('selected-pipeline').querySelector('[aria-label]')).not.toBeNull();
    doc.querySelector(`button[data-sha="${untouched}"]`).click();await vi.waitFor(()=>expect(doc.getElementById('selected-pipeline').hidden).toBe(true));
    expect(dom.window.getComputedStyle(doc.getElementById('selected-pipeline')).display).toBe('none');
    data.versions=[];await poll();expect(dom.window.getComputedStyle(doc.getElementById('rollback-row')).display).toBe('none');
    expect(f.run).not.toHaveBeenCalled();
  },30000);
  it.each(['zh-CN','en'])('offers instant rollback to eligible history with a confirmation dialog (%s)',async lang=>{
    const f=await fixture(),graph=linearGraphPage(0);
    f.data.active.release_id='base-release';
    f.data.versions=[{id:'G0007',generation_no:7,release_id:'older',label:'Older published version',available:true,canRollback:true}];
    const confirm=vi.fn(()=>true);
    const {dom,doc,poll}=await page(f,lang,'',{'/api/git-graph?limit=20&page=0':graph});
    dom.window.confirm=confirm as any;
    await poll();
    expect(doc.getElementById('rollback-row').hidden).toBe(false);
    expect(doc.getElementById('rollback-select').value).toBe('G0007');
    doc.getElementById('rollback').click();
    await vi.waitFor(()=>expect(confirm).toHaveBeenCalled());
    expect(String(confirm.mock.calls[0][0])).toContain('G0007');
    if(lang==='en')expect(String(confirm.mock.calls[0][0])).toContain('Roll the running software back');
    else expect(String(confirm.mock.calls[0][0])).toContain('回退到 G0007');
    await vi.waitFor(()=>expect(f.run).toHaveBeenCalledOnce());
    expect(f.run.mock.calls[0][1][0]).toBe('rollback-to');
    expect(f.run.mock.calls[0][1][1]).toBe('G0007');
    expect(f.checkRunning).toHaveBeenCalledWith('G0008');
  },30000);
});
