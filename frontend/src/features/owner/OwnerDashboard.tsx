import { useEffect, useRef } from 'react';
import type { OwnerOverview } from '../../api/owner';
import { t, useLanguage, language } from '../../i18n';
import { OwnerInbox } from './OwnerInbox';
import { OwnerActivity } from './OwnerActivity';
import { CompanyProposalCard } from './CompanyProposalCard';
import { OwnerWork } from './OwnerWork';
import { OwnerBudget } from './OwnerBudget';
import { OwnerExtensions } from './OwnerExtensions';
import { OwnerTaskBoard, ownerBoardItems, ownerBoardColumn } from './OwnerTaskBoard';
import { ownerApprovalPair, ownerStatusLabel, ownerTime } from './ownerPresentation';

export function OwnerDashboard({ data, onDone }: { data: OwnerOverview; onDone: () => void }) {
  useLanguage();
  const pending = (data.proposals ?? []).filter(p => p.state === 'PENDING' && p.kind !== 'budget');
  const approvals = data.inbox.filter(item => ownerApprovalPair(item));
  const followup = data.inbox.filter(item => !ownerApprovalPair(item));
  const alerts = data.alerts ?? [];
  const opened = useRef('');
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const resource = query.get('goal') ?? query.get('report');
    const target = resource ?? window.location.hash.slice(1);
    if (target === 'owner-dashboard' || target === 'owner-chat') return;
    if (!target || opened.current === target) return;
    const node = document.getElementById(target);
    if (!node) return;
    opened.current = target;
    let ancestor: HTMLElement | null = node;
    while (ancestor) {
      if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      ancestor = ancestor.parentElement;
    }
    const detail = node.querySelector('details');
    if (resource && detail) detail.open = true;
    node.scrollIntoView?.({ block: 'start' });
  }, [data.asOf]);
  return <div className="owner-dashboard">
    <OwnerTaskBoard data={data} />
    <div className="owner-decisions-grid">
      <section className={'owner-card' + (pending.length + approvals.length ? ' owner-approval' : '')}
        aria-label={t('Needs your approval')}>
        <h2>{t('Needs your approval')}<span className={'owner-badge' +
          (pending.length + approvals.length ? ' owner-badge--warning' : '')}>{pending.length + approvals.length}</span></h2>
        {!pending.length && !approvals.length && <p className="owner-muted">{t('No approvals pending.')}</p>}
        {pending.map(proposal => <CompanyProposalCard key={proposal.id} proposal={proposal} onDone={onDone} />)}
        {!!approvals.length && <OwnerInbox items={approvals} onDone={onDone} title={null} id="owner-approval-items" />}
      </section>
      <section className={'owner-card' + (followup.length + alerts.length ? ' owner-followup' : '')}
        aria-label={t('Needs follow-up')}>
        <h2>{t('Needs follow-up')}<span className={'owner-badge' +
          (followup.length + alerts.length ? ' owner-badge--warning' : '')}>{followup.length + alerts.length}</span></h2>
        {!followup.length && !alerts.length ? <p className="owner-muted">{t('No follow-up pending.')}</p> :
          <OwnerInbox items={followup} alerts={alerts} onDone={onDone} title={null} id="owner-followup-items" />}
      </section>
    </div>
    <OwnerBudget data={data} onDone={onDone} />
    <People data={data} />
    <OwnerWork work={data.work} showTasks={false} />
    {data.storefront && <details className="owner-card">
      <summary><strong>{t('Store products and orders')}</strong></summary>
      {!data.storefront.products.length && <p>{t('No products configured.')}</p>}
      {data.storefront.products.map(p => <article key={p.id}><h3>{(language() === 'en' ? p.nameEn : p.nameZh) || p.id}</h3>
        <p>{t(p.enabled ? 'Published product' : 'Unpublished product')} · {p.price ?? '—'} {p.currency}</p></article>)}
      {!data.storefront.orders.length && <p>{t('No orders recorded.')}</p>}
      <ol>{data.storefront.orders.map(o => <li key={o.id}>{o.product} · {o.amount} {o.currency} ·
        {' '}{ownerStatusLabel(o.status)} · {ownerTime(o.at)}</li>)}</ol>
    </details>}
    <details className="owner-card"><summary><strong>{t('Verified revenue')}</strong></summary>
      {(data.revenue ?? []).length ? <><RevenueChart rows={data.revenue!} /><ol>{data.revenue!.map((r, index) =>
        <li key={index}>{ownerTime(r.at)} · {r.amount} {r.asset}</li>)}</ol></> : <p>{t('No verified revenue yet.')}</p>}
    </details>
    <OwnerExtensions worldIds={data.people.map(p => p.worldId).filter(Boolean)} />
    <details className="owner-card owner-history"><summary><strong>{t('History')}</strong>
      <span className="owner-count">{data.activity.length}</span></summary><OwnerActivity items={data.activity} /></details>
    <details className="owner-card"><summary><strong>{t('Decision history')}</strong></summary>
      {!(data.proposals ?? []).some(p => p.state !== 'PENDING') && <p>{t('No decisions recorded.')}</p>}
      {(data.proposals ?? []).filter(p => p.state !== 'PENDING').map(p => <CompanyProposalCard key={p.id} proposal={p} />)}
    </details>
  </div>;
}

function People({ data }: { data: OwnerOverview }) {
  const items = ownerBoardItems(data);
  return <section className="owner-card"><h2>{t('People and workload')}</h2>
    <p className="owner-muted">{t('Task counts and live execution are shown separately. A stopped run does not close a task.')}</p>
    <div className="owner-people-grid">{data.people.map(person => {
      const tasks = items.filter(item => item.personIds.includes(person.id) && !['COMPLETED', 'ARCHIVED'].includes(item.status));
      const waiting = tasks.filter(item => ownerBoardColumn(item, data) === 'attention').length;
      const replies = tasks.filter(item => ['REPLIED', 'WAITING_APPROVAL'].includes(item.status)).length;
      return <article className="owner-person-card" key={person.id}><div className="owner-section-heading">
        <h3>{person.name}</h3><span className={'owner-task-state' + (person.running ? ' owner-task-state--running' : '')}>
          {t(person.running ? 'Executing now' : 'Not executing now')}</span></div>
        <p className="owner-person-role">{person.role || t('Company coordinator')}</p>
        <dl><div><dt>{t('Open tasks')}</dt><dd>{tasks.length}</dd></div>
          <div><dt>{t('Tasks needing follow-up')}</dt><dd>{waiting}</dd></div>
          <div><dt>{t('Replies awaiting acceptance')}</dt><dd>{replies}</dd></div></dl>
      </article>;
    })}</div>
    {!data.people.length && <p>{t('No active people. AI can propose recruitment when execution needs it.')}</p>}
  </section>;
}

function RevenueChart({ rows }: { rows: { asset: string; amount: string; at: number }[] }) {
  return <>{[...new Set(rows.map(row => row.asset))].map(asset => {
    const list = rows.filter(row => row.asset === asset && Number.isFinite(Number(row.amount)) && Number(row.amount) >= 0)
      .sort((a, b) => a.at - b.at);
    if (!list.length) return <p key={asset}>{t('Revenue chart unavailable for {0}.', [asset])}</p>;
    const max = Math.max(1, ...list.map(row => Number(row.amount)));
    return <svg className="owner-revenue-chart" key={asset} viewBox="0 0 400 110" role="img"
      aria-label={t('Verified revenue') + ' · ' + asset}><polyline fill="none" stroke="currentColor" strokeWidth="2"
        points={list.map((row, index) => (20 + index * 360 / Math.max(1, list.length - 1)) + ',' +
          (90 - Number(row.amount) / max * 70)).join(' ')} />
      {list.map((row, index) => <circle key={index} cx={20 + index * 360 / Math.max(1, list.length - 1)}
        cy={90 - Number(row.amount) / max * 70} r="3" fill="currentColor">
        <title>{ownerTime(row.at) + ': ' + row.amount + ' ' + asset}</title></circle>)}</svg>;
  })}</>;
}
