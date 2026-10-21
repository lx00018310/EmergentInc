import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {BossAttentionCard} from '../src/features/boss/BossAttentionCard';
import {BossNodeProgress} from '../src/features/boss/BossNodeProgress';
import {CompanyProposalCard} from '../src/features/owner/CompanyProposalCard';
import {ApiError} from '../src/api/client';
import {setLanguage} from '../src/i18n';
import {en} from '../src/i18n/en';
import {zhCN} from '../src/i18n/zh-CN';
const {request}=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/api/owner',()=>({ownerGoalRequest:request,ownerError:(e:Error)=>e.message,executeOwnerAction:vi.fn()}));
beforeEach(()=>{localStorage.clear();request.mockReset();setLanguage('en');});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const nodeFacts={expectedRevision:7,planRevision:2,hash:'facts-hash',node:{key:'draft',title:'Draft stage',instruction:'Preserve actual facts',state:'DEFERRED',filename:'result.md',trigger:{kind:'once'},dependsOn:[],latestEvidence:[],occurrences:0,progressPolicy:{passPercent:80,allowIncompleteFrom:[],requirements:[{id:'fact',description:'Expected fact',contains:'Expected fact'}]}},actions:['SUPPLEMENT','CONTINUE_NODE','EXTEND_LIMITS','ADJUST_REQUIREMENTS','SKIP_NODE'],scope:{id:'original-scope',modelCalls:2,toolCalls:3,maxModelCalls:60,maxToolCalls:120},gaps:[{id:'missing-fact',description:'Original missing fact',status:'OPEN',nodeKeys:['draft'],attempts:[{key:'a',method:'First source failed'}],limit:3}]};
describe('bounded stage decisions in BOSS',()=>{
  it('refreshes a rejected task version and retains rework input for the next explicit decision',async()=>{
    let version=7,posts=0;request.mockImplementation(async(_path:string,method?:string)=>{if(!method)return {expectedRevision:version,hash:'version-'+version,actions:['REWORK_TASK']};posts++;if(posts===1){version=8;throw new ApiError(409,'OWNER_PROGRESS_CHANGED');}return {};});
    const onDone=vi.fn();render(<BossAttentionCard message={{id:'changed-card',entityId:'changed-card',title:'Task needs attention',priority:'critical',reason:'MODEL_RESPONSE_INVALID',alert:{id:'changed',taskId:'changed-task',goalId:'changed-goal',kind:'task',title:'Task needs attention',summary:'Draft',severity:'critical',createdAt:1,source:'company',href:'/BOSS'}}} revision={99} onDone={onDone} onAction={()=>{}}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Rework with instructions'}));fireEvent.change(screen.getByLabelText('Rework instructions'),{target:{value:'Retain my exact rework instructions.'}});
    fireEvent.click(screen.getByRole('button',{name:'Submit rework instructions'}));await screen.findByRole('alert');
    await waitFor(()=>expect(request.mock.calls.filter(c=>!c[1])).toHaveLength(2));
    expect((screen.getByLabelText('Rework instructions') as HTMLTextAreaElement).value).toBe('Retain my exact rework instructions.');
    fireEvent.click(screen.getByRole('button',{name:'Submit rework instructions'}));await waitFor(()=>expect(onDone).toHaveBeenCalledOnce());
    expect(request.mock.calls.filter(c=>c[1]==='POST').at(-1)![2]).toMatchObject({expectedRevision:8,hash:'version-8'});
  });
  it('uses the actual goal revision, sends rework instructions separately, and reuses a lost request after remount',async()=>{
    request.mockImplementation(async(_path:string,method?:string)=>{if(!method)return {expectedRevision:7,hash:'current-task',actions:['REWORK_TASK','RETRY_TASK','STOP_TASK']};throw new ApiError(504,'response lost');});
    const props={message:{id:'card',entityId:'card',title:'Task needs attention',priority:'critical' as const,reason:'MODEL_RESPONSE_INVALID',alert:{id:'goal:goal-one',taskId:'task-one',goalId:'goal-one',kind:'task',title:'Task needs attention',summary:'Failed draft',severity:'critical' as const,createdAt:1,source:'company',href:'/BOSS'}},revision:99,onDone:vi.fn(),onAction:vi.fn()};
    const first=render(<BossAttentionCard {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Rework with instructions'}));
    fireEvent.change(screen.getByLabelText('Rework instructions'),{target:{value:'Use the actual revised source material.'}});fireEvent.click(screen.getByRole('button',{name:'Submit rework instructions'}));
    await screen.findByRole('button',{name:'Retry original decision'});
    const original=request.mock.calls.find(c=>c[1]==='POST')![2];expect(original).toMatchObject({action:'REWORK_TASK',expectedRevision:7,hash:'current-task',instructions:'Use the actual revised source material.'});
    first.unmount();request.mockImplementation(async(_path:string,method?:string)=>method?{}:{expectedRevision:8,hash:'new-task',actions:['REWORK_TASK']});
    render(<BossAttentionCard {...props}/>);fireEvent.click(await screen.findByRole('button',{name:'Retry original decision'}));
    await waitFor(()=>expect(props.onDone).toHaveBeenCalledOnce());
    expect(request.mock.calls.filter(c=>c[1]==='POST').at(-1)![2]).toEqual(original);
  });
  it.each(['en','zh-CN'] as const)('shows missing items and posts finite stage decisions in %s',async language=>{
    setLanguage(language);request.mockImplementation(async()=>nodeFacts);render(<BossNodeProgress goalId="goal" nodeKey="draft" onDone={vi.fn()}/>);
    fireEvent.click(await screen.findByText(/Draft stage/));
    expect(screen.getByText(language==='en'?'The automatic window starts with execution.':'自动执行时限从实际执行时开始。')).toBeTruthy();
    expect(screen.getAllByText('Original missing fact',{exact:false}).length).toBeGreaterThan(0);
    const material=language==='en'?'Owner-supplied material':'老板补充的资料';fireEvent.change(screen.getByLabelText(material),{target:{value:'The actual source supplied by the owner.'}});
    fireEvent.click(screen.getByRole('button',{name:language==='en'?'Save material':'保存资料'}));
    await waitFor(()=>expect(request.mock.calls.some(c=>c[1]==='POST')).toBe(true));
    expect(request.mock.calls.find(c=>c[1]==='POST')![2]).toMatchObject({action:'SUPPLEMENT',expectedRevision:7,planRevision:2,hash:'facts-hash',text:'The actual source supplied by the owner.'});
    expect(Object.keys(en).filter(k=>k.startsWith('OWNER_PROGRESS_')).every(k=>Boolean(zhCN[k])&&en[k]!==zhCN[k])).toBe(true);
  });
  it('submits a rework with no instructions instead of requiring free text',async()=>{
    request.mockImplementation(async(_path:string,method?:string)=>method?{}:{expectedRevision:7,hash:'reviewed-task',actions:['REWORK_TASK']});
    const onDone=vi.fn();
    render(<BossAttentionCard message={{id:'goal:reviewed',entityId:'goal:reviewed',title:'Goal needs attention',priority:'critical',reason:'OWNER_EXECUTION_REVIEWED',alert:{id:'goal:reviewed',taskId:'stopped-task',goalId:'reviewed',kind:'goal',title:'Goal needs attention',summary:'Stopped work',severity:'critical',createdAt:1,source:'owner_goals',href:'/BOSS'}}} revision={99} onDone={onDone} onAction={vi.fn()}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Rework with instructions'}));
    // The empty instruction box must not gate the decision: the action itself is the authorization.
    expect((screen.getByRole('button',{name:'Submit rework instructions'}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/8 characters/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Submit rework instructions'}));
    await waitFor(()=>expect(onDone).toHaveBeenCalledOnce());
    const body=request.mock.calls.find(c=>c[1]==='POST')![2];
    expect(body).toMatchObject({action:'REWORK_TASK',expectedRevision:7,hash:'reviewed-task'});
    expect(body.instructions).toBeUndefined();
  });
  it('keeps a reviewed task card actionable instead of pointing at an empty recovery dialog',async()=>{
    request.mockImplementation(async(_path:string,method?:string)=>method?{}:{expectedRevision:7,hash:'reviewed-task',actions:['REWORK_TASK']});
    render(<BossAttentionCard message={{id:'goal:reviewed',entityId:'goal:reviewed',title:'Goal needs attention',priority:'critical',reason:'OWNER_EXECUTION_REVIEWED',alert:{id:'goal:reviewed',taskId:'stopped-task',goalId:'reviewed',kind:'goal',title:'Goal needs attention',summary:'Stopped work',severity:'critical',createdAt:1,source:'owner_goals',href:'/BOSS'}}} revision={99} onDone={vi.fn()} onAction={vi.fn()}/>);
    // The prior outcome is already reviewed, so the recovery dialog would list nothing.
    expect(await screen.findByRole('button',{name:'Rework with instructions'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Review unresolved calls'})).toBeNull();
  });
  it('makes a partial close with zero artifacts reviewable without claiming complete delivery',()=>{
    const proposal={id:'partial-close',kind:'close_task' as const,goalId:'goal',goalRevision:1,hash:'hash',state:'PENDING' as const,createdAt:1,result:null,payload:{title:'Partial draft',completionKind:'partial',evidence:[],gaps:[{id:'gap',description:'Missing original source',attempts:3}]}};
    render(<CompanyProposalCard proposal={proposal}/>);
    expect(screen.getByText('Accepting this result closes the task as partially completed. Missing items remain recorded.')).toBeTruthy();
    expect(screen.getByRole('button',{name:'Approve'})).toBeTruthy();expect(screen.queryByRole('link',{name:'View task deliverables'})).toBeNull();
  });
});
