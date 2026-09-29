import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GachaView } from '../src/features/gacha/GachaView';
import * as qianjiApi from '../src/api/qianji';

vi.mock('../src/api/qianji', () => ({ recruitQianji: vi.fn() }));

const born = {
  qianjiId: 'qj_new', careerStatus: 'active', narrativeRevision: 0,
  narrative: { displayName: '观复', shortBio: '蹇卦之后，我先看清路径再动。',
    appearanceSpec: '青年，素色深衣，手持铜灯', traits: {}, behaviorProfile: [] },
  createdAt: 1, retiredAt: null, retiredReason: null,
  birthIdentity: { birthSeed: '20', birthAlgorithmVersion: 1,
    primaryHexagram: '水山蹇', movingLine: 1, changedHexagram: '水火既济',
    birthText: '面对变化先观察路径，再衡量方向。' },
};

describe('recruitment view', () => {
  it('creates a person and returns to the hall with that person opened', async () => {
    const open = vi.fn();
    vi.mocked(qianjiApi.recruitQianji).mockResolvedValue(born as any);
    render(<GachaView onBack={vi.fn()} onOpenPerson={open} />);
    fireEvent.click(screen.getByRole('button', { name: '招募一位人物' }));
    expect((screen.getByRole('button', { name: /正在招募/ }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(qianjiApi.recruitQianji).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledWith('qj_new');
  });

  it('stays on the recruitment view when the model refuses to name the person', async () => {
    const open = vi.fn();
    vi.mocked(qianjiApi.recruitQianji).mockRejectedValue(new Error('招募失败'));
    render(<GachaView onBack={vi.fn()} onOpenPerson={open} />);
    fireEvent.click(screen.getByRole('button', { name: '招募一位人物' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('招募失败');
    expect(open).not.toHaveBeenCalled();
  });
});
