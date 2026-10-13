import { useCallback, useEffect, useRef, useState } from 'react';
import { t, useLanguage, language } from '../../i18n';
import { fetchOwnerOverview, ownerError, ownerTodoCount, type OwnerOverview } from '../../api/owner';
import { OwnerChat } from './OwnerChat';
import { OwnerInbox } from './OwnerInbox';
import { OwnerActivity } from './OwnerActivity';
import { OwnerWork } from './OwnerWork';
import { OwnerGoals } from './OwnerGoals';
import { OwnerCompany } from './OwnerCompany';
import './owner.css';
type OwnerTab='owner-goals'|'owner-mission'|'owner-inbox'|'owner-activity';
const parseHash=():OwnerTab=>window.location.hash==='#owner-goals'||!window.location.hash&&new URLSearchParams(window.location.search).has('goal')?'owner-goals':window.location.hash==='#owner-activity'?'owner-activity':window.location.hash==='#owner-inbox'?'owner-inbox':!window.location.hash&&new URLSearchParams(window.location.search).has('report')?'owner-activity':'owner-mission';
function OwnerStatusOverview({data,error}:{data?:OwnerOverview;error:string}) {
  const summary=data?.summary, unavailable=t('Unavailable');
  const number=(value:number|null|undefined)=>value==null?unavailable:value.toLocaleString(language());
  const status=error?'unavailable':summary?.serviceStatus;
  const statuses:Record<string,string>={ready:'Ready',paused:'Paused',attention:'Needs attention',unavailable:'Unavailable'};
  const fields=[
    [t('Running version'),summary?.currentGeneration??unavailable],
    [t('Service status'),status?t(statuses[status]!):data?unavailable:t('Loading…')],
    [t('Total pixels'),number(summary?.pixelCount)],
    [t('Running tasks'),number(summary?.runningWorlds)],
    [t('To-dos'),number(data?ownerTodoCount(data):undefined)],
    [t('Available tokens'),number(data?.automation?Math.max(0,data.automation.maxTokens-data.automation.spentTokens-data.automation.reservedTokens):summary?.availableEnergy)],
  ];
  return <section className="owner-status-overview" aria-label={t('Status overview')}>
    <div className="owner-status-heading"><h2>{t('Status overview')}</h2>{data&&<small>{t('Read at')} <time dateTime={new Date(data.asOf).toISOString()}>{new Date(data.asOf).toLocaleTimeString(language())}</time></small>}</div>
    <table aria-label={t('Status overview')}><tbody>{fields.map(([label,value],index)=><tr key={label}><th scope="row">{label}</th><td className={index===1?`owner-status-value ${status??'unknown'}`:undefined}>{value}</td></tr>)}</tbody></table>
    <p className="owner-status-scope">{t('Active Worlds only. Running tasks count active Runs; available tokens are the company quota minus usage and reservations.')}</p>
    {error&&<p role="alert">{t('Overview unavailable. Previously displayed data may be stale.')} {error}</p>}
  </section>;
}
export function OwnerConsole(){
  useLanguage();
  const [data,setData]=useState<OwnerOverview>(),[error,setError]=useState(''),[tab,setTab]=useState<OwnerTab>(parseHash);
  const latestRequest=useRef(0);
  const focusedReport=useRef<string|null>(null);
  const refresh=useCallback(async()=>{
    const request=++latestRequest.current;
    try{const d=await fetchOwnerOverview();if(request===latestRequest.current&&d&&typeof d==='object'&&Array.isArray(d.inbox)&&typeof d.asOf==='number'){setData(d);setError('');}}
    catch(e){if(request===latestRequest.current)setError(ownerError(e));}
  },[]);
  useEffect(()=>{
    if(tab!=='owner-activity'){focusedReport.current=null;return;}
    const report=new URLSearchParams(window.location.search).get('report');
    if(!report||focusedReport.current===report)return;
    const target=document.getElementById(report);
    if(target){target.querySelector('details')?.setAttribute('open','');target.scrollIntoView?.({block:'start'});focusedReport.current=report;}
  },[tab,data?.work]);
  useEffect(()=>{let inFlight=false;const poll=async()=>{if(inFlight)return;inFlight=true;try{await refresh();}finally{inFlight=false;}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{latestRequest.current++;clearInterval(timer);};},[refresh]);
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
        <a href="#owner-mission" aria-current={tab==='owner-mission'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-mission');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z"/></svg>{t('My AI company')}</a>
        <a href="#owner-goals" aria-current={tab==='owner-goals'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-goals');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4h16v16H4Z M8 8h8 M8 12h8 M8 16h5"/></svg>{t('Business goals')}</a>
        <a href="#owner-inbox" aria-current={tab==='owner-inbox'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-inbox');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14l3 10v6H2v-6L5 4Z M2 14h6l2 3h4l2-3h6"/></svg>{t('To-dos')}{data&&<span className="owner-nav-count">{ownerTodoCount(data)}</span>}</a>
        <a href="#owner-activity" aria-current={tab==='owner-activity'?'page':undefined} onClick={event=>{event.preventDefault();select('owner-activity');}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>{t('History')}</a>
      </nav>
    </aside>
    <div className="owner-workspace">
      <section className="owner-mission" id="owner-mission" aria-label={t('My AI company')} hidden={tab!=='owner-mission'}>
        <OwnerCompany automation={data?.automation} onDone={refresh}/>
        {error&&<p role="alert">{error}</p>}
      </section>
      <section className="owner-goal-page" id="owner-goals" aria-label={t('Business information')} hidden={tab!=='owner-goals'}>
        <OwnerStatusOverview data={data} error={error}/>
        {data?.goals&&data.automation&&<OwnerGoals goals={data.goals} automation={data.automation} onDone={refresh}/>}
        <details open={!data?.automation}><summary>{t('Company status and chat')}</summary><OwnerChat missionControl onDone={()=>void refresh()}/></details>
      </section>
      {(tab==='owner-inbox'||tab==='owner-activity')&&<div className="owner-list-page">
        <div className="owner-notices">
          {error&&<p role="alert">{t('Overview unavailable. Previously displayed data may be stale.')} {error}</p>}
          {data&&!data.availability.business&&<p role="status">{t('Business data unavailable.')}</p>}
          {!data&&!error&&<p role="status">{t('Loading…')}</p>}
        </div>
        {data&&<>
          {tab==='owner-inbox'?<>
            <OwnerInbox items={data.inbox} alerts={data.alerts} onDone={()=>void refresh()}/>
          </>:<><OwnerActivity items={data.activity}/><OwnerWork work={data.work}/></>}
        </>}
      </div>}
    </div>
  </main>;
}
