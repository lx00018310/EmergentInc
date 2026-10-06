import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  world: { world: null as any, worldId: null as string | null, runStatus: null as any, error: null as string | null, refreshImmediately: vi.fn().mockResolvedValue(undefined) },
  qianji: { items: [] as any[], events: [] as any[], presentation: null as any, error: null as string | null, loading: false, refresh: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../src/hooks/useWorldPolling', () => ({ useWorldPolling: () => state.world }));
vi.mock('../src/hooks/useQianjiPolling', () => ({ useQianjiPolling: () => state.qianji }));
vi.mock('../src/api/run', () => ({ startRun: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/api/meetings', () => ({ listApprovals: vi.fn().mockResolvedValue([]), decideApproval: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/features/qianji/QianjiProfilePanel', async () => {
  const ReactModule = await import('react');
  return { QianjiProfilePanel: ({ item, modalRequest, onSent, sendBlocked }: any) => ReactModule.createElement('div', { 'aria-label': '人物详情', 'data-modal-request': modalRequest ? `${modalRequest.modal}:${modalRequest.nonce}` : '', 'data-send-blocked': sendBlocked ?? '' },
    item.profile.narrative.displayName,
    ReactModule.createElement('button', { type: 'button', onClick: () => void onSent() }, '模拟发送')) };
});

import { QianJiHall } from '../src/features/hall/QianJiHall';
import { startRun } from '../src/api/run';
import { enableWorlds } from '../src/api/worldScope';

const member = {
  profile: {
    qianjiId: 'qj_test', careerStatus: 'active', narrativeRevision: 0,
    narrative: { displayName: '守序者', title: '校验师', roleLabel: '研究员', traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null },
  },
  currentBinding: { bindingId: 'binding_test', pixelId: '0_0_0', incarnation: 2 },
  bindingHistory: [],
  physical: { active: true, energy: 1000, refundDeficitTokens: 0, bindingConsistent: true },
};

const candidate = {
  ...member,
  profile: { ...member.profile, qianjiId: 'qj_candidate', careerStatus: 'candidate',
    narrative: { ...member.profile.narrative, displayName: '未名者' } },
};

describe('QianJiHall', () => {
  const onSelectedQianji = vi.fn();
  const onSelectedPixel = vi.fn();
  const onOpenEngine = vi.fn();
  const onOpenGacha = vi.fn();
  const onOpenMeeting = vi.fn();

  const renderHall = () => render(
    <QianJiHall selectedQianjiId="qj_test" onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel}
      onOpenEngine={onOpenEngine} onOpenGacha={onOpenGacha} onOpenMeeting={onOpenMeeting} />);

  beforeEach(() => {
    vi.clearAllMocks();
    enableWorlds(false);
    localStorage.removeItem('emergentinc.tips.read.0_0_0');
    state.world = {
      world: { round: 12, pixels: [{ active: true }], metrics: { alive_pixels: 1, total_energy: 1000, total_spent_cny: null } },
      worldId: null,
      runStatus: null, error: null, refreshImmediately: vi.fn().mockResolvedValue(undefined),
    };
    state.qianji = {
      items: [member], events: [], presentation: { hallName: '千机阁', organizationName: 'EmergentInc', revision: 0 },
      error: null, loading: false, refresh: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('opens as a usable hall with a chat column and a missing-image state', () => {
    renderHall();
    expect(screen.getByRole('heading', { name: '千机阁' })).toBeTruthy();
    expect(screen.getByText('EmergentInc')).toBeTruthy();
    expect(screen.getByText('未设画像')).toBeTruthy();
    expect(screen.getByLabelText('人物详情')).toBeTruthy();
    expect(screen.getByLabelText('需要阁主决定')).toBeTruthy();
    expect(onSelectedPixel).toHaveBeenCalledWith('0_0_0');
  });

  it.each([
    ['zh-CN', 'Tips (公开提醒):', '● 新提醒', '标记已读', '已读'],
    ['en', 'Tips (public reminders):', '● New reminder', 'Mark as read', 'Read'],
  ])('shows Tips and shares the YUAN read version in %s', (lang, title, unread, mark, read) => {
    localStorage.setItem('emergentinc.language', lang);
    state.world.world.pixels = [{ id: '0_0_0', active: true, tips_md: 'Please review the outline.', tips_version: 'v1' },
      { id: '1_0_0', active: true, tips_md: 'Other person reminder.', tips_version: 'v1' }];
    const { rerender } = renderHall();
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    expect(screen.getByText('Please review the outline.')).toBeTruthy();
    expect(screen.queryByText('Other person reminder.')).toBeNull();
    expect(screen.getByText(unread)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: mark }));
    expect(localStorage.getItem('emergentinc.tips.read.0_0_0')).toBe('v1');
    expect(screen.getByText(read)).toBeTruthy();
    state.world.world = { ...state.world.world, pixels: [{ ...state.world.world.pixels[0], tips_version: 'v2' }] };
    rerender(<QianJiHall selectedQianjiId="qj_test" onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel} onOpenEngine={onOpenEngine} />);
    expect(screen.getByText(unread)).toBeTruthy();
  });

  it('shows reminders from every Pixel in the selected World, including a non-gateway Pixel', () => {
    enableWorlds(true);
    state.world.worldId = 'world_a';
    state.qianji.items = [{ ...member, currentBinding: null, world: { world_id: 'world_a', status: 'ACTIVE', gateway_pixel_id: '0_0_0', gatewayRevision: 0 } }];
    state.world.world.pixels = [{ id: '0_0_0', active: true, tips_md: 'Gateway reminder.', tips_version: 'v1' },
      { id: '1_0_0', active: true, tips_md: 'Internal Pixel reminder.', tips_version: 'v1' }];
    const { rerender } = renderHall();
    expect(screen.getByText('Gateway reminder.')).toBeTruthy();
    expect(screen.getByText('Internal Pixel reminder.')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: '标记已读' })[1]);
    expect(localStorage.getItem('emergentinc.tips.read.world_a.1_0_0')).toBe('v1');
    expect(localStorage.getItem('emergentinc.tips.read.world_a.0_0_0')).toBeNull();
    state.qianji.items = [{ ...state.qianji.items[0], world: { ...state.qianji.items[0].world, world_id: 'world_b' } }];
    rerender(<QianJiHall selectedQianjiId="qj_test" onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel} onOpenEngine={onOpenEngine} />);
    expect(screen.queryByText('Gateway reminder.')).toBeNull();
    expect(screen.queryByText('Internal Pixel reminder.')).toBeNull();
  });

  it('passes the selected stable Qianji ID and exposes only the Engine entry', () => {
    render(<QianJiHall selectedQianjiId={null} onSelectedQianji={onSelectedQianji} onSelectedPixel={onSelectedPixel} onOpenEngine={onOpenEngine} onOpenGacha={onOpenGacha} onOpenMeeting={onOpenMeeting} />);
    fireEvent.click(screen.getByRole('button', { name: /守序者.*正式成员/ }));
    expect(onSelectedQianji).toHaveBeenCalledWith('qj_test');
    expect(onOpenEngine).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '组织控制台' })).toBeNull();
    expect(screen.queryByRole('button', { name: '招募人物' })).toBeNull();
    expect(screen.queryByRole('button', { name: '发起会议' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '进入 Engine' }));
    expect(onOpenEngine).toHaveBeenCalledOnce();
  });

  it('routes card ... commands to dialogs and the meeting entry', () => {
    renderHall();
    fireEvent.click(screen.getByRole('button', { name: '守序者更多操作' }));
    expect(screen.queryByRole('menuitem', { name: '对话' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: '经历' }));
    expect(onSelectedQianji).toHaveBeenCalledWith('qj_test');
    expect(screen.getByLabelText('人物详情').getAttribute('data-modal-request')).toMatch(/^history:/);
    fireEvent.click(screen.getByRole('button', { name: '守序者更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '办理退役' }));
    expect(screen.getByLabelText('人物详情').getAttribute('data-modal-request')).toMatch(/^retire:/);
    fireEvent.click(screen.getByRole('button', { name: '守序者更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '发起会议' }));
    expect(onOpenMeeting).toHaveBeenCalledOnce();
  });

  it('offers 办理退役 before a person has been activated', () => {
    state.qianji = { ...state.qianji, items: [member, candidate] };
    renderHall();
    fireEvent.click(screen.getByRole('button', { name: '未名者更多操作' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '办理退役' }));
    expect(screen.getByLabelText('人物详情').getAttribute('data-modal-request')).toMatch(/^retire:/);
  });

  it('always offers a + slot with recruit and meeting commands', () => {
    renderHall();
    fireEvent.click(screen.getByRole('button', { name: '新建人物位' }));
    expect(screen.getByRole('menu', { name: '新建菜单' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: '招募人物' }));
    expect(onOpenGacha).toHaveBeenCalledOnce();
  });

  it('keeps the side column limited to what the owner must decide', () => {
    renderHall();
    const side = screen.getByLabelText('需要阁主决定');
    expect(screen.getByRole('heading', { name: '请求' })).toBeTruthy();
    expect(side.textContent).toContain('需要阁主决定');
    expect(screen.queryByRole('heading', { name: '运行控制' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '能量与成本' })).toBeNull();
    expect(screen.queryByRole('heading', { name: '最近事件' })).toBeNull();
    expect(screen.queryByRole('button', { name: '启动 Run' })).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('starts a run as soon as a message is sent', async () => {
    renderHall();
    fireEvent.click(screen.getByRole('button', { name: '模拟发送' }));
    await vi.waitFor(() => expect(startRun).toHaveBeenCalledWith({ rounds: 1, run_budget_tokens: 100000 }));
    expect(state.qianji.refresh).toHaveBeenCalledOnce();
    expect(state.world.refreshImmediately).toHaveBeenCalled();
  });

  it('tells the composer to wait and skips a second run while one is active', async () => {
    state.world = { ...state.world, runStatus: { running: true, completed_rounds: 1, requested_rounds: 3 } };
    renderHall();
    expect(screen.getByLabelText('人物详情').getAttribute('data-send-blocked')).toContain('Run 进行中');
    fireEvent.click(screen.getByRole('button', { name: '模拟发送' }));
    await vi.waitFor(() => expect(state.qianji.refresh).toHaveBeenCalledOnce());
    expect(startRun).not.toHaveBeenCalled();
  });

  it('keeps the hall error visible', () => {
    state.qianji = { ...state.qianji, error: '人物接口读取失败' };
    renderHall();
    expect(screen.getByRole('alert').textContent).toContain('人物接口读取失败');
  });

  it('still queues messages but skips the auto run while recovery is unresolved', async () => {
    state.world = { ...state.world, runStatus: { running: false, unfinalized_operations: { hasUnfinalized: true } } };
    renderHall();
    expect(screen.getByLabelText('人物详情').getAttribute('data-send-blocked')).toBe('');
    expect(screen.getByText(/存在未决操作。请进入 Engine 的 Recovery 面板处理后再运行。/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '模拟发送' }));
    await vi.waitFor(() => expect(state.qianji.refresh).toHaveBeenCalledOnce());
    expect(startRun).not.toHaveBeenCalled();
  });
});
