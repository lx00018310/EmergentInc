import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {PublicApp} from '../src/features/public/PublicApp';
import {BackendLogin} from '../src/features/public/BackendLogin';
import {setLanguage} from '../src/i18n';

const products=['custom-service','product-2'].map(product_id=>({product_id,product_enabled:0,product_name_en:'',product_name_zh:'',product_description_en:'',product_description_zh:'',product_price:null,product_currency:'USDT'}));
const site={site_name:'EmergentInc',headline_en:'Store',headline_zh:'商城',description_en:'Our shared store',description_zh:'我们的共同商城',github_url:'',contact_text_en:'Contact',contact_text_zh:'联系'};
const response=(body:unknown,status=200)=>({ok:status<400,status,json:async()=>body}) as Response;
beforeEach(()=>{setLanguage('en');window.history.replaceState(null,'','/');Object.defineProperty(Element.prototype,'scrollIntoView',{value:vi.fn(),configurable:true});});
afterEach(()=>{cleanup();vi.restoreAllMocks();sessionStorage.clear();window.history.replaceState(null,'','/');});
it('shows two empty product cards in both languages, with details and disabled purchase',async()=>{
  vi.spyOn(globalThis,'fetch').mockImplementation(async input=>response(String(input).endsWith('/site')?site:{items:products}));
  render(<PublicApp/>);await screen.findByRole('heading',{name:'Product 01'});expect(screen.getByRole('heading',{name:'Product 02'})).toBeTruthy();
  expect(screen.getAllByRole('button',{name:'Buy / Start'}).every(button=>(button as HTMLButtonElement).disabled)).toBe(true);
  fireEvent.click(screen.getAllByRole('button',{name:'View details'})[1]!);await waitFor(()=>expect(screen.getAllByRole('heading',{name:'Product 02'})).toHaveLength(2));
  fireEvent.click(screen.getByRole('button',{name:'中文'}));expect(screen.getByRole('heading',{name:'商品 01'})).toBeTruthy();expect(screen.getAllByRole('heading',{name:'商品 02'})).toHaveLength(2);
  expect(screen.getByRole('button',{name:'后台'})).toBeTruthy();
});
it('opens an explicit password prompt from the homepage without requesting a session',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>response(String(input).endsWith('/site')?site:{items:products}));
  render(<PublicApp/>);await screen.findByRole('heading',{name:'Product 01'});fireEvent.click(screen.getByRole('button',{name:'Backend'}));
  expect(screen.getByRole('dialog',{name:'Backend login'})).toBeTruthy();expect((screen.getByLabelText('Owner secret') as HTMLInputElement).type).toBe('password');
  expect(fetch.mock.calls.every(([url])=>String(url).startsWith('/api/public/'))).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.queryByRole('dialog')).toBeNull();
});
it('rejects an incorrect secret, submits only to the login API, and navigates only after successful authentication',async()=>{
  let accepted=false;const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>response(accepted?{authenticated:true}:{detail:'INVALID_OWNER_SECRET'},accepted?200:401)),authenticated=vi.fn();
  render(<BackendLogin onClose={()=>{}} onAuthenticated={authenticated}/>);
  fireEvent.change(screen.getByLabelText('Owner secret'),{target:{value:'wrong-test-secret'}});fireEvent.submit(screen.getByRole('button',{name:'Log in'}).closest('form')!);
  await screen.findByRole('alert');expect(authenticated).not.toHaveBeenCalled();accepted=true;
  fireEvent.change(screen.getByLabelText('Owner secret'),{target:{value:'accepted-test-secret'}});fireEvent.submit(screen.getByRole('button',{name:'Log in'}).closest('form')!);
  await waitFor(()=>expect(authenticated).toHaveBeenCalledTimes(1));expect(fetch.mock.calls.every(([url])=>url==='/api/login')).toBe(true);
  expect(JSON.parse(String(fetch.mock.calls[1]![1]!.body))).toEqual({secret:'accepted-test-secret'});expect((screen.getByLabelText('Owner secret') as HTMLInputElement).value).toBe('');
});
it('looks up a delisted product order only through a valid private token link',async()=>{
  const id='order_12345678-1234-1234-1234-123456789abc',token='a'.repeat(64);
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
    if(String(input).endsWith('/site'))return response(site);if(String(input).endsWith('/products'))return response({items:products});
    expect((init!.headers as Record<string,string>).Authorization).toBe('Bearer '+token);
    return response({order_id:id,invoice_status:'PAID',chain:'bsc',quoted_amount:'10',amount:'10.000001',recipient_address:'test',token_contract:'test',expires_at:1});
  });render(<PublicApp/>);await screen.findByRole('heading',{name:'Product 01'});
  const form=screen.getByRole('button',{name:'Check order'}).closest('form')!;
  fireEvent.change(screen.getByLabelText('Private order link'),{target:{value:window.location.origin+'/#order='+id}});fireEvent.submit(form);
  await screen.findByRole('alert');expect(fetch.mock.calls).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Private order link'),{target:{value:window.location.origin+'/#order='+id+'&token='+token}});fireEvent.submit(form);
  await screen.findByText('Payment received. We will contact you using your order details.');expect(window.location.hash).toContain(token);
});
it('starts a new selected-product checkout after viewing an older order without reusing its private token',async()=>{
  const id='order_12345678-1234-1234-1234-123456789abc',token='a'.repeat(64);
  window.history.replaceState(null,'','/#order='+id+'&token='+token);
  const listed=products.map((product,index)=>({...product,product_enabled:1,product_name_en:'Service '+index,product_name_zh:'服务 '+index,product_price:'20'}));
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(async input=>{
    if(String(input).endsWith('/site'))return response(site);if(String(input).endsWith('/products'))return response({items:listed});
    if(String(input).endsWith('/payment-rails'))return response({items:[{rail_id:'bsc',chain:'bsc',asset:'USDT'}]});
    if(String(input).endsWith('/orders'))return response({order_id:id,public_order_token:token},201);
    return response({order_id:id,invoice_status:'PAID',chain:'bsc',quoted_amount:'10',amount:'10.000001',recipient_address:'test',token_contract:'test',expires_at:1});
  });render(<PublicApp/>);await screen.findByText('Payment received. We will contact you using your order details.');
  fireEvent.click(screen.getAllByRole('button',{name:'Buy / Start'})[1]!);await screen.findByRole('option');expect(window.location.hash).toBe('#orders');
  fireEvent.change(screen.getByLabelText('Your name'),{target:{value:'Test'}});fireEvent.change(screen.getByLabelText('Email or other contact'),{target:{value:'test@example.invalid'}});
  fireEvent.change(screen.getByLabelText('What would you like to build?'),{target:{value:'Second product'}});fireEvent.submit(screen.getByRole('button',{name:'Create order and USDT invoice'}).closest('form')!);
  await waitFor(()=>expect(fetch.mock.calls.some(([url])=>String(url).endsWith('/orders'))).toBe(true));
  const body=JSON.parse(String(fetch.mock.calls.find(([url])=>String(url).endsWith('/orders'))![1]!.body));expect(body.product_id).toBe('product-2');expect(body).not.toHaveProperty('price');
});
