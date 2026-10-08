import { useCallback, useEffect, useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { fetchOwnerOverview, ownerError, type OwnerOverview } from '../../api/owner';
import { OwnerChat } from './OwnerChat';
import { OwnerInbox } from './OwnerInbox';
import { OwnerActivity } from './OwnerActivity';
import './owner.css';
export function OwnerConsole(){
  useLanguage();
  const [data,setData]=useState<OwnerOverview>(),[error,setError]=useState('');
  const refresh=useCallback(async()=>{try{setData(await fetchOwnerOverview());setError('');}catch(e){setError(ownerError(e));}},[]);
  useEffect(()=>{let active=true,inFlight=false;const poll=async()=>{if(inFlight)return;inFlight=true;try{const d=await fetchOwnerOverview();if(active){setData(d);setError('');}}catch(e){if(active)setError(ownerError(e));}finally{inFlight=false;}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{active=false;clearInterval(timer);};},[]);
  return <main className="owner-console">
    <aside className="owner-sidebar">
      <div className="owner-brand"><span className="owner-brand-mark" aria-hidden="true">E</span><div><strong>EmergentInc</strong><small>{t('Company workspace')}</small></div></div>
      <nav aria-label={t('On this page')}>
        <a href="#owner-mission"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/></svg>{t('Owner Chat')}</a>
        {data&&<><a href="#owner-inbox"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14l3 10v6H2v-6L5 4Z M2 14h6l2 3h4l2-3h6"/></svg>{t('Inbox')}<span className="owner-nav-count">{data.inbox.length}</span></a>
        <a href="#owner-activity"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>{t('Activity')}</a></>}
      </nav>
      {data&&<div className="owner-sidebar-meta"><small>{t('Current generation')}</small><strong>{data.summary.currentGeneration??'—'}</strong></div>}
    </aside>
    <div className="owner-workspace">
      <header className="owner-page-header"><div><small>OWNER</small><h1>{t('Owner Mission Control')}</h1><p>{t('Tell the company what you need. Review decisions and follow the evidence here.')}</p></div>
        {data&&<small className="owner-read-time">{t('Read at')}<time>{new Date(data.asOf).toLocaleString()}</time></small>}
      </header>
      {data&&<div className="owner-summary">
        <a href="/QIAN"><span>{t('People')}</span><strong>{data.summary.qianjiCount}</strong></a>
        <div><span>{t('Active Worlds')}</span><strong>{data.summary.activeWorlds}</strong></div>
        <div><span>{t('Running')}</span><strong>{data.summary.runningWorlds}</strong></div>
        <a href="#owner-inbox"><span>{t('Pending')}</span><strong>{data.summary.inboxCount}</strong></a>
      </div>}
      <div className="owner-notices">
        {error&&<p role="alert">{t('Overview unavailable. Previously displayed data may be stale.')} {error}</p>}
        {data&&!data.availability.business&&<p role="status">{t('Business data unavailable.')}</p>}
        {data&&data.availability.upgrade!=='available'&&<p role="status">{t(data.availability.upgrade==='unavailable'?'Upgrade service unavailable.':'Upgrade service not configured.')}</p>}
        {data?.upgrade&&<p className="owner-service-status"><span className={data.upgrade.busy?'working':'idle'} aria-hidden="true"/>{t('Upgrade service')}: {t(data.upgrade.busy?'Working':'Idle')} · {t('Current generation')}: {data.upgrade.active??'—'}</p>}
      </div>
      <div className="owner-content-grid">
        <section className="owner-mission" id="owner-mission" tabIndex={-1}><h2>{t('Owner Chat')}</h2><OwnerChat missionControl work={data?.work} onDone={()=>void refresh()}/></section>
        {data&&<div className="owner-columns"><OwnerInbox items={data.inbox} onDone={()=>void refresh()}/><OwnerActivity items={data.activity}/></div>}
      </div>
    </div>
  </main>;
}
