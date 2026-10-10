import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OwnerActionCard } from '../src/features/owner/OwnerActionCard';
import { OwnerConsole } from '../src/features/owner/OwnerConsole';
import { OwnerInbox } from '../src/features/owner/OwnerInbox';
import { executeOwnerAction, fetchOwnerOverview } from '../src/api/owner';
import { enableWorlds, selectWorld } from '../src/api/worldScope';
import { setLanguage } from '../src/i18n';
const proposal={id:'batch-1',requiresApproval:true as const,action:{type:'qianji_chat' as const,targets:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],message:'Report'}};
const response=(data:unknown)=>({ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>data}) as Response;
beforeEach(()=>{localStorage.clear();setLanguage('en');window.history.replaceState(null,'','/OWNER');});afterEach(()=>{cleanup();vi.restoreAllMocks();enableWorlds(false);});
describe('Owner Mission Control',()=>{
  it('shows six live status values above Boss chat in both languages, retaining values with a stale warning on failure',async()=>{
    const data={asOf:Date.now(),summary:{currentGeneration:'G0019',pixelCount:45,runningWorlds:2,pendingApprovals:3,availableEnergy:123456,serviceStatus:'ready'},inbox:[],activity:[],availability:{business:true,upgrade:'available'}};
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response(data));
    vi.useFakeTimers();
    try {
    render(<OwnerConsole/>);
    await act(async()=>{});
    const table=screen.getByRole('table',{name:'Status overview'});
    expect(within(table).getByText('G0019')).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByRole('row',{name:'Total pixels 45'})).toBeTruthy();
    expect(within(table).getByRole('row',{name:'Running tasks 2'})).toBeTruthy();
    expect(within(table).getByRole('row',{name:'Pending approvals 3'})).toBeTruthy();
    expect(within(table).getByRole('row',{name:'Available energy 123,456'})).toBeTruthy();
    expect(within(table).getByRole('row',{name:'Service status Ready'})).toBeTruthy();
    expect(table.compareDocumentPosition(screen.getByRole('textbox'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(()=>setLanguage('zh-CN'));
    expect(screen.getByRole('table',{name:'状态总览'})).toBe(table);
    expect(within(table).getByRole('row',{name:'服务状态 正常'})).toBeTruthy();
    for(const name of ['当前运行版本','元胞总数','运行中任务数','待处理审批数','可用能量'])expect(within(table).getByRole('rowheader',{name})).toBeTruthy();
    fireEvent.click(screen.getByRole('link',{name:/待办事项/}));expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:'Boss'}));
      fetch.mockResolvedValue(response({...data,summary:{...data.summary,availableEnergy:0,serviceStatus:'paused'}}));
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
      expect(within(table).getByRole('row',{name:'可用能量 0'})).toBeTruthy();
      expect(within(table).getByRole('row',{name:'服务状态 已暂停'})).toBeTruthy();
      fetch.mockRejectedValue(new Error('connection lost'));
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
      expect(screen.getByRole('alert').textContent).toContain('之前显示的数据可能已过期');
      expect(within(table).getByRole('row',{name:'服务状态 不可用'})).toBeTruthy();
      expect(within(table).getByRole('row',{name:'元胞总数 45'})).toBeTruthy();
      act(()=>setLanguage('en'));
      expect(screen.getByRole('alert').textContent).toContain('Previously displayed data may be stale');
      fetch.mockResolvedValue(response({...data,summary:{...data.summary,pixelCount:null,availableEnergy:null,serviceStatus:'attention'}}));
      await act(async()=>{await vi.advanceTimersByTimeAsync(5000);});
      expect(screen.queryByRole('alert')).toBeNull();
      expect(within(table).getByRole('row',{name:'Total pixels Unavailable'})).toBeTruthy();
      expect(within(table).getByRole('row',{name:'Available energy Unavailable'})).toBeTruthy();
      expect(within(table).getByRole('row',{name:'Service status Needs attention'})).toBeTruthy();
    } finally {vi.useRealTimers();}
  });
  it('reports missing source timestamps explicitly in both languages',()=>{
    const content=<OwnerInbox onDone={()=>{}} items={[{id:'unknown',type:'external',title:'External outcome unknown',summary:'Task',priority:'critical',createdAt:null,source:'business_tasks',href:'/GENE?view=business'}]}/>;
    render(content);
    expect(screen.getByText('business_tasks · Time not recorded.')).toBeTruthy();
    act(()=>setLanguage('zh-CN'));expect(screen.getByText('business_tasks · 未记录时间。')).toBeTruthy();
  });
  it('requires explicit confirmation before sending, and labels acceptance independently from replies',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({created:true}));render(<OwnerActionCard proposal={proposal}/>);
    expect(fetch).not.toHaveBeenCalled();expect((screen.getByRole('button',{name:'Confirm action'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Confirm action'}));
    await screen.findByText('Messages accepted. Follow replies in History or QIAN.');expect(fetch).toHaveBeenCalledTimes(3);
  });
  it('limits batches to two in flight and retains per-recipient request keys after partial failure',async()=>{
    let active=0,max=0;const attempts:Record<string,string[]>={};let first=true;
    vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const id=String(input).split('/').at(-2)!;const key=JSON.parse(String(init!.body)).idempotencyKey;(attempts[id]??=[]).push(key);
      active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;
      if(id==='b'&&first){first=false;throw new Error('connection lost');}return response({created:true});
    });
    const firstResult=await executeOwnerAction(proposal);expect(firstResult.filter(r=>!r.ok).map(r=>r.id)).toEqual(['b']);
    await executeOwnerAction(proposal);expect(max).toBe(2);expect(attempts.a).toHaveLength(1);expect(attempts.c).toHaveLength(1);expect(attempts.b).toHaveLength(2);for(const keys of Object.values(attempts))expect(new Set(keys).size).toBe(1);
    await expect(executeOwnerAction({id:'bad',requiresApproval:true,action:{type:'shell'}} as any)).rejects.toThrow('OWNER_ACTION_DENIED');
  });
  it('uses the global endpoint even when a World was selected',async()=>{
    enableWorlds(true);selectWorld('world-a');const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({}));await fetchOwnerOverview();expect(fetch.mock.calls[0]![0]).toBe('/api/owner/overview');
  });
  it('defaults to Boss and keeps all three pages separate in both languages',async()=>{
    window.location.hash='';
    vi.spyOn(globalThis,'fetch').mockResolvedValue(response({asOf:Date.now(),summary:{qianjiCount:2,activeWorlds:2,runningWorlds:1,inboxCount:0,currentGeneration:'G0001'},inbox:[],activity:[{id:'tip',type:'Tips',summary:'Actual customer reminder',source:'tips.md',createdAt:Date.now(),href:'/YUAN?world=a'}],availability:{business:true,upgrade:'unavailable'},work:{tasks:[{id:'task1',personName:'A',state:'RUNNING',instruction:'Separate work summary',updatedAt:1}],codeReports:[]}}));
    const {container}=render(<OwnerConsole/>);await screen.findByRole('link',{name:/To-dos\s*0/});
    expect(screen.getByRole('textbox',{name:'Ask the Owner assistant'})).toBeTruthy();
    expect(screen.getByRole('link',{name:'Boss'}).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('heading',{name:'To-dos (0)'})).toBeNull();
    expect(screen.queryByText('Actual customer reminder')).toBeNull();
    expect(screen.queryByText('Separate work summary')).toBeNull();
    expect(screen.queryByText('Upgrade service unavailable.')).toBeNull();
    expect(container.querySelector('.owner-summary,.owner-content-grid,.owner-tabs,.owner-page-header')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Unsent draft'}});
    for(const lang of ['en','zh-CN'] as const){
      act(()=>setLanguage(lang));
      const todos=lang==='en'?'To-dos':'待办事项',history=lang==='en'?'History':'历史记录';
      fireEvent.click(screen.getByRole('link',{name:new RegExp(todos)}));
      expect(screen.getByRole('heading',{name:`${todos} (0)`})).toBeTruthy();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByText('Actual customer reminder')).toBeNull();
      fireEvent.click(screen.getByRole('link',{name:history}));
      expect(screen.getByRole('heading',{name:history})).toBeTruthy();
      expect(screen.getByText('Actual customer reminder')).toBeTruthy();
      expect(screen.queryByRole('heading',{name:`${todos} (0)`})).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      fireEvent.click(screen.getByRole('link',{name:'Boss'}));
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Unsent draft');
      expect(screen.queryByText('Actual customer reminder')).toBeNull();
    }
  });
  it('follows direct links and hash changes for all three pages',async()=>{
    window.location.hash='#owner-activity';
    const activity=[{id:'tip',type:'Tips',summary:'Timeline item',source:'tips.md',createdAt:Date.now(),href:'/YUAN?world=a'}];
    vi.spyOn(globalThis,'fetch').mockResolvedValue(response({asOf:Date.now(),summary:{qianjiCount:1,activeWorlds:1,runningWorlds:0,inboxCount:1,currentGeneration:'G0001'},
      inbox:[{id:'plan:1',type:'plan',title:'Business plan approval',summary:'Plan',priority:'normal',createdAt:Date.now(),source:'business_plans',href:'/GENE?view=plans&id=1',actions:[],approveEffect:'x',rejectEffect:'y'}],
      activity,availability:{business:true,upgrade:'not_configured'}}));
    render(<OwnerConsole/>);await screen.findByText('Timeline item');
    expect(screen.queryByText('Business plan approval')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    window.location.hash='#owner-inbox';act(()=>{window.dispatchEvent(new HashChangeEvent('hashchange'));});
    await waitFor(()=>expect(screen.getByText('Business plan approval')).toBeTruthy());
    expect(screen.queryByText('Timeline item')).toBeNull();
    window.location.hash='#owner-mission';act(()=>{window.dispatchEvent(new HashChangeEvent('hashchange'));});
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByText('Business plan approval')).toBeNull();
    expect(screen.getByRole('link',{name:'Boss'}).getAttribute('aria-current')).toBe('page');
  });
  it('executes the approve decision with one click and shows both effects, per item',async()=>{
    window.location.hash='#owner-inbox';
    const fetch=vi.spyOn(globalThis,'fetch');
    fetch.mockResolvedValue(response({asOf:Date.now(),summary:{qianjiCount:1,activeWorlds:1,runningWorlds:0,inboxCount:1,currentGeneration:'G0001'},
      inbox:[{id:'plan:1',type:'plan',title:'Business plan approval',summary:'Plan',priority:'normal',createdAt:Date.now(),source:'business_plans',href:'/GENE?view=plans&id=1',
        approveEffect:'Authorizes the budget.',rejectEffect:'Stops the plan.',
        actions:[{id:'business_plan_approve:1:1:abc',requiresApproval:true,action:{type:'business_plan_approve',plan:{id:'1',revision:1,hash:'abc',state:'AWAITING_APPROVAL',plan:{title:'T',objective:'O',budgetMicros:1000000,expiresAt:Date.now(),stopCondition:'never'} as any,spentMicros:0,reservedMicros:0}}},
                 {id:'business_plan_reject:1:1:abc',requiresApproval:true,action:{type:'business_plan_reject',plan:{id:'1',revision:1,hash:'abc',state:'AWAITING_APPROVAL',plan:{title:'T',objective:'O',budgetMicros:1000000,expiresAt:Date.now(),stopCondition:'never'} as any,spentMicros:0,reservedMicros:0}}}]}],
      activity:[],availability:{business:true,upgrade:'not_configured'}}));
    render(<OwnerConsole/>);await screen.findByText('Authorizes the budget.');expect(screen.getByText('Stops the plan.')).toBeTruthy();
    const effects=[...document.querySelectorAll('.owner-effect')];expect(effects).toHaveLength(2);
    // No checkbox and no nested confirm gate: the button is clickable immediately.
    expect(screen.queryByRole('checkbox')).toBeNull();
    const approve=screen.getByRole('button',{name:'Approve'}) as HTMLButtonElement;expect(approve.disabled).toBe(false);
    fetch.mockClear();fetch.mockResolvedValue(response({ok:true}));
    fireEvent.click(approve);
    await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0]![0])).toBe('/api/business/plans/1/approve');
  });
  it('keeps verification to-dos on the To-dos page without decision buttons',async()=>{
    window.location.hash='';
    vi.spyOn(globalThis,'fetch').mockResolvedValue(response({asOf:Date.now(),summary:{qianjiCount:1,activeWorlds:1,runningWorlds:0,inboxCount:0,currentGeneration:'G0001'},inbox:[],
      alerts:[{id:'run:w1:r1',kind:'run',severity:'critical',title:'Run needs attention',summary:'CALL_OUTCOME_UNKNOWN (1)',createdAt:Date.now(),source:'runs / operations',href:'/YUAN?world=w1'},
              {id:'upgrade:c1',kind:'upgrade',severity:'normal',title:'Upgrade candidate ready',summary:'c1 · abc · def',createdAt:Date.now(),source:'Upgrade Service',href:'http://127.0.0.1:8766/'}],
      activity:[],availability:{business:true,upgrade:'unavailable'}}));
    render(<OwnerConsole/>);
    await screen.findByRole('link',{name:/To-dos\s*0/});
    expect(screen.queryByText('Run needs attention')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:/To-dos/}));
    await screen.findByText('Run needs attention');expect(screen.getByText('Upgrade candidate ready')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Approve'})).toBeNull();expect(screen.queryByRole('button',{name:'Reject'})).toBeNull();
    expect(screen.getByText('Run needs attention').closest('article')!.querySelector('a[href="/YUAN?world=w1"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('link',{name:'History'}));
    expect(screen.queryByText('Run needs attention')).toBeNull();expect(screen.queryByText('Upgrade candidate ready')).toBeNull();
  });
  it('retains a reply that finishes while another page is open',async()=>{
    let finish!:(value:Response)=>void;
    vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input)==='/api/owner/chat'?new Promise(resolve=>{finish=resolve;}):response({asOf:Date.now(),summary:{},inbox:[],activity:[],availability:{business:true,upgrade:'available'}}));
    render(<OwnerConsole/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Report progress'}});
    fireEvent.click(screen.getByRole('button',{name:'Send'}));
    fireEvent.click(screen.getByRole('link',{name:'History'}));
    await act(async()=>finish(response({answer:'Reply completed in background',sources:[],as_of:new Date().toISOString(),usage:{tokens:1,cost_cny:null}})));
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:'Boss'}));
    expect(screen.getByText('Reply completed in background')).toBeTruthy();
    expect((screen.getByRole('button',{name:'Clear chat'}) as HTMLButtonElement).disabled).toBe(false);
  });
});
