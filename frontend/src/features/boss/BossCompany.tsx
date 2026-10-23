import { useCallback, useEffect, useState } from 'react';
import type { OwnerGoalDetail, OwnerOverview, OwnerWorkTask } from '../../../../packages/protocol/src/types/owner';
import { ownerError } from '../../api/owner';
import { apiRequest } from '../../api/client';
import { language, t, useLanguage } from '../../i18n';
import { OwnerMarkdown } from '../owner/OwnerMarkdown';
import { ownerStatusLabel, ownerTime } from '../owner/ownerPresentation';
import { BossNodeProgress } from './BossNodeProgress';
import { BossPluginCards } from './BossPluginCards';
import { BossCompanyCard, BossCompanyDialog } from './BossCompanyCard';

type Product = NonNullable<OwnerOverview['storefront']>['products'][number];
type Detail = { kind: 'goal' | 'product'; id: string } | { kind: 'budget' | 'team' | 'tasks' | 'orders' };
const productName = (product: Product, index: number) => (language() === 'en' ? product.nameEn : product.nameZh) || t('Product {0}', [String(index + 1).padStart(2, '0')]);
const money = (micros: number) => (micros / 1000000).toLocaleString(language(), { maximumFractionDigits: 6 });
function goalSummary(status: string): string {
  if (status === 'COMPLETED') return t('This goal is complete. Open to review its results.');
  if (status === 'PARTIALLY_COMPLETED') return t('The current results were accepted; some work remains.');
  if (['BLOCKED', 'FAILED'].includes(status)) return t('An issue needs to be resolved before this goal can move forward.');
  if (['DRAFT', 'WAITING_APPROVAL'].includes(status)) return t('This goal is waiting for your decision.');
  if (['PAUSED', 'STOPPED', 'ARCHIVED'].includes(status)) return t('This goal is not running. Its records are kept.');
  return t('Open this goal to see its progress and next steps.');
}

function TaskDetails({ task }: { task: OwnerWorkTask }) {
  return <article className="boss-company-record">
    <h4>{t(task.personName)} · {ownerStatusLabel(task.state, 'Task state: ')}</h4>
    <OwnerMarkdown content={task.instruction} />
    {task.reply && <><h5>{t('Work result')}</h5><OwnerMarkdown content={task.reply} /></>}
    {task.reason && <p>{t(task.reason)}</p>}
    <details><summary>{t('Technical details')}</summary>
      {task.attempt && <p>{t('Execution result')}: {t('Attempt state: ' + task.attempt.state)} · {t('Cost accounting')}: {t('Accounting state: ' + task.attempt.accountingState)}</p>}
      <p>{t('Last refreshed')}: {ownerTime(task.updatedAt)}</p><code>{task.id}</code>
    </details>
  </article>;
}

function GoalDetails({ id, data, onDone }: { id: string; data: OwnerOverview; onDone: () => void }) {
  const [detail, setDetail] = useState<OwnerGoalDetail>(), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void apiRequest<OwnerGoalDetail>('owner/goals/' + encodeURIComponent(id), { worldScoped: false, signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) { setDetail(next); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(ownerError(e)); });
    return () => controller.abort();
  }, [id, revision]);
  if (error) return <p role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>{t('Retry')}</button></p>;
  if (!detail) return <p>{t('Loading…')}</p>;
  const artifacts = detail.evidence.filter(e => e.kind === 'artifact');
  const tasks = data.work?.tasks.filter(task => task.goalId === id) ?? [];
  return <>
    <p className="boss-company-detail-status">{ownerStatusLabel(detail.goal.status, 'Goal status: ')}</p>
    <h3>{t('What this is about')}</h3><OwnerMarkdown content={detail.goal.objective} />
    {detail.goal.reason && <p>{t(detail.goal.reason)}</p>}
    <h3>{t('Stage progress and continuation')}</h3>
    {data.taskPlans?.find(plan => plan.goalId === id)?.nodes.map(node => <BossNodeProgress key={id + ':' + node.key} goalId={id} nodeKey={node.key} onDone={() => { onDone(); setRevision(n => n + 1); }} />)}
    <h3>{t('View task deliverables')}</h3>
    {!artifacts.length && <p>{t('No verified deliverables yet.')}</p>}
    {artifacts.map(e => <p key={e.id}><a href={'/api/owner/goals/' + encodeURIComponent(id) + '/evidence/' + encodeURIComponent(e.id)} target="_blank" rel="noopener noreferrer">{e.reference.split('/').at(-1)}</a></p>)}
    <h3>{t('Acceptance rule')}</h3><p>{detail.goal.acceptance.kind === 'manual' ? t(detail.goal.acceptance.description) : detail.goal.acceptance.kind === 'artifact' ? detail.goal.acceptance.filename : detail.goal.acceptance.targetCount + ' ' + t('Confirmed paid orders')}</p>
    {!!tasks.length && <details><summary>{t('Work records')}</summary>{tasks.map(task => <TaskDetails key={task.id} task={task} />)}</details>}
  </>;
}

export function BossCompany({ onAction }: { onAction: (action: 'budget' | 'payment' | 'review' | 'model') => void }) {
  useLanguage();
  const [data, setData] = useState<OwnerOverview>(), [selected, setSelected] = useState<Detail>(), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setData(await apiRequest<OwnerOverview>('boss/company', { worldScoped: false })); setError(''); } catch (e) { setError(ownerError(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const goals = data?.goals ?? [], products = data?.storefront?.products ?? [], orders = data?.storefront?.orders ?? [], tasks = data?.work?.tasks ?? [];
  const goal = selected?.kind === 'goal' ? goals.find(g => g.id === selected.id) : undefined;
  const productIndex = selected?.kind === 'product' ? products.findIndex(p => p.id === selected.id) : -1;
  const product = products[productIndex];
  const titles = { budget: t('Company money'), team: t('Who is working?'), tasks: t('Work records'), orders: t('Customer orders') };
  const detailTitle = goal?.title ?? (product ? productName(product, productIndex) : selected && selected.kind in titles ? titles[selected.kind as keyof typeof titles] : '');
  const detailId = selected ? 'id' in selected ? selected.kind + ':' + selected.id : selected.kind : '';
  return <>
    <header className="boss-company-header">
      <div><h2>{t('Inspect Company')}</h2><p>{t('One card, one story. Open it for the details.')}</p></div>
      <details className="boss-company-settings"><summary>{t('Settings')}</summary><div className="boss-company-settings-menu">
        <button onClick={() => onAction('budget')}>{t('Authorize company budget')}</button>
        <button onClick={() => onAction('payment')}>{t('Configure payments')}</button>
        <button onClick={() => onAction('review')}>{t('Review unresolved calls')}</button>
        <button onClick={() => onAction('model')}>{t('Configure a model')}</button>
      </div></details>
    </header>
    <nav className="boss-entries" aria-label={t('Company entrances')}>
      <a href="/" target="_blank" rel="noopener noreferrer">{t('Storefront')} ↗</a>
      <a href="/#orders" target="_blank" rel="noopener noreferrer">{t('Order lookup')} ↗</a>
      <a href="/#support" target="_blank" rel="noopener noreferrer">{t('Support')} ↗</a>
    </nav>
    {!!error && <p role="alert">{error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    {!data && !error && <p>{t('Waiting for verified data')}</p>}
    <BossPluginCards>
      {data && <>
        {goals.map(g => {
          const nodes = data.taskPlans?.find(plan => plan.goalId === g.id)?.nodes ?? [];
          const current = nodes.find(node => ['RUNNING', 'BLOCKED', 'WAITING_RESOURCE'].includes(node.state)) ?? nodes.find(node => node.state === 'WAITING');
          return <BossCompanyCard key={g.id} id={'goal:' + g.id} topic={t('Business goal')} title={g.title} status={ownerStatusLabel(g.status, 'Goal status: ')} onOpen={() => setSelected({ kind: 'goal', id: g.id })}>
            <p className="boss-company-card-summary">{goalSummary(g.status)}</p>
            {current && <p className="boss-company-card-note">{t('Current stage: {0}', [current.title])}</p>}
          </BossCompanyCard>;
        })}
        {data.budget && <BossCompanyCard id="budget" topic={t('Budget')} title={titles.budget} onOpen={() => setSelected({ kind: 'budget' })}>
          <p className="boss-company-card-value">{data.budget.activatedAt === null ? t('Unauthorized') : <>{money(data.budget.availableMicros)} <small>CNY</small></>}</p>
          <p className="boss-company-card-summary">{t('Available for the company to use.')}</p>
        </BossCompanyCard>}
        {products.map((p, index) => <BossCompanyCard key={p.id} id={'product:' + p.id} topic={t('Product')} title={productName(p, index)} status={t(p.enabled ? 'Published' : 'Unpublished')} onOpen={() => setSelected({ kind: 'product', id: p.id })}>
          <p className="boss-company-card-value">{p.price === null ? t('Not priced yet') : <>{p.price} <small>{p.currency}</small></>}</p>
          <p className="boss-company-card-summary">{t(p.enabled ? 'This product is published in the storefront.' : 'This product has not been published yet.')}</p>
        </BossCompanyCard>)}
        <BossCompanyCard id="team" topic={t('Team')} title={titles.team} onOpen={() => setSelected({ kind: 'team' })}>
          <p className="boss-company-card-value">{data.people.filter(p => p.running).length}<small> / {data.people.length}</small></p>
          <p className="boss-company-card-summary">{t(data.people.length ? 'Workers currently running / company workers.' : 'No company workers yet.')}</p>
          {!!data.people.length && <p className="boss-company-card-note">{data.people.slice(0, 3).map(p => t(p.name)).join(' · ')}</p>}
        </BossCompanyCard>
        <BossCompanyCard id="tasks" topic={t('Execution')} title={titles.tasks} onOpen={() => setSelected({ kind: 'tasks' })}>
          <p className="boss-company-card-value">{data.work ? tasks.length : '—'}</p><p className="boss-company-card-summary">{t(data.work ? 'Recorded work, replies and execution history.' : 'Waiting for verified data')}</p>
          {!!tasks.length && <p className="boss-company-card-note">{t('{0} running · {1} need attention', [tasks.filter(task => task.state === 'RUNNING').length, tasks.filter(task => ['BLOCKED', 'FAILED', 'NO_REPLY'].includes(task.state)).length])}</p>}
        </BossCompanyCard>
        <BossCompanyCard id="orders" topic={t('Orders')} title={titles.orders} onOpen={() => setSelected({ kind: 'orders' })}>
          <p className="boss-company-card-value">{data.storefront ? orders.length : '—'}</p><p className="boss-company-card-summary">{t(!data.storefront ? 'Waiting for verified data' : orders.length ? 'Open to check these orders and their payment status.' : 'No company orders yet.')}</p>
        </BossCompanyCard>
      </>}
    </BossPluginCards>
    {selected && data && <BossCompanyDialog id={detailId} title={detailTitle} onClose={() => setSelected(undefined)}>
      {goal && <GoalDetails key={goal.id} id={goal.id} data={data} onDone={() => void refresh()} />}
      {product && <>
        <p className="boss-company-detail-status">{t(product.enabled ? 'Published' : 'Unpublished')}</p>
        <p className="boss-company-card-value">{product.price === null ? t('Not priced yet') : product.price + ' ' + product.currency}</p>
        <p>{t(product.enabled ? 'This product is published in the storefront.' : 'This product has not been published yet.')}</p>
        <a href="/" target="_blank" rel="noopener noreferrer">{t('Storefront')} ↗</a>
        <details><summary>{t('Technical details')}</summary><code>{product.id}</code></details>
      </>}
      {selected.kind === 'budget' && data.budget && <>
        <p>{t('Available company budget')}: {money(data.budget.availableMicros)} CNY</p>
        <p>{t('Settled cost')}: {money(data.budget.spentMicros)} CNY</p><p>{t('Reserved cost')}: {money(data.budget.reservedMicros)} CNY</p>
        <button onClick={() => onAction('budget')}>{t('Authorize company budget')}</button>
      </>}
      {selected.kind === 'team' && <>
        {!data.people.length && <p>{t('No company workers yet.')}</p>}
        {data.people.map(person => <article key={person.id} className="boss-company-record"><h3>{t(person.name)}</h3>{person.role && <p>{t(person.role)}</p>}<p>{ownerStatusLabel(person.running ? 'RUNNING' : 'IDLE', 'Company observed: ')}</p></article>)}
      </>}
      {selected.kind === 'tasks' && <>
        {!tasks.length && <p>{t(data.work ? 'No company tasks yet.' : 'Waiting for verified data')}</p>}
        {tasks.map(task => <TaskDetails key={task.id} task={task} />)}
      </>}
      {selected.kind === 'orders' && <>
        {!orders.length && <p>{t(data.storefront ? 'No company orders yet.' : 'Waiting for verified data')}</p>}
        {orders.map(order => {
          const index = products.findIndex(p => p.id === order.product), orderedProduct = products[index];
          return <article key={order.id} className="boss-company-record"><h3>{orderedProduct ? productName(orderedProduct, index) : order.product}</h3><p>{order.amount} {order.currency} · {ownerStatusLabel(order.status, 'Order status: ')}</p><p>{ownerTime(order.at)}</p><details><summary>{t('Technical details')}</summary><code>{order.id}</code></details></article>;
        })}
      </>}
    </BossCompanyDialog>}
  </>;
}
