import {useRef,useState} from 'react';
import type {CompanyProposal} from '../../../../packages/protocol/src/types/owner';
import {ownerGoalRequest,ownerError} from '../../api/owner';
import {t,useLanguage,language} from '../../i18n';
import {ownerStatusLabel,ownerTime} from './ownerPresentation';
function reviewableTrigger(trigger:any):boolean{
  if(!trigger)return false;
  if(['once','continuous'].includes(trigger.kind))return true;
  if(trigger.kind==='interval')return Number.isSafeInteger(trigger.everyMinutes)&&trigger.everyMinutes>0;
  if(!['daily','weekly'].includes(trigger.kind)||typeof trigger.time!=='string'||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)||typeof trigger.timezone!=='string'||!trigger.timezone)return false;
  return trigger.kind==='daily'||Array.isArray(trigger.weekdays)&&trigger.weekdays.length>0&&
    trigger.weekdays.every((day:number)=>Number.isInteger(day)&&day>=0&&day<=6);
}
export function CompanyProposalCard({proposal:p,onDone}:{proposal:CompanyProposal;onDone?:()=>void}){
  useLanguage();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<string>();
  const flight=useRef(false);
  const payload=p.payload;
  const valid=payload&&(
    p.kind==='budget'?Number.isSafeInteger(payload.totalMicros)&&payload.totalMicros>0:
    p.kind==='task_plan'?typeof payload.title==='string'&&payload.plan&&typeof payload.plan.summary==='string'&&
      Array.isArray(payload.plan.nodes)&&payload.plan.nodes.length>0&&payload.plan.nodes.every((node:any)=>node&&typeof node.title==='string'&&
        typeof node.instruction==='string'&&reviewableTrigger(node.trigger)):
    p.kind==='close_task'&&(payload.reason===undefined||typeof payload.reason==='string')&&typeof payload.title==='string'&&
      p.goalId&&Array.isArray(payload.evidence)&&payload.evidence.length>0&&
      payload.evidence.every((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.sha256==='string'&&/^[a-f0-9]{64}$/.test(entry.sha256))
  );
  if(!valid)return <article className="company-proposal" id={p.id}><h3>{t('Proposal details unavailable')}</h3>
    <p role="alert">{t('This proposal cannot be reviewed safely. Refresh its details before deciding.')}</p></article>;
  return <article className="company-proposal" id={p.id}>
    <h3>{t(p.kind==='budget'?'Company budget proposal':p.kind==='task_plan'?'Task plan proposal':'Close task proposal')}</h3>
    <p>{p.kind==='budget'?`${t('Total authorized budget')}: ¥${(p.payload.totalMicros/1000000).toLocaleString(language())}`:p.payload.title}</p>
    {p.kind==='task_plan'&&<><p>{p.payload.plan.summary}</p><ol>{p.payload.plan.nodes.map((n:any)=><li key={n.key}>{n.title} · {t(`Task trigger: ${n.trigger.kind}`)}{n.trigger.time&&` · ${n.trigger.time} (${n.trigger.timezone})`}{n.trigger.weekdays&&` · ${n.trigger.weekdays.map((d:number)=>new Intl.DateTimeFormat(language(),{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+d)))).join(', ')}`}{n.trigger.everyMinutes&&` · ${n.trigger.everyMinutes} min`}<p>{n.instruction}</p></li>)}</ol></>}
    {p.kind==='close_task'&&<>{p.payload.reason&&<p>{p.payload.reason}</p>}<p>{t('Review the actual deliverables before closing this task.')}</p>{p.payload.evidence.map((e:any)=><p key={e.id}><a href={`/api/owner/goals/${encodeURIComponent(p.goalId!)}/evidence/${encodeURIComponent(e.id)}`} target="_blank" rel="noopener noreferrer">{t('View task deliverables')}</a> · <code>{e.sha256}</code></p>)}</>}
    <small>{ownerTime(p.createdAt)} · {p.id}</small>
    {p.kind==='budget'?<p>{t('Budget proposals are retired. Use Company money budget settings.')}</p>:p.state==='PENDING'&&!result?<div className="owner-decision"><p>{t(p.kind==='task_plan'?'Approval authorizes this exact plan within the existing company budget. Rejection leaves it unauthorized.':'Approval closes this goal using the displayed verified evidence. Rejection keeps it open.')}</p>{(['approve','reject'] as const).map(decision=><button key={decision} disabled={busy} className={`owner-btn ${decision==='approve'?'owner-btn--approve':'owner-btn--reject'}`} onClick={async()=>{if(flight.current)return;flight.current=true;setBusy(true);setError('');try{const r=await ownerGoalRequest<CompanyProposal>(`proposals/${encodeURIComponent(p.id)}/decision`,'POST',{decision,hash:p.hash,idempotencyKey:`${decision}_${p.id}`});setResult(r.state);onDone?.();}catch(e){setError(ownerError(e));}finally{flight.current=false;setBusy(false);}}}>{t(busy?'Submitting…':decision==='approve'?'Approve':'Reject')}</button>)}</div>:<p role="status">{ownerStatusLabel(result??p.state,'Proposal state: ')}</p>}
    {error&&<p role="alert">{error}</p>}
  </article>;
}
