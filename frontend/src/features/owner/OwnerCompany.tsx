import { useRef, useState, type FormEvent } from 'react';
import { language, t, useLanguage } from '../../i18n';
import { ownerError, ownerGoalRequest, type OwnerAutomation } from '../../api/owner';
import { OwnerAutomationReview } from './OwnerAutomationReview';

function useCompanyControl(automation:OwnerAutomation|undefined,onDone:()=>Promise<void>){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<{hash:string;key:string}>();
  const save=async(body:Record<string,unknown>)=>{
    if(!automation||busy)return;
    const request={...body,expectedRevision:automation.revision},hash=JSON.stringify(request);
    if(pending.current?.hash!==hash)pending.current={hash,key:crypto.randomUUID()};
    setBusy(true);setError('');
    try{await ownerGoalRequest('automation','POST',{...request,idempotencyKey:pending.current.key});pending.current=undefined;await onDone();}
    catch(e){setError(ownerError(e));await onDone();}finally{setBusy(false);}
  };
  return {busy,error,save};
}

export function OwnerCompany({automation,onDone}:{automation?:OwnerAutomation;onDone:()=>Promise<void>}){
  useLanguage();const {busy,error,save}=useCompanyControl(automation,onDone),on=automation?.desiredMode==='ON';
  return <div className="owner-company">
    <h1>{t('My AI company')}</h1>
    <button type="button" role="switch" aria-label={t('Company automation')} aria-checked={on} className={`owner-company-switch${on?' is-on':''}`} disabled={!automation||busy||!on&&automation.observedState==='STOPPING'} onClick={()=>void save({desiredMode:on?'OFF':'ON'})}>
      <span className={on?'selected':''}>ON</span><span className={!on?'selected':''}>OFF</span>
    </button>
    {error&&<p role="alert">{error}</p>}
  </div>;
}

export function OwnerTokenQuota({automation,onDone}:{automation:OwnerAutomation;onDone:()=>Promise<void>}){
  useLanguage();const {busy,error,save}=useCompanyControl(automation,onDone),[total,setTotal]=useState('');
  const number=(value:number)=>value.toLocaleString(language());
  const submit=(event:FormEvent)=>{event.preventDefault();void save({maxTokens:Number(total)});};
  return <section className="owner-token-quota" aria-label={t('Company token quota')}>
    <h2>{t('Company token quota')}</h2>
    <p>{t('Company tokens: {0} used, {1} reserved / {2} total',[number(automation.spentTokens),number(automation.reservedTokens),number(automation.maxTokens)])}</p>
    {automation.observedState==='LIMIT_REACHED'&&<p role="status">{t('Token quota needs Owner approval. Increase the total quota to continue.')}</p>}
    <form onSubmit={submit} className="owner-control-form">
      <label>{t('New total token quota')}<input type="number" min={Math.max(1,automation.maxTokens+1,automation.spentTokens+automation.reservedTokens)} max="1000000000" required value={total} onChange={event=>setTotal(event.target.value)}/></label>
      <button type="submit" disabled={busy}>{t('Approve token quota')}</button>
    </form>
    <p className="owner-status-scope">{t('One quota for all AI calls. OFF/ON and restarts never reset usage; only Owner can increase the total.')}</p>
    {error&&<p role="alert">{error}</p>}
    <OwnerAutomationReview revision={automation.revision} onDone={onDone}/>
  </section>;
}
