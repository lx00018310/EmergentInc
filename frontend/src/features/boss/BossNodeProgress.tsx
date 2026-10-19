import {useCallback,useEffect,useRef,useState} from 'react';
import type {CompanyTaskNodeView,CompanyProgressScope,CompanyProgressGap} from '../../../../packages/protocol/src/types/owner';
import {ownerGoalRequest,ownerError} from '../../api/owner';
import {t,useLanguage} from '../../i18n';
import {ownerStatusLabel,ownerTime} from '../owner/ownerPresentation';
import {useOwnerCommand} from './useOwnerCommand';

interface Facts {expectedRevision:number;planRevision:number;hash:string;node:CompanyTaskNodeView;actions:string[];scope:CompanyProgressScope|null;gaps:CompanyProgressGap[];dependencies?:{key:string;title:string}[]}
export function BossNodeProgress({goalId,nodeKey,onDone}:{goalId:string;nodeKey:string;onDone:()=>void}){
  useLanguage();const path=`goals/${encodeURIComponent(goalId)}/nodes/${encodeURIComponent(nodeKey)}/actions`;
  const command=useOwnerCommand(`boss.progress.${goalId}.${nodeKey}`,path);
  const initialized=useRef(false);
  const [allowIncompleteFrom,setIncomplete]=useState<string[]>([]);
  const [facts,setFacts]=useState<Facts>(),[error,setError]=useState(''),[material,setMaterial]=useState(''),[threshold,setThreshold]=useState(100),[checks,setChecks]=useState(''),[modelCalls,setModels]=useState(0),[toolCalls,setTools]=useState(0),[minutes,setMinutes]=useState(0),[attempts,setAttempts]=useState(0),[gapId,setGap]=useState('');
  const refresh=useCallback(async()=>{try{const f=await ownerGoalRequest<Facts>(path);if(!f?.node||!Array.isArray(f.actions)||!Array.isArray(f.gaps))throw new Error('OWNER_PROGRESS_UNAVAILABLE');setFacts(f);if(!initialized.current){setThreshold(f.node.progressPolicy?.passPercent??100);setChecks(f.node.progressPolicy?.requirements.map(r=>r.contains??'').join('\n')??'');setIncomplete(f.node.progressPolicy?.allowIncompleteFrom??[]);initialized.current=true;}setError('');}catch(e){setError(ownerError(e));}},[path]);
  useEffect(()=>{void refresh();},[refresh]);
  async function act(action:string,extra:Record<string,unknown>={}){
    if(!facts)return;
    if(await command.submit({action,...extra,expectedRevision:facts.expectedRevision,planRevision:facts.planRevision,hash:facts.hash,idempotencyKey:crypto.randomUUID(),reason:'The owner explicitly chose this bounded stage action.'})){await refresh();onDone();}
  }
  const disabled=command.busy||command.awaiting;
  return <details className="boss-stage"><summary>{facts?.node.title??nodeKey} · {facts?ownerStatusLabel(facts.node.state,'Stage state: '):t('Loading…')}</summary>
    {facts&&<>
      <p>{facts.node.instruction}</p>
      {facts.node.progress&&<p>{t('Checked requirements: {0}',[facts.node.progress.checked.length])}</p>}
      {facts.scope&&<p>{t('Model calls: {0}/{1}',[facts.scope.modelCalls,facts.scope.maxModelCalls])} · {t('Tool calls: {0}/{1}',[facts.scope.toolCalls,facts.scope.maxToolCalls])}</p>}
      {facts.scope&&<p>{facts.scope.deadlineAt?t('Automatic window ends at {0}',[ownerTime(facts.scope.deadlineAt)]):t('The automatic window starts with execution.')}</p>}
      <h5>{t('Missing items and previous attempts')}</h5>
      {!facts.gaps.filter(g=>!g.superseded&&g.status!=='RESOLVED').length&&<p>{t('No unresolved items recorded.')}</p>}
      {facts.gaps.filter(g=>!g.superseded&&g.status!=='RESOLVED').map(g=><details key={g.id}><summary>{g.description} · {t('Attempts: {0}/{1}',[g.attempts.length,g.limit])}</summary>{g.attempts.map(a=><p key={a.key}>{t(a.method)}{a.result&&` · ${t(a.result)}`}</p>)}</details>)}
      {!!facts.gaps.filter(g=>g.superseded).length&&<details><summary>{t('Earlier requirements retained for history')}</summary>{facts.gaps.filter(g=>g.superseded).map(g=><p key={g.id}>{g.description} · {t('Previous attempts: {0}',[g.attempts.length])}</p>)}</details>}
      <div className="boss-actions">
        {facts.actions.includes('CONTINUE_NODE')&&<button disabled={disabled} onClick={()=>void act('CONTINUE_NODE')}>{t('Continue this stage')}</button>}
        {facts.actions.includes('SKIP_NODE')&&<button disabled={disabled} onClick={()=>void act('SKIP_NODE')}>{t('Skip this ordinary stage')}</button>}
      </div>
      {facts.actions.includes('SUPPLEMENT')&&<><label>{t('Owner-supplied material')}<textarea maxLength={4000} value={material} disabled={disabled} onChange={e=>setMaterial(e.target.value)}/></label><button disabled={disabled||material.trim().length<8} onClick={()=>void act('SUPPLEMENT',{text:material.trim()})}>{t('Save material')}</button><p>{t('Material is retained with its source. Continue separately when the remaining limits permit.')}</p></>}
      {facts.actions.includes('ADJUST_REQUIREMENTS')&&<details><summary>{t('Adjust ordinary requirements')}</summary>
        <label>{t('Pass threshold')}<select value={threshold} disabled={disabled} onChange={e=>setThreshold(Number(e.target.value))}>{[70,80,100].map(n=><option key={n} value={n}>{n}%</option>)}</select></label>
        <label>{t('Expected text, one requirement per line')}<textarea maxLength={6000} value={checks} disabled={disabled} onChange={e=>setChecks(e.target.value)}/></label>
        <p>{t('These checks apply to ordinary drafts. Payment, permissions and verified facts retain their existing checks.')}</p>
        {facts.node.dependsOn.map(key=><label key={key} className="boss-stage-check"><input type="checkbox" checked={allowIncompleteFrom.includes(key)} disabled={disabled} onChange={e=>setIncomplete(old=>e.target.checked?[...old,key]:old.filter(v=>v!==key))}/>{t('Allow missing input from {0}',[facts.dependencies?.find(d=>d.key===key)?.title??key])}</label>)}
        {!!facts.node.dependsOn.length&&<p>{t('Changing input handoff rules creates a revised plan for approval.')}</p>}
        <button disabled={disabled||!checks.trim()&&!facts.node.progressPolicy} onClick={()=>{
          const lines=checks.split('\n').map(s=>s.trim()).filter(Boolean);
          const requirements=lines.length?lines.map((contains,i)=>({id:facts.node.progressPolicy?.requirements[i]?.id??`check_${i+1}`,description:contains,contains})):facts.node.progressPolicy!.requirements;
          void act('ADJUST_REQUIREMENTS',{progressPolicy:{requirements,passPercent:threshold,allowIncompleteFrom}});
        }}>{t('Save ordinary requirements')}</button>
      </details>}
      {facts.actions.includes('EXTEND_LIMITS')&&<details><summary>{t('Add a finite allowance')}</summary>
        <label>{t('Additional model calls')}<input type="number" min={0} max={120} value={modelCalls} disabled={disabled} onChange={e=>setModels(Number(e.target.value))}/></label>
        <label>{t('Additional tool calls')}<input type="number" min={0} max={120} value={toolCalls} disabled={disabled} onChange={e=>setTools(Number(e.target.value))}/></label>
        <label>{t('Additional minutes')}<input type="number" min={0} max={60} value={minutes} disabled={disabled} onChange={e=>setMinutes(Number(e.target.value))}/></label>
        <label>{t('Missing item')}<select value={gapId} disabled={disabled} onChange={e=>setGap(e.target.value)}><option value="">{t('Select an item')}</option>{facts.gaps.map(g=><option key={g.id} value={g.id}>{g.description}</option>)}</select></label>
        <label>{t('Additional attempts for this item')}<input type="number" min={0} max={10} value={attempts} disabled={disabled} onChange={e=>setAttempts(Number(e.target.value))}/></label>
        <button disabled={disabled||!(modelCalls||toolCalls||minutes||gapId&&attempts)} onClick={()=>void act('EXTEND_LIMITS',{limits:{...(modelCalls?{modelCalls}:{}),...(toolCalls?{toolCalls}:{}),...(minutes?{minutes}:{}),...(gapId&&attempts?{gapId,attempts}:{})}})}>{t('Add allowance')}</button>
      </details>}
    </>}
    {command.awaiting&&<p role="status">{t('The recovery decision is not confirmed. Retry its original fields and key.')} <button disabled={command.busy} onClick={()=>void command.retry().then(ok=>{if(ok){void refresh();onDone();}})}>{t('Retry original decision')}</button></p>}
    {(error||command.error)&&<p role="alert">{error||command.error} <button disabled={command.busy} onClick={()=>void refresh()}>{t('Refresh stage')}</button></p>}
  </details>;
}
