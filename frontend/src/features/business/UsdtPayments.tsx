import {apiRequest} from '../../api/client';
const chainLabels={solana:'Solana · USDT',bsc:'BSC · Binance-Peg USDT',polygon:'Polygon PoS · USDT0',tron:'TRON · TRC-20 USDT'};
export const usdtAmount=(atomic:unknown,decimals=6)=>{const n=BigInt(String(atomic??'0')),unit=10n**BigInt(decimals);return `${n/unit}.${(n%unit).toString().padStart(decimals,'0').replace(/0+$/,'')||'0'} USDT`;};
export function UsdtPayments({rails,invoices,unmatched,worlds,monitor,legacy,busy,act}:{rails:any[];invoices:any[];unmatched:any[];worlds:any[];monitor:any;legacy:any;busy:boolean;act:(fn:()=>Promise<unknown>)=>Promise<void>}){
  return <><h3>四链 USDT 收款设置</h3><p>按链填写公开收款地址。系统核验到账，不保存私钥、不转出资金。</p><p>监听状态：{monitor?.state} {monitor?.error}</p>
    {(Object.entries(chainLabels) as [keyof typeof chainLabels,string][]).map(([chain,label])=>{const rail=rails.find(r=>r.chain===chain);return <form key={chain+':'+(rail?.config_revision??0)} aria-label={label+'收款设置'} onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act(()=>apiRequest('/api/payments/rails',{method:'PUT',body:JSON.stringify({rail_id:rail?.rail_id??'usdt_'+chain,chain,network:'mainnet',recipient_address:f.get('recipient'),status:f.get('status'),expected_revision:rail?.config_revision??0,rpc_id:chain+'-mainnet'})}));}}>
      <h4>{label} · 主网</h4><label>公开收款地址<input name="recipient" required defaultValue={rail?.recipient_address??''} placeholder={chain==='solana'?'Solana 钱包地址':chain==='tron'?'T 开头的 TRON 地址':'0x 开头的地址'}/></label>
      <label>收款状态<select name="status" defaultValue={rail?.status??'ENABLED'}><option value="ENABLED">启用（验证链及代币）</option><option value="DISABLED">停用</option></select></label><button disabled={busy}>保存 {label} 地址</button>
      {rail&&<p>配置版本 {rail.config_revision} · 代币合约 {rail.mint}</p>}</form>;})}
    {legacy&&Number(legacy.receipts)>0&&<p>旧 USDC 回执已归档保留，不计入 USDT 收入。</p>}
    <h3>创建 USDT 发票</h3><p>Solana 使用独立 Reference。其他三条链在报价上增加最多 0.009999 USDT 的唯一尾数；实际应付金额以发票为准。必须完整支付小数位，尾数过期也不复用。</p>
    <form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act(()=>apiRequest('/api/payments/invoices',{method:'POST',body:JSON.stringify({qianji_id:f.get('qianji'),rail_id:f.get('rail'),amount:f.get('amount'),idempotency_key:crypto.randomUUID()})}));}}>
      <label>归属千机 / World<select name="qianji" required>{worlds.filter(w=>w.status==='ACTIVE').map(w=><option key={w.world_id} value={w.qianji_id}>{w.qianji_id} / {w.world_id}</option>)}</select></label>
      <label>收款链<select name="rail" required>{rails.filter(r=>r.status==='ENABLED').map(r=><option key={r.rail_id} value={r.rail_id}>{chainLabels[r.chain as keyof typeof chainLabels]} / {r.recipient_address}</option>)}</select></label>
      <label>USDT 报价金额<input name="amount" pattern="[0-9]+(\.[0-9]{1,6})?" required placeholder="10"/></label><button disabled={busy||!rails.some(r=>r.status==='ENABLED')}>生成应付金额与二维码</button>
    </form>
    {invoices.map(i=><article key={i.invoice_id}><strong>{chainLabels[i.chain as keyof typeof chainLabels]} · {i.status}</strong><p>报价：{i.quoted_amount} USDT</p><p>实际应付：<strong>{usdtAmount(i.amount_atomic,i.decimals)}</strong></p><p>{i.qianji_id} / {i.world_id}</p><p>收款地址：{i.recipient_address}</p>
      {i.chain==='solana'&&<p>Reference {i.reference}</p>}{i.status==='WAITING'&&<>{i.wallet_url&&<a href={i.wallet_url}>打开兼容钱包支付</a>}<img width="240" height="240" src={'/api/payments/invoices/'+i.invoice_id+'/qr'} alt={i.chain==='tron'?'TRON 收款地址二维码':'USDT 发票二维码'}/>{i.chain==='tron'&&<p>二维码包含收款地址。请在钱包选择 TRC-20 USDT，并输入上述完整应付金额。</p>}</>}
      <button disabled={busy} onClick={()=>void act(()=>apiRequest('/api/payments/invoices/'+i.invoice_id+'/scan',{method:'POST',body:'{}'}))}>核验链上状态</button></article>)}
    <h3>未归属收款</h3><p>没有匹配发票的到账只提示 Owner，不计入任一 World 收入。</p>{unmatched.map(u=><p key={u.chain+':'+u.signature+':'+u.transfer_index}>{chainLabels[u.chain as keyof typeof chainLabels]} / {u.signature} / {usdtAmount(u.amount_atomic,u.decimals)}</p>)}
  </>;
}
