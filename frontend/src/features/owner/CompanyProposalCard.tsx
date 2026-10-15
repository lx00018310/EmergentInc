import {useState} from 'react';
import type {CompanyProposal} from '../../../../packages/protocol/src/types/owner';
import {ownerGoalRequest,ownerError} from '../../api/owner';
import {t,useLanguage,language} from '../../i18n';
export function CompanyProposalCard({proposal:p,onDone}:{proposal:CompanyProposal;onDone?:()=>void}){
  useLanguage();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<string>();
  return <article className="company-proposal" id={p.id}>
    <h3>{t(p.kind==='budget'?'Company budget proposal':p.kind==='task_plan'?'Task plan proposal':'Close task proposal')}</h3>
    <p>{p.kind==='budget'?`${t('Total authorized budget')}: ¥${(p.payload.totalMicros/1000000).toLocaleString(language())}`:p.payload.title}</p>
    {p.kind==='task_plan'&&<><p>{p.payload.plan.summary}</p><ol>{p.payload.plan.nodes.map((n:any)=><li key={n.key}>{n.title} · {t(`Task trigger: ${n.trigger.kind}`)}{n.trigger.time&&` · ${n.trigger.time} (${n.trigger.timezone})`}{n.trigger.weekdays&&` · ${n.trigger.weekdays.map((d:number)=>new Intl.DateTimeFormat(language(),{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+d)))).join(', ')}`}{n.trigger.everyMinutes&&` · ${n.trigger.everyMinutes} min`}<p>{n.instruction}</p></li>)}</ol></>}
    {p.kind==='close_task'&&<><p>{p.payload.reason}</p><p>{t('Review the actual deliverables before closing this task.')}</p></>}
    <small>{new Date(p.createdAt).toLocaleString(language())} · {p.id}</small>
    {p.state==='PENDING'&&!result?<div className="owner-decision">{(['approve','reject'] as const).map(decision=><button key={decision} disabled={busy} className={`owner-btn ${decision==='approve'?'owner-btn--approve':'owner-btn--reject'}`} onClick={async()=>{setBusy(true);setError('');try{const r=await ownerGoalRequest<CompanyProposal>(`proposals/${encodeURIComponent(p.id)}/decision`,'POST',{decision,hash:p.hash,idempotencyKey:`${decision}_${p.id}`});setResult(r.state);onDone?.();}catch(e){setError(ownerError(e));}finally{setBusy(false);}}}>{t(busy?'Submitting…':decision==='approve'?'Approve and execute':'Reject')}</button>)}</div>:<p role="status">{t(`Proposal state: ${result??p.state}`)}</p>}
    {error&&<p role="alert">{error}</p>}
  </article>;
}
