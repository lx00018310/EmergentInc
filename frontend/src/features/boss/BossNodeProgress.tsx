import {useCallback,useEffect,useRef,useState,type ReactNode} from 'react';
import type {CompanyTaskNodeView,CompanyProgressScope,CompanyProgressGap} from '../../../../packages/protocol/src/types/owner';
import {ownerGoalRequest,ownerError} from '../../api/owner';
import {t,useLanguage} from '../../i18n';
import {ownerStatusLabel,ownerTime} from '../owner/ownerPresentation';
import {useOwnerCommand} from './useOwnerCommand';
import {OwnerMarkdown} from '../owner/OwnerMarkdown';
import {BossDetailProgress} from './BossDetailLayout';

interface Facts {expectedRevision:number;planRevision:number;hash:string;node:CompanyTaskNodeView;actions:string[];scope:CompanyProgressScope|null;gaps:CompanyProgressGap[];dependencies?:{key:string;title:string}[]}
export function BossNodeProgress({goalId,nodeKey,onDone,index,title,state,children}:{goalId:string;nodeKey:string;onDone:()=>void;index?:number;title?:string;state?:string;children?:ReactNode}){
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
  const requirements=facts?.node.progressPolicy?.requirements??[];
  const checked=requirements.filter(requirement=>facts?.node.progress?.checked.includes(requirement.id)).length;
  return <details className="boss-stage"><summary>
    {index!==undefined&&<span className="boss-stage-number" aria-hidden="true">{String(index).padStart(2,'0')}</span>}
    <span className="boss-stage-summary-title"><strong>{facts?.node.title??title??nodeKey}</strong>{facts&&requirements.length>0&&<small>{facts.node.progress?t('Acceptance checks: {0}/{1}',[checked,requirements.length]):t('No acceptance result recorded yet.')}</small>}</span>
    <span className="boss-detail-state">{facts||state?ownerStatusLabel(facts?.node.state??state!,'Stage state: '):t('Loading…')}</span><span className="boss-stage-chevron" aria-hidden="true">⌄</span>
  </summary>
    {facts&&<div className="boss-stage-body">
      <div className="boss-detail-split">
        <section className="boss-detail-panel"><h5>{t('Stage objective and output')}</h5><OwnerMarkdown content={facts.node.instruction}/><p className="boss-detail-caption">{t('Expected file: {0}',[facts.node.filename])}</p></section>
        <section className="boss-detail-panel"><h5>{t('Acceptance checklist')}</h5>
          {!!requirements.length&&facts.node.progress&&<BossDetailProgress completed={checked} total={requirements.length} label={t('Acceptance checks passed')} caption={t('Based on recorded checks against this stage’s requirements.')}/>}
          {!requirements.length&&<p>{t('No quantified acceptance checklist is defined for this stage.')}</p>}
          {!!requirements.length&&!facts.node.progress&&<p className="boss-detail-caption">{t('No acceptance result recorded yet.')}</p>}
          <ul className="boss-detail-checklist">{requirements.map(requirement=><li key={requirement.id} data-checked={Boolean(facts.node.progress?.checked.includes(requirement.id))}><span aria-hidden="true">{facts.node.progress?.checked.includes(requirement.id)?'✓':'○'}</span><span>{requirement.description}</span><small>{t(facts.node.progress?.checked.includes(requirement.id)?'Check passed':'Not verified')}</small></li>)}</ul>
        </section>
      </div>
      {children}
      <section className="boss-detail-panel">
      <h5>{t('Missing items and previous attempts')}</h5>
      {!facts.gaps.filter(g=>!g.superseded&&g.status!=='RESOLVED').length&&<p>{t('No unresolved items recorded.')}</p>}
      {facts.gaps.filter(g=>!g.superseded&&g.status!=='RESOLVED').map(g=><details key={g.id}><summary>{g.description} · {t('Attempts: {0}/{1}',[g.attempts.length,g.limit])}</summary>{g.attempts.map(a=><p key={a.key}>{t(a.method)}{a.result&&` · ${t(a.result)}`}</p>)}</details>)}
      {!!facts.gaps.filter(g=>g.superseded).length&&<details><summary>{t('Earlier requirements retained for history')}</summary>{facts.gaps.filter(g=>g.superseded).map(g=><p key={g.id}>{g.description} · {t('Previous attempts: {0}',[g.attempts.length])}</p>)}</details>}
      </section>
      {!!facts.actions.length&&<section className="boss-detail-panel boss-stage-actions"><h5>{t('Actions for this stage')}</h5>
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
      </section>}
      {facts.scope&&<details className="boss-detail-technical"><summary>{t('Execution limits and records')}</summary>
        <p>{t('Model calls: {0}/{1}',[facts.scope.modelCalls,facts.scope.maxModelCalls])} · {t('Tool calls: {0}/{1}',[facts.scope.toolCalls,facts.scope.maxToolCalls])}</p>
        <p>{facts.scope.deadlineAt?t('Automatic window ends at {0}',[ownerTime(facts.scope.deadlineAt)]):t('The automatic window starts with execution.')}</p>
      </details>}
    </div>}
    {command.awaiting&&<p role="status">{t('The recovery decision is not confirmed. Retry its original fields and key.')} <button disabled={command.busy} onClick={()=>void command.retry().then(ok=>{if(ok){void refresh();onDone();}})}>{t('Retry original decision')}</button></p>}
    {(error||command.error)&&<p role="alert">{error||command.error} <button disabled={command.busy} onClick={()=>void refresh()}>{t('Refresh stage')}</button></p>}
  </details>;
}
