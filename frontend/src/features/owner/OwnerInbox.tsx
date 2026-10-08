import { t, useLanguage } from '../../i18n';
import type { OwnerInboxItem } from '../../api/owner';
import { OwnerActionCard, ownerActionLabels } from './OwnerActionCard';
const statuses:Record<string,string>={WAITING_PIXEL_BUDGET:'元胞能量不足，等待补充后重试。',WAITING_RUN_BUDGET:'Run budget needs attention.',WAITING_EXECUTION_BUDGET:'Execution budget needs attention.',CALL_OUTCOME_UNKNOWN:'External outcome unknown',AWAITING_SETTLEMENT:'Settlement needs verification.',PAUSED_RECOVERY_REQUIRED:'Needs verification',ABANDONED:'The conversation has no reply and needs review.'};
export function OwnerInbox({items,onDone}:{items:OwnerInboxItem[];onDone:()=>void}){
  useLanguage();
  return <section className="owner-inbox" id="owner-inbox" tabIndex={-1}><h2>{t('Inbox')} ({items.length})</h2><p>{t('Only decisions, missing resources and unresolved outcomes appear here.')}</p>
    {!items.length&&<p>{t('No decisions pending.')}</p>}
    {items.map(i=><article key={i.id} className={i.priority==='critical'?'critical':''}><h3>{t(i.title)}</h3><p>{i.type==='run'?i.summary.replace(/\b[A-Z_]+\b/g,code=>statuses[code]?t(statuses[code]!):code):i.summary}</p>
      {i.priority==='critical'&&<strong>{t('Needs verification')}</strong>}<small>{i.source} · {i.createdAt===null?t('Time not recorded.'):new Date(i.createdAt).toLocaleString()}</small>
      <a href={i.href}>{t('View details')}</a>{i.actions?.map(p=><details key={p.id}><summary>{t(ownerActionLabels[p.action.type] ?? 'View details')}</summary><OwnerActionCard proposal={p} onDone={onDone}/></details>)}</article>)}
  </section>;
}
