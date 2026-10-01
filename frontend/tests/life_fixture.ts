import type { LifeOverview } from '../src/features/business/evolution/life_types';

export function lifeFixture(): LifeOverview {
  return {
    trust: { state: 'DEV_LOCAL', recovery: { state: 'NOT_CONFIGURED' }, control: 'NOT_CONNECTED', runtime: 'LOCAL_OWNER_MAINTENANCE',
      supervisor: 'NOT_CONNECTED', ownerExactApproval: 'REQUIRES_REVIEW', releaseRecovery: 'REQUIRES_REVIEW', activeGeneration: 'G0002', evidence: [] },
    genome: { generation: 2, geneHash: 'a'.repeat(64), bodyInterfaceVersion: '7', protectedPaths: ['api-protected/**'],
      capabilityContracts: { 'body_skill@7': { input: 'JSON', output: 'JSON', network: false }, business: ['fixture_report@7'] }, events: [],
      proposals: [{ id: 'proposal1', generation_id: 'G0002', source: 'dream', source_ref: 'body-need:G0002:need1',
        state: 'PROPOSED', point: '接口变化', reason: '确有缺失', effect: '下一代', candidate_hash: null, target_generation_id: null }],
      generations: [{ id: 'G0002', generation_no: 2, state: 'ACTIVE', parent_id: 'G0001', gene_hash: 'a'.repeat(64), release_id: 'r2', born_at: 1000, retired_at: null, failure_reason: null },
        { id: 'G0001', generation_no: 1, state: 'RETIRED', parent_id: null, gene_hash: 'b'.repeat(64), release_id: 'r1', born_at: 0, retired_at: 1000, failure_reason: null }] },
    evolution: { dream: { busy: false, failure: null, time: '04:30', timezone: 'Asia/Shanghai', hasNewFacts: true, pendingFactCount: 3 },
      dreamRuns: [], proposals: [], generations: [], evolutionEvents: [],
      memories: [{ id: 'm1', point: 'G1 经验', reason: '真实回执', effect: '继续复用', source: 'gate', kind: 'owner_correction', generation_id: 'G0001' }] },
    body: { current: { generation_id: 'G0002', body_revision: 3, gene_hash: 'a'.repeat(64), body_interface_version: '7' }, database: 'READY',
      skills: [{ skill_id: 'summary', name: '汇总', state: 'ACTIVE', body_revision: 3, successful_runs: 18, failed_runs: 1 }],
      needs: [{ id: 'need1', pixel_id: 'pixel1', need: '需要联网', evidence: '真实边界', state: 'GENE_PROPOSED' }], bodyCandidates: [],
      currentEvents: [{ id: 'event1', time: 2000, layer: 'BODY', type: 'body_rolled_back', title: '身体能力回退',
        detail: 'R4 ROLLED_BACK → R3 ACTIVE', state: 'RECORDED', generation: 'G0002' }],
      businessSummary: { activePlans: 2, runningTasks: 1, waitingResources: 1, datasets: 4, connections: 1, recentResults: [] } },
  };
}
export const businessFixture = { settings: { limit_micros: 1000000 }, modelConfigured: false, plans: [], datasets: [], requests: [],
  unknownOperations: [], tasks: [], spentMicros: 0, reservedMicros: 0, orders: [], receipts: [] };
