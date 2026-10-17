import { useEffect, useRef, useState } from 'react';
import { askMissionOwner, ownerError } from '../../api/owner';
import type { OwnerChatTurn } from '../../api/ownerChat';
import { language, t, useLanguage, type Language } from '../../i18n';
import { ApiError } from '../../api/client';
import { OwnerMarkdown } from '../owner/OwnerMarkdown';
import { clearLegacyBossStorage } from './bossStorage';
export { clearLegacyBossStorage } from './bossStorage';

interface Pending { question: string; history: OwnerChatTurn[]; key: string; language: Language }
export function BossChat({ instanceId, onDone, canDiscardPending = false }: { instanceId: string; onDone: () => void; canDiscardPending?: boolean }) {
  useLanguage();
  const prefix = `boss.v34.chat.${instanceId}.`;
  const read = (key: string) => { try { return localStorage.getItem(prefix + key); } catch { return null; } };
  const save = (key: string, value: unknown) => { try { value === undefined ? localStorage.removeItem(prefix + key) : localStorage.setItem(prefix + key, typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* Current-page retries remain idempotent. */ } };
  const pending = useRef<Pending>();
  const [history, setHistory] = useState<OwnerChatTurn[]>(() => { clearLegacyBossStorage(); try { const rows = JSON.parse(read('history') || '[]'); return Array.isArray(rows) && rows.every(r => ['user', 'assistant'].includes(r?.role) && typeof r.content === 'string') ? rows.slice(-12) : []; } catch { return []; } });
  const [draft, setDraft] = useState(() => {
    try { const row = JSON.parse(read('pending') || 'null'); if (row && typeof row.question === 'string' && row.question.length <= 2000 && /^[a-zA-Z0-9_-]{1,128}$/.test(row.key) && ['en', 'zh-CN'].includes(row.language) && Array.isArray(row.history) && row.history.length <= 12 && row.history.every((turn: OwnerChatTurn) => ['user', 'assistant'].includes(turn.role) && typeof turn.content === 'string' && turn.content.length <= 4000)) pending.current = row; } catch { /* Invalid local data grants no authority. */ }
    return pending.current?.question ?? read('draft') ?? '';
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''); const flight = useRef(false);
  useEffect(() => save('draft', draft), [draft]);
  async function send() {
    const question = draft.trim(); if (!question || flight.current) return;
    if (pending.current && pending.current.question !== question) { setError(t('Resolve the pending request before sending a different command.')); return; }
    flight.current = true; setBusy(true); setError('');
    pending.current ??= { question, history: history.slice(-12).map(turn => ({ ...turn, content: turn.content.slice(0, 4000) })), key: crypto.randomUUID(), language: language() };
    save('pending', pending.current);
    try {
      const response = await askMissionOwner(question, pending.current.history, pending.current.key, pending.current.language);
      const next: OwnerChatTurn[] = [...pending.current.history, { role: 'user' as const, content: question }, { role: 'assistant' as const, content: response.answer }].slice(-12);
      setHistory(next); save('history', next); pending.current = undefined; save('pending', undefined); setDraft(''); onDone();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 400 || ['OWNER_DISPATCH_INVALID', 'OWNER_DISPATCH_EMPTY', 'OWNER_DISPATCH_OUTPUT_LIMIT', 'OWNER_GOAL_AUTH_REQUIRED', 'OWNER_COMPANY_BUDGET_REQUIRED', 'OWNER_COMPANY_BUDGET_EXHAUSTED', 'MODEL_NOT_CONFIGURED'].includes(e.detail))) { pending.current = undefined; save('pending', undefined); }
      setError(ownerError(e)); onDone();
    } finally { flight.current = false; setBusy(false); }
  }
  return <section className="boss-chat" aria-label={t('Talk to your company')}>
    {!!history.length && <div className="boss-latest"><p>{history.at(-2)?.content}</p><details><summary>{t('Latest company reply')}</summary><OwnerMarkdown content={history.at(-1)?.content ?? ''} /></details>
      {history.length > 2 && <details><summary>{t('Conversation history')}</summary>{history.slice(0, -2).map((turn, index) => <div key={index}><strong>{t(turn.role === 'user' ? 'Boss' : 'Company')}</strong><OwnerMarkdown content={turn.content} /></div>)}</details>}</div>}
    <form onSubmit={e => { e.preventDefault(); void send(); }}>
      <textarea aria-label={t('Tell your company what to achieve…')} placeholder={t('Tell your company what to achieve…')} rows={2} maxLength={2000} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void send(); } }} />
      <button type="submit" disabled={busy || !draft.trim()} aria-label={t(busy ? 'Submitting…' : 'Send')}>{busy ? '…' : '↑'}</button>
    </form>
    {!!error && <p role="alert">{error}</p>}
    {!!pending.current && canDiscardPending && !busy && <button onClick={() => { pending.current=undefined;save('pending',undefined);setError(''); }}>{t('Discard local retry; this does not cancel server work')}</button>}
  </section>;
}
