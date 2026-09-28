import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GachaView } from '../src/features/gacha/GachaView';
import * as gachaApi from '../src/api/gacha';

vi.mock('../src/api/gacha', () => ({
  drawGacha: vi.fn(), generateGachaImage: vi.fn(), getGacha: vi.fn(),
  listGachaHistory: vi.fn(), retryGacha: vi.fn(),
}));

describe('GachaView', () => {
  it('opens a failed card from history so its narrative can be retried', async () => {
    const card: any = { error: '模型未返回人设正文', profile: {
      qianjiId: 'qj_failed', careerStatus: 'candidate', narrativeRevision: 0,
      narrative: { displayName: '顾观星', roleLabel: '军师', shortBio: '初入天机阁', portraitAsset: null },
      draw: { rarity: 'R', origin: 'appointed', attributes: { 谋: 1.2, 察: 1.2, 决: 1.2, 行: 1.2, 言: 1.2, 创: 1.2, 韧: 1.2, 学: 1.2 },
        traitTags: [], lineage: [], skillTags: [], generationStatus: 'failed', imageStatus: 'pending', cardPrompt: null, createdAt: 1 },
    } };
    vi.mocked(gachaApi.listGachaHistory).mockResolvedValue({ items: [card], total: 1,
      counts: { N: 0, R: 1, SR: 0, SSR: 0 }, nextCursor: null });
    vi.mocked(gachaApi.retryGacha).mockResolvedValue(card);
    render(<GachaView onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '抽卡历史与图鉴' }));
    fireEvent.click(await screen.findByRole('button', { name: '打开卡片并重试人设' }));
    expect(screen.getByText(/模型未返回人设正文/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试人设' }));
    await waitFor(() => expect(gachaApi.retryGacha).toHaveBeenCalledWith('qj_failed'));
  });
});
