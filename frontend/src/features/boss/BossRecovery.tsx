import { useCallback, useEffect, useRef, useState } from 'react';
import { ownerError, ownerGoalRequest } from '../../api/owner';
import {ApiError} from '../../api/client';
import { t, useLanguage } from '../../i18n';

interface Review { id: string; worldId?: string; kind?: 'model' | 'tool' | 'run' | 'message' | 'attempt' | 'safety'; tokens?: number; hash?:string;reason?:string;canAcknowledge?:boolean;reservedMicros?:number;suggestedTokens?:number;suggestedCost?:number }
interface Call { id: string; world_id: string | null; source_id: string | null; source_kind: string | null; actual_tokens: number | null; reserved_micros?: number; reviewed?:number|boolean }
interface RecoveryWorld { worldId: string; status: { running: boolean; unfinalized_operations: null | { unknownCalls: { callId: string }[]; unsettledReservations: { callId: string }[]; startedToolExecutions: string[]; pendingRuns: string[]; callingMessages: { messageId: string }[] } } }
interface ExecutionRecovery {attempts:{id:string;hash:string;reason:string}[];holds:{id:string;hash:string;reason:string;canAcknowledge:boolean}[]}

/**
 * One recovery decision = a server-suggested resolution plus exactly three owner actions:
 * approve (settle with the suggested verified values), reject (stop the uncertain work),
 * or rework (opens the instruction input). Free-form fields never gate the first two.
 */
export function VerifiedSettlement({ review: initial, revision, onDone }: { review: Review; revision: number; onDone: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [rework, setRework] = useState(false), [note, setNote] = useState('');
  const pending = useRef<{path:string;body:Record<string,unknown>}>(), flight = useRef(false);
  const [review, setReview] = useState(initial);
  const [awaiting,setAwaiting]=useState(false);
  const model = !review.kind || review.kind === 'model';
  const suggestedTokens = review.suggestedTokens ?? review.tokens ?? 0;
  const suggestedCost = review.suggestedCost ?? (review.reservedMicros != null ? review.reservedMicros / 1000000 : 0);
  // Attempt and safety decisions bind to a server fact hash the alert card does not carry;
  // fetch it from the recovery projection before the first submit instead of failing later.
  useEffect(() => {
    if (!initial.kind || (initial.kind !== 'attempt' && initial.kind !== 'safety') || initial.hash) return;
    let alive = true;
    void ownerGoalRequest<{attempts:Review[];holds:Review[]}>('execution-recovery').then(data => {
      if (!alive) return;
      const found = [...(data.attempts ?? []), ...(data.holds ?? [])].find(item => item.id === initial.id);
      if (found?.hash) setReview(current => ({ ...current, hash: found.hash, reservedMicros: found.reservedMicros, suggestedTokens: found.suggestedTokens, suggestedCost: found.suggestedCost }));
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [initial.kind, initial.id, initial.hash]);
  const build = (decision:'approve'|'reject'|'rework', reason:string):{path:string;body:Record<string,unknown>} => {
    const idempotencyKey = pending.current ? String(pending.current.body.idempotencyKey) : crypto.randomUUID();
    if(review.kind==='attempt')return {path:`execution-recovery/${encodeURIComponent(review.id)}/abandon`,body:{hash:review.hash,reason,idempotencyKey}};
    if(review.kind==='safety')return {path:`safety-holds/${encodeURIComponent(review.id)}/acknowledge`,body:{hash:review.hash,reason,idempotencyKey}};
    if(review.worldId)return {path:`recovery/${encodeURIComponent(review.worldId)}`,body:{kind:review.kind,id:review.id,decision:decision==='approve'&&model?'settle_billed':model?'abandon':review.kind==='message'?'abandon':'acknowledge',reason,idempotencyKey,...(decision==='approve'&&model?{actualTokens:suggestedTokens,costCny:suggestedCost}:{})}};
    return {path:`automation/calls/${encodeURIComponent(review.id)}/reconcile`,body:{actualTokens:suggestedTokens,costCny:suggestedCost,reason,expectedRevision:revision,idempotencyKey}};
  };
  async function decide(decision:'approve'|'reject'|'rework') {
    if (flight.current) return;
    if ((review.kind === 'attempt' || review.kind === 'safety') && !review.hash) { setError(t('The recovery decision is not confirmed. Retry its original fields and key.')); return; }
    flight.current = true; setBusy(true); setError('');
    const reason = decision === 'approve' ? t('Approved the suggested verified settlement for this exact record.')
      : decision === 'reject' ? t('Rejected this uncertain result; its charges and records stay reserved for review.')
      : note.trim() || t('The owner sent this uncertain result back for rework without extra instructions.');
    pending.current=build(decision,reason);
    setAwaiting(true);
    try {
      await ownerGoalRequest(pending.current.path,'POST',pending.current.body);
      pending.current=undefined;setAwaiting(false);setRework(false);setNote('');onDone();
    } catch (e) { if(e instanceof ApiError&&e.status>=400&&e.status<500&&e.status!==408){pending.current=undefined;setAwaiting(false);setError(ownerError(e));} else setError(ownerError(e)); } finally { flight.current = false; setBusy(false); }
  }
  return <div className="boss-budget">
    <p>{t(model?'Suggested settlement: use the verified provider receipt values shown below. Approving records them; nothing is replayed.':'This record needs your decision. Approving acknowledges the verified facts; rejecting stops the uncertain work.')}</p>
    {model && <p>{t('Suggested verified usage')}: <strong>{Number.isSafeInteger(suggestedTokens)?suggestedTokens:'—'}</strong> Tokens · <strong>{Number.isFinite(suggestedCost)?suggestedCost:'—'}</strong> {t('CNY')}</p>}
    {review.reason&&<p>{t(review.reason)}</p>}
    <div className="boss-actions">
      <button disabled={busy} onClick={()=>void decide('approve')}>{t(busy?'Submitting…':model?'Approve suggested settlement':'Approve')}</button>
      <button disabled={busy} onClick={()=>void decide('reject')}>{t(busy?'Submitting…':'Reject')}</button>
      <button disabled={busy} onClick={()=>setRework(v=>!v)}>{t('Rework with instructions')}</button>
    </div>
    {rework && <label>{t('Rework instructions')}<textarea maxLength={1000} value={note} disabled={busy} autoFocus onChange={e => setNote(e.target.value)} placeholder={t('Describe what the company should redo or adjust')} /></label>}
    {rework && <button disabled={busy} onClick={()=>void decide('rework')}>{t(busy?'Submitting…':'Submit rework instructions')}</button>}
    {awaiting&&!busy&&<><p role="status">{t('The recovery decision is not confirmed. Retry its original fields and key.')}</p><button type="button" onClick={()=>{if(!pending.current||flight.current)return;flight.current=true;setBusy(true);void ownerGoalRequest(pending.current.path,'POST',pending.current.body).then(()=>{pending.current=undefined;setAwaiting(false);onDone();}).catch(e=>setError(ownerError(e))).finally(()=>{flight.current=false;setBusy(false);});}}>{t('Retry pending recovery')}</button></>}
    {review.kind==='safety'&&!review.canAcknowledge&&<p>{t('A verified receipt is required before this safety hold can be acknowledged.')}</p>}
    {!!error && <p role="alert">{error}</p>}
  </div>;
}
export function BossRecovery({ revision, onDone }: { revision: number; onDone: () => void }) {
  useLanguage(); const [reviews, setReviews] = useState<Review[]>(), [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const [calls, worlds,execution] = await Promise.allSettled([ownerGoalRequest<{ items: Call[] }>('automation/calls'), ownerGoalRequest<{ items: RecoveryWorld[] }>('recovery'),ownerGoalRequest<ExecutionRecovery>('execution-recovery')]);
      const items: Review[] = [];
      if(calls.status==='fulfilled')for(const call of calls.value.items)items.push(call.world_id && call.source_kind === 'world' && call.source_id&&!call.reviewed ? { id: call.source_id, worldId: call.world_id, kind: 'model', tokens: call.actual_tokens ?? undefined, reservedMicros: call.reserved_micros } : { id: call.id, tokens: call.actual_tokens ?? undefined, reservedMicros: call.reserved_micros });
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
  return <><p>{t('Unknown outcomes retain their reservations. Approving records the suggested verified values; nothing is replayed.')}</p>
    {!!error && <p role="alert">{t('Some recovery records are unavailable. Loaded records can still be reviewed.')} {error} <button onClick={() => void refresh()}>{t('Retry')}</button></p>}
    {!error && reviews?.length === 0 && <p>{t('No unresolved calls remain.')}</p>}
    {reviews?.map(review => <details key={`${review.worldId}:${review.kind}:${review.id}`}><summary>{t(review.kind==='attempt'?'Review uncertain execution':review.kind==='safety'?'Review safety hold':'Confirm verified usage')} · {review.id}</summary><VerifiedSettlement review={review} revision={revision} onDone={() => { onDone(); void refresh(); }} /></details>)}</>;
}
