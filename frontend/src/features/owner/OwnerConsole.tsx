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
  return <main className="owner-console"><header><small>EMERGENTINC · OWNER</small><h1>{t('Owner Mission Control')}</h1><p>{t('Tell the company what you need. Review decisions and follow the evidence here.')}</p>
    {data&&<div className="owner-summary"><span>{t('People')}: {data.summary.qianjiCount}</span><span>{t('Active Worlds')}: {data.summary.activeWorlds}</span><span>{t('Running')}: {data.summary.runningWorlds}</span><span>{t('Pending')}: {data.summary.inboxCount}</span><span>Generation: {data.summary.currentGeneration ?? '—'}</span><small>{t('Read at')}: {new Date(data.asOf).toLocaleString()}</small></div>}</header>
    {error&&<p role="alert">{t('Overview unavailable. Previously displayed data may be stale.')} {error}</p>}
    {data&&!data.availability.business&&<p role="status">{t('Business data unavailable.')}</p>}
    {data&&data.availability.upgrade!=='available'&&<p role="status">{t(data.availability.upgrade==='unavailable'?'Upgrade service unavailable.':'Upgrade service not configured.')}</p>}
    {data?.upgrade&&<p>{t('Upgrade service')}: {t(data.upgrade.busy?'Working':'Idle')} · Generation: {data.upgrade.active}</p>}
    <section className="owner-mission"><h2>{t('Owner Chat')}</h2><OwnerChat missionControl work={data?.work} onDone={()=>void refresh()}/></section>
    {data&&<div className="owner-columns"><OwnerInbox items={data.inbox} onDone={()=>void refresh()}/><OwnerActivity items={data.activity}/></div>}
  </main>;
}
