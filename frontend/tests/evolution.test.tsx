import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EvolutionPanel } from '../src/features/business/EvolutionPanel';
import { OwnerEntry } from '../src/OwnerEntry';
import { lifeFixture, businessFixture } from './life_fixture';
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });
it('shows life facts and submits only a Proposal direction decision', async () => {
  const payload = lifeFixture();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response);
  render(<EvolutionPanel />); await screen.findByRole('heading', { name: '当前生命：G0002' }); expect(screen.getByText('G1 经验')).toBeTruthy();
  fireEvent.click(screen.getByText('查看遗传规则、Gene Proposal 与历史'));
  expect(screen.getByText('G0001 · RETIRED')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '批准方向' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/evolution/proposals/proposal1/decision', expect.objectContaining({ body: JSON.stringify({ decision: 'APPROVED' }) })));
  expect(screen.queryByRole('button', { name: /出生|Release|Hash/ })).toBeNull();
});

it('lands at the four layers after GENE login and retains the business tabs', async () => {
  window.history.replaceState(null, '', '/GENE');
  const life = lifeFixture();
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => ({ ok: true, json: async () =>
    String(url).endsWith('/session') ? { authenticated: false, mode: 'business' } : String(url).endsWith('/login') ? { authenticated: true, mode: 'business' }
      : String(url).includes('/evolution/') ? life : businessFixture } as Response));
  const { container } = render(<OwnerEntry />);
  await screen.findByRole('button', { name: '登录' });
  fireEvent.change(screen.getByLabelText('Owner 口令'), { target: { value: 'owner-test' } });
  fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!);
  await screen.findByRole('heading', { name: '当前生命：G0002' });
  expect(Array.from(container.querySelectorAll('[data-layer]')).map(el => el.getAttribute('data-layer'))).toEqual(['ROOT', 'GENOME', 'EVOLUTION', 'BODY']);
  expect(screen.getByRole('button', { name: '生命总览' }).getAttribute('aria-current')).toBe('page');
  expect(screen.queryByText('已确认费用')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '经营', exact: true }));
  expect(await screen.findByText('已确认费用')).toBeTruthy(); expect(screen.getByLabelText('业务方向')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '方案', exact: true })); expect(screen.getByText(/先在经营页输入方向/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '连接与资料', exact: true })); expect(screen.getByRole('heading', { name: '连接 GitHub 仓库' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '生命总览' }));
  await screen.findByRole('heading', { name: '当前生命：G0002' });
  expect(window.location.pathname).toBe('/GENE');
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
});

it('shows API genome values and never upgrades an unconfigured trust root to READY', async () => {
  const payload = lifeFixture();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response);
  render(<EvolutionPanel />); await screen.findByRole('heading', { name: '当前生命：G0002' });
  const root = within(screen.getByRole('region', { name: 'L1 信任根' }));
  expect(root.getAllByText('NOT_CONFIGURED').length).toBeGreaterThan(0);
  expect(root.queryByText('READY')).toBeNull(); expect(root.queryByRole('button')).toBeNull();
  const genome = within(screen.getByRole('region', { name: 'L2 基因层' }));
  expect(genome.getByText('api-protected/**')).toBeTruthy(); expect(genome.getByText('fixture_report@7')).toBeTruthy();
  expect(genome.getAllByText('a'.repeat(64)).length).toBeGreaterThan(0); expect(genome.getByText('v7')).toBeTruthy();
  expect(genome.getByText('禁止')).toBeTruthy();
});

it('marks failed and unknown Dream outcomes and restores only an available saved response', async () => {
  const payload = lifeFixture();
  payload.evolution.dreamRuns = [
    { id: 'unknown1', generation_id: 'G0001', status: 'OUTCOME_UNKNOWN', trigger: 'manual', error: '结果待核实', created_at: 1000,
      finished_at: null, retry_available: 1, fact_count: 1, memory_count: 0, proposal_count: 0 },
    { id: 'failed1', generation_id: 'G0002', status: 'FAILED', trigger: 'manual', error: '未保存响应', created_at: 500,
      finished_at: null, retry_available: 0, fact_count: 1, memory_count: 0, proposal_count: 0 },
  ];
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response);
  render(<EvolutionPanel />); await screen.findByRole('heading', { name: '进化层' });
  fireEvent.click(screen.getByText('查看进化流水线、Dream、Memory 与事件'));
  const evolution = within(screen.getByRole('region', { name: 'L3 进化层' }));
  expect(evolution.getAllByText('OUTCOME_UNKNOWN').every(el => el.classList.contains('life-state-error'))).toBe(true);
  expect(evolution.getByText('FAILED').classList.contains('life-state-error')).toBe(true);
  expect(evolution.getAllByRole('button', { name: '恢复已保存的响应' })).toHaveLength(1);
  fireEvent.click(evolution.getByRole('button', { name: '恢复已保存的响应' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/evolution/dream/unknown1/retry', expect.objectContaining({ method: 'POST' })));
});

it('shows Body revision, skills, needs and rollback facts and navigates to the existing workbench', async () => {
  const payload = lifeFixture(), navigate = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response);
  render(<EvolutionPanel onNavigate={navigate} />); await screen.findByRole('heading', { name: '身体层' });
  fireEvent.click(screen.getByText('查看能力、需求、身体候选与当前工作'));
  const body = within(screen.getByRole('region', { name: 'L4 身体层' }));
  expect(body.getByRole('heading', { name: '当前身体 · Body Revision R3' })).toBeTruthy();
  expect(body.getByText('summary · 汇总')).toBeTruthy(); expect(body.getByText('需要联网')).toBeTruthy();
  expect(body.getByText('R4 ROLLED_BACK → R3 ACTIVE')).toBeTruthy();
  expect(body.getByText(/Body Need → Gene Proposal/)).toBeTruthy();
  fireEvent.click(body.getByRole('button', { name: '进入经营' })); expect(navigate).toHaveBeenCalledWith('business');
  fireEvent.click(body.getByRole('button', { name: '查看方案' })); expect(navigate).toHaveBeenCalledWith('plans');
  fireEvent.click(body.getByRole('button', { name: '连接与资料' })); expect(navigate).toHaveBeenCalledWith('resources');
});
