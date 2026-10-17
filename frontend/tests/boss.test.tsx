import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {BossConsole} from '../src/features/boss/BossConsole';
import {BossChat} from '../src/features/boss/BossChat';
import {BossBudget} from '../src/features/boss/BossBudget';
import {BossPayment} from '../src/features/boss/BossPayment';
import {BossRecovery} from '../src/features/boss/BossRecovery';
import {BossCompany} from '../src/features/boss/BossCompany';
import {flowOverview,flowGoal,flowWork} from './fixtures/owner_flow';
import {clearLegacyBossStorage} from '../src/features/boss/bossStorage';
import {projectBossAttention,sumUsdt} from '../src/features/boss/bossAttention';
import {setLanguage} from '../src/i18n';
import {bossFixture,planProposal} from './fixtures/boss';
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>setLanguage('en'));
afterEach(()=>{cleanup();vi.restoreAllMocks();localStorage.clear();sessionStorage.clear();setLanguage('en');});
it('projects exactly three real startup values without synthetic progress',()=>{
  const data=bossFixture({budget:{...bossFixture().budget!,activatedAt:null,totalMicros:0,availableMicros:0},paymentConfigured:false,modelConfigured:false});
  const projection=projectBossAttention(data);
  expect(projection.metrics.map(m=>m.id)).toEqual(['products','budget','goals']);expect(projection.metrics.map(m=>m.value)).toEqual(['0','Unauthorized','0']);expect(projection.messages).toHaveLength(3);expect(projection.overflowCount).toBe(0);
});
it('uses integer decimal receipt sums across USDT decimal scales and rejects malformed money',()=>{
  expect(sumUsdt([{id:'a',asset:'USDT',amount:'0.1',at:1},{id:'b',asset:'USDT',amount:'0.200000000000000001',at:2},{id:'c',asset:'CNY',amount:'99',at:3}])).toBe('0.300000000000000001');
  expect(sumUsdt([{id:'bad',asset:'USDT',amount:'NaN',at:1}])).toBe('—');
});
it('holds ordinary metric selection for 60 seconds and switches immediately for a real blocker',()=>{
  const first=projectBossAttention(bossFixture()),growth=bossFixture({asOf:110000,paidOrderCount:321,revenue:[{id:'receipt_1',asset:'USDT',amount:'2',at:109999}]});
  expect(projectBossAttention(growth,first).view).toBe('startup');
  const next=projectBossAttention({...growth,asOf:161000},first);expect(next.view).toBe('growth');expect(next.metrics.map(m=>[m.value,m.unit])).toEqual([['2','USDT'],['321',undefined],['0','CNY']]);
  const blocked=projectBossAttention({...growth,alerts:[{id:'incident',kind:'run',severity:'critical',title:'Needs attention',summary:'Unknown call',createdAt:110000,source:'ledger',href:'/BOSS'}]},first);expect(blocked.view).toBe('critical');expect(blocked.metrics).toHaveLength(3);
});
it('deduplicates the same business entity without losing any pending approval',()=>{
  const a=planProposal('a'),b={...planProposal('b'),kind:'close_task' as const},data=bossFixture({proposals:[a,a,b],alerts:[{id:'goal:goal_fixture',kind:'goal',severity:'critical',title:'Needs attention',summary:'A real blocker',createdAt:1,source:'owner_goals',href:'/BOSS'}]});
  const projection=projectBossAttention(data);expect(projection.messages).toHaveLength(1);expect(projection.messages[0].priority).toBe('critical');expect(projection.messages[0].proposals?.map(p=>p.id)).toEqual(['a','b']);
});
it('counts an affected goal from the backend incident link even before its status projection catches up',()=>{
  const projection=projectBossAttention(bossFixture({goals:[{id:'goal-incident',title:'Research',status:'RUNNING',updatedAt:1}],alerts:[{id:'goal:goal-incident',goalId:'goal-incident',taskId:'task-incident',runId:'run-incident',kind:'run',severity:'critical',title:'Worker recovery needs verification',summary:'Research',reasonKey:'CALL_OUTCOME_UNKNOWN',createdAt:1,source:'company execution',href:'/BOSS'}]}));
  expect(projection.metrics.find(m=>m.id==='affected')?.value).toBe('1');expect(projection.messages).toHaveLength(1);
});
it('keeps all pending items reachable beyond three cards and removes only resolved facts',()=>{
  const data=bossFixture({proposals:[0,1,2,3,4].map(i=>planProposal('p'+i,'g'+i))}),first=projectBossAttention(data);
  expect(first.messages).toHaveLength(3);expect(first.overflowCount).toBe(2);expect(new Set([...first.messages,...first.overflow].flatMap(m=>m.proposals!.map(p=>p.id))).size).toBe(5);
  const resolved=projectBossAttention({...data,proposals:data.proposals!.map(p=>({...p,state:'EXECUTED'}))},first);expect(resolved.messages).toEqual([]);
});
it('never translates retired browser history into V34 commands and preserves unrelated storage',()=>{
  localStorage.setItem('emergentinc.ownerChat.pending','old authorization');localStorage.setItem('emergentinc.ownerChat.history','old history');localStorage.setItem('emergentinc.owner.action:old','old action');localStorage.setItem('unrelated','keep');localStorage.setItem('emergentinc.language','zh-CN');
  sessionStorage.setItem('emergentinc.checkout-intent','old customer');sessionStorage.setItem('unrelated','keep');clearLegacyBossStorage();
  expect(localStorage.getItem('emergentinc.ownerChat.pending')).toBeNull();expect(localStorage.getItem('unrelated')).toBe('keep');expect(localStorage.getItem('emergentinc.language')).toBe('zh-CN');expect(sessionStorage.getItem('emergentinc.checkout-intent')).toBeNull();expect(sessionStorage.getItem('unrelated')).toBe('keep');
});
it.each(['en','zh-CN'] as const)('renders the quiet single page with exactly three metric cards in %s',async language=>{
  setLanguage(language);vi.spyOn(globalThis,'fetch').mockResolvedValue(response(bossFixture()));const {container}=render(<BossConsole/>);
  await waitFor(()=>expect(container.querySelectorAll('.boss-metric')).toHaveLength(3));await screen.findByRole('button',{name:language==='en'?'Inspect Company':'视察公司'});
  expect(container.querySelectorAll('.boss-message')).toHaveLength(0);expect(container.querySelectorAll('textarea')).toHaveLength(1);expect(screen.getByText(language==='en'?'Nothing needs your attention. The company is paused.':'目前无须你处理，公司已暂停。')).toBeTruthy();
  expect(screen.getByRole('button',{name:language==='en'?'Inspect Company':'视察公司'}).hasAttribute('disabled')).toBe(false);expect(screen.queryByRole('link',{name:'QIAN'})).toBeNull();
});
it('shows at most three messages while a temporary overflow dialog exposes every approval',async()=>{
  vi.spyOn(globalThis,'fetch').mockResolvedValue(response(bossFixture({proposals:[0,1,2,3,4].map(i=>planProposal('p'+i,'g'+i))})));const {container}=render(<BossConsole/>);
  await screen.findByRole('button',{name:'2 more items need attention'});expect(container.querySelector('.boss-attention')!.querySelectorAll('.boss-message')).toHaveLength(3);
  fireEvent.click(screen.getByRole('button',{name:'2 more items need attention'}));expect(within(screen.getByRole('dialog')).getAllByText('Review and decide')).toHaveLength(2);fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();
});
it('retains a failed approval, pins its hash/key, and never announces optimistic success',async()=>{
  const proposal=planProposal(),calls:RequestInit[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{if(String(input).includes('/decision')){calls.push(init!);return response({detail:'OWNER_PROPOSAL_CHANGED'},409);}return response(bossFixture({proposals:[proposal]}));});render(<BossConsole/>);
  fireEvent.click(await screen.findByText('Review and decide'));fireEvent.click(screen.getByRole('button',{name:'Approve'}));await screen.findByRole('alert');expect(screen.getByRole('button',{name:'Approve'})).toBeTruthy();
  const body=JSON.parse(String(calls[0].body));expect(body).toEqual({decision:'approve',hash:proposal.hash,idempotencyKey:'approve_'+proposal.id});expect(screen.queryByText('Executed')).toBeNull();
});
it('deduplicates double control clicks and uses the actual control revision',async()=>{
  let release!:(value:Response)=>void,calls:RequestInit[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{if(String(input).endsWith('/automation')){calls.push(init!);return new Promise(resolve=>{release=resolve;});}return response(bossFixture());});render(<BossConsole/>);
  const start=await screen.findByRole('button',{name:'Start company'});fireEvent.click(start);fireEvent.click(start);expect(calls).toHaveLength(1);expect(JSON.parse(String(calls[0].body))).toMatchObject({desiredMode:'ON',expectedRevision:0});release(response(bossFixture().automation));await waitFor(()=>expect(screen.getByRole('button',{name:'Start company'}).hasAttribute('disabled')).toBe(false));
});
it('marks failed polling as unknown instead of retaining a running status',async()=>{
  let reject=false;vi.spyOn(globalThis,'fetch').mockImplementation(async()=>{if(reject)throw new TypeError('offline');return response(bossFixture({automation:{...bossFixture().automation!,desiredMode:'ON',observedState:'RUNNING'}}));});render(<BossConsole/>);await screen.findByText('Company running');
  reject=true;fireEvent(document,new Event('visibilitychange'));await screen.findByText('Company state unknown');expect(screen.queryByText('Company running')).toBeNull();
});
it('preserves the same chat request across timeout and remount, and rejects changing its intent',async()=>{
  const calls:RequestInit[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{calls.push(init!);throw new TypeError('connection lost');});const first=render(<BossChat instanceId="new" onDone={()=>{}}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Create a verified draft'}});fireEvent.click(screen.getByRole('button',{name:'Send'}));await screen.findByRole('alert');const payload=JSON.parse(String(calls[0].body));first.unmount();render(<BossChat instanceId="new" onDone={()=>{}}/>);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(payload.question);fireEvent.click(screen.getByRole('button',{name:'Send'}));await waitFor(()=>expect(calls).toHaveLength(2));expect(JSON.parse(String(calls[1].body))).toEqual(payload);
});
it('preserves a pending money authorization across timeout, modal closure and remount',async()=>{
  const calls:RequestInit[]=[];let fail=true;vi.spyOn(globalThis,'fetch').mockImplementation(async(_input,init)=>{calls.push(init!);if(fail)throw new TypeError('lost response');return response(bossFixture().budget);});const first=render(<BossBudget budget={bossFixture().budget!} instanceId="new" onDone={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save company budget'}));await screen.findByRole('alert');const payload=JSON.parse(String(calls[0].body));first.unmount();fail=false;render(<BossBudget budget={{...bossFixture().budget!,revision:2}} instanceId="new" onDone={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Save company budget'}));await waitFor(()=>expect(calls).toHaveLength(2));expect(JSON.parse(String(calls[1].body))).toEqual(payload);await waitFor(()=>expect(localStorage.getItem('boss.v34.budget.new.pending')).toBeNull());
});
it.each(['en','zh-CN'] as const)('releases a rejected chat plan for editing and resubmission in %s',async language=>{
  setLanguage(language);const calls:any[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return calls.length===1?response({detail:'OWNER_TASK_PLAN_INVALID'},400):response({answer:'Accepted'});});
  render(<BossChat instanceId="rejected" onDone={()=>{}}/>);fireEvent.change(screen.getByRole('textbox'),{target:{value:'Research a business proposal'}});fireEvent.submit(screen.getByRole('textbox').closest('form')!);await screen.findByRole('alert');
  expect(localStorage.getItem('boss.v34.chat.rejected.pending')).toBeNull();expect(screen.getByRole('alert').textContent).toContain(language==='en'?'invalid fields':'字段');
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Research and save a proposal only'}});fireEvent.submit(screen.getByRole('textbox').closest('form')!);await waitFor(()=>expect(calls).toHaveLength(2));expect(calls[1].question).toBe('Research and save a proposal only');expect(calls[1].requestKey).not.toBe(calls[0].requestKey);
});
it('retains an unknown server result and blocks a changed command',async()=>{
  const calls:any[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{calls.push(JSON.parse(String(init?.body)));return response({detail:'OWNER_OUTCOME_REVIEW_REQUIRED'},500);});render(<BossChat instanceId="unknown" onDone={()=>{}}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Original task'}});fireEvent.submit(screen.getByRole('textbox').closest('form')!);await screen.findByRole('alert');expect(localStorage.getItem('boss.v34.chat.unknown.pending')).not.toBeNull();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Different task'}});fireEvent.submit(screen.getByRole('textbox').closest('form')!);expect(calls).toHaveLength(1);expect(screen.getByRole('alert').textContent).toContain('Resolve the pending request');
});
it.each(['en','zh-CN'] as const)('inspects actual company records and keeps settings reachable in %s',async language=>{
  setLanguage(language);vi.spyOn(globalThis,'fetch').mockImplementation(async url=>String(url).endsWith('/boss/overview')?response(bossFixture()):String(url).includes('/goals/')?response({goal:flowGoal(),events:[],dispatches:[],evidence:[{id:'artifact-1',kind:'artifact',reference:'evidence/owner-run/guide.md',bytes:123}]}):response(flowOverview()));render(<BossConsole/>);
  fireEvent.click(await screen.findByRole('button',{name:language==='en'?'Inspect Company':'视察公司'}));const dialog=screen.getByRole('dialog');await within(dialog).findByText('Alice · Researcher · '+(language==='en'?'Running':'运行中'));
  expect(within(dialog).getByText(language==='en'?'Company orders':'公司订单')).toBeTruthy();fireEvent.click(within(dialog).getByRole('button',{name:'Digital guide'}));const evidence=await within(dialog).findByRole('link',{name:'guide.md'});expect(evidence.getAttribute('href')).toBe('/api/owner/goals/goal-a/evidence/artifact-1');
  fireEvent.click(within(dialog).getByRole('button',{name:language==='en'?'Authorize company budget':'授权公司预算'}));await screen.findByRole('button',{name:language==='en'?'Save company budget':'保存公司预算'});
});
it.each(['en','zh-CN'] as const)('distinguishes delivery and retained accounting reservations in %s',async language=>{
  setLanguage(language);const task=flowWork({state:'REPLIED',reply:'Actual delivery',attempt:{id:'attempt-a',taskId:'work-a',worldId:'world-a',goalId:'goal-a',goalRevision:1,dispatchId:'dispatch-a',runId:'run-a',fence:1,revision:3,state:'COMPLETED',accountingState:'PENDING',leaseOwner:'controller',leaseExpiresAt:20,lastSequence:2,reason:null,createdAt:10,updatedAt:20}});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(response(flowOverview({work:{tasks:[task],requests:[],codeReports:[]}})));render(<BossCompany onAction={()=>{}}/>);
  await screen.findByText(language==='en'?'Execution result: Completed · Cost accounting: Pending verification; reservation retained':'执行结果: 执行完成 · 费用结算: 费用待核实，预留保留');
  expect(screen.getByText('Actual delivery')).toBeTruthy();
});
it.each(['en','zh-CN'] as const)('shows a suspended worker and retained progress in %s',async language=>{
  setLanguage(language);const task=flowWork({state:'BLOCKED',reason:'OWNER_GOAL_PAUSED',attempt:{id:'attempt-paused',taskId:'work-a',worldId:'agent-a',goalId:'goal-a',goalRevision:1,dispatchId:'dispatch-a',runId:'run-a',fence:1,revision:3,state:'SUSPENDED',accountingState:'SETTLED',leaseOwner:'controller',leaseExpiresAt:20,lastSequence:2,reason:'OWNER_GOAL_PAUSED',createdAt:10,updatedAt:20}});
  vi.spyOn(globalThis,'fetch').mockResolvedValue(response(flowOverview({work:{tasks:[task],requests:[],codeReports:[]}})));render(<BossCompany onAction={()=>{}}/>);
  await screen.findByText(language==='en'?'Execution result: Suspended; progress retained · Cost accounting: Settled':'执行结果: 执行已暂停，保留进度 · 费用结算: 已结算');
  expect(screen.getByText(language==='en'?'This goal is paused; execution progress is retained.':'该目标已暂停，执行进度已保留。')).toBeTruthy();
});
it('loads existing payment addresses and submits only the selected rail at its current revision',async()=>{
  const calls:any[]=[];const rails=[{rail_id:'sol-main',chain:'solana',recipient_address:'solana-address',config_revision:2,status:'ENABLED'},{rail_id:'bsc-main',chain:'bsc',recipient_address:'0x-address',config_revision:4,status:'ENABLED'}];
  vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>{if(init?.method==='PUT'){calls.push(JSON.parse(String(init.body)));return response({});}return response({items:rails});});const done=vi.fn();render(<BossPayment onDone={done}/>);
  await waitFor(()=>expect((screen.getByLabelText('Mainnet recipient address') as HTMLInputElement).value).toBe('solana-address'));fireEvent.change(screen.getByLabelText('Payment chain'),{target:{value:'bsc'}});expect((screen.getByLabelText('Mainnet recipient address') as HTMLInputElement).value).toBe('0x-address');
  fireEvent.click(screen.getByRole('button',{name:'Enable receive-only payments'}));await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(calls).toEqual([{rail_id:'bsc-main',chain:'bsc',network:'mainnet',recipient_address:'0x-address',status:'ENABLED',expected_revision:4,rpc_id:'bsc-mainnet'}]);
});
it('deduplicates company and world recovery records and settles through the world contract',async()=>{
  const calls:any[]=[];let settled=false;vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){calls.push(JSON.parse(String(init.body)));settled=true;return response({});}if(String(url).endsWith('/execution-recovery'))return response({attempts:[],holds:[]});if(String(url).endsWith('/calls'))return response({items:settled?[]:[{id:'permit-1',world_id:'world-a',source_kind:'world',source_id:'call-a',actual_tokens:30}]});return response({items:settled?[]:[{worldId:'world-a',status:{running:false,unfinalized_operations:{unknownCalls:[{callId:'call-a'}],unsettledReservations:[{callId:'call-a'}],startedToolExecutions:[],pendingRuns:[],callingMessages:[]}}}]});});
  const done=vi.fn();render(<BossRecovery revision={5} onDone={done}/>);await screen.findByText(/Confirm verified usage/);expect(screen.getAllByText(/Confirm verified usage/)).toHaveLength(1);fireEvent.click(screen.getByText(/Confirm verified usage/));fireEvent.change(screen.getByLabelText('Verified cost (CNY)'),{target:{value:'0.25'}});fireEvent.change(screen.getByLabelText('Receipt and verification reason'),{target:{value:'Provider receipt checked'}});fireEvent.click(screen.getByRole('button',{name:'Record verified settlement'}));await screen.findByText('No unresolved calls remain.');expect(done).toHaveBeenCalledOnce();expect(calls).toEqual([{kind:'model',id:'call-a',decision:'settle_billed',reason:'Provider receipt checked',actualTokens:30,costCny:0.25,idempotencyKey:expect.any(String)}]);
});
it.each(['en','zh-CN'] as const)('stops a specific uncertain worker without entering or inventing a bill in %s',async lang=>{
  setLanguage(lang);let stopped=false;const posts:{url:string;body:any}[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){posts.push({url:String(url),body:JSON.parse(String(init.body))});stopped=true;return response({});}return String(url).endsWith('/execution-recovery')?response({attempts:stopped?[]:[{id:'attempt-a',hash:'a'.repeat(64),reason:'CALL_OUTCOME_UNKNOWN'}],holds:[]}):response({items:[]});});
  render(<BossRecovery revision={1} onDone={()=>{}}/>);await screen.findByText(new RegExp(lang==='en'?'Review uncertain execution':'核验未知执行'));expect(screen.queryByLabelText(lang==='en'?'Verified tokens':'已核验 Tokens')).toBeNull();fireEvent.change(screen.getByLabelText(lang==='en'?'Receipt and verification reason':'回执与核验依据'),{target:{value:'Owner verified and stops this exact uncertain work'}});fireEvent.click(screen.getByRole('button',{name:lang==='en'?'Acknowledge and stop uncertain work':'确认并停止结果未明的工作'}));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0].url).toContain('/execution-recovery/attempt-a/abandon');expect(posts[0].body).toMatchObject({hash:'a'.repeat(64)});expect(posts[0].body.actualTokens).toBeUndefined();expect(posts[0].body.costCny).toBeUndefined();
});
it.each(['en','zh-CN'] as const)('abandons a legacy unknown result separately from its unknown bill in %s',async lang=>{
  setLanguage(lang);const posts:any[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));return response({});}return String(url).endsWith('/execution-recovery')?response({attempts:[],holds:[]}):String(url).endsWith('/calls')?response({items:[{id:'permit',world_id:'world-a',source_kind:'world',source_id:'legacy-call',actual_tokens:null}]}):response({items:[]});});
  render(<BossRecovery revision={1} onDone={()=>{}}/>);await screen.findByText(/(?:Confirm verified usage|确认已核验用量)/);fireEvent.change(screen.getByLabelText(lang==='en'?'Receipt and verification reason':'回执与核验依据'),{target:{value:'Owner discards this exact unknown result; the charge stays unknown'}});fireEvent.click(screen.getByRole('button',{name:lang==='en'?'Acknowledge and stop uncertain work':'确认并停止结果未明的工作'}));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0]).toMatchObject({kind:'model',id:'legacy-call',decision:'abandon'});expect(posts[0].actualTokens).toBeUndefined();expect(posts[0].costCny).toBeUndefined();
});
it.each(['en','zh-CN'] as const)('keeps exact worker recovery usable when the separate billing read fails in %s',async lang=>{
  setLanguage(lang);let stopped=false;const posts:any[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));stopped=true;return response({});}if(String(url).endsWith('/calls'))throw new Error('Synthetic billing read failure');return String(url).endsWith('/execution-recovery')?response({attempts:stopped?[]:[{id:'independent-attempt',hash:'b'.repeat(64),reason:'TOOL_OUTCOME_UNKNOWN'}],holds:[]}):response({items:[]});});
  render(<BossRecovery revision={1} onDone={()=>{}}/>);await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain(lang==='en'?'Loaded records can still be reviewed':'仍可处理已成功读取的记录');fireEvent.change(screen.getByLabelText(lang==='en'?'Receipt and verification reason':'回执与核验依据'),{target:{value:'Owner stops this exact uncertain worker without replay'}});fireEvent.click(screen.getByRole('button',{name:lang==='en'?'Acknowledge and stop uncertain work':'确认并停止结果未明的工作'}));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0]).toMatchObject({hash:'b'.repeat(64)});expect(screen.queryByText(lang==='en'?'No unresolved calls remain.':'没有待核验调用。')).toBeNull();
});
it.each(['en','zh-CN'] as const)('settles the late bill of a reviewed legacy outcome through the company ledger in %s',async lang=>{
  setLanguage(lang);const posts:{url:string;body:any}[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){posts.push({url:String(url),body:JSON.parse(String(init.body))});return response({});}return String(url).endsWith('/execution-recovery')?response({attempts:[],holds:[]}):String(url).endsWith('/calls')?response({items:[{id:'reviewed-permit',world_id:'legacy-world',source_kind:'world',source_id:'abandoned-source-call',actual_tokens:null,reviewed:1}]}):response({items:[]});});
  render(<BossRecovery revision={7} onDone={()=>{}}/>);await screen.findByText(/Confirm verified usage|确认已核验用量/);fireEvent.change(screen.getByLabelText(lang==='en'?'Verified tokens':'已核验 Tokens'),{target:{value:'40'}});fireEvent.change(screen.getByLabelText(lang==='en'?'Verified cost (CNY)':'已核验费用（人民币）'),{target:{value:'0.001'}});fireEvent.change(screen.getByLabelText(lang==='en'?'Receipt and verification reason':'回执与核验依据'),{target:{value:'Verified late receipt for the already abandoned outcome'}});fireEvent.click(screen.getByRole('button',{name:lang==='en'?'Record verified settlement':'记录已核验结算'}));await waitFor(()=>expect(posts).toHaveLength(1));expect(posts[0].url).toContain('/automation/calls/reviewed-permit/reconcile');expect(posts[0].body).toMatchObject({actualTokens:40,costCny:0.001,expectedRevision:7});
});
it.each(['en','zh-CN'] as const)('retries an uncertain recovery response with the complete original request after a newer revision in %s',async lang=>{
  setLanguage(lang);const posts:any[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));if(posts.length===1)throw new Error('Synthetic lost response after commit');return response({});}return String(url).endsWith('/execution-recovery')?response({attempts:[],holds:[]}):String(url).endsWith('/calls')?response({items:[{id:'pending-bill',world_id:null,source_kind:'company_worker',source_id:'source',actual_tokens:40}]}):response({items:[]});});
  const view=render(<BossRecovery revision={6} onDone={()=>{}}/>);await screen.findByText(/Confirm verified usage|确认已核验用量/);fireEvent.change(screen.getByLabelText(lang==='en'?'Verified cost (CNY)':'已核验费用（人民币）'),{target:{value:'0.001'}});fireEvent.change(screen.getByLabelText(lang==='en'?'Receipt and verification reason':'回执与核验依据'),{target:{value:'The exact original verified receipt'}});fireEvent.click(screen.getByRole('button',{name:lang==='en'?'Record verified settlement':'记录已核验结算'}));await screen.findByRole('alert');view.rerender(<BossRecovery revision={7} onDone={()=>{}}/>);expect((screen.getByLabelText(lang==='en'?'Verified cost (CNY)':'已核验费用（人民币）') as HTMLInputElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:lang==='en'?'Retry pending recovery':'重试未确认核验'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1]).toEqual(posts[0]);
});
it.each(['en','zh-CN'] as const)('shows a readable payment address error in %s',async language=>{
  setLanguage(language);vi.spyOn(globalThis,'fetch').mockImplementation(async(_url,init)=>init?.method==='PUT'?response({detail:'EVM_PUBLIC_ADDRESS_REQUIRED'},500):response({items:[]}));render(<BossPayment onDone={()=>{}}/>);
  await waitFor(()=>expect(screen.getByRole('combobox')).toBeTruthy());fireEvent.change(screen.getByRole('combobox'),{target:{value:'bsc'}});fireEvent.change(screen.getByRole('textbox'),{target:{value:'invalid-address'}});
  await waitFor(()=>expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));fireEvent.click(screen.getByRole('button'));await screen.findByRole('alert');expect(screen.getByRole('alert').textContent).toContain(language==='en'?'Enter a valid BSC':'请输入有效的 BSC');expect(screen.getByRole('alert').textContent).not.toContain('EVM_PUBLIC_ADDRESS_REQUIRED');
});
