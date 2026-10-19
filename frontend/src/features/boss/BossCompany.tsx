import { useCallback, useEffect, useState } from 'react';
import type { OwnerGoalDetail, OwnerOverview } from '../../../../packages/protocol/src/types/owner';
import { ownerError, ownerGoalRequest } from '../../api/owner';
import { apiRequest } from '../../api/client';
import { language, t, useLanguage } from '../../i18n';
import { OwnerMarkdown } from '../owner/OwnerMarkdown';
import { ownerStatusLabel } from '../owner/ownerPresentation';
import {BossNodeProgress} from './BossNodeProgress';

export function BossCompany({ onAction }: { onAction: (action: 'budget' | 'payment' | 'review' | 'model') => void }) {
  useLanguage();
  const [data, setData] = useState<OwnerOverview>(), [detail, setDetail] = useState<OwnerGoalDetail>(), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setData(await apiRequest<OwnerOverview>('boss/company', { worldScoped: false })); setError(''); } catch (e) { setError(ownerError(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function inspect(id: string) {
    setDetail(undefined);
    try { setDetail(await ownerGoalRequest<OwnerGoalDetail>(`goals/${encodeURIComponent(id)}`)); setError(''); } catch (e) { setError(ownerError(e)); }
  }
  return <>
    <h2>{t('Inspect Company')}</h2>
    <nav className="boss-entries" aria-label={t('Company entrances')}>
      <a href="/" target="_blank" rel="noopener noreferrer">{t('Storefront')}</a>
      <a href="/#orders" target="_blank" rel="noopener noreferrer">{t('Order lookup')}</a>
      <a href="/#support" target="_blank" rel="noopener noreferrer">{t('Support')}</a>
    </nav>
    <div className="boss-actions">
      <button onClick={() => onAction('budget')}>{t('Authorize company budget')}</button>
      <button onClick={() => onAction('payment')}>{t('Configure payments')}</button>
      <button onClick={() => onAction('review')}>{t('Review unresolved calls')}</button>
      <button onClick={() => onAction('model')}>{t('Configure a model')}</button>
    </div>
    {!!error && <p role="alert">{error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    {!data && !error && <p>{t('Waiting for verified data')}</p>}
    {data && <>
      <h3>{t('Company goals')}</h3>
      {!data.goals?.length && <p>{t('No company goals yet.')}</p>}
      {data.goals?.map(goal => <p key={goal.id}><button onClick={() => void inspect(goal.id)}>{goal.title}</button> · {ownerStatusLabel(goal.status, 'Goal status: ')}</p>)}
      {detail && <article><h3>{detail.goal.title}</h3><OwnerMarkdown content={detail.goal.objective} />
        <p>{t('Acceptance rule')}: {detail.goal.acceptance.kind === 'manual' ? detail.goal.acceptance.description : detail.goal.acceptance.kind === 'artifact' ? detail.goal.acceptance.filename : `${detail.goal.acceptance.targetCount} ${t('Confirmed paid orders')}`}</p>
        <h4>{t('Stage progress and continuation')}</h4>
        {data.taskPlans?.find(p=>p.goalId===detail.goal.id)?.nodes.map(n=><BossNodeProgress key={`${detail.goal.id}:${n.key}`} goalId={detail.goal.id} nodeKey={n.key} onDone={()=>{void refresh();void inspect(detail.goal.id);}}/>)}
        <h4>{t('View task deliverables')}</h4>
        {!detail.evidence.length && <p>{t('No verified deliverables yet.')}</p>}
        {detail.evidence.filter(e => e.kind === 'artifact').map(e => <p key={e.id}><a href={`/api/owner/goals/${encodeURIComponent(detail.goal.id)}/evidence/${encodeURIComponent(e.id)}`} target="_blank" rel="noopener noreferrer">{e.reference.split('/').at(-1)}</a> · {e.bytes} B</p>)}
      </article>}
      <h3>{t('Company workers')}</h3>
      {!data.people.length && <p>{t('No company workers yet.')}</p>}
      {data.people.map(person => <p key={person.id}>{person.name} · {person.role} · {ownerStatusLabel(person.running ? 'RUNNING' : 'IDLE', 'Company observed: ')}</p>)}
      <h3>{t('Company tasks')}</h3>
      {!data.work?.tasks.length && <p>{t('No company tasks yet.')}</p>}
      {data.work?.tasks.map(task => <details key={task.id}><summary>{task.personName} · {ownerStatusLabel(task.state, 'Task state: ')}</summary>{task.attempt&&<p>{t('Execution result')}: {t('Attempt state: '+task.attempt.state)} · {t('Cost accounting')}: {t('Accounting state: '+task.attempt.accountingState)}</p>}<OwnerMarkdown content={task.instruction} />{task.reply && <OwnerMarkdown content={task.reply} />}{task.reason && <p>{t(task.reason)}</p>}</details>)}
      <h3>{t('Company products')}</h3>
      {!data.storefront?.products.length && <p>{t('No company products yet.')}</p>}
      {data.storefront?.products.map((product, index) => <p key={product.id}>{(language() === 'en' ? product.nameEn : product.nameZh) || t('Product {0}', [String(index + 1).padStart(2, '0')])} · {product.price ?? '—'} {product.currency} · {t(product.enabled ? 'Published' : 'Unpublished')}</p>)}
      <h3>{t('Company orders')}</h3>
      {!data.storefront?.orders.length && <p>{t('No company orders yet.')}</p>}
      {data.storefront?.orders.map(order => <p key={order.id}>{order.id} · {order.amount} {order.currency} · {ownerStatusLabel(order.status)}</p>)}
    </>}
  </>;
}
