import { EventStream } from './EventStream';
import { LayerHeader, LayerSummary, StateBadge } from './LayerHeader';
import { lifeTime, type BusinessTab, type LifeOverview } from './life_types';

export function BodyLayer({ body, proposals, onNavigate }: {
  body: LifeOverview['body']; proposals: LifeOverview['genome']['proposals']; onNavigate?: (tab: BusinessTab) => void;
}) {
  const { current, skills, needs, businessSummary: business } = body;
  const pending = needs.filter(n => n.state !== 'SATISFIED');
  const state = skills.some(s => s.state === 'RECOVERY_REQUIRED') ? 'RECOVERY_REQUIRED' : body.database;
  return <section className="life-layer life-body" aria-label="L4 身体层" data-layer="BODY">
    <LayerHeader number={4} code="BODY" title="身体层" state={state}
      description="在基因允许范围内生长、工作和回退；身体变化不产生新一代。" />
    <LayerSummary current={<>{current.generation_id} · Body Revision R{current.body_revision} · DB {body.database}<br />Active Skills {skills.filter(s => s.state === 'ACTIVE').length} · Running Tasks {business.runningTasks}</>}
      recent={body.currentEvents[0]?.title ?? (business.recentResults[0] ? `${business.recentResults[0].capability} · ${business.recentResults[0].state}` : '尚无身体活动或经营结果。')}
      next={pending.length ? `${pending.length} 个 Body Need 待处理 · ${needs.filter(n => n.state === 'GENE_PROPOSED').length} 个已转 Gene Proposal` : business.waitingResources ? `${business.waitingResources} 个资源请求待提供` : '等待新的任务或 Body Need。'} />
    <details className="life-detail"><summary>查看能力、需求、身体候选与当前工作</summary>
      <h3>当前身体 · Body Revision R{current.body_revision}</h3>
      <p>Current DB：{body.database} · Body Needs {needs.length} 项（最近）</p>
      <h3>Body Skills</h3>{!skills.length && <p>当前身体尚未长出动态 Skill。发生新的 Body Need 后，会在基因允许的边界内尝试生成和验证能力。</p>}
      {skills.map(s => <div className="life-record" key={s.skill_id}><strong>{s.skill_id} · {s.name}</strong><p><StateBadge state={s.state} /> · {s.body_revision == null ? '无激活 Revision' : `R${s.body_revision}`} · Success {s.successful_runs} · Failed {s.failed_runs}</p></div>)}
      <h3>Body Needs</h3>{!needs.length && <p>当前没有已记录的 Body Need。身体发现能力缺口后，会在契约内生长，或向基因层提出请求。</p>}
      {needs.map(n => <div className="life-record" key={n.id}><strong>{n.need}</strong><p><StateBadge state={n.state} /> · {n.pixel_id}</p><p>证据：{n.evidence}</p>
        {n.state === 'GENE_PROPOSED' && <p>Body Need → Gene Proposal · {proposals.find(p => p.source_ref === `body-need:${current.generation_id}:${n.id}`)?.point ?? '等待基因层决定方向'}</p>}
      </div>)}
      <h3>Body Candidates · 最近 20 项</h3>{!body.bodyCandidates.length && <p>尚无身体候选；新能力完成生成后会记录验证与激活状态。</p>}
      {body.bodyCandidates.map(c => <div className="life-record" key={c.id}><strong>{c.skill_id}</strong><p><StateBadge state={c.state} /> · {c.body_revision == null ? '尚未分配 Revision' : `R${c.body_revision}`} · {c.id}</p>
        {c.previous_id && <p>前一候选：{c.previous_id}</p>}</div>)}
      <h3>当前工作</h3><dl><dt>Active Plans</dt><dd>{business.activePlans}</dd><dt>Running Tasks</dt><dd>{business.runningTasks}</dd>
        <dt>Open Resource Requests</dt><dd>{business.waitingResources}</dd><dt>Datasets</dt><dd>{business.datasets}</dd><dt>Connections</dt><dd>{business.connections} 个已启用</dd></dl>
      <h3>Recent Business Results</h3>{!business.recentResults.length && <p>尚无已记录的经营结果。</p>}
      {business.recentResults.map(r => <p key={r.id}>{r.capability} · <StateBadge state={r.state} /> · {lifeTime(r.time)}{r.error && ` · ${r.error}`}</p>)}
      {onNavigate && <div className="business-actions"><button onClick={() => onNavigate('business')}>进入经营</button>
        <button onClick={() => onNavigate('plans')}>查看方案</button><button onClick={() => onNavigate('resources')}>连接与资料</button></div>}
      <h3>Current Events · 最近 20 条</h3><EventStream events={body.currentEvents} empty="当前身体尚无活动记录；生成、验证、运行或回退后会在这里显示。" />
    </details>
  </section>;
}
