import { useRef, useState } from 'react';
import type { BossMessage } from './bossAttention';
import { executeOwnerAction, ownerError, ownerGoalRequest } from '../../api/owner';
import { ApiError } from '../../api/client';
import { t } from '../../i18n';
import { VerifiedSettlement } from './BossRecovery';
import { CompanyProposalCard } from '../owner/CompanyProposalCard';

/**
 * Every attention card offers exactly three decisions: approve (execute the suggestion),
 * reject (the company finds another way), or rework with instructions (an input opens).
 * Free-form input is never required before the first two.
 */
export function BossAttentionCard({ message, revision, onDone, onAction }: { message: BossMessage; revision: number; onDone: () => void; onAction: (action: 'budget' | 'payment' | 'review' | 'model') => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState(''), [rework, setRework] = useState(false);
  const flight = useRef(false);
  const task = message.alert?.taskId, goal = message.alert?.goalId ?? message.proposals?.[0]?.goalId ?? message.inbox?.id.replace(/^recruit:/, '');
  const isRecovery = ['CALL_OUTCOME_UNKNOWN', 'TOOL_OUTCOME_UNKNOWN', 'OWNER_OUTCOME_REVIEW_REQUIRED'].includes(message.reason ?? '');
  const kind = message.alert?.attemptId && isRecovery ? 'attempt' : message.reason === 'OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION' ? 'safety' : undefined;
  const showTaskActions = Boolean(task && goal && !isRecovery && message.alert);
  const approveLabel = t('Continue this task'), rejectLabel = t('Stop this task');
  async function taskAction(action: 'RETRY_TASK' | 'STOP_TASK', reworkNote?: string) {
    if (flight.current || !task || !goal) return; flight.current = true; setBusy(true); setError('');
    try {
      await ownerGoalRequest(`tasks/${encodeURIComponent(task)}/actions`, 'POST', {
        action, expectedRevision: revision, idempotencyKey: crypto.randomUUID(),
        reason: reworkNote ?? (action === 'RETRY_TASK' ? 'The owner approved continuing this work from its event card.' : 'The owner rejected this work; the company should find another way.'),
      });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && (e.status >= 500 || e.status === 408)) setError(t('The recovery decision is not confirmed. Retry its original fields and key.'));
      else setError(ownerError(e));
    } finally { flight.current = false; setBusy(false); }
  }
  return <article className={'boss-message boss-message--' + message.priority}>
    <small>{t(message.priority === 'critical' ? 'Needs attention' : 'Needs your decision')}</small>
    <h3>{t(message.title)}</h3>
    {message.reason && <p>{t(message.reason)}</p>}
    {message.proposals?.map(proposal => <details key={proposal.id}><summary>{t('Review and decide')}</summary><CompanyProposalCard proposal={proposal} onDone={onDone} /></details>)}
    {message.inbox && <InboxActions message={message} onDone={onDone} />}
    {showTaskActions && <div className="boss-actions">
      <button disabled={busy} onClick={() => void taskAction('RETRY_TASK')}>{t(busy ? 'Submitting…' : approveLabel)}</button>
      <button disabled={busy} onClick={() => void taskAction('STOP_TASK')}>{t(busy ? 'Submitting…' : rejectLabel)}</button>
      <button disabled={busy} onClick={() => setRework(v => !v)}>{t('Rework with instructions')}</button>
      {rework && <label>{t('Rework instructions')}<textarea required minLength={8} maxLength={1000} value={note} disabled={busy} autoFocus onChange={e => setNote(e.target.value)} placeholder={t('Describe what the company should redo or adjust')} /></label>}
      {rework && <button disabled={busy || note.trim().length < 8} onClick={() => void taskAction('RETRY_TASK', note.trim())}>{t(busy ? 'Submitting…' : 'Submit rework instructions')}</button>}
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
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [rework, setRework] = useState(false), [note, setNote] = useState('');
  const flight = useRef(false);
  const item = message.inbox!;
  async function decide(approve: boolean | 'rework') {
    const proposal = item.actions?.find(a => a.action.type === (approve === true ? 'recruit_approve' : 'recruit_reject'));
    if (!proposal || flight.current) return;
    if (approve === 'rework') { setRework(true); return; }
    flight.current = true; setBusy(true); setError('');
    try { await executeOwnerAction(proposal); onDone(); } catch (e) { setError(ownerError(e)); } finally { flight.current = false; setBusy(false); }
  }
  return <><p>{item.summary}</p><details><summary>{t('Why this needs you')}</summary><p>{t(item.approveEffect ?? '')}</p><p>{t(item.rejectEffect ?? '')}</p><code>{item.id}</code></details>
    <div className="boss-actions">
      <button disabled={busy} onClick={() => void decide(true)}>{t(busy ? 'Submitting…' : 'Approve')}</button>
      <button disabled={busy} onClick={() => void decide(false)}>{t('Reject')}</button>
      <button disabled={busy} onClick={() => setRework(v => !v)}>{t('Rework with instructions')}</button>
      {rework && <label>{t('Rework instructions')}<textarea required minLength={8} maxLength={1000} value={note} disabled={busy} autoFocus onChange={e => setNote(e.target.value)} placeholder={t('Describe what the company should redo or adjust')} /></label>}
      {rework && <button disabled={busy || note.trim().length < 8} onClick={() => { setRework(false); void decide(false); }}>{t(busy ? 'Submitting…' : 'Submit rework instructions')}</button>}
    </div>
    {!!error && <p role="alert">{error}</p>}</>;
}
