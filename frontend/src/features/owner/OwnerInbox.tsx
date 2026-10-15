import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { executeOwnerAction, ownerError, ownerTodoCount } from '../../api/owner';
import type { OwnerInboxItem, OwnerAlert } from '../../api/owner';
import { OwnerActionCard } from './OwnerActionCard';
import { OwnerReason, OwnerTechnical } from './OwnerStatus';
import { ownerApprovalPair, ownerActivityHref, ownerMetadataText, ownerTime } from './ownerPresentation';
function DecisionButtons({item,onDone}:{item:OwnerInboxItem;onDone:()=>void}){
  useLanguage();
  const [busy,setBusy]=useState<'approve'|'reject'|null>(null),[error,setError]=useState('');
  const pair=ownerApprovalPair(item);
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
      <button className="owner-btn owner-btn--approve" disabled={busy!==null} onClick={()=>void run('approve')}>{t(busy==='approve'?'Submitting…':'Approve')}</button>
      <button className="owner-btn owner-btn--reject" disabled={busy!==null} onClick={()=>void run('reject')}>{t(busy==='reject'?'Submitting…':'Reject')}</button>
      <a className="owner-btn owner-btn--ghost owner-btn--sm" href={item.href}>{t('View details')}</a>
    </div>
    {error&&<p role="alert">{error}</p>}
  </>;
}
export function OwnerInbox({items, alerts = [], onDone, title = 'To-dos', id = 'owner-inbox'}:
  {items: OwnerInboxItem[]; alerts?: OwnerAlert[]; onDone: () => void; title?: string | null; id?: string}) {
  useLanguage();
  const total = ownerTodoCount({inbox: items, alerts});
  return <section className="owner-inbox" id={id} tabIndex={-1}>
    {title && <><h2>{t(title)} ({total})</h2><p>{t('Only decisions, missing resources and unresolved outcomes appear here.')}</p></>}
    {!total && <p>{t('No to-dos pending.')}</p>}
    {items.map(item => {
      const pair = ownerApprovalPair(item);
      return <article key={item.id} className={item.priority === 'critical' ? 'critical' : ''}>
        <h3>{t(item.title)}</h3><p>{ownerMetadataText(item.summary, item.type === 'run')}</p>
        {item.priority === 'critical' && <strong>{t('Needs verification')}</strong>}
        <small>{ownerTime(item.createdAt)}</small>
        {pair && item.approveEffect && <p className="owner-effect"><strong>{t('If you approve')}:</strong>
          {' '}{t(item.approveEffect, item.approveEffectValues)}</p>}
        {pair && item.rejectEffect && <p className="owner-effect"><strong>{t('If you reject')}:</strong>
          {' '}{t(item.rejectEffect, item.rejectEffectValues)}</p>}
        {pair ? <DecisionButtons item={item} onDone={onDone} /> :
          <a className="owner-btn owner-btn--ghost owner-btn--sm" href={ownerActivityHref(item.href)}>{t('View details')}</a>}
        {pair && (item.actions ?? []).filter(p => p.action.type === 'qianji_chat' || p.action.type === 'open_details')
          .map(p => <details key={p.id}><summary>{t('More actions')}</summary>
            <OwnerActionCard proposal={p} onDone={onDone}/></details>)}
        <OwnerTechnical><small>{item.source} · {ownerTime(item.createdAt)}</small>
          <p>{item.summary}</p><code>{item.id}</code></OwnerTechnical>
      </article>;
    })}
    {!!alerts.length && <section className="owner-alerts" aria-label={t('Needs human verification')}>
      <h3>{t('Needs human verification')} ({alerts.length})</h3>
      {alerts.map(alert => <article key={alert.id} className={alert.severity === 'critical' ? 'critical' : ''}>
        <h3>{t(alert.title)}</h3><p>{ownerMetadataText(alert.summary)}</p>
        <OwnerReason reason={alert.reasonKey}/><small>{ownerTime(alert.createdAt)}</small>
        <a className="owner-btn owner-btn--ghost owner-btn--sm" href={ownerActivityHref(alert.href)}>{t('View details')}</a>
        <OwnerTechnical><small>{alert.source} · {ownerTime(alert.createdAt)}</small>
          <p>{alert.summary}</p>{alert.reasonKey && <code>{alert.reasonKey}</code>}</OwnerTechnical>
      </article>)}
    </section>}
  </section>;
}
