import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { executeOwnerAction, ownerError, ownerTodoCount } from '../../api/owner';
import type { OwnerInboxItem, OwnerActionProposal, OwnerAlert } from '../../api/owner';
import { OwnerActionCard } from './OwnerActionCard';
const statuses:Record<string,string>={WAITING_PIXEL_BUDGET:'元胞能量不足，等待补充后重试。',WAITING_RUN_BUDGET:'Run budget needs attention.',WAITING_EXECUTION_BUDGET:'Execution budget needs attention.',CALL_OUTCOME_UNKNOWN:'External outcome unknown',AWAITING_SETTLEMENT:'Settlement needs verification.',PAUSED_RECOVERY_REQUIRED:'Needs verification',ABANDONED:'The conversation has no reply and needs review.'};
/** Inbox items must expose exactly one approve and one reject proposal; anything else is a projection bug. */
function pairOf(item:OwnerInboxItem):{approve:OwnerActionProposal;reject:OwnerActionProposal}|null{
  const actions=(item.actions??[]).filter(p=>p.action.type.endsWith('_approve')||p.action.type.endsWith('_provided')||p.action.type.endsWith('_reject')||p.action.type.endsWith('gene_proposal_reject'));
  const approve=actions.find(p=>['business_plan_approve','resource_provided','recruit_approve','gene_proposal_approve'].includes(p.action.type));
  const reject=actions.find(p=>['business_plan_reject','resource_reject','recruit_reject','gene_proposal_reject'].includes(p.action.type));
  return approve&&reject?{approve,reject}:null;
}
function DecisionButtons({item,onDone}:{item:OwnerInboxItem;onDone:()=>void}){
  useLanguage();
  const [busy,setBusy]=useState<'approve'|'reject'|null>(null),[error,setError]=useState('');
  const pair=pairOf(item);
  if(!pair)return null;
  const run=async(kind:'approve'|'reject')=>{
    if(busy)return;
    setBusy(kind);setError('');
    try{
      const results=await executeOwnerAction(kind==='approve'?pair.approve:pair.reject);
      const failures=results.filter(r=>!r.ok);
      if(failures.length)setError(failures.map(r=>`${r.id}: ${r.error}`).join('; '));
      else onDone();
    }catch(e){setError(ownerError(e));}
    finally{setBusy(null);}
  };
  return <>
    <div className="owner-decision">
      <button className="owner-decision-approve" disabled={busy!==null} onClick={()=>void run('approve')}>{t(busy==='approve'?'Submitting…':'Approve')}</button>
      <button className="owner-decision-reject" disabled={busy!==null} onClick={()=>void run('reject')}>{t(busy==='reject'?'Submitting…':'Reject')}</button>
      <a className="owner-decision-details" href={item.href}>{t('View details')}</a>
    </div>
    {error&&<p role="alert">{error}</p>}
  </>;
}
export function OwnerInbox({items,alerts=[],onDone}:{items:OwnerInboxItem[];alerts?:OwnerAlert[];onDone:()=>void}){
  useLanguage();
  const total=ownerTodoCount({inbox:items,alerts});
  return <section className="owner-inbox" id="owner-inbox" tabIndex={-1}><h2>{t('To-dos')} ({total})</h2><p>{t('Only decisions, missing resources and unresolved outcomes appear here.')}</p>
    {!total&&<p>{t('No to-dos pending.')}</p>}
    {items.map(i=>{const pair=pairOf(i);return <article key={i.id} className={i.priority==='critical'?'critical':''}><h3>{t(i.title)}</h3><p>{i.type==='run'?i.summary.replace(/\b[A-Z_]+\b/g,code=>statuses[code]?t(statuses[code]!):code):i.summary}</p>
      {i.priority==='critical'&&<strong>{t('Needs verification')}</strong>}<small>{i.source} · {i.createdAt===null?t('Time not recorded.'):new Date(i.createdAt).toLocaleString()}</small>
      {pair&&i.approveEffect&&<p className="owner-effect"><strong>{t('If you approve')}:</strong> {t(i.approveEffect)}</p>}
      {pair&&i.rejectEffect&&<p className="owner-effect"><strong>{t('If you reject')}:</strong> {t(i.rejectEffect)}</p>}
      {pair?<DecisionButtons item={i} onDone={onDone}/>:<a href={i.href}>{t('View details')}</a>}
      {/* Actions without a symmetric pair (chat dispatch, full-plan review) keep their existing gated card. */}
      {pair&&(i.actions??[]).filter(p=>p.action.type==='qianji_chat'||p.action.type==='open_details').map(p=><details key={p.id}><summary>{t('More actions')}</summary><OwnerActionCard proposal={p} onDone={onDone}/></details>)}
    </article>;})}
    {!!alerts.length&&<section className="owner-alerts" aria-label={t('Needs human verification')}>
      <h2>{t('Needs human verification')} ({alerts.length})</h2>
      {alerts.map(a=><article key={a.id} className={a.severity==='critical'?'critical':''}><h3>{t(a.title)}</h3><p>{a.summary}</p><small>{a.source} · {a.createdAt===null?t('Time not recorded.'):new Date(a.createdAt).toLocaleString()}</small><a href={a.href}>{t('View details')}</a></article>)}
    </section>}
  </section>;
}
