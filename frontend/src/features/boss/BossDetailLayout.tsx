import { useId, type ReactNode } from 'react';
import type { OwnerWorkTask } from '../../../../packages/protocol/src/types/owner';
import { t } from '../../i18n';
import { OwnerMarkdown } from '../owner/OwnerMarkdown';
import { ownerStatusLabel, ownerTime } from '../owner/ownerPresentation';

export function BossDetailSection({ number, title, caption, children }: { number: number; title: string; caption?: string; children: ReactNode }) {
  const heading = useId();
  return <section className="boss-detail-section" data-detail-section={number} aria-labelledby={heading}>
    <header><span className="boss-detail-section-number" aria-hidden="true">{String(number).padStart(2, '0')}</span><div><h3 id={heading}>{title}</h3>{caption && <p>{caption}</p>}</div></header>
    <div className="boss-detail-section-content">{children}</div>
  </section>;
}

export function BossDetailStats({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="boss-detail-stats">{items.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}

/** A ratio of recorded facts, never an estimate of effort or time. */
export function BossDetailProgress({ completed, total, label, caption }: { completed: number; total: number; label: string; caption: string }) {
  const percent = Math.floor(100 * completed / total);
  return <div className="boss-detail-progress">
    <div className="boss-detail-progress-head"><div><span>{label}</span><p>{completed} / {total}</p></div><strong>{percent}%</strong></div>
    <progress aria-label={label} value={completed} max={total} />
    <p className="boss-detail-caption">{caption}</p>
  </div>;
}

export function BossTaskRecord({ task }: { task: OwnerWorkTask }) {
  return <details className="boss-work-record">
    <summary><span>{t(task.personName)}</span><span className="boss-detail-state">{ownerStatusLabel(task.state, 'Task state: ')}</span></summary>
    <div className="boss-detail-split">
      <section className="boss-detail-panel"><h5>{t('Assigned work')}</h5><OwnerMarkdown content={task.instruction} /></section>
      <section className="boss-detail-panel"><h5>{t('Work result')}</h5>{task.reply ? <OwnerMarkdown content={task.reply} /> : <p>{t('No reply recorded yet.')}</p>}</section>
    </div>
    {task.reason && <p className="boss-detail-notice">{t(task.reason)}</p>}
    <details className="boss-detail-technical"><summary>{t('Technical details')}</summary>
      {task.attempt && <p>{t('Execution result')}: {t('Attempt state: ' + task.attempt.state)} · {t('Cost accounting')}: {t('Accounting state: ' + task.attempt.accountingState)}</p>}
      <p>{t('Last refreshed')}: {ownerTime(task.updatedAt)}</p><code>{task.id}</code>
    </details>
  </details>;
}
