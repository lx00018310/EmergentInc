import { describe, expect, it } from 'vitest';
import { attentionPriority, projectBossAttention, sumUsdt, type BossMessage } from '../src/features/boss/bossAttention';
import type { BossOverview } from '../../packages/protocol/src/types/owner';
import { bossFixture, planProposal } from './fixtures/boss';

const msg = (over: Partial<BossMessage>): BossMessage => ({ id: 'm', entityId: 'm', priority: 'decision', at: 0, title: 'T', ...over });

describe('V35 attention priority scoring (spec §4)', () => {
  it('scores a paid-order blocker without a deadline at 25+15+0+3+3=46; U=20 requires a real deadline this projection has none of', () => {
    const waited = 18 * 60 * 60 * 1000;
    const score = attentionPriority({ priority: 'critical', at: waited, alert: { id: 'product-intent:g1', goalId: 'g1', kind: 'product', severity: 'critical', title: 'Product publication needs attention', summary: '', reasonKey: 'OWNER_PUBLICATION_OUTCOME_UNKNOWN', createdAt: waited, source: 'owner_product_intents', href: '/BOSS' } }, waited + 18 * 60 * 60 * 1000);
    expect(score.score).toBe(25 + 15 + 3 + 3);
  });
  it('scores a company-wide budget blocker at 35+15 with no urgency when time is unknown', () => {
    const { score, unknownTime } = attentionPriority({ priority: 'critical', alert: { id: 'a', kind: 'automation', severity: 'critical', title: 'Company automation needs review', summary: '', reasonKey: 'OWNER_COMPANY_BUDGET_EXHAUSTED', createdAt: null, source: 'company_admission_blocks', href: '/BOSS' } }, 1000);
    expect(score).toBe(35 + 15); expect(unknownTime).toBe(true);
  });
  it('scores a single-goal unknown charge at B25 R8 I3 and W from the real first-attention time (documented 38)', () => {
    const now = 24 * 60 * 60 * 1000;
    const score = attentionPriority({ priority: 'critical', at: 0, alert: { id: 'goal:g1', goalId: 'g1', kind: 'run', severity: 'critical', title: 'Worker recovery needs verification', summary: '', reasonKey: 'CALL_OUTCOME_UNKNOWN', createdAt: 0, source: 'company execution', href: '/BOSS' } }, now);
    // createdAt=0 stays unknown for U/W; the goal impact still counts. 25+8+3=36.
    expect(score.score).toBe(25 + 8 + 3);
    // The same incident with a real first-needs-attention time reaches the documented 38.
    const withTime = attentionPriority({ priority: 'critical', at: now - 12 * 60 * 60 * 1000, alert: { id: 'goal:g1', goalId: 'g1', kind: 'run', severity: 'critical', title: 'Worker recovery needs verification', summary: '', reasonKey: 'CALL_OUTCOME_UNKNOWN', createdAt: now - 12 * 60 * 60 * 1000, source: 'company execution', href: '/BOSS' } }, now);
    expect(withTime.score).toBe(25 + 8 + 3 + 2);
  });
  it('scores a fresh single-goal plan approval at 15+3=18 and configuration at 15 with zero wait', () => {
    const now = 1000 + 60 * 60 * 1000;
    const plan = attentionPriority({ priority: 'decision', at: 1000, proposals: [{ id: 'p', kind: 'task_plan', goalId: 'g1', goalRevision: 1, hash: 'h', payload: {}, state: 'PENDING', createdAt: 1000, result: null }] }, now);
    expect(plan.score).toBe(15 + 3);
    const payment = attentionPriority({ priority: 'decision', action: 'payment' }, 1000);
    expect(payment.score).toBe(15);
  });
  it('never interprets a missing time as 1970 and caps the wait factor at 5', () => {
    const unknown = attentionPriority({ priority: 'decision', action: 'payment' }, 1000);
    expect(unknown.unknownTime).toBe(true); expect(unknown.score).toBe(15);
    const waited = attentionPriority({ priority: 'critical', at: 200 * 60 * 60 * 1000, alert: { id: 'g', goalId: 'g1', kind: 'run', severity: 'critical', title: 'T', summary: '', reasonKey: 'CALL_OUTCOME_UNKNOWN', createdAt: 200 * 60 * 60 * 1000, source: 'x', href: '/BOSS' } }, 400 * 60 * 60 * 1000);
    expect(waited.score).toBe(25 + 8 + 3 + 5);
  });
});

describe('V35 stable refresh and reordering', () => {
  it('keeps ranking stable across five-second fact refreshes when nothing changed', () => {
    const base = bossFixture({ proposals: [planProposal('p1', 'g1'), planProposal('p2', 'g2'), planProposal('p3', 'g3'), planProposal('p4', 'g4')] });
    const first = projectBossAttention(base);
    const refreshed = projectBossAttention({ ...base, asOf: base.asOf + 5000 }, first);
    expect(refreshed.messages.map(m => m.id)).toEqual(first.messages.map(m => m.id));
  });
  it('keeps at most three cards, keeps the rest queryable, and refills after a resolution', () => {
    const base = bossFixture({ proposals: [planProposal('p1', 'g1'), planProposal('p2', 'g2'), planProposal('p3', 'g3'), planProposal('p4', 'g4')] });
    const first = projectBossAttention(base);
    expect(first.messages).toHaveLength(3); expect(first.overflowCount).toBe(1);
    const resolved = projectBossAttention({ ...base, proposals: base.proposals!.filter(p => p.id !== 'p1') }, first);
    expect(resolved.messages).toHaveLength(3);
    expect(resolved.messages.some(m => m.id === 'p1')).toBe(false);
    expect(resolved.messages.some(m => m.id === 'p4')).toBe(true);
  });
  it('keeps two proposals of one goal as separate decisions and merges one incident to one seat', () => {
    const base = bossFixture({ proposals: [planProposal('pa', 'g1'), planProposal('pb', 'g1')], alerts: [{ id: 'goal:g1', goalId: 'g1', kind: 'run', severity: 'critical', title: 'Needs attention', summary: '', reasonKey: 'CALL_OUTCOME_UNKNOWN', createdAt: 1, source: 'x', href: '/BOSS' }] });
    const projection = projectBossAttention(base);
    const goalCards = projection.messages.filter(m => m.proposals?.length);
    expect(goalCards.flatMap(m => m.proposals!.map(p => p.id)).sort()).toEqual(['pa', 'pb']);
    const incident = projection.messages.find(m => m.alert?.id === 'goal:g1');
    expect(incident).toBeTruthy();
    expect(projection.messages.filter(m => m.entityId === 'goal:g1')).toHaveLength(1);
  });
  it('drops completed milestones from the three seats while keeping the revenue sum exact', () => {
    expect(sumUsdt([{ id: 'r', asset: 'USDT', amount: '1.5', at: 1 }])).toBe('1.5');
    const base = bossFixture({ events: [{ id: 'e1', kind: 'payment', title: 'Verified payment received', at: 1000, reference: 'goal:none' }] });
    const projection = projectBossAttention(base);
    expect(projection.messages.some(m => m.id === 'e1')).toBe(true); // milestone candidates still render when seats are free
    const busy = projectBossAttention({ ...base, proposals: [planProposal('p1', 'g1'), planProposal('p2', 'g2'), planProposal('p3', 'g3')] });
    expect(busy.messages.some(m => m.id === 'e1')).toBe(false); // decisions outrank milestones for the three seats
  });
});
