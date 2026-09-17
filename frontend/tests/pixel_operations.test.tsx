import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { PixelOperations, knownNumber } from '../src/features/pixels/PixelOperations';
import * as api from '../src/api/pixels';

vi.mock('../src/api/pixels', () => ({
  fetchMandate: vi.fn(), updateMandate: vi.fn(), deleteMandate: vi.fn(),
  fetchExternalRewards: vi.fn(), postExternalReward: vi.fn(), fetchStepCosts: vi.fn(),
}));

const onRefresh = vi.fn().mockResolvedValue(undefined);
function mount(tab: 'mandate' | 'reward' | 'cost' = 'mandate') {
  return render(<PixelOperations pixelId="p1" initialTab={tab} onClose={vi.fn()} onRefresh={onRefresh} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.fetchMandate).mockResolvedValue({ pixel_id: 'p1', mandate: '独立职责' });
  vi.mocked(api.updateMandate).mockImplementation(async (_id, mandate) => ({ pixel_id: 'p1', mandate }));
  vi.mocked(api.deleteMandate).mockResolvedValue({ pixel_id: 'p1', status: 'DELETED' });
  vi.mocked(api.fetchExternalRewards).mockResolvedValue({ pixel_id: 'p1', rewards: [] });
  vi.mocked(api.postExternalReward).mockResolvedValue({ newBalance: 120 });
  vi.mocked(api.fetchStepCosts).mockResolvedValue({ pixel_id: 'p1', costs: [] });
});
afterEach(cleanup);

describe('V11 Pixel operations', () => {
  it('reads, saves and deletes only the selected pixel mandate', async () => {
    mount();
    await waitFor(() => expect((screen.getByLabelText('Human Mandate 内容') as HTMLTextAreaElement).value).toBe('独立职责'));
    fireEvent.change(screen.getByLabelText('Human Mandate 内容'), { target: { value: '新职责' } });
    fireEvent.click(screen.getByText('保存 Human Mandate'));
    await screen.findByText(/Human Mandate 已保存/);
    expect(api.updateMandate).toHaveBeenCalledWith('p1', '新职责');
    fireEvent.click(screen.getByText('删除 Human Mandate'));
    await screen.findByText(/Human Mandate 已删除/);
    expect(api.deleteMandate).toHaveBeenCalledWith('p1');
    expect(screen.getByText('当前状态：未设置')).toBeDefined();
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('keeps failed mandate drafts and exposes read errors without empty-state claims', async () => {
    mount();
    await waitFor(() => expect((screen.getByLabelText('Human Mandate 内容') as HTMLTextAreaElement).disabled).toBe(false));
    vi.mocked(api.updateMandate).mockRejectedValueOnce(new Error('save rejected'));
    fireEvent.change(screen.getByLabelText('Human Mandate 内容'), { target: { value: 'keep draft' } });
    fireEvent.click(screen.getByText('保存 Human Mandate'));
    expect((await screen.findByRole('alert')).textContent).toContain('save rejected');
    expect((screen.getByLabelText('Human Mandate 内容') as HTMLTextAreaElement).value).toBe('keep draft');
    vi.mocked(api.fetchMandate).mockRejectedValueOnce(new Error('read rejected'));
    fireEvent.click(screen.getByText('刷新（重新读取，覆盖草稿）'));
    await screen.findByText('read rejected');
    expect(screen.getByText('当前状态：未知')).toBeDefined();
  });

  it('validates rewards, prevents repeated in-flight submits and refreshes the ledger', async () => {
    let finish!: (value: { newBalance: number }) => void;
    vi.mocked(api.postExternalReward).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mount('reward');
    await screen.findByText('暂无奖励记录。');
    const button = screen.getByText('发放 External Reward') as HTMLButtonElement;
    for (const value of ['', '0', '-1', '1.5', '9007199254740992']) {
      fireEvent.change(screen.getByLabelText(/奖励金额/), { target: { value } });
      expect(button.disabled).toBe(true);
    }
    fireEvent.change(screen.getByLabelText(/奖励金额/), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('原因'), { target: { value: '有效成果' } });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.postExternalReward).toHaveBeenCalledTimes(1);
    expect(api.postExternalReward).toHaveBeenCalledWith('p1', { amount: 20, source: 'human', reason: '有效成果' });
    await act(async () => finish({ newBalance: 120 }));
    await screen.findByText('奖励已入账。新余额：120 Energy。');
    expect(api.fetchExternalRewards).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows reward errors with a warning against blind retry', async () => {
    vi.mocked(api.postExternalReward).mockRejectedValueOnce(new Error('connection severed'));
    mount('reward');
    await screen.findByText('暂无奖励记录。');
    fireEvent.change(screen.getByLabelText(/奖励金额/), { target: { value: '20' } });
    fireEvent.click(screen.getByText('发放 External Reward'));
    expect((await screen.findByRole('alert')).textContent).toContain('请先刷新奖励记录核对');
  });

  it('renders stored rewards with provenance', async () => {
    vi.mocked(api.fetchExternalRewards).mockResolvedValueOnce({ pixel_id: 'p1', rewards: [{ event_id: 'event-1', pixel_id: 'p1', round: 3, amount: 8, source: 'human', reason: 'accepted result', created_at: 1 }] });
    mount('reward');
    expect(await screen.findByText('event-1')).toBeDefined();
    expect(screen.getByText('accepted result')).toBeDefined();
    expect(screen.getByText('+8')).toBeDefined();
  });

  it('shows nullable step costs as unknown and preserves real zeros with trace ids', async () => {
    vi.mocked(api.fetchStepCosts).mockResolvedValueOnce({ pixel_id: 'p1', costs: [{ pixelId: 'p1', round: 4, inputTokens: null, cachedInputTokens: 0, outputTokens: null, modelCost: null, toolCost: 0, callId: 'call-1', outcome: 'UNKNOWN', runId: 'run-1' }] });
    mount('cost');
    expect(await screen.findByText('¥0.000000')).toBeDefined();
    expect(screen.getAllByText('未知').length).toBe(4);
    expect(screen.getByText('0')).toBeDefined();
    expect(screen.getByText(/call-1/)).toBeDefined();
    expect(knownNumber(undefined, true)).toBe('未知');
    expect(knownNumber(Number.NaN)).toBe('未知');
  });

  it('does not render zero-cost or empty ledger claims after a failed cost fetch', async () => {
    vi.mocked(api.fetchStepCosts).mockRejectedValueOnce(new Error('cost unavailable'));
    mount('cost');
    expect((await screen.findByRole('alert')).textContent).toBe('cost unavailable');
    expect(screen.queryByText(/暂无 Step Cost/)).toBeNull();
    expect(screen.queryByText('¥0.000000')).toBeNull();
  });
});
