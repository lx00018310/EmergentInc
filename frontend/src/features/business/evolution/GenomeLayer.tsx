import { businessApi } from '../business_api';
import { EventStream } from './EventStream';
import { LayerHeader, LayerSummary, StateBadge } from './LayerHeader';
import { lifeTime, type LifeAction, type LifeOverview } from './life_types';

const proposalStates: Record<string, string> = { PROPOSED: '待审批', APPROVED: '已批准方向', REJECTED: '已拒绝',
  IMPLEMENTING: '实施中', CANDIDATE_READY: '候选就绪', BORN: '已出生', FAILED: '失败' };
const contractFields: Record<string, string> = { input: '输入', output: '输出', network: '网络', host_files: '宿主文件',
  credentials: 'Credentials', child_process: '子进程', package_install: '安装依赖', max_source_bytes: '源码字节上限', max_json_bytes: 'JSON 字节上限' };
function Contract({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <ul>{value.map((item, i) => <li key={i}><Contract value={item} /></li>)}</ul>;
  if (value && typeof value === 'object') return <dl>{Object.entries(value).map(([key, v]) => <div className="life-contract-field" key={key}>
    <dt>{contractFields[key] ?? key}</dt><dd><Contract value={v} /></dd></div>)}</dl>;
  return <>{typeof value === 'boolean' ? value ? '允许' : '禁止' : String(value)}</>;
}
export function GenomeLayer({ genome, currentGeneration, busy, act }: {
  genome: LifeOverview['genome']; currentGeneration: string; busy: boolean; act: LifeAction;
}) {
  const waiting = genome.proposals.filter(p => ['PROPOSED', 'CANDIDATE_READY'].includes(p.state));
  const current = genome.generations.find(g => g.id === currentGeneration);
  return <section className="life-layer life-genome" aria-label="L2 基因层" data-layer="GENOME">
    <LayerHeader number={2} code="GENOME" title="基因层" state={current?.state ?? 'UNAVAILABLE'}
      description="遗传基础结构、权限与能力契约；Gene 变化才形成新一代。" />
    <LayerSummary current={<>{currentGeneration} · Gene <code>{genome.geneHash.slice(0, 12)}…</code><br />Interface v{genome.bodyInterfaceVersion} · 契约 {Object.keys(genome.capabilityContracts).length} 项</>}
      recent={genome.events[0]?.title ?? (genome.generations[0] ? `${genome.generations[0].id} · ${genome.generations[0].state}` : '尚无代际记录。')}
      next={waiting.length ? `${waiting.filter(p => p.state === 'PROPOSED').length} 个方向待决定 · ${waiting.filter(p => p.state === 'CANDIDATE_READY').length} 个候选待可信审批` : '当前没有等待遗传的变化。'} />
    <details className="life-detail"><summary>查看遗传规则、Gene Proposal 与历史</summary>
      <dl><dt>Current Generation</dt><dd>{currentGeneration}</dd><dt>Manifest Generation</dt><dd>{genome.generation}</dd>
        <dt>Body Interface</dt><dd>v{genome.bodyInterfaceVersion}</dd></dl>
      <details><summary>Gene Hash · {genome.geneHash.slice(0, 12)}…（展开完整值）</summary><code className="life-hash">{genome.geneHash}</code></details>
      <details><summary>受保护路径 {genome.protectedPaths.length} 项</summary><ul>{genome.protectedPaths.map(p => <li key={p}><code>{p}</code></li>)}</ul></details>
      <h3>Capability Contracts · 这一代遗传了什么</h3>
      {Object.entries(genome.capabilityContracts).map(([name, value]) => <div className="life-record" key={name}><strong>{name}</strong><Contract value={value} /></div>)}
      <h3>Gene Proposal</h3>{!genome.proposals.length && <p>当前没有等待遗传的变化。Dream 或 Body 越界需求可能产生新的 Gene Proposal。</p>}
      {genome.proposals.length > 0 && <p>优先展开待审批方向和就绪候选；批准方向后，准确候选 Hash 仍需可信维护通道批准。</p>}
      {genome.proposals.map(p => <details key={p.id} open={['PROPOSED', 'CANDIDATE_READY'].includes(p.state)}>
        <summary>{p.point} · {proposalStates[p.state] ?? p.state} <StateBadge state={p.state} /></summary>
        <p>原因：{p.reason}</p><p>效果：{p.effect}</p>
        <p>来源：{p.source_ref.startsWith('body-need:') ? 'Body Need → Gene Proposal' : p.source} · {p.generation_id} · {p.source_ref}</p>
        {p.candidate_hash && <p>Candidate Hash：<code className="life-hash">{p.candidate_hash}</code></p>}
        {p.target_generation_id && <p>目标代：{p.target_generation_id}</p>}
        {p.state === 'PROPOSED' && <div className="business-actions"><button disabled={busy} onClick={() => void act(() => businessApi(`evolution/proposals/${p.id}/decision`, { decision: 'APPROVED' }))}>批准方向</button>
          <button disabled={busy} onClick={() => void act(() => businessApi(`evolution/proposals/${p.id}/decision`, { decision: 'REJECTED' }))}>拒绝</button></div>}
      </details>)}
      <h3>基因事件 · 最近 20 条</h3><EventStream events={genome.events} empty="尚无基因提案形成记录；代际身份见 Gene History。" />
      <h3>Gene History · 最近六代</h3>{genome.generations.slice(0, 6).map(g => <details key={g.id}>
        <summary>{g.id} · {g.state}</summary><dl><dt>Parent</dt><dd>{g.parent_id ?? '初始代'}</dd><dt>Gene Hash</dt><dd><code className="life-hash">{g.gene_hash}</code></dd>
          <dt>Release ID</dt><dd>{g.release_id}</dd><dt>出生时间</dt><dd>{lifeTime(g.born_at)}</dd><dt>退休时间</dt><dd>{lifeTime(g.retired_at)}</dd>
          <dt>Failure Reason</dt><dd>{g.failure_reason ?? '无记录'}</dd></dl>
      </details>)}
    </details>
  </section>;
}
