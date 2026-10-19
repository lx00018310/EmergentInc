import {useRef,useState} from 'react';
import type {CompanyProposal} from '../../../../packages/protocol/src/types/owner';
import {ownerError} from '../../api/owner';
import {t,useLanguage,language} from '../../i18n';
import {ownerStatusLabel,ownerTime} from './ownerPresentation';
import {useOwnerCommand} from '../boss/useOwnerCommand';
function reviewableTrigger(trigger:any):boolean{
  if(!trigger)return false;
  if(['once','continuous'].includes(trigger.kind))return true;
  if(trigger.kind==='interval')return Number.isSafeInteger(trigger.everyMinutes)&&trigger.everyMinutes>0;
  if(!['daily','weekly'].includes(trigger.kind)||typeof trigger.time!=='string'||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)||typeof trigger.timezone!=='string'||!trigger.timezone)return false;
  return trigger.kind==='daily'||Array.isArray(trigger.weekdays)&&trigger.weekdays.length>0&&
    trigger.weekdays.every((day:number)=>Number.isInteger(day)&&day>=0&&day<=6);
}
/** Every approval offers exactly three decisions: approve, reject, or rework with instructions. */
export function CompanyProposalCard({proposal:p,onDone}:{proposal:CompanyProposal;onDone?:()=>void}){
  useLanguage();const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<string>(),[rework,setRework]=useState(false),[note,setNote]=useState('');
  const flight=useRef(false);
  const command=useOwnerCommand(`boss.proposal-decision.${p.id}`,`proposals/${encodeURIComponent(p.id)}/decision`);
  const [nodeKey,setNodeKey]=useState('');
  const payload=p.payload;
  const valid=payload&&(
    p.kind==='budget'?Number.isSafeInteger(payload.totalMicros)&&payload.totalMicros>0:
    p.kind==='task_plan'?typeof payload.title==='string'&&payload.plan&&typeof payload.plan.summary==='string'&&
      Array.isArray(payload.plan.nodes)&&payload.plan.nodes.length>0&&payload.plan.nodes.every((node:any)=>node&&typeof node.title==='string'&&
        typeof node.instruction==='string'&&reviewableTrigger(node.trigger)):
    p.kind==='close_task'&&(payload.reason===undefined||typeof payload.reason==='string')&&typeof payload.title==='string'&&
      p.goalId&&Array.isArray(payload.evidence)&&(payload.evidence.length>0||payload.completionKind==='partial')&&
      payload.evidence.every((entry:any)=>entry&&typeof entry.id==='string'&&typeof entry.sha256==='string'&&/^[a-f0-9]{64}$/.test(entry.sha256))
  );
  if(!valid)return <article className="company-proposal" id={p.id}><h3>{t('Proposal details unavailable')}</h3>
    <p role="alert">{t('This proposal cannot be reviewed safely. Refresh its details before deciding.')}</p></article>;
  async function decide(decision:'approve'|'reject'|'rework'){
    if(flight.current)return;flight.current=true;setBusy(true);setError('');
    try{
      const saved=await command.submit({decision,hash:p.hash,idempotencyKey:decision==='rework'?crypto.randomUUID():`${decision}_${p.id}`,...(decision==='rework'?{reworkNote:note.trim(),...(nodeKey?{nodeKey}:{})}:{})});
      if(saved){setResult(decision==='approve'?'EXECUTED':'REJECTED');setRework(false);setNote('');onDone?.();}
    }catch(e){setError(ownerError(e));}finally{flight.current=false;setBusy(false);}
  }
  return <article className="company-proposal" id={p.id}>
    <h3>{t(p.kind==='budget'?'Company budget proposal':p.kind==='task_plan'?'Task plan proposal':'Close task proposal')}</h3>
    <p>{p.kind==='budget'?`${t('Total authorized budget')}: ¥${(p.payload.totalMicros/1000000).toLocaleString(language())}`:p.payload.title}</p>
    {payload.plan?.ownerInstructions&&<p>{t('Rework instructions')}: {payload.plan.ownerInstructions}</p>}
    {p.kind==='task_plan'&&<><p>{p.payload.plan.summary}</p><ol>{p.payload.plan.nodes.map((n:any)=><li key={n.key}>{n.title} · {t(`Task trigger: ${n.trigger.kind}`)}{n.trigger.time&&` · ${n.trigger.time} (${n.trigger.timezone})`}{n.trigger.weekdays&&` · ${n.trigger.weekdays.map((d:number)=>new Intl.DateTimeFormat(language(),{weekday:'short',timeZone:'UTC'}).format(new Date(Date.UTC(2026,0,4+d)))).join(', ')}`}{n.trigger.everyMinutes&&` · ${n.trigger.everyMinutes} min`}<p>{n.instruction}</p></li>)}</ol></>}
    {p.kind==='task_plan'&&p.payload.plan.nodes.filter((n:any)=>n.progressPolicy).map((n:any)=><details key={n.key}><summary>{n.title} · {t('Pass threshold')}: {n.progressPolicy.passPercent}%</summary><ul>{n.progressPolicy.requirements.map((r:any)=><li key={r.id}>{r.description}</li>)}</ul><p>{t('May continue with missing inputs from: {0}',[n.progressPolicy.allowIncompleteFrom.join(', ')||t('None')])}</p></details>)}
    {p.kind==='close_task'&&<>{p.payload.reason&&<p>{p.payload.reason}</p>}<p>{t(p.payload.completionKind==='partial'?'Accepting this result closes the task as partially completed. Missing items remain recorded.':'Review the actual deliverables before closing this task.')}</p>{p.payload.gaps?.map((g:any)=><p key={g.id}>{g.description} · {t('Previous attempts: {0}',[g.attempts])}</p>)}{p.payload.evidence.map((e:any)=><p key={e.id}>{e.id.startsWith('artifact:')&&<a href={`/api/owner/goals/${encodeURIComponent(p.goalId!)}/evidence/${encodeURIComponent(e.id)}`} target="_blank" rel="noopener noreferrer">{t('View task deliverables')}</a>} · <code>{e.sha256}</code></p>)}</>}
    <small>{ownerTime(p.createdAt)} · {p.id}</small>
    {p.kind==='budget'?<p>{t('Budget proposals are retired. Use Company money budget settings.')}</p>:p.state==='PENDING'&&!result?<div className="owner-decision"><p>{t(p.kind==='task_plan'?'Approve authorizes this plan. Reject sends the company back to find another way. Rework keeps the goal alive with your instructions.':'Approve closes this task with the displayed evidence. Reject refuses the result. Rework keeps the goal open with your instructions.')}</p>
      <div className="owner-decision">
        <button disabled={busy||command.awaiting} className="owner-btn owner-btn--approve" onClick={()=>void decide('approve')}>{t(busy?'Submitting…':'Approve')}</button>
        <button disabled={busy||command.awaiting} className="owner-btn owner-btn--reject" onClick={()=>void decide('reject')}>{t('Reject')}</button>
        <button disabled={busy||command.awaiting} className="owner-btn" onClick={()=>setRework(v=>!v)}>{t('Rework with instructions')}</button>
      </div>
      {rework&&<label>{t('Rework instructions')}<textarea required minLength={8} maxLength={1000} value={note} disabled={busy} autoFocus onChange={e=>setNote(e.target.value)} placeholder={t('Describe what the company should redo or adjust')} /></label>}
      {rework&&p.kind==='close_task'&&payload.reworkNodes?.length>1&&<label>{t('Stage to rework')}<select value={nodeKey} disabled={busy} onChange={e=>setNodeKey(e.target.value)}><option value="">{t('Select a stage')}</option>{payload.reworkNodes.map((n:any)=><option key={n.key} value={n.key}>{n.title}</option>)}</select></label>}
      {rework&&<button disabled={busy||command.awaiting||note.trim().length<8||p.kind==='close_task'&&payload.reworkNodes?.length>1&&!nodeKey} className="owner-btn" onClick={()=>void decide('rework')}>{t(busy?'Submitting…':'Submit rework instructions')}</button>}
    </div>:<p role="status">{ownerStatusLabel(result??p.state,'Proposal state: ')}</p>}
    {command.awaiting&&<p role="status">{t('The recovery decision is not confirmed. Retry its original fields and key.')} <button disabled={command.busy} onClick={()=>void command.retry().then(ok=>{if(ok)onDone?.();})}>{t('Retry original decision')}</button></p>}
    {(error||command.error)&&<p role="alert">{error||command.error}</p>}
  </article>;
}
