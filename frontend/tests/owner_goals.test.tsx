import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {OwnerConsole} from '../src/features/owner/OwnerConsole';
import {CompanyProposalCard} from '../src/features/owner/CompanyProposalCard';
import {setLanguage,t} from '../src/i18n';
import {en} from '../src/i18n/en';
import {zhCN} from '../src/i18n/zh-CN';
const response=(value:unknown)=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>value}) as Response;
const proposal={id:'proposal_test',kind:'budget' as const,goalId:null,goalRevision:null,payload:{totalMicros:1000000},hash:'a'.repeat(64),state:'PENDING' as const,result:null,createdAt:1};
const data={asOf:1,summary:{},people:[],inbox:[],alerts:[],activity:[],goals:[],proposals:[proposal],taskPlans:[],budget:{currency:'CNY',totalMicros:1000000,spentMicros:10,reservedMicros:20,availableMicros:999970,activatedAt:1},automation:{observedState:'STOPPED',reason:null},availability:{business:true,upgrade:'not_configured'}};
beforeEach(()=>{localStorage.clear();setLanguage('en');window.history.replaceState(null,'','/OWNER');});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('V32 approval-only company UI',()=>{
  it.each(['en','zh-CN'] as const)('has exactly two navigation entries and read-only money/status charts (%s)',async lang=>{
    setLanguage(lang);vi.spyOn(globalThis,'fetch').mockResolvedValue(response(data));render(<OwnerConsole/>);
    const companyStatus=within(screen.getByRole('status'));
    expect(companyStatus.getByText(t('Company status'))).toBeTruthy();
    await companyStatus.findByText(t('Company observed: STOPPED'));
    expect(within(screen.getByRole('navigation')).getAllByRole('link').map(n=>n.textContent)).toEqual([t('Boss chat'),t('AI company dashboard')]);
    expect(screen.getByRole('textbox')).toBeTruthy();expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('link',{name:t('AI company dashboard')}));
    expect(screen.queryByRole('textbox')).toBeNull();expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
    expect(screen.getByRole('button',{name:t('Approve')})).toBeTruthy();expect(screen.getByRole('button',{name:t('Reject')})).toBeTruthy();
  });
  it.each(['approve','reject'] as const)('sends the exact proposal hash once for %s with a durable retry key',async decision=>{
    const done=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({...proposal,state:decision==='approve'?'EXECUTED':'REJECTED'}));
    render(<CompanyProposalCard proposal={proposal} onDone={done}/>);
    fireEvent.click(screen.getByRole('button',{name:t(decision==='approve'?'Approve':'Reject')}));
    await vi.waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({decision,hash:proposal.hash,idempotencyKey:decision+'_'+proposal.id});expect(screen.queryByRole('button')).toBeNull();
  });
  it('reuses an approval key after a lost response and does not declare success',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('Lost response')).mockResolvedValue(response({...proposal,state:'EXECUTED'}));render(<CompanyProposalCard proposal={proposal}/>);
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));await screen.findByRole('alert');expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Approve'}));await screen.findByRole('status');
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual(JSON.parse(fetch.mock.calls[1][1]!.body as string));
  });
  it('maps legacy links to the dashboard and retains an in-flight chat reply',async()=>{
    let finish!:(v:Response)=>void;vi.spyOn(globalThis,'fetch').mockImplementation(async input=>String(input)==='/api/owner/chat'?new Promise(resolve=>finish=resolve):response(data));render(<OwnerConsole/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Report progress'}});fireEvent.click(screen.getByRole('button',{name:t('发送')}));
    fireEvent.click(screen.getByRole('link',{name:'AI company dashboard'}));await act(async()=>finish(response({answer:'Actual retained report',sources:[],as_of:new Date().toISOString(),usage:{tokens:0,cost_cny:0}})));
    fireEvent.click(screen.getByRole('link',{name:'Boss chat'}));expect(screen.getByText('Actual retained report')).toBeTruthy();
    act(()=>{window.location.hash='#owner-goals';window.dispatchEvent(new Event('hashchange'));});expect(screen.getByRole('heading',{name:'AI company dashboard'})).toBeTruthy();
  });
  it('translates every new task, proposal, company state and error key',()=>{
    for(const key of Object.keys(en).filter(k=>/^(Task (node|trigger):|Company observed:|Proposal state:|OWNER_)/.test(k))){expect(zhCN[key],key).toBeTruthy();expect(en[key],key).not.toBe(key);}
  });
});
