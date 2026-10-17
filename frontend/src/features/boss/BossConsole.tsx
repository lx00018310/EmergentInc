import { useCallback, useEffect, useRef, useState } from 'react';
import type { BossOverview, OwnerAutomation } from '../../../../packages/protocol/src/types/owner';
import { apiRequest } from '../../api/client';
import { executeOwnerAction, ownerError, ownerGoalRequest } from '../../api/owner';
import { LanguageSwitch, t, useLanguage } from '../../i18n';
import { CompanyProposalCard } from '../owner/CompanyProposalCard';
import { ownerTime } from '../owner/ownerPresentation';
import { BossChat, clearLegacyBossStorage } from './BossChat';
import { BossBudget } from './BossBudget';
import { BossPayment } from './BossPayment';
import { BossRecovery } from './BossRecovery';
import { BossCompany } from './BossCompany';
import { projectBossAttention, sumUsdt, type BossAttentionSnapshot, type BossMessage, type BossMetric } from './bossAttention';
import './boss.css';

function AttentionMessage({ message, onDone, onAction }: { message: BossMessage; onDone: () => void; onAction: (action: 'budget' | 'payment' | 'review' | 'model') => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const flight = useRef(false);
  const item = message.inbox;
  async function decide(approve: boolean) {
    const proposal = item?.actions?.find(a => a.action.type === (approve ? 'recruit_approve' : 'recruit_reject'));
    if (!proposal || flight.current) return; flight.current = true; setBusy(true); setError('');
    try { await executeOwnerAction(proposal); onDone(); } catch (e) { setError(ownerError(e)); } finally { flight.current = false; setBusy(false); }
  }
  return <article className={'boss-message boss-message--' + message.priority}>
    <small>{t(message.priority === 'critical' ? 'Needs attention' : message.priority === 'decision' ? 'Needs your decision' : 'Just completed')}</small>
    <h3>{t(message.title)}</h3>
    {message.reason && <p>{t(message.reason)}</p>}
    {message.proposals?.map(proposal => <details key={proposal.id}><summary>{t('Review and decide')}</summary><CompanyProposalCard proposal={proposal} onDone={onDone} /></details>)}
    {item && <><p>{item.summary}</p><details><summary>{t('Why this needs you')}</summary><p>{t(item.approveEffect ?? '')}</p><p>{t(item.rejectEffect ?? '')}</p><code>{item.id}</code></details>
      <div className="boss-actions"><button disabled={busy} onClick={() => void decide(true)}>{t(busy ? 'Submitting…' : 'Approve')}</button><button disabled={busy} onClick={() => void decide(false)}>{t('Reject')}</button></div></>}
    {message.action && <button onClick={() => onAction(message.action!)}>{t(message.action === 'budget' ? 'Authorize company budget' : message.action === 'payment' ? 'Configure payments' : 'Configure a model')}</button>}
    {message.alert && <details><summary>{t('View details')}</summary><p>{message.alert.summary}</p><p>{t(message.alert.reasonKey ?? '')}</p><code>{message.alert.id}</code>
      {message.priority === 'critical' && <button onClick={() => onAction('review')}>{t('Review unresolved calls')}</button>}</details>}
    {message.reference && <details><summary>{t('Evidence reference')}</summary><code>{message.reference}</code></details>}
    {!!error && <p role="alert">{error}</p>}
  </article>;
}

export function BossConsole() {
  useLanguage();
  const [data, setData] = useState<BossOverview>(), [error, setError] = useState(''), [controlling, setControlling] = useState(false), [controlError, setControlError] = useState('');
  const [attention, setAttention] = useState<BossAttentionSnapshot>(), [modal, setModal] = useState<'budget' | 'payment' | 'review' | 'overflow' | 'model' | 'company' | BossMetric>();
  const controlFlight = useRef(false), pollFlight = useRef(false), mounted = useRef(true), controller = useRef<AbortController>();
  const refresh = useCallback(async (force = false) => {
    if (pollFlight.current && !force) return; pollFlight.current = true;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    try {
      const next = await apiRequest<BossOverview>('boss/overview', { worldScoped: false, signal: current.signal, timeoutMs: 15000 });
      if (!next || typeof next.instanceId !== 'string' || !Number.isFinite(next.asOf) || !Array.isArray(next.inbox) || !Array.isArray(next.revenue) || !Array.isArray(next.events)) throw new Error('Company data is invalid.');
      if (!mounted.current || current.signal.aborted) return;
      setData(next); setAttention(previous => projectBossAttention(next, previous)); setError('');
    } catch (e) { if (mounted.current && !current.signal.aborted) setError(ownerError(e)); }
    finally { if (controller.current === current) pollFlight.current = false; }
  }, []);
  useEffect(() => {
    mounted.current = true; clearLegacyBossStorage(); void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    const visible = () => { if (!document.hidden) void refresh(); }; document.addEventListener('visibilitychange', visible);
    return () => { mounted.current = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); controller.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null, dialog = document.querySelector<HTMLElement>('.boss-dialog');
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setModal(undefined); }
      if (event.key !== 'Tab' || !dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary')].filter(node => node.getClientRects().length);
      if (!controls.length) { event.preventDefault(); dialog.focus(); return; }
      const first=controls[0]!,last=controls.at(-1)!;
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); document.body.style.overflow=oldOverflow; previous?.focus(); };
  }, [modal]);
  const automation = data?.automation;
  const state = error || !automation ? 'Company state unknown' : ['BLOCKED', 'ERROR', 'LIMIT_REACHED'].includes(automation.observedState) || automation.desiredMode === 'ON' && !data?.modelConfigured ? 'Needs attention' : automation.desiredMode === 'OFF' ? 'Company paused' : ['STARTING', 'STOPPING'].includes(automation.observedState) ? 'Company transitioning' : 'Company running';
  async function toggle() {
    if (!automation || controlFlight.current || error) return; controlFlight.current = true; setControlling(true); setControlError('');
    try { await ownerGoalRequest<OwnerAutomation>('automation', 'POST', { desiredMode: automation.desiredMode === 'ON' ? 'OFF' : 'ON', expectedRevision: automation.revision, idempotencyKey: crypto.randomUUID() }); await refresh(true); }
    catch (e) { setControlError(ownerError(e)); await refresh(true); } finally { controlFlight.current = false; setControlling(false); }
  }
  return <main className="boss-shell">
    <header className="boss-header"><div><h1>BOSS:/AFK</h1><p>{t('甩手掌柜 · 老板不在，生意还在')}</p></div>
      <div className="boss-header-actions"><div><span role="status">{t(state)}</span><button disabled={!automation || !!error || controlling || automation.observedState === 'STOPPING'} onClick={() => void toggle()}>{t(controlling ? 'Submitting…' : automation?.desiredMode === 'ON' ? 'Pause company' : 'Start company')}</button>
        <button disabled={!data || !!error} onClick={() => setModal('company')}>{t('Inspect Company')}</button></div><LanguageSwitch /></div></header>
    {!!controlError && <p role="alert">{controlError}</p>}
    {!!error && <p className="boss-error" role="alert">{t('Company data unavailable. Previous values may be stale.')} {error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    <section aria-label={t('The three numbers that matter now')}><h2>{t('The three numbers that matter now')}</h2>
      <div className="boss-metrics">{attention ? attention.metrics.map(metric => <button className="boss-metric" key={metric.id} onClick={() => setModal(metric)}>
        <span>{t('Boss metric: ' + metric.id)}</span><strong>{t(metric.value)}{metric.unit && metric.value !== 'Unauthorized' && <small> {metric.unit}</small>}</strong><small>{t(metric.reason)}</small></button>) :
        ['products', 'budget', 'goals'].map(id => <div className="boss-metric" key={id}><span>{t('Boss metric: ' + id)}</span><strong>—</strong><small>{t('Waiting for verified data')}</small></div>)}</div>
      {attention?.view === 'critical' && <p className="boss-muted">{t('Critical incident view')} · {t('Verified revenue')}: {data ? sumUsdt(data.revenue) : '—'} USDT</p>}
    </section>
    <section className="boss-attention" aria-label={t('What needs your attention')}><h2>{t('What needs your attention')}</h2>
      {attention?.messages.map(message => <AttentionMessage key={message.entityId} message={message} onDone={() => void refresh(true)} onAction={setModal} />)}
      {attention && !attention.messages.length && <p className="boss-quiet">{t(data?.automation?.desiredMode === 'ON' ? 'Nothing needs your attention. The company is following its goals.' : 'Nothing needs your attention. The company is paused.')}</p>}
      {!!attention?.overflowCount && <button className="boss-overflow" onClick={() => setModal('overflow')}>{t('{0} more items need attention', [attention.overflowCount])}</button>}
    </section>
    {data && <BossChat key={data.instanceId} instanceId={data.instanceId} canDiscardPending={automation?.desiredMode === 'OFF' && automation.inFlight === 0 && data.budget?.unknownCalls === 0 && automation.reason !== 'OWNER_OUTCOME_REVIEW_REQUIRED'} onDone={() => void refresh(true)} />}
    <footer className="boss-muted">{t('Last refreshed')}: {data ? ownerTime(data.asOf) : '—'} · {t('Powered by EmergentInc')}</footer>
    {modal && <div className="boss-backdrop"><section role="dialog" aria-modal="true" aria-label={t('Details')} tabIndex={-1} className="boss-dialog"><button className="boss-dialog-close" onClick={() => setModal(undefined)}>{t('Close')}</button>
      {modal === 'company' && <BossCompany onAction={setModal} />}
      {modal === 'budget' && data?.budget && <><h2>{t('Company money budget')}</h2><BossBudget budget={data.budget} instanceId={data.instanceId} onDone={() => { setModal(undefined); void refresh(true); }} /></>}
      {modal === 'payment' && <><h2>{t('Configure receive-only payments')}</h2><BossPayment onDone={() => { setModal(undefined); void refresh(true); }} /></>}
      {modal === 'model' && <><h2>{t('Configure a model')}</h2><p>{t('Configure provider credentials, the model and its CNY pricing in deployment settings, then restart the approved service. Never paste credentials into chat.')}</p><p>{t('No provider call is sent while the company is paused.')}</p></>}
      {modal === 'review' && automation && <><h2>{t('Review unresolved calls')}</h2><BossRecovery revision={automation.revision} onDone={() => void refresh(true)} /></>}
      {modal === 'overflow' && attention?.overflow.map(message => <AttentionMessage key={message.id} message={message} onDone={() => void refresh(true)} onAction={setModal} />)}
      {typeof modal === 'object' && <><h2>{t('Boss metric: ' + modal.id)}</h2><p>{modal.value} {modal.unit}</p><p>{t(modal.reason)}</p>{modal.references.map(reference => <p key={reference}><code>{reference}</code></p>)}{modal.id === 'budget' && <button onClick={() => setModal('budget')}>{t('Authorize company budget')}</button>}</>}
    </section></div>}
  </main>;
}
