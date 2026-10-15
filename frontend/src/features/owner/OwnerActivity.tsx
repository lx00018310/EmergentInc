import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import type { OwnerActivityItem } from '../../api/owner';
import { OwnerTechnical } from './OwnerStatus';
import { ownerActivityHref, ownerMetadataText, ownerTime } from './ownerPresentation';

const technicalEvent = (item: OwnerActivityItem) =>
  /^(generation_|world_current_|world_migration_|instance_compatibility|STARTING$|SWITCHING$|CANDIDATE_SMOKE$)/.test(item.type);

export function OwnerActivity({items}: {items: OwnerActivityItem[]}) {
  useLanguage();
  const [includeSystem, setIncludeSystem] = useState(false);
  const visible = items.filter(item => includeSystem || !technicalEvent(item));
  return <section className="owner-activity" id="owner-activity" tabIndex={-1}>
    <h2>{t('History')}</h2><p>{t('Recent events and public Tips, newest first.')}</p>
    <button className="owner-btn owner-btn--ghost owner-btn--sm" aria-pressed={includeSystem}
      onClick={() => setIncludeSystem(value => !value)}>{t(includeSystem ? 'Hide system events' : 'Include system events')}</button>
    <p className="owner-muted">{t('Showing {0} of {1} events', [visible.length, items.length])}</p>
    {!visible.length && <p>{t(items.length ? 'No business events in the received history.' : 'No history recorded.')}</p>}
    <ol>{visible.map(item => {
      const translatedType = t(item.type);
      const label = translatedType !== item.type ? translatedType : t('System event');
      const summary = item.summaryKey ? (t(item.summaryKey, item.summaryValues) === item.summaryKey ?
        t('Task updated') : t(item.summaryKey, item.summaryValues)) :
        ['life_events', 'control_events', 'current_events'].includes(item.source) ? '' :
          ownerMetadataText(item.summary, item.source === 'runs');
      return <li key={item.id}><time>{ownerTime(item.createdAt)}</time>
        <a href={ownerActivityHref(item.href)}>{label}</a>{summary && <p>{summary}</p>}
        <OwnerTechnical><p>{item.type} · {item.source}</p><p>{item.summary}</p></OwnerTechnical>
      </li>;
    })}</ol>
  </section>;
}
