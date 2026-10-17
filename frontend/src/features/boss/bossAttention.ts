import type { BossOverview, CompanyProposal, OwnerInboxItem, OwnerAlert } from '../../../../packages/protocol/src/types/owner';

export type BossMetricId = 'revenue' | 'goals' | 'budget' | 'products' | 'orders' | 'cost' | 'affected' | 'decisions';
export interface BossMetric { id: BossMetricId; value: string; unit?: 'USDT' | 'CNY'; reason: string; references: string[] }
export interface BossMessage {
  id: string; entityId: string; priority: 'critical' | 'decision' | 'milestone'; at: number; title: string; reason?: string;
  proposals?: CompanyProposal[]; inbox?: OwnerInboxItem; alert?: OwnerAlert; action?: 'budget' | 'payment' | 'model'; reference?: string;
}
export interface BossAttentionSnapshot {
  instanceId: string; view: 'startup' | 'normal' | 'growth' | 'critical'; selectedAt: number;
  metrics: [BossMetric, BossMetric, BossMetric]; messages: BossMessage[]; overflow: BossMessage[]; overflowCount: number; reasonCodes: string[];
}
export function sumUsdt(rows: BossOverview['revenue']): string {
  let atomic = 0n;
  for (const row of rows.filter(r => r.asset === 'USDT')) {
    if (!/^\d+(?:\.\d{1,18})?$/.test(row.amount)) return '—';
    const [whole, fraction = ''] = row.amount.split('.'); atomic += BigInt(whole!) * 1000000000000000000n + BigInt(fraction.padEnd(18, '0'));
  }
  return (atomic / 1000000000000000000n).toString() + (atomic % 1000000000000000000n ? '.' + (atomic % 1000000000000000000n).toString().padStart(18, '0').replace(/0+$/, '') : '');
}
const rank = { critical: 0, decision: 1, milestone: 2 };
/** Pure facts-to-attention projection. Refreshes cannot manufacture progress or dismiss decisions. */
export function projectBossAttention(data: BossOverview, previous?: BossAttentionSnapshot): BossAttentionSnapshot {
  const candidates: BossMessage[] = [];
  for (const alert of data.alerts ?? []) candidates.push({ id: alert.id, entityId: alert.id.replace(/^product-intent:/, 'goal:'), priority: alert.severity === 'critical' ? 'critical' : 'decision', at: alert.createdAt ?? 0, title: alert.title, reason: alert.reasonKey, alert });
  for (const proposal of data.proposals?.filter(p => p.state === 'PENDING' && p.kind !== 'budget') ?? []) candidates.push({ id: proposal.id, entityId: proposal.goalId ? `goal:${proposal.goalId}` : `proposal:${proposal.id}`, priority: 'decision', at: proposal.createdAt, title: proposal.kind === 'task_plan' ? 'Task plan proposal' : 'Close task proposal', proposals: [proposal] });
  for (const inbox of data.inbox.filter(item => item.actions?.some(a => a.requiresApproval))) candidates.push({ id: inbox.id, entityId: inbox.id, priority: inbox.priority === 'critical' ? 'critical' : 'decision', at: inbox.createdAt ?? 0, title: inbox.title, inbox });
  if (data.budget?.activatedAt === null || data.budget?.needsRefill || data.budget?.availableMicros === 0) candidates.push({ id: 'budget:configure', entityId: 'budget', priority: 'decision', at: data.budget?.activatedAt ?? 0, title: 'Company money budget', action: 'budget', reason: data.budget?.activatedAt === null ? 'OWNER_COMPANY_BUDGET_REQUIRED' : 'OWNER_COMPANY_BUDGET_EXHAUSTED' });
  if (!data.paymentConfigured) candidates.push({ id: 'payment:configure', entityId: 'payment', priority: 'decision', at: 0, title: 'Configure receive-only payments', action: 'payment' });
  if (!data.modelConfigured) candidates.push({ id: 'model:configure', entityId: 'model', priority: 'decision', at: 0, title: 'Configure a model', action: 'model' });
  const pending = new Set(candidates.map(m => m.entityId));
  for (const event of data.events.filter(e => data.asOf - e.at < 24 * 60 * 60 * 1000)) if (!pending.has(event.reference)) candidates.push({ id: event.id, entityId: event.reference, priority: 'milestone', at: event.at, title: event.kind === 'payment' ? 'Verified payment received' : event.kind === 'product' ? 'Verified product published' : 'Verified goal completed', reference: event.reference });
  candidates.sort((a, b) => rank[a.priority] - rank[b.priority] || (a.proposals ? -1 : 0) - (b.proposals ? -1 : 0) || a.at - b.at || a.id.localeCompare(b.id));
  const entities = new Map<string, BossMessage>();
  for (const candidate of candidates) {
    const current = entities.get(candidate.entityId);
    if (!current) entities.set(candidate.entityId, { ...candidate });
    else if (candidate.proposals) current.proposals = [...new Map([...(current.proposals ?? []), ...candidate.proposals].map(p => [p.id, p])).values()];
  }
  const messages = [...entities.values()];
  const critical = messages.some(m => m.priority === 'critical');
  const paidOrders = data.storefront?.orders.filter(o => ['PAID', 'DELIVERED', 'FULFILLED'].includes(o.status)) ?? [];
  const products = data.storefront?.products.filter(p => p.enabled) ?? [];
  const revenue = sumUsdt(data.revenue), activeGoals = data.goals?.filter(g => !['STOPPED', 'ARCHIVED', 'COMPLETED'].includes(g.status));
  const requested = critical ? 'critical' : data.paidOrderCount > 0 ? 'growth' : products.length || revenue !== '0' && revenue !== '—' ? 'normal' : 'startup';
  const keep = previous && previous.instanceId === data.instanceId && !critical && previous.view !== 'critical' && data.asOf >= previous.selectedAt && data.asOf - previous.selectedAt < 60000;
  const view = keep && previous ? previous.view : requested;
  const budget = data.budget;
  const definitions: Record<BossMetricId, BossMetric> = {
    revenue: { id: 'revenue', value: revenue, unit: 'USDT', reason: 'Verified receipts only', references: data.revenue.map(r => r.id) },
    goals: { id: 'goals', value: activeGoals ? String(activeGoals.length) : '—', reason: 'Persisted active goals', references: activeGoals?.map(g => g.id) ?? [] },
    budget: { id: 'budget', value: budget?.activatedAt === null ? 'Unauthorized' : budget && Number.isSafeInteger(budget.availableMicros) ? (budget.availableMicros / 1000000).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—', unit: 'CNY', reason: 'Shared company money budget', references: budget ? [`budget:${budget.revision}`] : [] },
    products: { id: 'products', value: data.storefront ? String(products.length) : '—', reason: 'Verified published products', references: products.map(p => p.id) },
    orders: { id: 'orders', value: Number.isSafeInteger(data.paidOrderCount) && data.paidOrderCount >= 0 ? String(data.paidOrderCount) : '—', reason: 'Confirmed paid orders', references: ['orders:PAID', ...paidOrders.map(o => o.id)] },
    cost: { id: 'cost', value: budget && Number.isSafeInteger(budget.spentMicros) ? String(budget.spentMicros / 1000000) : '—', unit: 'CNY', reason: 'Settled model costs only', references: data.costs?.map(c => c.day) ?? [] },
    affected: { id: 'affected', value: String(new Set([...(data.goals?.filter(g => ['BLOCKED', 'FAILED'].includes(g.status)).map(g=>g.id)??[]),...(data.alerts??[]).filter(a=>a.severity==='critical'&&a.goalId).map(a=>a.goalId!)]).size), reason: 'Critical incident view', references: messages.filter(m => m.priority === 'critical').map(m => m.id) },
    decisions: { id: 'decisions', value: String(messages.filter(m => m.priority !== 'milestone').length), reason: 'Unresolved decisions and blockers', references: messages.filter(m => m.priority !== 'milestone').map(m => m.id) },
  };
  const ids: [BossMetricId, BossMetricId, BossMetricId] = view === 'critical' ? ['affected', 'budget', 'decisions'] : view === 'growth' ? ['revenue', 'orders', 'cost'] : view === 'normal' ? ['revenue', 'goals', 'budget'] : ['products', 'budget', 'goals'];
  return { instanceId: data.instanceId, view, selectedAt: previous && previous.instanceId === data.instanceId && previous.view === view ? previous.selectedAt : data.asOf, metrics: ids.map(id => definitions[id]) as BossAttentionSnapshot['metrics'], messages: messages.slice(0, 3), overflow: messages.slice(3), overflowCount: messages.length - Math.min(3, messages.length), reasonCodes: [view, ...(critical ? ['CRITICAL_IMMEDIATE'] : [])] };
}
