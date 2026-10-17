import { useRef, useState } from 'react';
import type { BossMessage } from './bossAttention';
import { executeOwnerAction, ownerError, ownerGoalRequest } from '../../api/owner';
import { ApiError } from '../../api/client';
import { t } from '../../i18n';
import { VerifiedSettlement } from './BossRecovery';
import { CompanyProposalCard } from '../owner/CompanyProposalCard';

/** One attention card completes its allowed actions in place; the server verdict is authoritative. */
export function BossAttentionCard({ message, revision, onDone, onAction }: { message: BossMessage; revision: number; onDone: () => void; onAction: (action: 'budget' | 'payment' | 'review' | 'model') => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const flight = useRef(false);
  const task = message.alert?.taskId, goal = message.alert?.goalId ?? message.proposals?.[0]?.goalId ?? message.inbox?.id.replace(/^recruit:/, '');
  async function taskAction(action: 'STOP_TASK' | 'RETRY_TASK') {
    if (flight.current || !task || !goal) return; flight.current = true; setBusy(true); setError('');
    try {
      await ownerGoalRequest(`tasks/${encodeURIComponent(task)}/actions`, 'POST', {
        action, expectedRevision: revision, idempotencyKey: crypto.randomUUID(), reason: note.trim().length >= 8 ? note.trim() : (action === 'STOP_TASK' ? 'The owner stopped this work from its event card.' : 'The owner retried this work from its event card.'),
      });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && (e.status >= 500 || e.status === 408)) setError(t('The recovery decision is not confirmed. Retry its original fields and key.'));
      else setError(ownerError(e));
    } finally { flight.current = false; setBusy(false); }
  }
  const isRecovery = ['CALL_OUTCOME_UNKNOWN', 'TOOL_OUTCOME_UNKNOWN', 'OWNER_OUTCOME_REVIEW_REQUIRED'].includes(message.reason ?? '');
  const kind = message.alert?.attemptId && isRecovery ? 'attempt' : message.reason === 'OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION' ? 'safety' : undefined;
  const showTaskActions = Boolean(task && goal && !isRecovery && message.alert);
  return <article className={'boss-message boss-message--' + message.priority}>
    <small>{t(message.priority === 'critical' ? 'Needs attention' : 'Needs your decision')}</small>
    <h3>{t(message.title)}</h3>
    {message.reason && <p>{t(message.reason)}</p>}
    {message.proposals?.map(proposal => <details key={proposal.id}><summary>{t('Review and decide')}</summary><CompanyProposalCard proposal={proposal} onDone={onDone} /></details>)}
    {message.inbox && <InboxActions message={message} onDone={onDone} />}
    {showTaskActions && <div className="boss-actions">
      <label>{t('Receipt and verification reason')}<input value={note} maxLength={1000} disabled={busy} onChange={e => setNote(e.target.value)} placeholder={t('At least 8 characters describing this decision')} /></label>
      <button disabled={busy || note.trim().length < 8} onClick={() => void taskAction('RETRY_TASK')}>{t(busy ? 'Submitting…' : 'Continue this task')}</button>
      <button disabled={busy || note.trim().length < 8} onClick={() => void taskAction('STOP_TASK')}>{t('Stop this task')}</button>
    </div>}
    {kind === 'attempt' && <VerifiedSettlement review={{ id: message.alert!.attemptId!, kind: 'attempt', reason: message.reason }} revision={revision} onDone={onDone} />}
    {kind === 'safety' && <VerifiedSettlement review={{ id: message.alert!.id.replace(/^goal:/, '') || message.alert!.id, kind: 'safety', reason: message.reason }} revision={revision} onDone={onDone} />}
    {message.alert && !kind && message.priority === 'critical' && <button onClick={() => onAction('review')}>{t('Review unresolved calls')}</button>}
    {message.action && <button onClick={() => onAction(message.action!)}>{t(message.action === 'budget' ? 'Authorize company budget' : message.action === 'payment' ? 'Configure payments' : 'Configure a model')}</button>}
    {message.alert && <details><summary>{t('View details')}</summary><p>{message.alert.summary}</p><code>{message.alert.id}</code></details>}
    {!!error && <p role="alert">{error}</p>}
  </article>;
}
function InboxActions({ message, onDone }: { message: BossMessage; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const flight = useRef(false);
  const item = message.inbox!;
  async function decide(approve: boolean) {
    const proposal = item.actions?.find(a => a.action.type === (approve ? 'recruit_approve' : 'recruit_reject'));
    if (!proposal || flight.current) return; flight.current = true; setBusy(true); setError('');
    try { await executeOwnerAction(proposal); onDone(); } catch (e) { setError(ownerError(e)); } finally { flight.current = false; setBusy(false); }
  }
  return <><p>{item.summary}</p><details><summary>{t('Why this needs you')}</summary><p>{t(item.approveEffect ?? '')}</p><p>{t(item.rejectEffect ?? '')}</p><code>{item.id}</code></details>
    <div className="boss-actions"><button disabled={busy} onClick={() => void decide(true)}>{t(busy ? 'Submitting…' : 'Approve')}</button><button disabled={busy} onClick={() => void decide(false)}>{t('Reject')}</button></div>
    {!!error && <p role="alert">{error}</p>}</>;
}
