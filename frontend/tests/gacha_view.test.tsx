import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GachaView } from '../src/features/gacha/GachaView';
import * as qianjiApi from '../src/api/qianji';

vi.mock('../src/api/qianji', () => ({ recruitQianji: vi.fn() }));

describe('recruitment view', () => {
  it('creates a person with one click and opens their chat', async () => {
    const open = vi.fn();
    vi.mocked(qianjiApi.recruitQianji).mockResolvedValue({
      qianjiId: 'qj_new', careerStatus: 'active', narrativeRevision: 0,
      narrative: { displayName: '未名·123456', traits: {}, behaviorProfile: [] },
      createdAt: 1, retiredAt: null, retiredReason: null,
      birthIdentity: { birthSeed: '20', birthAlgorithmVersion: 1,
        primaryHexagram: '水山蹇', movingLine: 1, changedHexagram: '水火既济',
        birthText: '面对变化先观察路径，再衡量方向。' },
    });
    render(<GachaView onBack={vi.fn()} onOpenPerson={open} />);
    fireEvent.click(screen.getByRole('button', { name: '招募一位人物' }));
    await waitFor(() => expect(qianjiApi.recruitQianji).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('水山蹇 → 水火既济')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '开始对话' }));
    expect(open).toHaveBeenCalledWith('qj_new');
  });
});
