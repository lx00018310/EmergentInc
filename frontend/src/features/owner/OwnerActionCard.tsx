import { useState } from 'react';
import { t, useLanguage } from '../../i18n';
import { executeOwnerAction, ownerError, type OwnerActionProposal } from '../../api/owner';

export const ownerActionLabels:Record<string,string>={qianji_chat:'Send person chat',business_plan_approve:'Approve plan',business_plan_reject:'Reject plan',resource_provided:'Resource provided',resource_reject:'Reject resource',recruit_approve:'Approve recruitment',recruit_reject:'Reject recruitment'};
export function OwnerActionCard({proposal,onDone}:{proposal:OwnerActionProposal;onDone?:()=>void}){
  useLanguage();
  const [checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState(false),[error,setError]=useState('');
  const a=proposal.action;
  if(a.type==='open_details')return /^\/(?:QIAN|YUAN|GENE)(?:\?|$)/.test(a.href)?<p><a href={a.href}>{t('View details')}</a></p>:<p role="alert">{t('Unsupported action')}</p>;
  if(!Object.hasOwn(ownerActionLabels,a.type))return <p role="alert">{t('Unsupported action')}</p>;
  return <section className="owner-action"><strong>{t(ownerActionLabels[a.type]!)}</strong>
    {a.type==='qianji_chat' ? <><p>{t('Recipients')}: {a.targets.map(p=>`${p.name} (${p.id})`).join(', ')}</p><blockquote>{a.message}</blockquote><p>{t('Chat may consume model tokens. Each person keeps the existing Run budget.')}</p></> :
      'role' in a ? <><p>{t('Role')}: {a.role}</p><p>{t('Reason')}: {a.reason}</p><blockquote>{a.instruction}</blockquote><p>{t('Approval creates one person with this role and dispatches the initial task. Model calls consume tokens; publication needs separate approval.')}</p></> : 'plan' in a ? <>
        <p>{a.plan.plan.title} · R{a.plan.revision}</p><p>{a.plan.plan.objective}</p>
        <p>{t('Authorized budget')}: ¥{(a.plan.plan.budgetMicros/1e6).toFixed(4)} · {t('Expires')}: {new Date(a.plan.plan.expiresAt).toLocaleString()}</p>
        <p>{t('Stop condition')}: {a.plan.plan.stopCondition}</p>
        <details><summary>{t('Review full plan and external actions')}</summary><pre>{JSON.stringify(a.plan,null,2)}</pre></details>
        <p>{a.type==='business_plan_approve'?t('Approval authorizes the displayed actions and budget, including external writes.'):t('Rejection stops this pending plan.')}</p>
      </> : <><p>{a.resource} · {a.planId} · R{a.revision}</p><p>{a.type==='resource_reject'?t('Rejecting this resource stops its associated plan.'):t('The server verifies that the requested data or connection already exists.')}</p></>}
    {!done&&<label><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>{t('I reviewed the targets, content and effects.')}</label>}
    <button disabled={!checked||busy||done} onClick={async()=>{setBusy(true);setError('');try{
      const results=await executeOwnerAction(proposal),failures=results.filter(r=>!r.ok);
      if(failures.length)setError(`${t('Accepted')}: ${results.filter(r=>r.ok).map(r=>r.id).join(', ') || '0'}; ${failures.map(r=>`${r.id}: ${r.error}`).join('; ')}`);
      else {setDone(true);onDone?.();}
    }catch(e){setError(ownerError(e));}finally{setBusy(false);}}}>{t(busy?'Submitting…':done?'Accepted':'Confirm action')}</button>
    {done&&a.type==='qianji_chat'&&<p>{t('Messages accepted. Follow replies in Activity or QIAN.')}</p>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
