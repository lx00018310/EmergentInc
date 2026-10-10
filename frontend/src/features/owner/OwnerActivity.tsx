import { t } from '../../i18n';
import type { OwnerActivityItem } from '../../api/owner';
export function OwnerActivity({items}:{items:OwnerActivityItem[]}){
  const states:Record<string,string>={QUEUED:'Queued for execution',RUNNING:'Running',REPLIED:'Person replied',BLOCKED:'Blocked',NO_REPLY:'Run ended without a reply',FAILED:'Failed'};
  return <section className="owner-activity" id="owner-activity" tabIndex={-1}><h2>{t('History')}</h2><p>{t('Recent events and public Tips, newest first.')}</p>
    {!items.length&&<p>{t('No history recorded.')}</p>}
    <ol>{items.map(i=><li key={i.id}><time>{new Date(i.createdAt).toLocaleString()}</time><a href={i.href}>{t(i.type)}</a><p>{i.source==='owner_work_tasks'?i.summary.replace(/\b(QUEUED|RUNNING|REPLIED|BLOCKED|NO_REPLY|FAILED)\b/g,s=>t(states[s]!)):i.summary}</p><small>{i.source}</small></li>)}</ol>
  </section>;
}
