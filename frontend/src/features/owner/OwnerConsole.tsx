import { useCallback, useEffect, useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { fetchOwnerOverview, ownerError, type OwnerOverview } from '../../api/owner';
import { OwnerChat } from './OwnerChat';
import { OwnerInbox } from './OwnerInbox';
import { OwnerActivity } from './OwnerActivity';
import './owner.css';
type OwnerTab='owner-mission'|'owner-inbox'|'owner-activity';
const parseHash=():OwnerTab=>window.location.hash==='#owner-activity'?'owner-activity':window.location.hash==='#owner-inbox'?'owner-inbox':'owner-mission';
export function OwnerConsole(){
  useLanguage();
  const [data,setData]=useState<OwnerOverview>(),[error,setError]=useState(''),[tab,setTab]=useState<OwnerTab>(parseHash);
  const refresh=useCallback(async()=>{const d=await fetchOwnerOverview();if(d&&typeof d==='object'&&Array.isArray((d as OwnerOverview).inbox)&&typeof (d as OwnerOverview).asOf==='number'){setData(d);setError('');}},[]);
  useEffect(()=>{let active=true,inFlight=false;const poll=async()=>{if(inFlight)return;inFlight=true;try{const d=await fetchOwnerOverview();if(active&&d&&typeof d==='object'&&Array.isArray((d as OwnerOverview).inbox)&&typeof (d as OwnerOverview).asOf==='number'){setData(d);setError('');}}catch(e){if(active)setError(ownerError(e));}finally{inFlight=false;}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{active=false;clearInterval(timer);};},[]);
  useEffect(()=>{
    const sync=()=>setTab(parseHash());
    window.addEventListener('hashchange',sync);
    return()=>window.removeEventListener('hashchange',sync);
  },[]);
  const select=(next:OwnerTab)=>{setTab(next);if(parseHash()!==next)window.location.hash=next;};
  return <main className="owner-console">
    <aside className="owner-sidebar">
      <div className="owner-brand"><span className="owner-brand-mark" aria-hidden="true">E</span><div><strong>EmergentInc</strong><small>{t('Company workspace')}</small></div></div>
      <nav aria-label={t('On this page')}>
        <a href="#owner-mission" aria-current={tab==='owner-mission'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-mission');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/></svg>{t('Boss')}</a>
        <a href="#owner-inbox" aria-current={tab==='owner-inbox'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-inbox');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14l3 10v6H2v-6L5 4Z M2 14h6l2 3h4l2-3h6"/></svg>{t('To-dos')}{data&&<span className="owner-nav-count">{data.inbox.length}</span>}</a>
        <a href="#owner-activity" aria-current={tab==='owner-activity'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-activity');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>{t('History')}</a>
      </nav>
    </aside>
    <div className="owner-workspace">
      {/* Keep the chat mounted so switching pages preserves drafts and in-flight replies. */}
      <section className="owner-mission" id="owner-mission" aria-label={t('Boss')} hidden={tab!=='owner-mission'}><OwnerChat missionControl onDone={()=>void refresh()}/></section>
      {tab!=='owner-mission'&&<div className="owner-list-page">
        <div className="owner-notices">
          {error&&<p role="alert">{t('Overview unavailable. Previously displayed data may be stale.')} {error}</p>}
          {data&&!data.availability.business&&<p role="status">{t('Business data unavailable.')}</p>}
          {!data&&!error&&<p role="status">{t('Loading…')}</p>}
        </div>
        {data&&<>
          {tab==='owner-inbox'?<>
            <OwnerInbox items={data.inbox} onDone={()=>void refresh()}/>
            {!!data.alerts?.length&&<section className="owner-alerts" aria-label={t('Needs human verification')}>
              <h2>{t('Needs human verification')} ({data.alerts.length})</h2>
              {data.alerts.map(a=><article key={a.id} className={a.severity==='critical'?'critical':''}><h3>{t(a.title)}</h3><p>{a.summary}</p><small>{a.source} · {a.createdAt===null?t('Time not recorded.'):new Date(a.createdAt).toLocaleString()}</small><a href={a.href}>{t('View details')}</a></article>)}
            </section>}
          </>:<OwnerActivity items={data.activity}/>}
        </>}
      </div>}
    </div>
  </main>;
}
