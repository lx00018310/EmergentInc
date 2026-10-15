import type {OwnerOverview} from '../../api/owner';
import {t,useLanguage,language} from '../../i18n';
import {OwnerInbox} from './OwnerInbox';
import {OwnerActivity} from './OwnerActivity';
import {CompanyProposalCard} from './CompanyProposalCard';
import {OwnerWork} from './OwnerWork';
import {OwnerExtensions} from './OwnerExtensions';

export function OwnerDashboard({data,onDone}:{data:OwnerOverview;onDone:()=>void}){
  useLanguage();const budget=data.budget,goals=data.goals??[],plans=data.taskPlans??[],people=data.people??[],pending=(data.proposals??[]).filter(p=>p.state==='PENDING');
  const opened=useRef('');useEffect(()=>{const query=new URLSearchParams(window.location.search),target=query.get('goal')??query.get('report');if(!target||opened.current===target)return;const node=document.getElementById(target);if(node){opened.current=target;const detail=node.querySelector('details');if(detail)detail.open=true;node.scrollIntoView?.({block:'start'});}},[data.asOf]);
  const money=(n:number)=>`¥${(n/1000000).toLocaleString(language(),{maximumFractionDigits:6})}`;
  const statuses=['DRAFT','READY','RUNNING','WAITING_APPROVAL','WAITING_RESOURCE','PAUSED','BLOCKED','COMPLETED','STOPPED'];
  const approvalCount=pending.length+data.inbox.length;
  return <div className="owner-dashboard">
    <section className={`owner-card${approvalCount?' owner-approval':''}`} aria-label={t('Needs your approval')}>
      <h2>{t('Needs your approval')}<span className={`owner-badge${approvalCount?' owner-badge--danger':' owner-badge--ok'}`}>{approvalCount}</span></h2>
      {pending.map(p=><CompanyProposalCard key={p.id} proposal={p} onDone={onDone}/>)}
      <OwnerInbox items={data.inbox} alerts={data.alerts} onDone={onDone}/>
    </section>
    <section className="owner-card" aria-label={t('Company money budget')}><h2>{t('Company money budget')}</h2>
      {budget?<><div className="owner-metric-grid">{([[t('Total authorized budget'),budget.totalMicros,''],[t('Settled cost'),budget.spentMicros,''],[t('Reserved cost'),budget.reservedMicros,'warning'],[t('Available budget'),budget.availableMicros,'ok']] as const).map(([label,n,tone])=><div key={label} className={`owner-metric${tone?` owner-metric--${tone}`:''}`}><span>{label}</span><strong>{money(Number(n))}</strong></div>)}</div>
        <div className="owner-money-bar" role="img" aria-label={`${t('Settled cost')}: ${money(budget.spentMicros)}; ${t('Reserved cost')}: ${money(budget.reservedMicros)}; ${t('Available budget')}: ${money(budget.availableMicros)}`}><span style={{width:`${budget.totalMicros?Math.min(100,budget.spentMicros/budget.totalMicros*100):0}%`}}/><i style={{width:`${budget.totalMicros?Math.min(100,budget.reservedMicros/budget.totalMicros*100):0}%`}}/></div>
        {budget.activatedAt===null&&<p>{t('Give a company money budget in Boss chat to begin.')}</p>}
        <p><small>{t('Tokens measure usage. Only the company money budget authorizes spending.')}</small></p></>:<p>{t('Unavailable')}</p>}
      {Boolean(budget?.historicalCostMicros)&&<p><small>{t('Historical cost before this budget')}: {money(budget!.historicalCostMicros!)}</small></p>}
      {(data.costs??[]).length>0&&<div className="company-status-chart" role="img" aria-label={t('Daily settled cost (Asia/Shanghai)')}>{data.costs!.map(c=><div key={c.day}><span>{c.day}</span><meter min={0} max={Math.max(1,...data.costs!.map(c=>c.micros))} value={c.micros}/><strong>{money(c.micros)}</strong></div>)}</div>}
    </section>
    {(data.legacyBusiness??[]).length>0&&<section className="owner-card"><h2>{t('Retained business tasks')}</h2>{data.legacyBusiness!.map(p=><article key={p.id}><h3>{p.title}</h3><p>{t(p.state)}</p><small>{p.id}{p.nextAt!==null&&` · ${new Date(p.nextAt).toLocaleString(language())}`}</small></article>)}<p><small>{t('These retained tasks continue through their original executor. No duplicate task is created.')}</small></p></section>}
    {data.storefront&&<section className="owner-card"><h2>{t('Store products and orders')}</h2>{data.storefront.products.map(p=><article key={p.id}><h3>{(language()==='en'?p.nameEn:p.nameZh)||p.id}</h3><p>{t(p.enabled?'Published product':'Unpublished product')} · {p.price??'—'} {p.currency}</p></article>)}<ol>{data.storefront.orders.map(o=><li key={o.id}>{o.product} · {o.amount} {o.currency} · {t(o.status)} · {new Date(o.at).toLocaleString(language())}</li>)}</ol></section>}
    <section className="owner-card" id="owner-goals" aria-label={t('Tasks and progress')}><h2>{t('Tasks and progress')}</h2>
      <div className="company-status-chart" role="img" aria-label={t('Task status distribution')}>{statuses.map(status=>{const count=goals.filter(g=>g.status===status).length;return count?<div key={status}><span>{t(`Goal status: ${status}`)}</span><meter min={0} max={Math.max(1,goals.length)} value={count}/><strong>{count}</strong></div>:null;})}</div>
      {!goals.length&&<p>{t('Describe a task in Boss chat. AI will propose the steps.')}</p>}
      {goals.map(g=><article className="company-task" id={g.id} key={g.id}><h3>{g.title}</h3><p>{t(`Goal status: ${g.status}`)} · {g.reason?t(g.reason):''}</p><p>{g.objective}</p>
        <ol className="company-task-timeline">{plans.find(p=>p.goalId===g.id)?.nodes.map(n=><li key={n.key}><strong>{n.title}</strong> · {t(`Task node: ${n.state}`)} · {t(`Task trigger: ${n.trigger.kind}`)}{n.nextAt!==null&&['READY','RUNNING'].includes(g.status)&&<small>{t('Next scheduled run')}: {new Date(n.nextAt).toLocaleString(language())}</small>}</li>)}</ol>
        <details><summary>{t('Deliverables and execution history')}</summary><TaskEvidence goalId={g.id} updatedAt={g.updatedAt}/></details>
      </article>)}
    </section>
    <section className="owner-card"><h2>{t('People and workload')}</h2>{people.map(p=><div key={p.id} className="company-person"><strong>{p.name}</strong><span>{p.role??t('Company coordinator')}</span><meter min={0} max={1} value={p.running?1:0}/><span>{t(p.running?'Running':'Idle')}</span></div>)}{!people.length&&<p>{t('No active people. AI can propose recruitment when execution needs it.')}</p>}</section>
    <section className="owner-card"><h2>{t('Verified revenue')}</h2>{(data.revenue??[]).length?<><RevenueChart rows={data.revenue!}/><ol>{data.revenue!.map((r,i)=><li key={i}>{new Date(r.at).toLocaleString(language())} · {r.amount} {r.asset}</li>)}</ol></>:<p>{t('No verified revenue yet.')}</p>}</section>
    <OwnerWork work={data.work}/>
    <OwnerExtensions worldIds={people.map(p=>p.worldId).filter((id):id is string=>Boolean(id))}/>
    <OwnerActivity items={data.activity}/>
    <details className="owner-card"><summary><strong>{t('Decision history')}</strong></summary>{(data.proposals??[]).filter(p=>p.state!=='PENDING').map(p=><CompanyProposalCard key={p.id} proposal={p}/>)}</details>
  </div>;
}
function RevenueChart({rows}:{rows:{asset:string;amount:string;at:number}[]}){return <>{[...new Set(rows.map(r=>r.asset))].map(asset=>{const list=rows.filter(r=>r.asset===asset),max=Math.max(1,...list.map(r=>Number(r.amount)));return <svg key={asset} viewBox="0 0 400 110" role="img" aria-label={t('Verified revenue')+' · '+asset}><polyline fill="none" stroke="#000000" strokeWidth="2" points={list.map((r,i)=>`${20+i*360/Math.max(1,list.length-1)},${90-Number(r.amount)/max*70}`).join(' ')}/>{list.map((r,i)=><circle key={i} cx={20+i*360/Math.max(1,list.length-1)} cy={90-Number(r.amount)/max*70} r="3" fill="#000000"><title>{`${new Date(r.at).toLocaleString(language())}: ${r.amount} ${asset}`}</title></circle>)}</svg>;})}</>;}
import {useEffect,useState,useRef} from 'react';
import {ownerGoalRequest,ownerError} from '../../api/owner';
import type {OwnerGoalDetail} from '../../api/owner';
function TaskEvidence({goalId,updatedAt}:{goalId:string;updatedAt:number}){
  const [detail,setDetail]=useState<OwnerGoalDetail>(),[error,setError]=useState('');
  useEffect(()=>{let alive=true;void ownerGoalRequest<OwnerGoalDetail>(`goals/${encodeURIComponent(goalId)}`).then(r=>{if(alive)setDetail(r);}).catch(e=>{if(alive)setError(ownerError(e));});return()=>{alive=false;};},[goalId,updatedAt]);
  return <>{error&&<p role="alert">{error}</p>}{detail?.evidence.map(e=><p key={e.id}>{e.kind==='artifact'?<a href={`/api/owner/goals/${encodeURIComponent(goalId)}/evidence/${encodeURIComponent(e.id)}`} target="_blank" rel="noreferrer">{e.reference.split('/').at(-1)}</a>:<span>{e.reference}</span>} · {e.bytes} {t('bytes')}</p>)}{detail?.events.slice(0,20).map(e=><p key={e.id}>{new Date(e.createdAt).toLocaleString(language())} · {t(`Goal event: ${e.kind}`)}</p>)}</>;
}
