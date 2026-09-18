import { useState } from 'react';
import type { RunStatusDto } from '../../api/types';
import { resolveRecovery, type RecoveryKind, type RecoveryDecision } from '../../api/run';

export function RecoveryOperations({ status, onRefresh }: { status: RunStatusDto; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [decision, setDecision] = useState<RecoveryDecision>('abandon');
  const [reason, setReason] = useState('');
  const [tokens, setTokens] = useState('');
  const [cost, setCost] = useState('');
  const ops = status.unfinalized_operations;
  const items = new Map<string, { kind: RecoveryKind; id: string }>();
  for (const call of [...(ops?.unsettledReservations ?? []), ...(ops?.unknownCalls ?? [])]) {
    items.set(`model:${call.callId}`, { kind: 'model', id: call.callId });
  }
  for (const id of ops?.startedToolExecutions ?? []) items.set(`tool:${id}`, { kind: 'tool', id });
  for (const id of ops?.pendingRuns ?? []) items.set(`run:${id}`, { kind: 'run', id });

  const resolve = async (kind: RecoveryKind, id: string) => {
    if (!reason.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await resolveRecovery({ kind, id, decision: kind === 'model' ? decision : 'acknowledge', reason,
        ...(decision === 'settle_billed' && kind === 'model' ? { actualTokens: Number(tokens), costCny: Number(cost) } : {}),
      });
      await onRefresh();
      setReason('');
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };
  return <section aria-label="逐项恢复决策">
    <p>未知结果不会自动退款或重试。先核实账单及外部副作用，再逐项提交带原因的审计决定。</p>
    <label htmlFor="recovery-decision">模型处理决定</label> <select id="recovery-decision" value={decision} disabled={busy} onChange={(e) => setDecision(e.target.value as RecoveryDecision)}>
      <option value="abandon">放弃重试（保守结算）</option>
      <option value="confirm_not_billed">确认未计费后退款重试</option>
      <option value="settle_billed">按供应商账单结算</option>
      <option value="settle_reserved">按预留上限结算</option>
    </select>
    {decision === 'settle_billed' && <div>
      <label htmlFor="recovery-tokens">实际 Tokens</label> <input id="recovery-tokens" type="number" min="0" step="1" value={tokens} onChange={(e) => setTokens(e.target.value)} />
      <label htmlFor="recovery-cost">账单 CNY</label> <input id="recovery-cost" type="number" min="0" step="any" value={cost} onChange={(e) => setCost(e.target.value)} />
    </div>}
    <label htmlFor="recovery-reason">核实依据 / 原因</label> <input id="recovery-reason" value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
    {error && <p role="alert">{error}</p>}
    <ul>{[...items.values()].map(({ kind, id }) => <li key={`${kind}:${id}`}>
      {kind}: {id}{' '}
      <button disabled={busy || !reason.trim() || (kind === 'model' && decision === 'settle_billed' && (!tokens || !cost || !Number.isSafeInteger(Number(tokens)) || Number(tokens) < 0 || !Number.isFinite(Number(cost)) || Number(cost) < 0))}
        onClick={() => void resolve(kind, id)}>{kind === 'model' ? '提交此项决定' : '确认此项已核实（不重试）'}</button>
    </li>)}</ul>
    {items.size === 0 && <p>未提供可决策操作 ID；请保留现场并检查未决消息。</p>}
  </section>;
}
