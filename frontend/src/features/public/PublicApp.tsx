import { useEffect, useState } from 'react';
import { LanguageSwitch, t, useLanguage } from '../../i18n';
import { publicApi, type Product, type Site } from './api';
import { Checkout, savedOrder } from './Checkout';
import './public.css';

export function PublicApp() {
  const lang = useLanguage();
  const [site, setSite] = useState<Site>(), [product, setProduct] = useState<Product>();
  const [error, setError] = useState(''), [buy, setBuy] = useState(() => Boolean(savedOrder()));
  useEffect(() => {
    void Promise.all([publicApi<Site>('site'), publicApi<{ items: Product[] }>('products')])
      .then(([s, p]) => { setSite(s); setProduct(p.items[0]); }).catch(e => setError(e.message));
  }, []);
  const zh = lang === 'zh-CN';
  return <div className="public-site">
    <header><a className="public-brand" href="/">{site?.site_name ?? 'EmergentInc'}</a><LanguageSwitch /></header>
    <main>
      <section className="public-hero"><small>{t('Open-source AI for your business')}</small>
        <h1>{site ? zh ? site.headline_zh : site.headline_en : t('AI that helps anyone start and run an online business.')}</h1>
        <p>{site ? zh ? site.description_zh : site.description_en : t('Start with an idea. Let AI help turn it into a real business.')}</p>
        <div className="public-actions"><a className="public-primary" href="#custom-service">{t('Get Custom Service')}</a>
          {site?.github_url && <a href={site.github_url} target="_blank" rel="noreferrer">{t('View on GitHub')}</a>}</div>
      </section>
      <section><small>{t('What EmergentInc does')}</small><h2>{t('Your idea. A team of AI characters. One business.')}</h2>
        <p>{t('You provide the idea, resources and final decisions. Characters and Pixels help explore opportunities, build products, market, sell, serve customers and learn from real work.')}</p>
        <div className="public-capabilities">{['Think', 'Build', 'Market', 'Sell', 'Learn', 'Evolve'].map(label => <span key={label}>{t(label)}</span>)}</div>
      </section>
      <section id="custom-service" className="public-offer"><small>{t('Custom Service')}</small>
        <h2>{product ? zh ? product.product_name_zh : product.product_name_en : t('Build your own AI-powered online business')}</h2>
        {error && <p role="alert">{t('The store could not be loaded. Please refresh.')}</p>}
        {product ? <><p>{zh ? product.product_description_zh : product.product_description_en}</p>
          <p className="public-price">{product.product_price} {product.product_currency}</p>
          <button className="public-primary" onClick={() => setBuy(true)}>{t('Buy / Start')}</button>
          </> : !error && <p>{site ? t('Custom Service is currently unavailable. See contact details below.') : t('Loading…')}</p>}
        {buy && <Checkout product={product} />}
      </section>
      <section><small>{t('How it works')}</small><h2>{t('Start small. Build through real work.')}</h2>
        <ol><li>{t('Share your idea and what you need.')}</li><li>{t('Choose Custom Service or deploy the open-source project yourself.')}</li><li>{t('Guide your AI team, approve decisions and learn from business results.')}</li></ol>
      </section>
      <section><small>{t('Open Source')}</small><h2>{t('Your business. Your instance.')}</h2>
        <p>{t('EmergentInc is open source. Deploy it yourself, modify it and use it to build your own business.')}</p>
        {site?.github_url && <a href={site.github_url} target="_blank" rel="noreferrer">{t('Explore the source')}</a>}
      </section>
      <section id="contact"><h2>{t('Purchase / Contact')}</h2><p className="public-contact">{site && (zh ? site.contact_text_zh : site.contact_text_en)}</p></section>
    </main>
    <footer><span>{site?.site_name ?? 'EmergentInc'} · {t('AI that helps anyone start and run an online business.')}</span><a href="/GENE">{t('Owner login')}</a></footer>
  </div>;
}
