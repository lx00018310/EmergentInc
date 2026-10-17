import type { CompanyTaskNodeView, OwnerGoal, OwnerOverview, OwnerWorkTask } from '../../../packages/protocol/src/types/owner';
export const flowGoal = (id = 'goal-a', extra: Partial<OwnerGoal> = {}): OwnerGoal => ({ id, revision: 1, specificationRevision: 1,
  title: 'Digital guide', objective: 'Create a sellable guide', acceptance: { kind: 'artifact', filename: 'guide.md', minBytes: 10 },
  maxTokens: 0, status: 'READY', nextAction: '', reason: null, verifiedCount: 0, evidenceCount: 0, spentTokens: 0, reservedTokens: 0,
  createdAt: 1, updatedAt: 2, lastScheduledAt: 0, ...extra });
export const flowNode = (key = 'research', extra: Partial<CompanyTaskNodeView> = {}): CompanyTaskNodeView => ({ key,
  title: key === 'research' ? 'Research demand' : key === 'guide' ? 'Write the guide' : 'Publish product', instruction: 'Produce an evidence file',
  dependsOn: [], trigger: { kind: 'once' }, filename: key + '.md', state: 'WAITING', nextAt: 1000,
  latestEvidence: [], occurrences: 0, ...extra });
export const flowWork = (extra: Partial<OwnerWorkTask> = {}): OwnerWorkTask => ({ id: 'work-a', goalId: 'goal-a', goalRevision: 1,
  planRevision: 1, nodeKey: 'research', occurrenceId: 'occ-a', occurrenceState: 'RUNNING', dispatchState: 'RUNNING', scheduledAt: 10,
  personId: 'alice', personName: 'Alice', instruction: 'Research demand', state: 'RUNNING', turnId: null, runId: 'run-a',
  reply: null, reason: null, createdAt: 10, updatedAt: 20, ...extra });
export function flowOverview(extra: Partial<OwnerOverview> = {}): OwnerOverview {
  return { asOf: 100, summary: { qianjiCount: 2, activeWorlds: 2, runningWorlds: 1, inboxCount: 0, currentGeneration: null },
    goals: [flowGoal()], taskPlans: [{ goalId: 'goal-a', goalRevision: 1, planRevision: 1, approved: true, summary: 'Create a digital guide',
      nodes: [flowNode('research', { state: 'RUNNING', personId: 'alice' }), flowNode('guide', { dependsOn: ['research'], personId: 'bob' })] }],
    people: [{ id: 'alice', name: 'Alice', role: 'Researcher', behaviorProfile: ['Evidence first'], worldId: 'world-a', running: true, runId: 'run-a', status: 'ACTIVE', runStatus: 'RUNNING' },
      { id: 'bob', name: 'Bob', role: 'Editor', behaviorProfile: ['Clear writing'], worldId: 'world-b', running: false, runId: null, status: 'ACTIVE', runStatus: 'STOPPED' }],
    work: { tasks: [flowWork()], requests: [], codeReports: [] }, inbox: [], alerts: [], proposals: [], activity: [],
    budget: { currency: 'CNY', totalMicros: 100000000, spentMicros: 1500000, reservedMicros: 500000, availableMicros: 98000000, activatedAt: 1, unknownCalls: 0, revision: 1 },
    revenue: [{ asset: 'USDT', amount: '19.9', at: 20 }], storefront: { products: [{ id: 'guide', nameEn: 'Digital guide', nameZh: '数字指南', enabled: true, price: '19.9', currency: 'USDT' }],
      orders: [{ id: 'paid', product: 'guide', amount: '19.9', currency: 'USDT', status: 'PAID', at: 20 }] },
    automation: { desiredMode: 'ON', observedState: 'RUNNING', revision: 1, runMode: 'CONTINUOUS', requestedRounds: null, startedRounds: 1,
      completedRounds: 0, reservedRounds: 0, maxTokens: 0, spentTokens: 0, reservedTokens: 0, knownCostCny: 1.5, unknownCostCalls: 0,
      batchId: 'preview', updatedAt: 20, reason: null, inFlight: 1 },
    availability: { business: true, upgrade: 'not_configured' }, ...extra };
}
