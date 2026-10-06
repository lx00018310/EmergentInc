import {useEffect,useState} from 'react';
import {apiRequest} from '../../api/client';
import {UsdtPayments} from './UsdtPayments';
type Tab='worlds'|'assets'|'payments';
export function V23Panel(){
  const [tab,setTab]=useState<Tab>('worlds'),[worlds,setWorlds]=useState<any[]>([]),[assets,setAssets]=useState<any[]>([]),[promotions,setPromotions]=useState<any[]>([]),[provenance,setProvenance]=useState<any[]>([]);
  const [rails,setRails]=useState<any[]>([]),[invoices,setInvoices]=useState<any[]>([]),[unmatched,setUnmatched]=useState<any[]>([]),[monitor,setMonitor]=useState<any>(),[migrations,setMigrations]=useState<any>();
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[review,setReview]=useState<any>(),[legacy,setLegacy]=useState<any>();
  async function refresh(){const [w,a,p,r,i,u,m]=await Promise.all([apiRequest<any>('/api/worlds'),apiRequest<any>('/api/gene/assets'),apiRequest<any>('/api/evolution/promotions'),
    apiRequest<any>('/api/payments/rails'),apiRequest<any>('/api/payments/invoices'),apiRequest<any>('/api/payments/unmatched'),apiRequest<any>('/api/evolution/migrations')]);
    setWorlds(w.items);setAssets(a.assets);setProvenance(a.provenance??[]);setPromotions(p.items);setRails(r.items);setLegacy(r.legacy);setMonitor(r.monitor);setInvoices(i.items);setUnmatched(u.items);setMigrations(m);}
  useEffect(()=>{void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(e=>setError(e.message)),10000);return()=>clearInterval(timer);},[]);
  async function act(fn:()=>Promise<unknown>){setBusy(true);setError('');try{await fn();await refresh();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <section><h2>全局 World · 遗传资产 · 收款</h2><p>Root、Genome、Evolution 全局共享。各 World 的 Current、元胞、技能和账本独立。</p>
    <nav>{([['worlds','世界'],['assets','基因资产'],['payments','链上收款']] as const).map(([id,label])=><button key={id} onClick={()=>setTab(id)} aria-current={tab===id?'page':undefined}>{label}</button>)}</nav>
    {error&&<p role="alert" className="business-error">{error}</p>}
    {tab==='worlds'&&<>{migrations?.items.map((m:any)=><article key={m.candidateId}><h3>{m.generation} 换代 · {m.state}</h3><p>World 总数 {m.total} · 已迁移 {m.successfulWorlds.length} · 失败 {m.failedWorlds.length}</p>{m.failedWorlds.map((w:any)=><p key={w.worldId}>{w.worldId}: {w.reason}</p>)}</article>)}{worlds.map(w=><article key={w.world_id}><strong>{w.qianji_id}</strong><p>{w.world_id} · {w.status} · {w.running?'运行中':'空闲'}</p>
      <p>内部入口 {w.gateway_pixel_id??'未设置'}</p><a href={'/YUAN?world='+encodeURIComponent(w.world_id)}>查看该世界</a><p>{w.blockedReason??w.runtimeFailure??''}</p></article>)}</>}
    {tab==='assets'&&<><h3>本代公共 Gene</h3>{assets.length?assets.map(a=><article key={a.id}><strong>{a.id} · v{a.version} · {a.kind}</strong><p>来源 Gene · 许可 {a.license}</p>{provenance.filter(p=>p.asset_id===a.id&&p.version===a.version).map(p=><p key={p.candidate_id}>来源 {p.world_id} / {p.pixel_id} · {p.generation_id} 正式遗传 · Snapshot {p.snapshot_hash}</p>)}<code>{a.contentHash}</code></article>):<p>本代尚无公共资产。</p>}
      <h3>资产晋升候选</h3><p>提名会冻结原始字节。审查通过后只提出方向；准确候选哈希仍由受信任 Supervisor 审批并出生。</p>
      {promotions.map(p=><article key={p.id}><strong>{p.kind} · {p.state}</strong><p>{p.world_id} / {p.pixel_id} / {p.source_path}</p><code>{p.snapshot_hash}</code>
        {p.state==='NOMINATED'&&<button disabled={busy} onClick={()=>void act(async()=>setReview(await apiRequest('/api/evolution/promotions/'+p.id)))}>审查快照来源</button>}</article>)}
      {review&&<form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void act(async()=>{await apiRequest('/api/evolution/promotions/'+review.id+'/propose',{method:'POST',body:JSON.stringify({shareConsent:f.get('consent')==='on',privacy:f.get('privacy'),license:f.get('license'),genericity:f.get('genericity'),point:f.get('point'),reason:f.get('reason'),effect:f.get('effect')})});setReview(undefined);});}}>
        <h3>审查 {review.id}</h3><pre>{JSON.stringify(review.metadata,null,2)}</pre><label>隐私分类<select name="privacy"><option value="PUBLIC">公开资产</option><option value="INTERNAL_NO_CUSTOMER_DATA">内部通用，无客户数据</option></select></label>
        {(['license','genericity','point','reason','effect'] as const).map((key,i)=><label key={key}>{['共享许可','通用性说明','要点','原因','效果'][i]}<textarea name={key} required maxLength={1000}/></label>)}
        <label><input name="consent" type="checkbox" required/>我确认拥有共享授权，已检查快照不含凭据及客户私密数据</label><button disabled={busy}>形成待批准的 Gene 方向提案</button></form>}</>}
    {tab==='payments'&&<UsdtPayments rails={rails} invoices={invoices} unmatched={unmatched} worlds={worlds} monitor={monitor} legacy={legacy} busy={busy} act={act}/>}
  </section>;
}
