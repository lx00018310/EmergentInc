import { businessApi } from '../business_api';
import { EventStream } from './EventStream';
import { LayerHeader, LayerSummary, StateBadge } from './LayerHeader';
import { lifeTime, type LifeAction, type LifeOverview } from './life_types';

const memorySources: Record<string, string> = { dream: 'Dream', gate: 'Memory Gate', owner_correction: 'Owner Correction',
  body_rollback: 'Body Rollback', business_outcome: 'Business Outcome', generation_birth: 'Generation Birth', security_boundary: 'Security Boundary',
  generation_failure: 'Generation Failure', generation_rollback: 'Generation Rollback' };
export function EvolutionLayer({ evolution, currentGeneration, busy, act }: {
  evolution: LifeOverview['evolution']; currentGeneration: string; busy: boolean; act: LifeAction;
}) {
  const { dream, dreamRuns, proposals, generations } = evolution;
  const last = dreamRuns[0], unresolved = dreamRuns.filter(r => ['FAILED', 'RUNNING', 'OUTCOME_UNKNOWN'].includes(r.status));
  const dreamState = dream.busy ? 'RUNNING' : unresolved[0]?.status ?? (dream.failure ? 'FAILED' : last?.status ?? 'IDLE');
  const pending = proposals.filter(p => p.state === 'PROPOSED');
  const candidate = proposals.find(p => p.state === 'CANDIDATE_READY');
  const implementing = proposals.find(p => p.state === 'IMPLEMENTING');
  const approved = proposals.filter(p => ['APPROVED', 'IMPLEMENTING', 'CANDIDATE_READY'].includes(p.state));
  const birthing = generations.find(g => g.state === 'BIRTHING');
  const current = generations.find(g => g.id === currentGeneration);
  const pipeline = [
    ['经历', dream.hasNewFacts ? `${dream.pendingFactCount} NEW` : 'NONE'],
    ['Memory Gate / Dream', dreamState], ['Memory', `${evolution.memories.length} RECENT`],
    ['Gene Proposal', pending.length ? `${pending.length} WAITING` : proposals[0]?.state ?? 'NONE'],
    ['Owner Direction Approval', pending.length ? 'WAITING' : approved.length ? 'APPROVED' : 'NONE'],
    ['Gene Candidate', candidate ? 'CANDIDATE_READY' : implementing ? 'IMPLEMENTING' : 'NONE'],
    ['Validation', candidate ? 'CANDIDATE_READY · Lineage' : 'NO_RECEIPT'],
    ['Exact Hash Approval', candidate ? 'REQUIRES_REVIEW' : 'NOT_CONNECTED'],
    ['Birth', birthing ? `${birthing.id} BIRTHING` : 'IDLE'], ['ACTIVE / ROLLBACK', `${currentGeneration} ${current?.state ?? 'UNAVAILABLE'}`],
  ];
  return <section className="life-layer life-evolution" aria-label="L3 进化层" data-layer="EVOLUTION">
    <LayerHeader number={3} code="EVOLUTION" title="进化层" state={dreamState}
      description="从经历提炼记忆，提出变化，经验证与批准后出生或回退。" />
    <LayerSummary current={<>Dream <StateBadge state={dreamState} /><br />新事实 {dream.pendingFactCount} 条 · Memory {evolution.memories.length} 条（最近）</>}
      recent={evolution.evolutionEvents[0] ? <>{evolution.evolutionEvents[0].title} · {lifeTime(evolution.evolutionEvents[0].time)}</> : '尚无进化事件。'}
      next={unresolved.length ? `${unresolved.length} 次 Dream 需处理；仅已保存响应可恢复。` : candidate ? '候选已就绪，等待可信通道准确 Hash 审批。' : pending.length ? `${pending.length} 个 Gene 方向等待决定。` : `下次整理：${dream.time}（${dream.timezone}）`} />
    <details className="life-detail"><summary>查看进化流水线、Dream、Memory 与事件</summary>
      <ol className="life-pipeline" aria-label="进化流水线">{pipeline.map(([name, state]) => <li key={name}><strong>{name}</strong><StateBadge state={state!} /></li>)}</ol>
      <p>候选和 Validation 节点依据 Lineage 的 CANDIDATE_READY 状态；详细验证与准确 Hash 审批回执仍在可信维护通道。</p>
      <h3>Dream</h3><dl><dt>计划时间 / 时区</dt><dd>{dream.time} · {dream.timezone}</dd>
        <dt>当前状态</dt><dd><StateBadge state={dreamState} /></dd><dt>上次运行</dt><dd>{lifeTime(last?.created_at)}{last && ` · ${last.generation_id}`}</dd>
        <dt>上次结果</dt><dd>{last ? `${last.status} · ${last.memory_count} 条 Memory · ${last.proposal_count} 条 Proposal` : '尚未运行'}</dd>
        <dt>本次新事实</dt><dd>{dream.hasNewFacts ? `有 · ${dream.pendingFactCount} 条待整理` : '无新事实'}</dd></dl>
      <button disabled={busy || dream.busy} onClick={() => void act(() => businessApi('evolution/dream', {}))}>整理新经历</button>
      {dream.failure && <p role="alert" className="life-failure">上次整理未完成：{dream.failure}</p>}
      {unresolved.map(r => <div key={r.id} className="life-record"><p className={['FAILED', 'OUTCOME_UNKNOWN'].includes(r.status) ? 'life-failure' : ''}>
        {r.generation_id} 整理待处理：<StateBadge state={r.status} /> · {r.error ?? r.status} · {lifeTime(r.created_at)}</p>
        {Boolean(r.retry_available) && <button disabled={busy} onClick={() => void act(() => businessApi(`evolution/dream/${r.id}/retry`, {}))}>恢复已保存的响应</button>}
      </div>)}
      <h3>最近 Memory</h3>{!evolution.memories.length && <p>尚无已提炼的 Memory。新增经历通过 Memory Gate 或 Dream 整理后，会在这里保留来源与效果。</p>}
      {evolution.memories.map(m => <div className="life-record" key={m.id}><strong>{m.point}</strong><p>原因：{m.reason}</p><p>效果：{m.effect}</p>
        <small>{memorySources[m.kind] ?? memorySources[m.source] ?? m.source} · {m.generation_id}</small></div>)}
      <h3>进化事件 · 最近 20 条</h3><EventStream events={evolution.evolutionEvents} empty="尚无进化事件；产生经历、提案或代际变化后记录会在这里出现。" />
    </details>
  </section>;
}
