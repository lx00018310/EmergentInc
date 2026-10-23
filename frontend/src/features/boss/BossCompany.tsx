import { useCallback, useEffect, useState } from 'react';
import type { OwnerGoalDetail, OwnerOverview } from '../../../../packages/protocol/src/types/owner';
import { ownerError } from '../../api/owner';
import { apiRequest } from '../../api/client';
import { language, t, useLanguage } from '../../i18n';
import { OwnerMarkdown } from '../owner/OwnerMarkdown';
import { ownerStatusLabel, ownerTime } from '../owner/ownerPresentation';
import { BossNodeProgress } from './BossNodeProgress';
import { BossPluginCards } from './BossPluginCards';
import { BossCompanyCard, BossCompanyDialog } from './BossCompanyCard';
import { BossDetailSection, BossDetailStats, BossDetailProgress, BossTaskRecord } from './BossDetailLayout';

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

function GoalDetails({ id, data, onSnapshot }: { id: string; data: OwnerOverview; onSnapshot: (data: OwnerOverview) => void }) {
  const [detail, setDetail] = useState<OwnerGoalDetail>(), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      apiRequest<OwnerGoalDetail>('owner/goals/' + encodeURIComponent(id), { worldScoped: false, signal: controller.signal }),
      apiRequest<OwnerOverview>('boss/company', { worldScoped: false, signal: controller.signal }),
    ])
      .then(([next, snapshot]) => { if (!controller.signal.aborted) { setDetail(next); onSnapshot(snapshot); setError(''); } })
      .catch(e => { if (!controller.signal.aborted) setError(ownerError(e)); });
    return () => controller.abort();
  }, [id, revision, onSnapshot]);
  if (error) return <p role="alert">{error} <button onClick={() => setRevision(n => n + 1)}>{t('Retry')}</button></p>;
  if (!detail) return <p>{t('Loading…')}</p>;
  const artifacts = detail.evidence.filter(e => e.kind === 'artifact');
  const tasks = data.work?.tasks.filter(task => task.goalId === id) ?? [];
  const plan = data.taskPlans?.find(plan => plan.goalId === id && plan.goalRevision === detail.goal.specificationRevision);
  const nodes = plan?.nodes ?? [];
  const completed = nodes.filter(node => node.state === 'COMPLETED').length;
  const unlinkedTasks = tasks.filter(task => !nodes.some(node => node.key === task.nodeKey));
  const acceptance = detail.goal.acceptance.kind === 'manual' ? t(detail.goal.acceptance.description) : detail.goal.acceptance.kind === 'artifact' ? detail.goal.acceptance.filename : detail.goal.acceptance.targetCount + ' ' + t('Confirmed paid orders');
  return <>
    <BossDetailSection number={1} title={t('Overview')} caption={t('What this is about')}>
      <p className="boss-company-detail-status">{ownerStatusLabel(detail.goal.status, 'Goal status: ')}</p>
      <div className="boss-detail-split"><OwnerMarkdown content={detail.goal.objective} />
      <div className="boss-detail-panel"><h4>{t('Expected outcome')}</h4><p>{acceptance}</p></div></div>
    </BossDetailSection>
    <BossDetailSection number={2} title={t('Overall progress')}>
      {plan?.approved && nodes.length ? <BossDetailProgress completed={completed} total={nodes.length} label={t('Stage completion')} caption={t('Completed stages / current plan stages, equally weighted. Partial, skipped and deferred stages are not complete.')} /> : <p className="boss-detail-empty">{t(plan && !plan.approved ? 'This plan is awaiting approval. Progress is not calculated yet.' : 'No stage plan is available to calculate progress.')}</p>}
      <BossDetailStats items={[{ label: t('Completed stages'), value: completed }, { label: t('Stages in progress'), value: nodes.filter(node => node.state === 'RUNNING').length }, { label: t('Verified artifacts'), value: artifacts.length }]} />
      {detail.goal.reason && <aside className="boss-detail-notice"><h4>{t('Current situation')}</h4><p>{t(detail.goal.reason)}</p></aside>}
    </BossDetailSection>
    <BossDetailSection number={3} title={t('Main stages')} caption={t('Open a stage to see its work, acceptance checks and next actions.')}>
      {!nodes.length && <p className="boss-detail-empty">{t('No stages have been planned yet.')}</p>}
      <ol className="boss-detail-stages">{nodes.map((node, index) => <li key={node.key}><BossNodeProgress index={index + 1} goalId={id} nodeKey={node.key} title={node.title} state={node.state} onDone={() => setRevision(n => n + 1)}>
        {!!tasks.filter(task => task.nodeKey === node.key).length && <section className="boss-detail-panel"><h5>{t('Specific work')}</h5>{tasks.filter(task => task.nodeKey === node.key).map(task => <BossTaskRecord key={task.id} task={task} />)}</section>}
        {!!artifacts.filter(e => node.latestEvidence.includes(e.id) || node.progress?.evidenceIds.includes(e.id)).length && <section className="boss-detail-panel"><h5>{t('Stage artifacts')}</h5>{artifacts.filter(e => node.latestEvidence.includes(e.id) || node.progress?.evidenceIds.includes(e.id)).map(e => <p key={e.id}><a href={'/api/owner/goals/' + encodeURIComponent(id) + '/evidence/' + encodeURIComponent(e.id)} target="_blank" rel="noopener noreferrer">{e.reference.split('/').at(-1)}</a></p>)}</section>}
      </BossNodeProgress></li>)}</ol>
    </BossDetailSection>
    <BossDetailSection number={4} title={t('Results and records')}>
      {!artifacts.length && <p className="boss-detail-empty">{t('No verified deliverables yet.')}</p>}
      <div className="boss-detail-artifacts">{artifacts.map(e => <a key={e.id} href={'/api/owner/goals/' + encodeURIComponent(id) + '/evidence/' + encodeURIComponent(e.id)} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>{e.reference.split('/').at(-1)}</a>)}</div>
      {!!unlinkedTasks.length && <details><summary>{t('Other work records')}</summary>{unlinkedTasks.map(task => <BossTaskRecord key={task.id} task={task} />)}</details>}
    </BossDetailSection>
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
  const detailSections:Record<Detail['kind'],string[]>={goal:['Overview','Overall progress','Main stages','Results and records'],product:['Overview','Current status','Details and next steps'],budget:['Overview','Budget breakdown','Details and next steps'],team:['Overview','Team members'],tasks:['Overview','Specific work'],orders:['Overview','Order records']};
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
    {selected && data && <BossCompanyDialog id={detailId} title={detailTitle} sections={detailSections[selected.kind].map(section=>t(section))} onClose={() => setSelected(undefined)}>
      {goal && <GoalDetails key={goal.id} id={goal.id} data={data} onSnapshot={setData} />}
      {product && <>
        <BossDetailSection number={1} title={t('Overview')}><p className="boss-company-detail-status">{t(product.enabled ? 'Published' : 'Unpublished')}</p><p>{t(product.enabled ? 'This product is published in the storefront.' : 'This product has not been published yet.')}</p></BossDetailSection>
        <BossDetailSection number={2} title={t('Current status')}><BossDetailStats items={[{label:t('Price'),value:product.price===null?t('Not priced yet'):product.price+' '+product.currency},{label:t('Publication status'),value:t(product.enabled?'Published':'Unpublished')}]} /></BossDetailSection>
        <BossDetailSection number={3} title={t('Details and next steps')}><a className="boss-detail-link" href="/" target="_blank" rel="noopener noreferrer">{t('Storefront')} ↗</a><details className="boss-detail-technical"><summary>{t('Technical details')}</summary><code>{product.id}</code></details></BossDetailSection>
      </>}
      {selected.kind === 'budget' && data.budget && <>
        <BossDetailSection number={1} title={t('Overview')}><p>{t('Available for the company to use.')}</p><p className="boss-company-card-value">{data.budget.activatedAt===null?t('Unauthorized'):money(data.budget.availableMicros)+' CNY'}</p></BossDetailSection>
        <BossDetailSection number={2} title={t('Budget breakdown')}><BossDetailStats items={[{label:t('Authorized budget'),value:money(data.budget.totalMicros)+' CNY'},{label:t('Settled cost'),value:money(data.budget.spentMicros)+' CNY'},{label:t('Reserved cost'),value:money(data.budget.reservedMicros)+' CNY'}]}/></BossDetailSection>
        <BossDetailSection number={3} title={t('Details and next steps')}><button onClick={() => onAction('budget')}>{t('Authorize company budget')}</button></BossDetailSection>
      </>}
      {selected.kind === 'team' && <>
        <BossDetailSection number={1} title={t('Overview')}><BossDetailStats items={[{label:t('Company workers'),value:data.people.length},{label:t('Currently working'),value:data.people.filter(person=>person.running).length}]}/></BossDetailSection>
        <BossDetailSection number={2} title={t('Team members')} caption={t('Open a member to see their role and work records.')}>
          {!data.people.length && <p className="boss-detail-empty">{t('No company workers yet.')}</p>}
          {data.people.map(person => <details key={person.id} className="boss-work-record"><summary><span>{t(person.name)}</span><span className="boss-detail-state">{ownerStatusLabel(person.running ? 'RUNNING' : 'IDLE', 'Company observed: ')}</span></summary><div className="boss-detail-panel"><h5>{t('Role')}</h5><p>{person.role?t(person.role):t('Not recorded')}</p></div>{tasks.filter(task=>task.personId===person.id).map(task=><BossTaskRecord key={task.id} task={task}/>)}</details>)}
        </BossDetailSection>
      </>}
      {selected.kind === 'tasks' && <>
        <BossDetailSection number={1} title={t('Overview')}><p>{t('Recorded work, replies and execution history.')}</p><BossDetailStats items={[{label:t('Visible records'),value:data.work?tasks.length:'—'},{label:t('Currently running'),value:data.work?tasks.filter(task=>task.state==='RUNNING').length:'—'},{label:t('Needs attention'),value:data.work?tasks.filter(task=>['BLOCKED','FAILED','NO_REPLY'].includes(task.state)).length:'—'}]}/></BossDetailSection>
        <BossDetailSection number={2} title={t('Specific work')} caption={t('Open a record to see the assignment, result and supporting details.')}>
          {!tasks.length && <p className="boss-detail-empty">{t(data.work ? 'No company tasks yet.' : 'Waiting for verified data')}</p>}
          {tasks.map(task => <BossTaskRecord key={task.id} task={task} />)}
        </BossDetailSection>
      </>}
      {selected.kind === 'orders' && <>
        <BossDetailSection number={1} title={t('Overview')}><BossDetailStats items={[{label:t('Visible orders'),value:data.storefront?orders.length:'—'},{label:t('Confirmed paid orders'),value:data.storefront?orders.filter(order=>['PAID','DELIVERED','FULFILLED'].includes(order.status)).length:'—'}]}/></BossDetailSection>
        <BossDetailSection number={2} title={t('Order records')} caption={t('Open an order to see its amount, time and reference.')}>
        {!orders.length && <p className="boss-detail-empty">{t(data.storefront ? 'No company orders yet.' : 'Waiting for verified data')}</p>}
        {orders.map(order => {
          const index = products.findIndex(p => p.id === order.product), orderedProduct = products[index];
          return <details key={order.id} className="boss-work-record"><summary><span>{orderedProduct ? productName(orderedProduct, index) : order.product}</span><span className="boss-detail-state">{ownerStatusLabel(order.status, 'Order status: ')}</span></summary><BossDetailStats items={[{label:t('Amount'),value:order.amount+' '+order.currency},{label:t('Order time'),value:ownerTime(order.at)}]}/><details className="boss-detail-technical"><summary>{t('Technical details')}</summary><code>{order.id}</code></details></details>;
        })}
        </BossDetailSection>
      </>}
    </BossCompanyDialog>}
  </>;
}
