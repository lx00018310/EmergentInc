import { useEffect, useState } from 'react';
import { apiRequest, ApiError } from '../../api/client';
import { t, useLanguage } from '../../i18n';
import type {Product} from '../public/api';
import { usdtAmount } from './UsdtPayments';

const siteFields = [['site_name', 'Site name'], ['headline_en', 'Headline (English)'], ['headline_zh', 'Headline (中文)'],
  ['description_en', 'Description (English)'], ['description_zh', 'Description (中文)'], ['github_url', 'GitHub URL'],
  ['contact_text_en', 'Contact (English)'], ['contact_text_zh', 'Contact (中文)']] as const;
const productFields = [['product_name_en', 'Product name (English)'], ['product_name_zh', 'Product name (中文)'],
  ['product_description_en', 'Product description (English)'], ['product_description_zh', 'Product description (中文)']] as const;
function ProductEditor({product,index,onSaved}:{product:Product;index:number;onSaved:()=>Promise<void>}){
  const lang=useLanguage();
  const [draft,setDraft]=useState({...product,product_enabled:Boolean(product.product_enabled),product_price:product.product_price??''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  const change=(key:string,value:unknown)=>{setSaved(false);setDraft(previous=>({...previous,[key]:value}));};
  return <article><h3>{(lang==='en'?product.product_name_en:product.product_name_zh)||t('Product {0}',[String(index+1).padStart(2,'0')])}</h3>
    {error&&<p role="alert">{t(error)}</p>}{saved&&<p role="status">{t('Product saved.')}</p>}
    <form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setSaved(false);
      const keys=[...productFields.map(([key])=>key),'product_enabled','product_price','product_currency'];
      const body=Object.fromEntries(keys.map(key=>[key,key==='product_currency'?'USDT':draft[key as keyof typeof draft]]));
      try{await apiRequest('/api/public-site/products/'+product.product_id,{method:'PUT',body:JSON.stringify(body)});await onSaved();setSaved(true);}
      catch(e){setError(e instanceof ApiError?e.detail:(e as Error).message);}finally{setBusy(false);}}}>
      <div className="business-grid">{productFields.map(([key,label])=><label key={key}>{t(label)}{key.includes('description')?
        <textarea required={draft.product_enabled} maxLength={4000} value={draft[key]} onChange={e=>change(key,e.target.value)}/>:
        <input required={draft.product_enabled} maxLength={200} value={draft[key]} onChange={e=>change(key,e.target.value)}/>}</label>)}</div>
      <label>{t('Price (USDT)')}<input value={draft.product_price} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" required={draft.product_enabled} onChange={e=>change('product_price',e.target.value)}/></label>
      <label><input type="checkbox" checked={draft.product_enabled} onChange={e=>change('product_enabled',e.target.checked)}/>{t('Product available for purchase')}</label>
      <p>{t('Fill in both languages, a price and a payment rail before listing. Blank products remain unavailable.')}</p>
      <button disabled={busy}>{t('Save product')}</button>
    </form>
  </article>;
}
export function PublicSiteSettings() {
  const lang = useLanguage();
  const [data, setData] = useState<any>(), [draft, setDraft] = useState<Record<string, any>>();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  async function refresh(replaceDraft = false) {
    const next = await apiRequest<any>('/api/public-site'); setData(next);
    setDraft(previous => previous && !replaceDraft ? previous : { ...next.settings, product_enabled: Boolean(next.settings.product_enabled), product_price: next.settings.product_price ?? '' });
  }
  useEffect(() => { void refresh().catch(e => setError(e.message)); const timer = setInterval(() => void refresh().catch(e => setError(e.message)), 10000); return () => clearInterval(timer); }, []);
  const change = (key: string, value: unknown) => { setSaved(false); setDraft(previous => ({ ...previous, [key]: value })); };
  if (!data || !draft) return <section><h2>{t('Public Site')}</h2>{error ? <p role="alert">{error}</p> : <p>{t('Loading…')}</p>}</section>;
  return <><section><h2>{t('Public Site')}</h2><p>{t('One public website and shared instance revenue for all characters and Worlds.')}</p><a href="/" target="_blank" rel="noreferrer">{t('Open public website')}</a>
    {error && <p role="alert" className="business-error">{t(error)}</p>}{saved && <p role="status">{t('Site settings saved.')}</p>}
    <form onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError(''); setSaved(false);
      const keys = siteFields.map(([key]) => key);
      const body = Object.fromEntries(keys.map(key => [key, draft[key]]));
      try { await apiRequest('/api/public-site', { method: 'PUT', body: JSON.stringify(body) }); await refresh(true); setSaved(true); }
      catch (e) { setError(e instanceof ApiError ? e.detail : (e as Error).message); } finally { setBusy(false); }
    }}><div className="business-grid">{siteFields.map(([key, label]) => <label key={key}>{t(label)}{key.startsWith('description') || key.startsWith('contact_text') ?
      <textarea value={draft[key]} maxLength={4000} onChange={e => change(key, e.target.value)} /> :
      <input required={key !== 'github_url'} type={key === 'github_url' ? 'url' : 'text'} maxLength={key === 'site_name' ? 100 : key === 'github_url' ? 500 : 4000} value={draft[key]} onChange={e => change(key, e.target.value)} />}</label>)}</div>
      <button disabled={busy}>{t('Save site settings')}</button></form>
    </section><section><h2>{t('Product management')}</h2>
      {data.products.map((product:Product,index:number)=><ProductEditor key={product.product_id} product={product} index={index} onSaved={()=>refresh()}/>)}
      <button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await apiRequest('/api/public-site/products',{method:'POST',body:'{}'});await refresh();}
        catch(e){setError(e instanceof ApiError?e.detail:(e as Error).message);}finally{setBusy(false);}}}>{t('Add blank product')}</button>
    </section><section><h2>{t('Instance revenue')}</h2><strong>{usdtAmount(data.revenue.mainnetAtomic)}</strong><p>{t('Finalized public order payments. Existing World revenue remains separately attributed.')}</p>
      {data.revenue.byChain.map((row: any) => <p key={row.chain}>{row.chain}: {usdtAmount(row.amount_atomic, row.decimals)}</p>)}
    </section><section><h2>{t('Public orders')}</h2>{!data.orders.length && <p>{t('No public orders yet.')}</p>}
      {data.orders.map((order: any) => <article key={order.order_id}><h3>{order.product_name_snapshot} · {t(order.status)}</h3><code>{order.order_id}</code>
        <p>{order.amount} {order.currency} · {new Date(order.created_at).toLocaleString(lang)}</p><dl><dt>{t('Customer')}</dt><dd>{order.customer_name}</dd>
          <dt>{t('Contact')}</dt><dd>{order.customer_contact}</dd><dt>{t('Requirement')}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{order.customer_requirement}</dd>
          <dt>{t('Invoice')}</dt><dd>{order.invoice_id}</dd>{order.paid_at && <><dt>{t('Paid at')}</dt><dd>{new Date(order.paid_at).toLocaleString(lang)}</dd></>}</dl></article>)}
    </section></>;
}
