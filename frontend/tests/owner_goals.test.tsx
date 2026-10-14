import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OwnerCompany, OwnerTokenQuota } from '../src/features/owner/OwnerCompany';
import { OwnerGoals } from '../src/features/owner/OwnerGoals';
import { OwnerConsole } from '../src/features/owner/OwnerConsole';
import { setLanguage, t } from '../src/i18n';
import { en } from '../src/i18n/en';
import { zhCN } from '../src/i18n/zh-CN';
import type { OwnerAutomation, OwnerGoal } from '../src/api/owner';
const automation:OwnerAutomation={desiredMode:'OFF',runMode:'BOUNDED',requestedRounds:7,startedRounds:0,completedRounds:0,reservedRounds:0,maxTokens:0,spentTokens:0,reservedTokens:0,knownCostCny:0,unknownCostCalls:0,revision:0,batchId:'initial',updatedAt:0,reason:null,observedState:'STOPPED',inFlight:0};
const goal:OwnerGoal={id:'goal-test',revision:3,specificationRevision:2,title:'Market research',objective:'Produce a draft',acceptance:{kind:'artifact',filename:'result.md',minBytes:10},maxTokens:100000,status:'READY',nextAction:'',reason:null,verifiedCount:0,evidenceCount:0,spentTokens:30,reservedTokens:0,createdAt:1,updatedAt:2,lastScheduledAt:0};
const response=(data:unknown,ok=true)=>({ok,status:ok?200:409,headers:new Headers({'content-type':'application/json'}),json:async()=>data}) as Response;
beforeEach(()=>setLanguage('en'));
afterEach(()=>{cleanup();vi.restoreAllMocks();setLanguage('en');localStorage.clear();window.history.replaceState(null,'','/');});
describe('V29 goal-first bilingual Owner UI',()=>{
  it.each(['en','zh-CN'] as const)('creates an explicitly authorized goal without a model call in %s',async lang=>{
    setLanguage(lang);const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response(goal)),done=vi.fn(async()=>{});
    render(<OwnerGoals goals={[]} automation={automation} onDone={done}/>);
    fireEvent.click(screen.getByRole('button',{name:t('Add goal')}));fireEvent.click(screen.getByText(t('Advanced acceptance settings')));fireEvent.change(screen.getByLabelText(t('Acceptance rule')),{target:{value:'artifact'}});
    fireEvent.change(screen.getByLabelText(t('Describe the business goal')),{target:{value:'Validate a service research draft'}});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:t('Confirm goal')})));await vi.waitFor(()=>expect(done).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][0]).toBe('/api/owner/goals');const body=JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({objective:'Validate a service research draft',acceptance:{kind:'artifact',filename:'result.md',minBytes:100}});expect(body.idempotencyKey).toBeTruthy();expect(fetch.mock.calls.some(c=>String(c[0]).includes('/chat'))).toBe(false);
  });
  it('keeps goal drafts on language changes and uses one stable request key after a lost response',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('Network disconnected')).mockResolvedValue(response(goal));
    render(<OwnerGoals goals={[]} automation={automation} onDone={async()=>{}}/>);fireEvent.click(screen.getByRole('button',{name:'Add goal'}));fireEvent.change(screen.getByLabelText('Describe the business goal'),{target:{value:'Preserve this draft'}});
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Confirm goal'})));expect(screen.getByRole('alert').textContent).toContain('Network disconnected');
    act(()=>setLanguage('zh-CN'));expect((screen.getByLabelText('描述经营目标') as HTMLTextAreaElement).value).toBe('Preserve this draft');
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'确认目标'})));
    const bodies=fetch.mock.calls.map(c=>JSON.parse(c[1]!.body as string));expect(bodies[1].idempotencyKey).toBe(bodies[0].idempotencyKey);
  });
  it.each(['en','zh-CN'] as const)('defaults to Boss chat with compact control, progress and read-only usage (%s)',async lang=>{
    setLanguage(lang);const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({asOf:Date.now(),goals:[goal],automation,summary:{currentGeneration:'G0025'},people:[],inbox:[],activity:[],availability:{business:true,upgrade:'not_configured'}}));
    render(<OwnerConsole/>);await screen.findByRole('switch',{name:t('Company automation')});
    const company=screen.getByRole('region',{name:t('Company control and progress')});expect(within(company).getAllByRole('switch')).toHaveLength(1);expect(screen.getByRole('heading',{name:t('Boss chat')})).toBeTruthy();
    expect(screen.queryByRole('table',{name:t('Status overview')})).toBeNull();expect(screen.queryByRole('region',{name:t('Business goals')})).toBeNull();expect(screen.queryByRole('spinbutton')).toBeNull();
    await act(async()=>fireEvent.click(screen.getByRole('switch')));expect(JSON.parse(fetch.mock.calls.find(c=>c[0]==='/api/owner/automation')![1]!.body as string)).toMatchObject({desiredMode:'ON',expectedRevision:0});
    fireEvent.click(screen.getByRole('link',{name:t('Business goals')}));expect(screen.getByRole('heading',{name:'Market research'})).toBeTruthy();expect(screen.getByRole('table',{name:t('Status overview')})).toBeTruthy();expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.queryByLabelText(t('Run mode'))).toBeNull();expect(screen.queryByLabelText(t('Goal token authorization'))).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();fireEvent.click(screen.getByRole('link',{name:t('Boss chat')}));
    expect(screen.getByRole('heading',{name:t('Boss chat')})).toBeTruthy();expect(screen.getByRole('textbox')).toBeTruthy();expect(screen.queryByRole('table')).toBeNull();expect(screen.queryByRole('spinbutton')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:new RegExp(t('To-dos'))}));expect(screen.queryByRole('table')).toBeNull();
  });
  it('keeps OFF usable and exposes usage without a quota approval form',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({}));const done=async()=>{};
    const {unmount}=render(<OwnerCompany automation={{...automation,desiredMode:'ON',observedState:'RUNNING'}} onDone={done}/>);
    await act(async()=>fireEvent.click(screen.getByRole('switch')));expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({desiredMode:'OFF'});unmount();
    render(<OwnerTokenQuota automation={{...automation,desiredMode:'ON',observedState:'LIMIT_REACHED',maxTokens:1_000_000_000,spentTokens:1_000_000_000}} onDone={done}/>);
    fireEvent.click(screen.getByText(t('Advanced usage and recovery')));
    expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.getByText(/Model API calls incur real costs/)).toBeTruthy();expect(fetch).toHaveBeenCalledOnce();
  });
  it('has matching English and Chinese keys for every new goal/control label',()=>{
    for(const key of Object.keys(en).filter(k=>k.startsWith('Goal status:')||k.startsWith('Goal event:')||k.startsWith('Automation state:')||k.startsWith('OWNER_'))){expect(zhCN[key],key).toBeTruthy();expect(en[key],key).not.toBe(key);}
  });
});
