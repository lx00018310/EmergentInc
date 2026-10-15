import {useCallback,useEffect,useState,useRef} from 'react';
import {t,useLanguage} from '../../i18n';
import {fetchOwnerOverview,ownerError,type OwnerOverview} from '../../api/owner';
import {OwnerChat} from './OwnerChat';
import {OwnerDashboard} from './OwnerDashboard';
import './owner.css';
type OwnerTab='owner-chat'|'owner-dashboard';
const parseHash=():OwnerTab=>!window.location.hash&&!window.location.search||window.location.hash==='#owner-chat'?'owner-chat':'owner-dashboard';
type BadgeTone='neutral'|'ok'|'warning'|'danger';
function statusTone(data:OwnerOverview|undefined):BadgeTone{
  const state=`${data?.automation?.observedState??''} ${data?.automation?.reason??''}`.toUpperCase();
  if(/ERROR|FAILED|BLOCKED|STOPPED/.test(state))return 'danger';
  if(/PAUSED|WAITING|IDLE|ATTENTION/.test(state))return 'warning';
  if(/RUNNING|READY|ACTIVE|OK/.test(state))return 'ok';
  return data?'ok':'neutral';
}
export function OwnerConsole(){
  useLanguage();const [tab,setTab]=useState<OwnerTab>(parseHash),[data,setData]=useState<OwnerOverview>(),[error,setError]=useState('');
  const request=useRef(0);
  const refresh=useCallback(async()=>{const serial=++request.current;try{const next=await fetchOwnerOverview();if(serial!==request.current)return;setData(next);setError('');}catch(e){if(serial===request.current)setError(ownerError(e));}},[]);
  useEffect(()=>{let alive=true,flight=false;const poll=async()=>{if(!alive||flight)return;flight=true;try{await refresh();}finally{flight=false;}};void poll();const timer=setInterval(()=>void poll(),5000);return()=>{alive=false;clearInterval(timer);};},[refresh]);
  useEffect(()=>{const sync=()=>setTab(parseHash());window.addEventListener('hashchange',sync);return()=>window.removeEventListener('hashchange',sync);},[]);
  const tone=statusTone(data);
  return <main className="owner-console">
    <header className="owner-topbar">
      <div className="owner-brand"><strong>EmergentInc</strong></div>
      <nav className="owner-tabs" aria-label={t('On this page')}>
        {(['owner-chat','owner-dashboard'] as const).map(key=><a key={key} className="owner-tab" href={`#${key}`} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{t(key==='owner-chat'?'Boss chat':'AI company dashboard')}</a>)}
      </nav>
      <p className="owner-topbar-status" role="status">
        <span className={`owner-badge${tone==='neutral'?'':` owner-badge--${tone}`}`}>{t('Company status')}</span>
        <span>{data?.automation?t(data.automation.reason??`Company observed: ${data.automation.observedState}`):t('Loading…')}</span>
      </p>
    </header>
    {error&&<p className="owner-alert owner-alert--danger" role="alert">{t('Overview unavailable. Previously displayed data may be stale.')} {error}</p>}
    <div className="owner-workspace">
      <section id="owner-chat" className="owner-page owner-page--chat" hidden={tab!=='owner-chat'}><h1>{t('Boss chat')}</h1><OwnerChat missionControl onDone={()=>void refresh()}/></section>
      <section id="owner-dashboard" className="owner-page" hidden={tab!=='owner-dashboard'}><h1>{t('AI company dashboard')}</h1>{data&&<OwnerDashboard data={data} onDone={()=>void refresh()}/>}</section>
    </div>
  </main>;
}
