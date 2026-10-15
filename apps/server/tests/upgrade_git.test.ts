import {describe,expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {tmpdir} from 'node:os';
import {cleanups,fixture,page,gitRepo,switchFixture} from './fixtures/upgrade_web.js';
// @ts-ignore Standalone maintenance script.
import {createUpgradeWeb,readGitGraph,readGitCommit} from '../../../scripts/upgrade-web.mjs';
// @ts-ignore Standalone maintenance script.
import {ensureFastForwardable,fastForwardMain} from '../../../scripts/version-upgrade.mjs';
// @ts-ignore Standalone maintenance script.
import {inspectSwitch,buildSwitch,syncSwitch,deletableBranches,deleteBranch} from '../../../scripts/upgrade-git.mjs';

describe("V32 single version switch flow",()=>{
  it.each(['zh-CN','en'])('only selects until one click merges, validates, approves and publishes from a branch card (%s)',async lang=>{
    const repo=gitRepo(),f=await switchFixture(repo),{doc,poll}=await page(f,lang);
    expect(doc.querySelectorAll('.main-step').length).toBe(2);expect(doc.querySelectorAll('.branch-card')).toHaveLength(1);
    expect(doc.querySelector('.branch-card').dataset.branch).toBe('refs/heads/feature/skills');
    doc.querySelector('.branch-card details').open=true;await poll();expect(doc.querySelector('.branch-card details').open).toBe(true);
    doc.querySelector('button[data-sha="'+repo.tip+'"]').click();await vi.waitFor(()=>expect(doc.getElementById('switch').disabled).toBe(false));
    await poll();await poll();expect(f.run).not.toHaveBeenCalled();expect(repo.run('rev-parse','main')).toBe(repo.base);
    expect(doc.getElementById('switch').textContent).toContain(lang==='en'?'Prepare + validate':'准备 + 校验');
    doc.getElementById('switch').click();await f.done();await poll();
    expect(doc.getElementById('selected-commit').contains(doc.getElementById('job'))).toBe(true);
    expect(doc.getElementById('job-state').textContent).toContain(lang==='en'?'Switch completed':'切换完成');
    expect(f.run.mock.calls.map(c=>c[1][0])).toEqual(['prepare','approve','apply']);
    const result=repo.run('rev-parse','main');expect(result).not.toBe(repo.tip);expect(repo.run('rev-list','--parents','-n','1',result).split(' ').slice(1)).toEqual([repo.base,repo.tip]);
    expect(f.run.mock.calls[0][1].at(-1)).toBe(result);expect(f.run.mock.calls[1][1]).toContain('a'.repeat(64));
    expect(repo.run('branch','--show-current')).toBe('main');expect(f.data.candidates.at(-1).request.owner_release.source_commit).toBe(result);
    expect(doc.querySelector('.merged-history').textContent).toContain('polish SKILL.md');
    doc.querySelector('button[data-sha="'+repo.base+'"]').click();await vi.waitFor(()=>expect(doc.getElementById('selected-sha').textContent).toContain(repo.base.slice(0,12)));await poll();
    expect(doc.getElementById('selected-sha').textContent).toContain(repo.base.slice(0,12));
    expect(doc.getElementById('secret').value).toBe('');
  },30000);
  it('does not approve stale or failed validation and never retries from page polling',async()=>{
    const repo=gitRepo(),f=await switchFixture(repo),{doc,poll}=await page(f,'en');f.run.mockRejectedValueOnce(new Error('UPGRADE_VALIDATION_FAILED'));
    doc.querySelector('button[data-sha="'+repo.tip+'"]').click();await vi.waitFor(()=>expect(doc.getElementById('switch').disabled).toBe(false));
    doc.getElementById('switch').click();await f.done('failed');await poll();await poll();
    expect(f.run).toHaveBeenCalledOnce();expect(repo.run('rev-parse','main')).toBe(repo.base);expect(doc.getElementById('job-state').textContent).toContain('Candidate validation failed');
    expect(doc.getElementById('selected-commit').contains(doc.getElementById('job-state'))).toBe(true);
    doc.getElementById('error').textContent='Actual failure';await poll();expect(doc.getElementById('error').textContent).toBe('Actual failure');
  },30000);
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

describe("main integration, restore and local branch deletion",()=>{
  it('merges sibling branches without losing main changes, then appends an exact-tree restore commit',async()=>{
    const repo=gitRepo();repo.commit('first independent feature','one.txt');const firstMain=repo.run('rev-parse','main');
    repo.run('checkout','feature/skills');const f=await switchFixture(repo);
    expect((await f.select()).statusCode).toBe(202);await f.done();const merged=repo.run('rev-parse','main');
    expect(repo.run('show','main:one.txt')).toBe('first independent feature');expect(repo.run('show','main:file.txt')).toBe('polish SKILL.md');
    expect(repo.run('rev-list','--parents','-n','1',merged).split(' ').slice(1)).toEqual([firstMain,repo.tip]);
    expect((await f.select(repo.base,'restore')).statusCode).toBe(202);await f.done();const restored=repo.run('rev-parse','main');
    expect(repo.run('rev-list','--parents','-n','1',restored).split(' ').slice(1)).toEqual([merged]);
    expect(repo.run('rev-parse',restored+'^{tree}')).toBe(repo.run('rev-parse',repo.base+'^{tree}'));expect(repo.run('merge-base','--is-ancestor',merged,restored)).toBe('');
    expect((await f.select(repo.tip,'merge')).json().detail).toBe('GIT_ALREADY_INCLUDED');expect(repo.run('rev-parse','main')).toBe(restored);
    expect(f.run.mock.calls.map(c=>c[1][0])).toEqual(['prepare','approve','apply','prepare','approve','apply']);
  },30000);
  it('reports actual conflicts without modifying main, checkout or publishing',async()=>{
    const repo=gitRepo();repo.commit('conflicting main edit');const original=repo.run('rev-parse','main'),f=await switchFixture(repo);
    expect((await f.select()).statusCode).toBe(202);await f.done('failed');
    expect(JSON.parse(fs.readFileSync(path.join(f.directory,'upgrade-web-job.json'),'utf8'))).toMatchObject({error:'GIT_MERGE_CONFLICT',conflicts:['file.txt']});
    expect(f.run).not.toHaveBeenCalled();expect(repo.run('rev-parse','main')).toBe(original);expect(repo.run('status','--porcelain')).toBe('');
  },30000);
  it('refuses dirty, concurrently moved or separately checked-out main before publication',async()=>{
    const repo=gitRepo(),f=await switchFixture(repo);
    fs.writeFileSync(path.join(repo.directory,'draft.txt'),'retain me');expect((await f.select()).json().detail).toBe('GIT_SYNC_DIRTY_WORKTREE');fs.unlinkSync(path.join(repo.directory,'draft.txt'));
    expect((await f.request({action:'switch',sourceCommit:repo.tip,expectedMain:repo.tip,expectedActive:f.data.active.id})).json().detail).toBe('GIT_SYNC_MAIN_MOVED');
    repo.run('checkout','feature/skills');const other=fs.mkdtempSync(path.join(tmpdir(),'switch-main-'));repo.run('worktree','add',other,'main');cleanups.push(async()=>repo.run('worktree','remove','--force',other));
    expect((await f.select()).json().detail).toBe('GIT_MAIN_OTHER_WORKTREE');expect(f.run).not.toHaveBeenCalled();
  },30000);
  it('rechecks main and candidate binding after validation and stops before approval',async()=>{
    const repo=gitRepo(),f=await switchFixture(repo),run=f.run.getMockImplementation()!;
    f.run.mockImplementation(async(...args)=>{await run(...args);if(args[1][0]==='prepare')repo.commit('main changed during validation','concurrent.txt');});
    await f.select();await f.done('failed');expect(f.run).toHaveBeenCalledOnce();expect(repo.run('show','main:concurrent.txt')).toBe('main changed during validation');
  },30000);
  it('refuses an old candidate instead of approving it after a new preparation',async()=>{
    const repo=gitRepo(),f=await switchFixture(repo);
    f.run.mockImplementation(async(_root,args)=>{if(args[0]==='prepare')f.data.candidates.push({id:'stale',state:'VALIDATED',candidate:{candidate_hash:'a'.repeat(64),base_generation:'G0007'},request:{base_generation:'G0007',owner_release:{source_commit:args.at(-1)}}});});
    await f.select();await f.done('failed');expect(f.run).toHaveBeenCalledOnce();expect(repo.run('rev-parse','main')).toBe(repo.base);
  },30000);
  it('retains a post-publication sync failure and retries sync without preparing or republishing',async()=>{
    const repo=gitRepo(),f=await switchFixture(repo),run=f.run.getMockImplementation()!;
    f.run.mockImplementation(async(...args)=>{await run(...args);if(args[1][0]==='apply')fs.writeFileSync(path.join(repo.directory,'draft.txt'),'Owner new work');});
    await f.select();await f.done('needs_git_sync');expect(repo.run('rev-parse','main')).toBe(repo.base);
    expect((await f.select()).json().detail).toBe('GIT_SYNC_REQUIRED');
    fs.unlinkSync(path.join(repo.directory,'draft.txt'));expect((await f.request({action:'sync-git'})).statusCode).toBe(202);await f.done();
    expect(f.run).toHaveBeenCalledTimes(3);expect(repo.run('rev-parse','main')).toBe(f.data.candidates.at(-1).request.owner_release.source_commit);
  },30000);
  it.each([false,true])('completes an interrupted post-publication sync after restarting the service (main already advanced: %s)',async advanced=>{
    const repo=gitRepo(),f=await switchFixture(repo),plan=buildSwitch(repo.directory,inspectSwitch(repo.directory,repo.tip,repo.base));
    f.data.candidates.push({id:'published',state:'BORN',request:{owner_release:{source_commit:plan.commit}}});f.data.active={id:'G0009',release_id:'published'};
    if(advanced)repo.run('merge','--ff-only',plan.commit);
    fs.writeFileSync(path.join(f.directory,'upgrade-web-job.json'),JSON.stringify({action:'switch',state:'running',phase:'publish',git:plan,startedAt:1}));
    const app=await createUpgradeWeb({root:repo.directory,config:{stateDirectory:f.directory},secret:f.secret,runCommand:f.run,status:()=>f.data,checkRunning:f.checkRunning});cleanups.push(()=>app.close());
    const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:f.secret}}),cookie=String(login.headers['set-cookie']).split(';')[0];
    expect((await app.inject({url:'/api/upgrades',headers:{cookie}})).json().job.state).toBe('interrupted');
    expect((await app.inject({method:'POST',url:'/api/upgrades',headers:{cookie},payload:{action:'sync-git'}})).statusCode).toBe(202);await f.done();
    expect(repo.run('rev-parse','main')).toBe(plan.commit);expect(repo.run('branch','--show-current')).toBe('main');expect(f.run).not.toHaveBeenCalled();
  },30000);
  it('deletes only an eligible exact local branch and keeps remotes, tags and recovery objects',async()=>{
    const repo=gitRepo(),f=await switchFixture(repo);repo.run('update-ref','refs/remotes/origin/feature/skills',repo.tip);repo.run('tag','retained-tag',repo.tip);
    expect((await f.request({action:'delete-branch',branch:'main',sourceCommit:repo.base,expectedMain:repo.base,expectedActive:f.data.active.id})).statusCode).toBe(409);
    expect(deletableBranches(repo.directory,repo.base,repo.base)).toEqual([]);
    expect(deletableBranches(repo.directory,repo.tip,repo.tip)).toEqual([]);
    repo.run('checkout','feature/skills');expect(deletableBranches(repo.directory,repo.tip,repo.base)).toEqual([]);repo.run('checkout','main');
    expect((await f.request({action:'delete-branch',branch:'feature/skills',sourceCommit:repo.first,expectedMain:repo.base,expectedActive:f.data.active.id})).statusCode).toBe(409);
    expect((await f.request({action:'delete-branch',branch:'feature/skills',sourceCommit:repo.tip,expectedMain:repo.base,expectedActive:f.data.active.id})).statusCode).toBe(202);await f.done();
    expect(repo.run('for-each-ref','--format=%(refname)','refs/heads')).toBe('refs/heads/main');
    expect(repo.run('rev-parse','refs/remotes/origin/feature/skills')).toBe(repo.tip);expect(repo.run('rev-parse','retained-tag')).toBe(repo.tip);
    const archived=repo.run('for-each-ref','--format=%(objectname)','refs/emergentinc/discarded');expect(archived).toBe(repo.tip);
    expect(f.run).not.toHaveBeenCalled();
  },30000);
  it('hides discarded-only commits from the graph and migrates develop only when all its changes are retained',()=>{
    const repo=gitRepo();const result=deleteBranch(repo.directory,'feature/skills',repo.tip,repo.base);
    expect(readGitGraph(repo.directory).commits.map((c:any)=>c.sha)).not.toContain(repo.tip);expect(repo.run('rev-parse',result.recoveryRef)).toBe(repo.tip);
    repo.run('branch','develop',repo.tip);repo.run('checkout','develop');const plan=buildSwitch(repo.directory,inspectSwitch(repo.directory,repo.tip,repo.base));
    expect(repo.run('branch','--show-current')).toBe('develop');syncSwitch(repo.directory,plan);
    expect(repo.run('branch','--show-current')).toBe('main');expect(repo.run('for-each-ref','refs/heads/develop')).toBe('');
  },30000);
  it.each(['zh-CN','en'])('renders deletion and history restore controls in both languages (%s)',async lang=>{
    const repo=gitRepo(),f=await switchFixture(repo),{dom,doc,poll}=await page(f,lang);dom.window.confirm=vi.fn(()=>true);
    doc.querySelector('button[data-sha="'+repo.tip+'"]').click();await vi.waitFor(()=>expect(doc.getElementById('delete-commit').disabled).toBe(false));
    expect(doc.getElementById('delete-commit').textContent).toBe(lang==='en'?'Delete branch and commits':'删除分支及提交');
    doc.getElementById('delete-commit').click();await f.done();await poll();expect(dom.window.confirm).toHaveBeenCalledOnce();
    const old=repo.run('rev-list','--max-parents=0','main');doc.querySelector('button[data-sha="'+old+'"]').click();await vi.waitFor(()=>expect(doc.getElementById('switch').disabled).toBe(false));
    expect(doc.getElementById('switch').textContent).toContain(lang==='en'?'Create restore commit':'新增回退提交');expect(doc.getElementById('delete-commit').disabled).toBe(true);
  },30000);
});

describe("V27 dual-tree git upgrade",()=>{
  it('serves three real Git pages without duplicating main history through local or remote refs',async()=>{
    const repo=gitRepo();repo.run('merge','--ff-only','feature/skills');
    repo.run('branch','same-as-main');repo.run('branch','old-main',repo.base);
    repo.run('update-ref','refs/remotes/origin/main',repo.tip);repo.run('update-ref','refs/remotes/origin/old-main',repo.base);
    repo.commitMany(Array.from({length:37},(_,i)=>'main change '+i));
    const f=await fixture(repo.directory),pages=[];
    for(const index of [0,1,2]){
      const response=await f.app.inject({url:'/api/git-graph?limit=20&page='+index,headers:{cookie:f.cookie}});
      expect(response.statusCode).toBe(200);pages.push(response.json());
    }
    expect(pages.map(graph=>graph.commits.length)).toEqual([20,20,1]);
    expect(pages.map(graph=>graph.hasMore)).toEqual([true,true,false]);
    expect(pages.map(graph=>graph.page)).toEqual([0,1,2]);
    expect(pages[0].commits[0].sha).toBe(repo.run('rev-parse','main'));
    expect(new Set(pages.flatMap(graph=>graph.commits.map((c:any)=>c.sha))).size).toBe(41);
    expect(pages.every(graph=>graph.branches.length===0)).toBe(true);
    expect(repo.run('show','main:file.txt')).toBe('main change 36');
    expect(repo.run('status','--porcelain')).toBe('');expect(f.run).not.toHaveBeenCalled();
  },30000);
  it('limits mixed branch pages to distinct visible commits, including branch history beyond its tip page',async()=>{
    const repo=gitRepo();repo.run('checkout','feature/skills');
    repo.commitMany(Array.from({length:23},(_,i)=>'feature change '+i));
    const tip=repo.run('rev-parse','HEAD');repo.run('checkout','main');
    repo.run('update-ref','refs/remotes/origin/feature/skills',tip);repo.run('update-ref','refs/remotes/origin/main',repo.base);
    const first=readGitGraph(repo.directory),second=readGitGraph(repo.directory,20,1);
    expect(first).toMatchObject({page:0,hasMore:true,limit:20});expect(first.commits).toHaveLength(20);
    expect(second).toMatchObject({page:1,hasMore:false,limit:20});expect(second.commits).toHaveLength(7);
    expect(new Set([...first.commits,...second.commits].map((c:any)=>c.sha)).size).toBe(27);
    expect(readGitGraph(repo.directory,20,-1).page).toBe(0);expect(readGitGraph(repo.directory,20,999).page).toBe(1);
    for(const graph of [first,second]){
      const visible=new Set(graph.commits.map((c:any)=>c.sha));
      expect(graph.firstParent.every((sha:string)=>visible.has(sha))).toBe(true);
      expect(graph.branches.some((b:any)=>b.ref==='refs/remotes/origin/main')).toBe(false);
      expect(graph.branches.every((b:any)=>b.commits.every((sha:string)=>visible.has(sha)))).toBe(true);
    }
    const f=await switchFixture(repo),{doc}=await page(f);
    expect(doc.querySelectorAll('button[data-sha]')).toHaveLength(20);expect(doc.querySelectorAll('.branch-card')).toHaveLength(1);
    doc.getElementById('next-page').click();await vi.waitFor(()=>expect(doc.querySelectorAll('button[data-sha]')).toHaveLength(7));
    expect(doc.querySelectorAll('button[data-sha="'+tip+'"]')).toHaveLength(0);
    expect(doc.querySelectorAll('.branch-card')).toHaveLength(1);expect(doc.querySelectorAll('.main-step')).toHaveLength(2);
    const pageShas=Array.from(doc.querySelectorAll('button[data-sha]'),(n:any)=>n.dataset.sha);expect(new Set(pageShas).size).toBe(7);
  },30000);
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
