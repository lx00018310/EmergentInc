import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {UsdtPayments,usdtAmount} from '../src/features/business/UsdtPayments';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('lets Owner enter each of four addresses and submits fixed USDT chain metadata without a secret field',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>new Response('{}',{status:200,headers:{'Content-Type':'application/json'}})),act=async(fn:()=>Promise<unknown>)=>{await fn();};
  render(<UsdtPayments rails={[]} invoices={[]} unmatched={[]} worlds={[]} monitor={{state:'STOPPED'}} legacy={null} busy={false} act={act}/>);
  expect(screen.getAllByLabelText('公开收款地址')).toHaveLength(4);expect(screen.queryByLabelText(/私钥|助记词|USDC/)).toBeNull();
  const form=screen.getByRole('form',{name:'BSC · Binance-Peg USDT收款设置'});fireEvent.change(within(form).getByLabelText('公开收款地址'),{target:{value:'0x'+'12'.repeat(20)}});fireEvent.submit(form);
  await waitFor(()=>expect(fetcher).toHaveBeenCalledWith('/api/payments/rails',expect.objectContaining({body:JSON.stringify({rail_id:'usdt_bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'})})));
});
it('shows exact payable tail with BSC 18 decimals and uses only an address QR for TRON',()=>{
  const invoice={invoice_id:'i',chain:'tron',status:'WAITING',quoted_amount:'10.000000',amount_atomic:'10000001',decimals:6,recipient_address:'T-address',qianji_id:'q',world_id:'w',wallet_url:null};
  render(<UsdtPayments rails={[]} invoices={[invoice]} unmatched={[]} worlds={[]} monitor={null} legacy={null} busy={false} act={async fn=>{await fn();}}/>);
  expect(screen.getByText('10.000001 USDT')).toBeTruthy();expect(screen.getByAltText('TRON 收款地址二维码')).toBeTruthy();expect(screen.queryByRole('link',{name:'打开兼容钱包支付'})).toBeNull();
  expect(usdtAmount('10000001000000000000',18)).toBe('10.000001 USDT');
});
