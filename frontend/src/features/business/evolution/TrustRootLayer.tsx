import { EventStream } from './EventStream';
import { LayerHeader, LayerSummary, StateBadge } from './LayerHeader';
import type { LifeOverview } from './life_types';

export function TrustRootLayer({ trust }: { trust: LifeOverview['trust'] }) {
  return <section className="life-layer life-root" aria-label="L1 信任根" data-layer="ROOT">
    <LayerHeader number={1} code="ROOT OF TRUST" title="信任根" state={trust.state}
      description="最终裁决与恢复边界，身体和基因不能自行绕过。" />
    <LayerSummary current={<>Recovery <StateBadge state={trust.recovery.state} /><br />控制通道 <StateBadge state={trust.control} /></>}
      recent={trust.evidence[0] ? <>{trust.evidence[0].title} · {trust.evidence[0].state}</> : 'Lineage 尚无可信裁决记录。'}
      next="独立部署尚未验收；最终候选批准需要可信维护通道。" />
    <details className="life-detail"><summary>查看信任边界与最近裁决</summary>
      <dl><dt>Recovery Service</dt><dd><StateBadge state={trust.recovery.state} /></dd>
        <dt>Trusted Supervisor</dt><dd><StateBadge state={trust.supervisor} /></dd>
        <dt>Owner Exact Approval</dt><dd><StateBadge state={trust.ownerExactApproval} /> · 准确 Hash 审批留在可信维护通道</dd>
        <dt>Active Generation Pointer</dt><dd>{trust.activeGeneration ?? '无 ACTIVE 记录'} · Lineage 投影</dd>
        <dt>Release Recovery</dt><dd><StateBadge state={trust.releaseRecovery} /></dd>
        <dt>Runtime Mode</dt><dd>{trust.runtime}</dd></dl>
      <p>独立可信控制通道尚未接入当前页面。这里显示 Lineage Evidence 和无认证健康探测结果；独立部署与恢复能力尚未完成验收。</p>
      <h3>最近可信结果 · Lineage Evidence</h3>
      <EventStream events={trust.evidence} empty="尚无可投影的可信裁决。" />
    </details>
  </section>;
}
