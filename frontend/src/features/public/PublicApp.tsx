import { useEffect, useState } from 'react';
import { LanguageSwitch, t, useLanguage } from '../../i18n';
import { publicApi, type Product, type Site } from './api';
import { Checkout, savedOrder } from './Checkout';
import {BackendLogin} from './BackendLogin';
import './public.css';

export function PublicApp() {
  const lang=useLanguage(),zh=lang==='zh-CN';
  const [site,setSite]=useState<Site>(),[products,setProducts]=useState<Product[]>([]),[error,setError]=useState('');
  const [selected,setSelected]=useState<Product>(),[buy,setBuy]=useState(()=>Boolean(savedOrder()||sessionStorage.getItem('emergentinc.checkout-intent')));
  const [backend,setBackend]=useState(false),[lookup,setLookup]=useState(''),[lookupError,setLookupError]=useState(''),[orderKey,setOrderKey]=useState('initial');
  useEffect(()=>{void Promise.all([publicApi<Site>('site'),publicApi<{items:Product[]}>('products')])
    .then(([s,p])=>{setSite(s);setProducts(p.items);}).catch(()=>setError('The store could not be loaded. Please refresh.'));},[]);
  useEffect(()=>{if(selected)document.getElementById(buy?'orders':'product-detail')?.scrollIntoView({behavior:'smooth'});},[selected,buy]);
  const name=(product:Product,index:number)=>(zh?product.product_name_zh:product.product_name_en)||t('Product {0}',[String(index+1).padStart(2,'0')]);
  const available=(product:Product)=>Boolean(product.product_enabled&&product.product_price);
  function choose(product:Product,checkout:boolean){
    if(checkout&&!sessionStorage.getItem('emergentinc.checkout-intent')){
      window.history.replaceState(null,'','/#orders');setOrderKey('checkout-'+crypto.randomUUID());
    }
    setSelected(product);setBuy(checkout);
  }
  return <div className="public-site">
    <header><a className="public-brand" href="/">{site?.site_name??'EmergentInc'}<small> / {t('Store')}</small></a>
      <nav className="public-main-nav" aria-label={t('Store navigation')}><a href="#products">{t('Products')}</a><a href="#orders">{t('Order lookup')}</a><a href="#support">{t('Support')}</a></nav>
      <div className="public-header-tools"><LanguageSwitch/><button onClick={()=>setBackend(true)}>{t('Backend')}</button></div>
    </header>
    <main>
      <section className="public-hero"><div><small><span className="public-live-dot"/> {t('One team. One shared store.')}</small>
        <h1>{site?zh?site.headline_zh:site.headline_en:t('AI that helps anyone start and run an online business.')}</h1>
        <p>{site?zh?site.description_zh:site.description_en:t('Start with an idea. Let AI help turn it into a real business.')}</p>
        <div className="public-actions"><a className="public-primary" href="#products">{t('Browse products')} <span aria-hidden="true">↗</span></a><a href="#orders">{t('Order lookup')}</a></div>
      </div><aside className="public-buying-guide"><small>{t('Purchase guide')}</small>
        {['Review product details and price before ordering.','Submit your requirements and contact details.','Keep your private order link for payment status and support.'].map((key,index)=><p key={key}><span>0{index+1}</span>{t(key)}</p>)}
      </aside></section>
      <section id="products"><div className="public-section-title"><div><small> / {t('Marketplace')}</small><h2>{t('Products')}</h2></div><span className="public-badge">{t('All products')}</span></div>
        {error&&<p role="alert">{t(error)}</p>}
        {!site&&!error&&<p>{t('Loading…')}</p>}
        {site&&!products.length&&<p>{t('No products yet.')}</p>}
        <div className="public-product-grid">{products.map((product,index)=><article className="public-product-card" key={product.product_id}>
          <div className="public-product-art" aria-hidden="true"><span>{String(index+1).padStart(2,'0')}</span><div className="public-art-lines"><i/><i/><i/></div></div>
          <div className="public-product-body"><span className="public-badge">{t(available(product)?'Available':'Coming soon')}</span><h3>{name(product,index)}</h3>
            <p>{(zh?product.product_description_zh:product.product_description_en)||t('Product details will be added here.')}</p>
            <div className="public-product-price">{product.product_price?product.product_price+' '+product.product_currency:t('Price pending')}</div>
            <div className="public-actions"><button className="public-primary" disabled={!available(product)} onClick={()=>choose(product,true)}>{t('Buy / Start')}</button>
              <button onClick={()=>choose(product,false)}>{t('View details')}</button></div>
          </div>
        </article>)}</div>
      </section>
      <section id="product-detail" hidden={!selected}><small>{t('Product details')}</small>
        {selected&&<><h2>{name(selected,products.findIndex(product=>product.product_id===selected.product_id))}</h2>
          <p>{(zh?selected.product_description_zh:selected.product_description_en)||t('Product details will be added here.')}</p>
          <p className="public-price">{selected.product_price?selected.product_price+' USDT':t('Price pending')}</p>
          <button className="public-primary" disabled={!available(selected)} onClick={()=>choose(selected,true)}>{t('Buy / Start')}</button></>}
      </section>
      <section id="orders"><small> / {t('Orders')}</small><h2>{t('Order lookup')}</h2><p>{t('Paste your private order link to check payment status. Only the link holder can view it.')}</p>
        <form className="public-order-lookup" onSubmit={e=>{e.preventDefault();setLookupError('');try{
          const url=new URL(lookup,window.location.origin),params=new URLSearchParams(url.hash.slice(1)),id=params.get('order'),token=params.get('token');
          if(url.origin!==window.location.origin||url.pathname!=='/'||!id||!/^order_[a-f0-9-]{36}$/.test(id)||!token||!/^[a-f0-9]{64}$/.test(token))throw new Error();
          window.history.replaceState(null,'','/#'+new URLSearchParams({order:id,token}).toString());setOrderKey(id+token);setBuy(true);setSelected(undefined);
        }catch{setLookupError('Enter a valid private order link from this store.');}}}>
          <label>{t('Private order link')}<input required type="url" value={lookup} onChange={e=>setLookup(e.target.value)}/></label><button type="submit">{t('Check order')}</button>
        </form>{lookupError&&<p role="alert">{t(lookupError)}</p>}
        {buy&&<Checkout key={orderKey} product={selected}/>}
      </section>
      <section className="public-how"><small> / {t('How it works')}</small><h2>{t('From browsing to payment')}</h2><ol>
        {['Browse products','Submit an order','Pay the exact invoice amount','Check payment status'].map((key,index)=><li key={key}><span>0{index+1}</span><h3>{t(key)}</h3></li>)}
      </ol></section>
      <section id="support" className="public-support"><div><small> / {t('Support')}</small><h2>{t('Purchase / Contact')}</h2>
        <p className="public-contact">{site&&(zh?site.contact_text_zh:site.contact_text_en)}</p>
        {site?.github_url&&<a href={site.github_url} target="_blank" rel="noreferrer">{t('Explore the source')} ↗</a>}
      </div><div><h2>{t('Frequently asked questions')}</h2>
        {[
          ['Why can’t I buy a placeholder product?','Placeholder products are not for sale. Ordering opens after the Owner adds bilingual details, pricing and a payment rail.'],
          ['How do I check my order?','Use the private link provided when your order was created. Keep it private and safe.'],
          ['When is payment confirmed?','Payment is credited only after the chain confirms it. Check the exact amount and chain shown on your invoice.']
        ].map(([question,answer])=><details key={question}><summary>{t(question!)}</summary><p>{t(answer!)}</p></details>)}
      </div></section>
    </main>
    <footer><span>{site?.site_name??'EmergentInc'} · {t('One public store for all characters and Worlds.')}</span><a href="#products">{t('Back to products')}</a></footer>
    {backend&&<BackendLogin onClose={()=>setBackend(false)}/>}
  </div>;
}
