import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  world: { world: null as any, runStatus: null as any, error: null as string | null, refreshImmediately: vi.fn().mockResolvedValue(undefined) },
  qianji: { items: [] as any[], events: [] as any[], presentation: null as any, error: null as string | null, loading: false, refresh: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../src/hooks/useWorldPolling', () => ({ useWorldPolling: () => state.world }));
vi.mock('../src/hooks/useQianjiPolling', () => ({ useQianjiPolling: () => state.qianji }));
vi.mock('../src/api/run', () => ({ startRun: vi.fn(), stopRun: vi.fn() }));
vi.mock('../src/features/qianji/QianjiProfilePanel', async () => {
  const ReactModule = await import('react');
  return { QianjiProfilePanel: ({ item }: any) => ReactModule.createElement('div', { 'aria-label': '人物对话' }, item.profile.narrative.displayName) };
});
vi.mock('../src/api/qianji', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/qianji')>();
  return { ...actual, fetchQianjiChat: vi.fn().mockResolvedValue([]), postQianjiChat: vi.fn() };
});

import { TianJiHall } from '../src/features/hall/TianJiHall';

const member = {
  profile: {
    qianjiId: 'qj_test', careerStatus: 'active', narrativeRevision: 0,
    narrative: { displayName: '守序者', title: '校验师', roleLabel: '研究员', traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null },
  },
  currentBinding: { bindingId: 'binding_test', pixelId: '0_0_0', incarnation: 2 },
  bindingHistory: [],
  physical: { active: true, energy: 1000, refundDeficitTokens: 0, bindingConsistent: true },
};

describe('TianJiHall', () => {
  const onSelectedQianji = vi.fn();
  const onSelectedPixel = vi.fn();
  const onOpenEngine = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    state.world = {
      world: { round: 12, pixels: [{ active: true }], metrics: { alive_pixels: 1, total_energy: 1000, total_spent_cny: null } },
      runStatus: null, error: null, refreshImmediately: vi.fn().mockResolvedValue(undefined),
    };
    state.qianji = {
      items: [member], events: [], presentation: { hallName: '天机阁', organizationName: 'EmergentInc', revision: 0 },
      error: null, loading: false, refresh: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('opens as a usable hall, shows neutral missing-image and unknown cost states', () => {
    render(<TianJiHall selectedQianjiId="qj_test" onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel} onOpenEngine={onOpenEngine} />);
    expect(screen.getByRole('heading', { name: '天机阁' })).toBeTruthy();
    expect(screen.getByText('EmergentInc')).toBeTruthy();
    expect(screen.getByText('未设画像')).toBeTruthy();
    expect(screen.getByText('未知')).toBeTruthy();
    expect(screen.getByLabelText('人物对话')).toBeTruthy();
    expect(onSelectedPixel).toHaveBeenCalledWith('0_0_0');
  });

  it('passes the selected stable Qianji ID and exposes the Engine entry', () => {
    render(<TianJiHall selectedQianjiId={null} onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel} onOpenEngine={onOpenEngine} />);
    fireEvent.click(screen.getByRole('button', { name: /守序者/ }));
    expect(onSelectedQianji).toHaveBeenCalledWith('qj_test');
    expect(onOpenEngine).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '进入 Engine' }));
    expect(onOpenEngine).toHaveBeenCalledOnce();
  });

  it('keeps the hall error visible and blocks Run while recovery is unresolved', () => {
    state.qianji = { ...state.qianji, error: '人物接口读取失败' };
    state.world = { ...state.world, runStatus: { running: false, unfinalized_operations: { hasUnfinalized: true } } };
    render(<TianJiHall selectedQianjiId="qj_test" onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel} onOpenEngine={onOpenEngine} />);
    expect(screen.getByRole('alert').textContent).toContain('人物接口读取失败');
    expect(screen.getAllByText(/需要恢复处理/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '启动 Run' })).toHaveProperty('disabled', true);
  });
});
