import { t } from '../../i18n';
import type { OwnerActivityItem } from '../../api/owner';
export function OwnerActivity({items}:{items:OwnerActivityItem[]}){
  return <section className="owner-activity"><h2>{t('Activity')}</h2><p>{t('Recent events and public Tips, newest first.')}</p>
    {!items.length&&<p>{t('No activity recorded.')}</p>}
    <ol>{items.map(i=><li key={i.id}><time>{new Date(i.createdAt).toLocaleString()}</time><a href={i.href}>{t(i.type)}</a><p>{i.summary}</p><small>{i.source}</small></li>)}</ol>
  </section>;
}
