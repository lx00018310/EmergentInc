import { useCallback, useEffect, useRef, useState } from 'react';
import { ownerError, ownerGoalRequest } from '../../api/owner';
import {ApiError} from '../../api/client';
import { t, useLanguage } from '../../i18n';

interface Review { id: string; worldId?: string; kind?: 'model' | 'tool' | 'run' | 'message' | 'attempt' | 'safety'; tokens?: number; hash?:string;reason?:string;canAcknowledge?:boolean }
interface Call { id: string; world_id: string | null; source_id: string | null; source_kind: string | null; actual_tokens: number | null;reviewed?:number|boolean }
interface RecoveryWorld { worldId: string; status: { running: boolean; unfinalized_operations: null | { unknownCalls: { callId: string }[]; unsettledReservations: { callId: string }[]; startedToolExecutions: string[]; pendingRuns: string[]; callingMessages: { messageId: string }[] } } }
interface ExecutionRecovery {attempts:{id:string;hash:string;reason:string}[];holds:{id:string;hash:string;reason:string;canAcknowledge:boolean}[]}
export function VerifiedSettlement({ review, revision, onDone }: { review: Review; revision: number; onDone: () => void }) {
  const [tokens, setTokens] = useState<number | ''>(review.tokens ?? ''), [cost, setCost] = useState<number | ''>(''), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<{path:string;body:Record<string,unknown>}>(), flight = useRef(false);
  const [awaiting,setAwaiting]=useState(false);
  const model = !review.kind || review.kind === 'model';
  async function confirm(abandonLegacy=false) {
    if (flight.current || !pending.current&&(reason.trim().length < 8 || model && !abandonLegacy && (typeof tokens !== 'number' || typeof cost !== 'number'))) return; flight.current = true; setBusy(true); setError('');
    if(!pending.current){const idempotencyKey=crypto.randomUUID();
      if(review.kind==='attempt')pending.current={path:`execution-recovery/${encodeURIComponent(review.id)}/abandon`,body:{hash:review.hash,reason,idempotencyKey}};
      else if(review.kind==='safety')pending.current={path:`safety-holds/${encodeURIComponent(review.id)}/acknowledge`,body:{hash:review.hash,reason,idempotencyKey}};
      else if(review.worldId)pending.current={path:`recovery/${encodeURIComponent(review.worldId)}`,body:{kind:review.kind,id:review.id,decision:abandonLegacy?'abandon':model?'settle_billed':review.kind==='message'?'abandon':'acknowledge',reason,idempotencyKey,...(model&&!abandonLegacy?{actualTokens:tokens,costCny:cost}:{})}};
      else pending.current={path:`automation/calls/${encodeURIComponent(review.id)}/reconcile`,body:{actualTokens:tokens,costCny:cost,reason,expectedRevision:revision,idempotencyKey}};
    }setAwaiting(true);
    try {
      await ownerGoalRequest(pending.current.path,'POST',pending.current.body);pending.current=undefined;setAwaiting(false);onDone();
    } catch (e) { if(e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==408){pending.current=undefined;setAwaiting(false);}setError(ownerError(e)); } finally { flight.current = false; setBusy(false); }
  }
  return <form className="boss-budget" onSubmit={e => { e.preventDefault(); void confirm(); }}><code>{review.id}</code>
    <p>{t(review.kind==='attempt'?'Stop this uncertain execution without replaying it. Its unresolved charges remain reserved; this does not start a replacement task.':review.kind==='safety'?'Acknowledge this exact verified provider receipt. The company run switch stays unchanged.':'This records verified usage; it does not prove delivery or retry an external operation.')}</p>
    {review.reason&&<p>{t(review.reason)}</p>}
    {model && <><label>{t('Verified tokens')}<input type="number" required min="0" step="1" value={tokens} disabled={busy||awaiting} onChange={e => setTokens(e.target.value === '' ? '' : Number(e.target.value))} /></label><label>{t('Verified cost (CNY)')}<input type="number" required min="0" step="0.000001" value={cost} disabled={busy||awaiting} onChange={e => setCost(e.target.value === '' ? '' : Number(e.target.value))} /></label></>}
    <label>{t('Receipt and verification reason')}<textarea required minLength={8} maxLength={1000} value={reason} disabled={busy||awaiting} onChange={e => setReason(e.target.value)} /></label>
    <button disabled={busy || awaiting || review.kind==='safety'&&!review.canAcknowledge || reason.trim().length < 8 || model && (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0 || typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0)}>{t(busy ? 'Submitting…' : model ? 'Record verified settlement' : review.kind==='safety'?'Acknowledge verified safety receipt':'Acknowledge and stop uncertain work')}</button>
    {model&&review.worldId&&<><p>{t('Stop this uncertain execution without replaying it. Its unresolved charges remain reserved; this does not start a replacement task.')}</p><button type="button" disabled={busy||awaiting||reason.trim().length<8} onClick={()=>void confirm(true)}>{t('Acknowledge and stop uncertain work')}</button></>}
    {awaiting&&!busy&&<><p role="status">{t('The recovery decision is not confirmed. Retry its original fields and key.')}</p><button type="button" onClick={()=>void confirm()}>{t('Retry pending recovery')}</button></>}
    {review.kind==='safety'&&!review.canAcknowledge&&<p>{t('A verified receipt is required before this safety hold can be acknowledged.')}</p>}
    {!!error && <p role="alert">{error}</p>}
  </form>;
}
export function BossRecovery({ revision, onDone }: { revision: number; onDone: () => void }) {
  useLanguage(); const [reviews, setReviews] = useState<Review[]>(), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [calls, worlds,execution] = await Promise.allSettled([ownerGoalRequest<{ items: Call[] }>('automation/calls'), ownerGoalRequest<{ items: RecoveryWorld[] }>('recovery'),ownerGoalRequest<ExecutionRecovery>('execution-recovery')]);
      const items: Review[] = [];
      if(calls.status==='fulfilled')for(const call of calls.value.items)items.push(call.world_id && call.source_kind === 'world' && call.source_id&&!call.reviewed ? { id: call.source_id, worldId: call.world_id, kind: 'model', tokens: call.actual_tokens ?? undefined } : { id: call.id, tokens: call.actual_tokens ?? undefined });
      if(worlds.status==='fulfilled')for (const world of worlds.value.items) {
        if (world.status.running) continue;
        const pending = world.status.unfinalized_operations; if (!pending) continue;
        for (const id of new Set([...pending.unknownCalls.map(c => c.callId), ...pending.unsettledReservations.map(c => c.callId)])) items.push({ id, worldId: world.worldId, kind: 'model' });
        for (const id of pending.startedToolExecutions) items.push({ id, worldId: world.worldId, kind: 'tool' });
        for (const id of pending.pendingRuns) items.push({ id, worldId: world.worldId, kind: 'run' });
        for (const { messageId } of pending.callingMessages) items.push({ id: messageId, worldId: world.worldId, kind: 'message' });
      }
      if(execution.status==='fulfilled'){
        for(const attempt of execution.value.attempts)items.push({...attempt,kind:'attempt'});
        for(const hold of execution.value.holds)items.push({...hold,kind:'safety'});
      }
      const seen = new Set<string>(); setReviews(items.filter(item => { const key = `${item.worldId}:${item.kind}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true; })); setError([calls,worlds,execution].filter(r=>r.status==='rejected').map(r=>ownerError((r as PromiseRejectedResult).reason)).join('; '));
    } catch (e) { setReviews(undefined);setError(ownerError(e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return <><p>{t('Unknown outcomes retain their reservations. Verify the provider receipt before reconciliation.')}</p>
    {!!error && <p role="alert">{t('Some recovery records are unavailable. Loaded records can still be reviewed.')} {error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    {!error && reviews?.length === 0 && <p>{t('No unresolved calls remain.')}</p>}
    {reviews?.map(review => <details key={`${review.worldId}:${review.kind}:${review.id}`}><summary>{t(review.kind==='attempt'?'Review uncertain execution':review.kind==='safety'?'Review safety hold':'Confirm verified usage')} · {review.id}</summary><VerifiedSettlement review={review} revision={revision} onDone={() => { onDone(); void refresh(); }} /></details>)}</>;
}
