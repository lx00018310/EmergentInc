import { useRef, useState } from 'react';
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

export function OwnerCompany({automation,onDone,compact=false}:{automation?:OwnerAutomation;onDone:()=>Promise<void>;compact?:boolean}){
  useLanguage();const {busy,error,save}=useCompanyControl(automation,onDone),on=automation?.desiredMode==='ON';
  return <div className={compact?'owner-company owner-company-compact':'owner-company'}>
    {!compact&&<h1>{t('My AI company')}</h1>}
    <button type="button" role="switch" aria-label={t('Company automation')} aria-checked={on} className={`owner-company-switch${on?' is-on':''}`} disabled={!automation||busy||!on&&automation.observedState==='STOPPING'} onClick={()=>void save({desiredMode:on?'OFF':'ON'})}>
      <span className={on?'selected':''}>ON</span><span className={!on?'selected':''}>OFF</span>
    </button>
    {automation&&<span role="status">{t(`Automation state: ${automation.observedState}`)}</span>}
    {automation?.reason&&<span>{t(automation.reason)}</span>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}

export function OwnerTokenQuota({automation,onDone}:{automation:OwnerAutomation;onDone:()=>Promise<void>}){
  useLanguage();
  const number=(value:number)=>value.toLocaleString(language());
  return <details className="owner-token-quota">
    <summary>{t('Advanced usage and recovery')}</summary>
    <h2>{t('Company token quota')}</h2>
    <p>{t('Company tokens: {0} used, {1} reserved / {2} total',[number(automation.spentTokens),number(automation.reservedTokens),number(automation.maxTokens)])}</p>
    <p>{t('Known model cost: ¥{0}; unpriced calls: {1}',[automation.knownCostCny.toFixed(6),automation.unknownCostCalls])}</p>
    <p className="owner-status-scope">{t('Tokens are authorized automatically in 10M batches. Model API calls incur real costs. OFF pauses new work; usage survives restarts.')}</p>
    <OwnerAutomationReview revision={automation.revision} onDone={onDone}/>
  </details>;
}
