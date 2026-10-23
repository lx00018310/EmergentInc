import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { BossCompany } from '../src/features/boss/BossCompany';
import { setLanguage } from '../src/i18n';
import { flowGoal, flowNode, flowOverview, flowWork } from './fixtures/owner_flow';
import type { CompanyTaskNodeView, OwnerOverview } from '../../packages/protocol/src/types/owner';

const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
beforeEach(() => setLanguage('en'));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockCompany(data: OwnerOverview, nodeFacts?: CompanyTaskNodeView) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const path = String(url);
    if (path.includes('/plugins/cards')) return response({ items: [] });
    if (path.endsWith('/boss/company')) return response(data);
    if (path.endsWith('/actions')) {
      const node = nodeFacts?.key === path.split('/').at(-2) ? nodeFacts : data.taskPlans?.[0]?.nodes.find(n => path.includes('/' + n.key + '/'));
      return response({ expectedRevision: 1, planRevision: 1, hash: 'exact-facts', node, actions: [], gaps: [], scope: null });
    }
    return response({ goal: data.goals![0], evidence: [], events: [], dispatches: [] });
  });
}

async function openGoal(language: 'en' | 'zh-CN' = 'en') {
  const topic = await screen.findByText(language === 'en' ? 'Business goal' : '经营目标');
  fireEvent.click(within(topic.closest('article')!).getByRole('button'));
  return screen.findByRole('region', { name: language === 'en' ? 'Overall progress' : '总体进展' });
}

it.each(['en', 'zh-CN'] as const)('uses verified complete stages as the denominator and drills down into checks in %s', async language => {
  setLanguage(language);
  const partial = flowNode('partial', { title: 'Partial stage', state: 'PARTIAL',
    progressPolicy: { passPercent: 80, allowIncompleteFrom: [], requirements: [{ id: 'a', description: 'Source verified' }, { id: 'b', description: 'Delivery verified' }] },
    progress: { state: 'PARTIAL', checked: ['a', 'stale-check'], missing: ['b'], evidenceIds: ['real-evidence'], reason: null, scopeId: 'scope' } });
  const nodes = [flowNode('done', { state: 'COMPLETED', title: 'Finished stage' }), partial, flowNode('skip', { state: 'SKIPPED', title: 'Skipped stage' })];
  const data = flowOverview({ taskPlans: [{ goalId: 'goal-a', goalRevision: 1, planRevision: 1, approved: true, summary: 'Current plan', nodes }], work: { tasks: [flowWork({ nodeKey: 'partial', instruction: 'Specific assignment', reply: 'Actual reply' })], requests: [], codeReports: [] } });
  mockCompany(data, partial); render(<BossCompany onAction={() => {}} />);
  const overall = await openGoal(language);
  expect(within(overall).getByText('33%')).toBeTruthy();
  const total = within(overall).getByRole('progressbar');
  expect(total.getAttribute('value')).toBe('1'); expect(total.getAttribute('max')).toBe('3');
  for (const name of language === 'en' ? ['Overview', 'Main stages', 'Results and records'] : ['总览', '主要环节', '成果与记录']) expect(screen.getByRole('region', { name })).toBeTruthy();
  const stage = (await screen.findByText('Partial stage')).closest('details')!;
  expect(stage.open).toBe(false); fireEvent.click(stage.querySelector('summary')!);
  const checks = within(stage).getByRole('progressbar', { name: language === 'en' ? 'Acceptance checks passed' : '验收项通过率' });
  expect(checks.getAttribute('value')).toBe('1'); expect(checks.getAttribute('max')).toBe('2');
  expect(within(stage).getByText('50%')).toBeTruthy();
  expect(within(stage).getByText('Source verified').closest('li')?.getAttribute('data-checked')).toBe('true');
  expect(within(stage).getByText('Delivery verified').closest('li')?.getAttribute('data-checked')).toBe('false');
  const record = within(stage).getByText('Alice').closest('details')!;
  expect(record.open).toBe(false); fireEvent.click(record.querySelector('summary')!);
  expect(within(record).getByText('Specific assignment')).toBeTruthy(); expect(within(record).getByText('Actual reply')).toBeTruthy();
});

it.each(['missing', 'unapproved', 'stale'] as const)('does not manufacture a goal percentage when the plan is %s', async mode => {
  const data = flowOverview({ goals: [flowGoal('goal-a', { status: 'COMPLETED' })] });
  if (mode === 'missing') data.taskPlans = [];
  if (mode === 'unapproved') data.taskPlans![0]!.approved = false;
  if (mode === 'stale') data.taskPlans![0]!.goalRevision = 0;
  mockCompany(data); render(<BossCompany onAction={() => {}} />);
  const overall = await openGoal();
  expect(within(overall).queryByRole('progressbar')).toBeNull(); expect(within(overall).queryByText('100%')).toBeNull();
  expect(within(overall).getByText(mode === 'unapproved' ? 'This plan is awaiting approval. Progress is not calculated yet.' : 'No stage plan is available to calculate progress.')).toBeTruthy();
});

it('shows an unverified checklist without inventing a check completion percentage', async () => {
  const node = flowNode('research', { progressPolicy: { passPercent: 100, allowIncompleteFrom: [], requirements: [{ id: 'source', description: 'Verify source evidence' }] } });
  const data = flowOverview(); data.taskPlans![0]!.nodes = [node];
  mockCompany(data, node); render(<BossCompany onAction={() => {}} />); await openGoal();
  const stage = (await screen.findByText('Research demand', { selector: 'strong' })).closest('details')!;
  fireEvent.click(stage.querySelector('summary')!);
  expect(within(stage).queryByRole('progressbar')).toBeNull();
  expect(within(stage).getByText('Verify source evidence')).toBeTruthy();
  expect(within(stage).getAllByText('No acceptance result recorded yet.').length).toBeGreaterThan(0);
});

it('refreshes the plan when opening a goal instead of using the older card-wall snapshot', async () => {
  const original = flowOverview(), fresh = flowOverview();
  fresh.taskPlans![0]!.nodes[0]!.state = 'COMPLETED';
  let snapshots = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    const path = String(url);
    if (path.includes('/plugins/cards')) return response({ items: [] });
    if (path.endsWith('/boss/company')) return response(++snapshots === 1 ? original : fresh);
    if (path.endsWith('/actions')) return response({ node: fresh.taskPlans![0]!.nodes[0], actions: [], gaps: [] });
    return response({ goal: fresh.goals![0], evidence: [], events: [], dispatches: [] });
  });
  render(<BossCompany onAction={() => {}} />);
  const overall = await openGoal();
  expect(within(overall).getByText('50%')).toBeTruthy();
});
