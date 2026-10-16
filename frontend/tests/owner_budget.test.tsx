import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {OwnerBudget} from '../src/features/owner/OwnerBudget';
import {CompanyProposalCard} from '../src/features/owner/CompanyProposalCard';
import {setLanguage,t} from '../src/i18n';
import type {OwnerOverview} from '../src/api/owner';
const budget={currency:'CNY' as const,totalMicros:0,spentMicros:0,reservedMicros:0,availableMicros:0,revision:0,activatedAt:null,unknownCalls:0,configuration:null,needsRefill:false};
const data=(extra:object={})=>({budget:{...budget,...extra}} as OwnerOverview);
const response=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
beforeEach(()=>{localStorage.clear();setLanguage('en');});afterEach(()=>{cleanup();vi.restoreAllMocks();});
it.each([['zh-CN',2,'200 元','CNY',200000000],['en',0.3,'$30','USD',210000000]] as const)('defaults to 100M and saves the exact localized rate in %s',async(lang,price,amount,currency,micros)=>{
  setLanguage(lang);const onDone=vi.fn(),fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response({...budget,revision:1,totalMicros:micros,availableMicros:micros,activatedAt:1,configuration:{tokenMillions:100,unitPriceCnyMicros:micros/100}}));
  render(<OwnerBudget data={data()} onDone={onDone}/>);
  expect(screen.getByLabelText(t('Token quantity (M)'))).toHaveProperty('value','100');expect(screen.getByLabelText(t('Unit price ({0} / 1M Tokens)',[currency==='USD'?'$':'元']))).toHaveProperty('value',String(price));
  expect(screen.getByLabelText(t('Calculated allowance')).textContent).toBe(amount);expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:t('Save company budget')}));await screen.findByText(t('Company budget saved.'));
  expect(fetch).toHaveBeenCalledOnce();expect(fetch.mock.calls[0][0]).toBe('/api/owner/budget');
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({tokenMillions:100,unitPrice:price,priceCurrency:currency,expectedRevision:0});expect(onDone).toHaveBeenCalledOnce();
});
it('keeps edits during polling, converts the configured rate when language changes and rejects invalid quantities',()=>{
  const view=render(<OwnerBudget data={data({revision:3,configuration:{tokenMillions:200,unitPriceCnyMicros:2100000}})} onDone={vi.fn()}/>);
  const quantity=screen.getByLabelText('Token quantity (M)');expect(quantity).toHaveProperty('value','200');expect(screen.getByLabelText('Unit price ($ / 1M Tokens)')).toHaveProperty('value','0.3');
  fireEvent.change(quantity,{target:{value:'300'}});view.rerender(<OwnerBudget data={data({revision:4,configuration:{tokenMillions:200,unitPriceCnyMicros:2100000}})} onDone={vi.fn()}/>);expect(quantity).toHaveProperty('value','300');
  for(const value of ['0','10001','1.5']){fireEvent.change(quantity,{target:{value}});expect(screen.getByRole('button',{name:'Save company budget'})).toHaveProperty('disabled',true);}
});
it('retains the same save identity after a lost reply even if polling observes the new revision',async()=>{
  const saved={...budget,revision:1,totalMicros:210000000,availableMicros:210000000,configuration:{tokenMillions:100,unitPriceCnyMicros:2100000}},fetch=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValue(response(saved));
  const view=render(<OwnerBudget data={data()} onDone={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Save company budget'}));await screen.findByRole('alert');
  view.rerender(<OwnerBudget data={data(saved)} onDone={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Save company budget'}));await screen.findByText('Company budget saved.');
  expect(fetch.mock.calls[0][1]!.body).toBe(fetch.mock.calls[1][1]!.body);
});
it.each(['en','zh-CN'] as const)('reports the changed-quantity requirement and allows a fresh 200M save in %s',async lang=>{
  setLanguage(lang);const exhausted=data({revision:2,needsRefill:true,activatedAt:1,configuration:{tokenMillions:100,unitPriceCnyMicros:2000000}}),fetch=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(response({detail:'OWNER_BUDGET_TOKEN_CHANGE_REQUIRED'},409)).mockResolvedValue(response({...exhausted.budget,needsRefill:false,configuration:{tokenMillions:200,unitPriceCnyMicros:2000000}}));
  render(<OwnerBudget data={exhausted} onDone={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:t('Save company budget')}));expect((await screen.findByRole('alert')).textContent).toBe(t('OWNER_BUDGET_TOKEN_CHANGE_REQUIRED'));
  fireEvent.change(screen.getByLabelText(t('Token quantity (M)')),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:t('Save company budget')}));await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).tokenMillions).toBe(200);
});
it('keeps a historical budget proposal without budget approval buttons',()=>{
  render(<CompanyProposalCard proposal={{id:'old',kind:'budget',goalId:null,goalRevision:null,payload:{totalMicros:1000000},hash:'a'.repeat(64),state:'PENDING',result:null,createdAt:1}}/>);
  expect(screen.queryByRole('button')).toBeNull();expect(screen.getByText(t('Budget proposals are retired. Use Company money budget settings.'))).toBeTruthy();
});
