import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EvolutionPanel } from '../src/features/business/EvolutionPanel';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('shows life facts and submits only a Proposal direction decision', async () => {
  const payload = { current: { generation_id: 'G0002', body_revision: 1 }, skills: [{ skill_id: 'summary', name: '汇总', state: 'ACTIVE', successful_runs: 2, failed_runs: 0 }],
    memories: [{ id: 'm1', point: 'G1 经验', reason: '真实回执', effect: '继续复用' }],
    proposals: [{ id: 'proposal1', state: 'PROPOSED', point: '接口变化', reason: '确有缺失', effect: '下一代' }],
    generations: [{ id: 'G0002', state: 'ACTIVE' }, { id: 'G0001', state: 'RETIRED' }], dream: {} };
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => payload } as Response);
  render(<EvolutionPanel />); await screen.findByText('G0002'); expect(screen.getByText('G1 经验')).toBeTruthy();
  expect(screen.getByText(/G0001 · RETIRED/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: '批准方向' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/evolution/proposals/proposal1/decision', expect.objectContaining({ body: JSON.stringify({ decision: 'APPROVED' }) })));
  expect(screen.queryByRole('button', { name: /出生|Release|Hash/ })).toBeNull();
});
