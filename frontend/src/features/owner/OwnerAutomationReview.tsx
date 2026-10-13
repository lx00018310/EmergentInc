import { useState } from 'react';
import { t } from '../../i18n';
import { ownerGoalRequest, ownerError } from '../../api/owner';
type Call={id:string;source_id:string|null;source_kind:string|null;world_id:string|null;reserved_tokens:number};
export function OwnerAutomationReview({revision,onDone}:{revision:number;onDone:()=>Promise<void>}){
  const [calls,setCalls]=useState<Call[]>([]),[selected,setSelected]=useState(''),[tokens,setTokens]=useState(''),[cost,setCost]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [retry,setRetry]=useState<{body:string;key:string}>();
  const load=async()=>{try{const result=await ownerGoalRequest<{items:Call[]}>('automation/calls');setCalls(result.items);}catch(e){setError(ownerError(e));}};
  return <details className="owner-automation-review" open={new URLSearchParams(window.location.search).has('automationReview')} onToggle={event=>{if(event.currentTarget.open)void load();}}><summary>{t('Review uncertain usage')}</summary>
    <p>{t('Verify the original bill before settling usage. World and external recovery still require their own decisions; this does not replay work or restart automation.')}</p>
    {error&&<p role="alert">{error}</p>}{!calls.length&&<p>{t('No uncertain control calls.')}</p>}
    <ul>{calls.map(call=><li key={call.id}><code>{call.source_id??call.id}</code> · {t('Reserved tokens: {0}',[call.reserved_tokens])} · {call.world_id&&<a href={`/YUAN?world=${encodeURIComponent(call.world_id)}`}>{t('Open original recovery')}</a>} <button type="button" disabled={busy} onClick={()=>{setSelected(call.id);setTokens('');setCost('');setReason('');setRetry(undefined);}}>{t('Reconcile verified usage')}</button></li>)}</ul>
    {selected&&<form className="owner-goal-form" onSubmit={async event=>{event.preventDefault();setBusy(true);setError('');const body={actualTokens:Number(tokens),costCny:Number(cost),reason,expectedRevision:revision},hash=JSON.stringify(body),key=retry?.body===hash?retry.key:crypto.randomUUID();setRetry({body:hash,key});try{await ownerGoalRequest(`automation/calls/${encodeURIComponent(selected)}/reconcile`,'POST',{...body,idempotencyKey:key});setSelected('');setRetry(undefined);await load();await onDone();}catch(e){setError(ownerError(e));}finally{setBusy(false);}}}>
      <label>{t('Verified actual tokens')}<input type="number" required min="0" max="1000000000" value={tokens} onChange={e=>setTokens(e.target.value)}/></label><label>{t('Verified cost in CNY')}<input type="number" required min="0" step="0.000001" value={cost} onChange={e=>setCost(e.target.value)}/></label><label>{t('Verification evidence and reason')}<textarea required minLength={8} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={busy}>{t('Record verified usage')}</button>
    </form>}
  </details>;
}
