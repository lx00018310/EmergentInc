import { useEffect, useRef, useState, type FormEvent } from 'react';
import { language, t, useLanguage } from '../../i18n';
import { ownerError, ownerGoalRequest, type OwnerAutomation, type OwnerGoal, type OwnerGoalDetail, type OwnerRunReport } from '../../api/owner';
import { OwnerTokenQuota } from './OwnerCompany';
import { OwnerExtensions } from './OwnerExtensions';

type GoalForm = { id?: string; revision?: number; title: string; objective: string; kind: 'artifact' | 'manual' | 'confirmed_payments'; invoiceIds:string;targetCount:string; filename: string; minBytes: string; description: string };
const emptyForm = (): GoalForm => ({ title: '', objective: '', kind: 'manual', invoiceIds:'',targetCount:'1', filename: 'result.md', minBytes: '100', description: t('Verify the stated business result against real source evidence.') });
const status = (value: string) => t(`Goal status: ${value}`);

export function OwnerGoals({ goals, automation, onDone }: { goals: OwnerGoal[]; automation: OwnerAutomation; onDone: () => Promise<void> }) {
  useLanguage();
  const [form, setForm] = useState<GoalForm | null>(null), [archived, setArchived] = useState(false), [archiveList, setArchiveList] = useState<OwnerGoal[]>([]);
  const [detail, setDetail] = useState<OwnerGoalDetail>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [verification,setVerification]=useState('');
  const [report,setReport]=useState<OwnerRunReport>();
  const pending = useRef<{ hash: string; key: string }>();
  const detailRequest = useRef(0);
  const list = archived ? archiveList : goals;
  const loadArchives = async () => { const result = await ownerGoalRequest<{ items: OwnerGoal[] }>('goals?archived=true'); setArchiveList(result.items); };
  const loadDetail = async (id: string) => { const request = ++detailRequest.current; try { const result = await ownerGoalRequest<OwnerGoalDetail>(`goals/${encodeURIComponent(id)}`); if(request===detailRequest.current)setDetail(result); } catch(e) { if(request===detailRequest.current)setError(ownerError(e)); } };
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('goal'); if(id)void loadDetail(id); return()=>{detailRequest.current++;}; }, []);
  const mutate = async (path: string, method: string, body: Record<string, unknown>): Promise<boolean> => {
    const hash = JSON.stringify({ path, method, body }); if(pending.current?.hash !== hash)pending.current={hash,key:crypto.randomUUID()};
    setBusy(true); setError('');
    try { await ownerGoalRequest(path,method,{...body,idempotencyKey:pending.current.key});pending.current=undefined;await onDone();if(archived)await loadArchives();if(detail)await loadDetail(detail.goal.id);return true; }
    catch(e){setError(ownerError(e));await onDone();return false;}
    finally{setBusy(false);}
  };
  const action=(goal:OwnerGoal,action:string)=>void mutate(`goals/${encodeURIComponent(goal.id)}/actions`,'POST',{action,expectedRevision:goal.revision});
  const save=async(event:FormEvent)=>{
    event.preventDefault();if(!form)return;
    const acceptance=form.kind==='artifact'?{kind:'artifact',filename:form.filename,minBytes:Number(form.minBytes)}:form.kind==='confirmed_payments'?{kind:form.kind,invoiceIds:form.invoiceIds.split(/[\s,]+/).filter(Boolean),targetCount:Number(form.targetCount)}:{kind:'manual',description:form.description};
    if(await mutate(form.id?`goals/${encodeURIComponent(form.id)}`:'goals',form.id?'PATCH':'POST',{title:form.title||form.objective.slice(0,120),objective:form.objective,acceptance,...(form.id?{expectedRevision:form.revision}:{})}))setForm(null);
  };
  const edit=(goal:OwnerGoal)=>{setForm({id:goal.id,revision:goal.revision,title:goal.title,objective:goal.objective,kind:goal.acceptance.kind,invoiceIds:goal.acceptance.kind==='confirmed_payments'?goal.acceptance.invoiceIds.join(', '):'',targetCount:goal.acceptance.kind==='confirmed_payments'?String(goal.acceptance.targetCount):'1',filename:goal.acceptance.kind==='artifact'?goal.acceptance.filename:'result.md',minBytes:goal.acceptance.kind==='artifact'?String(goal.acceptance.minBytes):'100',description:goal.acceptance.kind==='manual'?goal.acceptance.description:''});};
  const number=(n:number)=>n.toLocaleString(language());
  return <section className="owner-goals" aria-label={t('Business goals')}>
    <OwnerTokenQuota automation={automation} onDone={onDone}/>
    {error&&<p role="alert">{error}</p>}
    <div className="owner-goal-heading"><h2>{t('Business goals')}</h2><button disabled={busy} onClick={()=>setForm(emptyForm())}>{t('Add goal')}</button><button disabled={busy} aria-pressed={archived} onClick={async()=>{setError('');try{if(!archived)await loadArchives();setArchived(!archived);}catch(e){setError(ownerError(e));}}}>{archived?t('Current goals'):t('Archived goals')}</button></div>
    {form&&<form onSubmit={save} className="owner-goal-form" aria-label={form.id?t('Edit goal'):t('Add goal')}>
      <label>{t('Describe the business goal')}<textarea required maxLength={1200} value={form.objective} onChange={e=>setForm({...form,objective:e.target.value})}/></label>
      <details open={Boolean(form.id)}><summary>{t('Advanced acceptance settings')}</summary>
      <label>{t('Goal title')}<input maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
      <label>{t('Acceptance rule')}<select value={form.kind} onChange={e=>setForm({...form,kind:e.target.value as GoalForm['kind']})}><option value="artifact">{t('Verifiable draft file')}</option><option value="manual">{t('Result requiring human verification')}</option><option value="confirmed_payments">{t('Confirmed invoice payments')}</option></select></label>
      {form.kind==='artifact'?<details><summary>{t('File acceptance settings')}</summary><label>{t('Required filename')}<input required value={form.filename} onChange={e=>setForm({...form,filename:e.target.value})}/></label><label>{t('Minimum UTF-8 bytes')}<input type="number" min="1" max="1000000" required value={form.minBytes} onChange={e=>setForm({...form,minBytes:e.target.value})}/></label></details>:form.kind==='confirmed_payments'?<><label>{t('Owner-selected invoice IDs')}<textarea required value={form.invoiceIds} onChange={e=>setForm({...form,invoiceIds:e.target.value})}/></label><label>{t('Required confirmed payments')}<input type="number" min="1" max="100" required value={form.targetCount} onChange={e=>setForm({...form,targetCount:e.target.value})}/></label><p>{t('Only finalized receipts for these exact invoices count. This does not verify customer identity or service quality.')}</p></>:<label>{t('Evidence needed for acceptance')}<textarea required maxLength={1000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>}
      </details>
      <p>{t('The goal uses automatic company quota. Business results require source evidence.')}</p>
      <button disabled={busy} type="submit">{t('Confirm goal')}</button><button disabled={busy} type="button" onClick={()=>setForm(null)}>{t('Cancel')}</button>
    </form>}
    {!list.length&&<p>{archived?t('No archived goals.'):t('Describe a goal to get started. It uses the company token quota.')}</p>}
    <ul className="owner-goal-list">{list.map(goal=><li key={goal.id} className="owner-goal-card">
      <div><h3>{goal.title}</h3><strong>{status(goal.status)}</strong></div><p>{goal.objective}</p>
      {['READY','RUNNING'].includes(goal.status)&&automation.desiredMode==='OFF'&&<p>{t('Goal ready · company automation paused')}</p>}
      <p>{goal.acceptance.kind==='artifact'?t('Verified draft: {0} / 1',[goal.verifiedCount]):goal.acceptance.kind==='confirmed_payments'?t('Verified payments: {0} / {1}',[goal.verifiedCount,goal.acceptance.targetCount]):goal.verifiedCount?t('Owner verified the result against source evidence'):t('{0} evidenced stages; business result awaits verification',[goal.evidenceCount])}</p>
      <p>{t('Next step')}: {goal.reason?t(goal.reason):goal.status==='COMPLETED'?t('Review the verified evidence'):t('Wait for an authorized execution slot')}</p>
      <small>{t('Goal tokens used: {0}',[number(goal.spentTokens)])} · <time>{new Date(goal.updatedAt).toLocaleString(language())}</time></small>
      <div className="owner-goal-actions"><button onClick={()=>void loadDetail(goal.id)}>{t('Details')}</button>
        {['READY','RUNNING','WAITING_APPROVAL','WAITING_RESOURCE','BLOCKED'].includes(goal.status)&&<button disabled={busy} onClick={()=>action(goal,'pause')}>{t('Pause goal')}</button>}
        {['PAUSED','WAITING_RESOURCE'].includes(goal.status)&&<button disabled={busy} onClick={()=>action(goal,'resume')}>{t('Continue goal')}</button>}
        <details><summary>{t('More actions')}</summary>
          {goal.status==='ARCHIVED'?<button disabled={busy} onClick={()=>action(goal,'restore')}>{t('Restore goal')}</button>:<>
            <button disabled={busy} onClick={()=>edit(goal)}>{t('Edit goal')}</button>
            {!['STOPPED','COMPLETED'].includes(goal.status)&&<button disabled={busy} onClick={()=>action(goal,'stop')}>{t('Stop goal')}</button>}
            {['STOPPED','COMPLETED','FAILED','BLOCKED','WAITING_APPROVAL'].includes(goal.status)&&<button disabled={busy} onClick={()=>action(goal,'reopen')}>{t('Reopen goal')}</button>}
            <button disabled={busy} onClick={()=>action(goal,'archive')}>{t('Delete (archive)')}</button>
          </>}
        </details>
      </div>
    </li>)}</ul>
    {detail&&<section className="owner-goal-detail" aria-label={t('Goal details')}><button onClick={()=>{detailRequest.current++;setDetail(undefined);}}>{t('Close details')}</button><h2>{detail.goal.title}</h2><p>{status(detail.goal.status)} · {t('Revision {0}',[detail.goal.specificationRevision])}</p>
      <h3>{t('Verified evidence')}</h3>{detail.evidence.length?<ul>{detail.evidence.map(e=><li key={e.id}>{e.kind==='artifact'?t('Draft file'):e.kind==='payment'?t('Confirmed payment receipt'):t('Unverified person report')} · {e.reference}<br/><code>{e.sha256}</code> · {e.bytes} {t('bytes')}{e.kind==='artifact'&&<> · <a href={`/api/owner/goals/${encodeURIComponent(detail.goal.id)}/evidence/${encodeURIComponent(e.id)}`} target="_blank" rel="noreferrer">{t('Open evidence')}</a></>}</li>)}</ul>:<p>{t('No verified evidence yet.')}</p>}
      <h3>{t('Goal history')}</h3><ol>{detail.events.map(e=><li key={e.id}>{new Date(e.createdAt).toLocaleString(language())} · {t(`Goal event: ${e.kind}`,[detail.goal.title])}</li>)}</ol>
      {detail.goal.acceptance.kind==='manual'&&detail.goal.status==='WAITING_APPROVAL'&&<form onSubmit={event=>{event.preventDefault();void mutate(`goals/${encodeURIComponent(detail.goal.id)}/actions`,'POST',{action:'verify',expectedRevision:detail.goal.revision,verification:{evidenceIds:detail.evidence.filter(e=>e.kind!=='report'&&e.specificationRevision===detail.goal.specificationRevision).map(e=>e.id),reason:verification}});}}>
        <p>{t('Review the source files first. This records your explicit verification; it does not create payment or customer facts.')}</p><label>{t('Verification evidence and reason')}<textarea required minLength={8} maxLength={1000} value={verification} onChange={e=>setVerification(e.target.value)}/></label><button disabled={busy||!detail.evidence.some(e=>e.kind!=='report'&&e.specificationRevision===detail.goal.specificationRevision)}>{t('Confirm verified result')}</button>
      </form>}
      <details><summary>{t('Advanced execution details')}</summary><pre>{JSON.stringify(detail.dispatches,null,2)}</pre><p><a href="/QIAN">QIAN</a> · <a href="/YUAN">YUAN</a> · <a href="/GENE">GENE</a></p></details>
      <OwnerExtensions key={detail.goal.id} worldIds={[...new Set(detail.dispatches.map(d=>d.worldId))]}/>
    </section>}
    <details className="owner-run-report" onToggle={async event=>{if(event.currentTarget.open)try{setReport(await ownerGoalRequest<OwnerRunReport>('automation/report'));}catch(e){setError(ownerError(e));}}}><summary>{t('Run report')}</summary>{report&&<><p>{t('Read at')} {new Date(report.asOf).toLocaleString(language())} · {t('Completed rounds: {0}',[report.automation.completedRounds])}</p><ul>{report.goals.map(g=><li key={g.goalId}>{g.title}: {status(g.status)} · {t('Tokens used: {0}; known cost: ¥{1}; evidence: {2}',[g.spentTokens,g.knownCostCny.toFixed(6),g.evidence.length])}{g.reason&&` · ${t(g.reason)}`}</li>)}</ul>{report.automation.reason&&<p>{t(report.automation.reason)}</p>}</>}</details>
  </section>;
}
