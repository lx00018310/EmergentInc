import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QianjiChatPanel } from '../src/features/qianji/QianjiChatPanel';
import { QianjiNarrativeEditor } from '../src/features/qianji/QianjiNarrativeEditor';
import { QianjiProfilePanel } from '../src/features/qianji/QianjiProfilePanel';
import * as qianjiApi from '../src/api/qianji';

vi.mock('../src/api/qianji', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/api/qianji')>();
  return { ...actual, fetchQianjiChat: vi.fn(), postQianjiChat: vi.fn(), updateQianjiNarrative: vi.fn(), uploadQianjiPortrait: vi.fn(), importQianjiPortraitUrl: vi.fn(), fetchQianjiHistory: vi.fn(), retireQianji: vi.fn() };
});

const item: any = {
  profile: { qianjiId: 'qj_test', careerStatus: 'active', narrativeRevision: 0,
    narrative: { displayName: '守序者', title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null } },
  currentBinding: { bindingId: 'binding_test', pixelId: '0_0_0' },
  physical: { active: true, refundDeficitTokens: 0 },
};

describe('Qianji detail panels', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(qianjiApi.fetchQianjiChat).mockResolvedValue([]); });

  it('preserves a chat draft when queue submission fails', async () => {
    vi.mocked(qianjiApi.postQianjiChat)
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockResolvedValueOnce({ turn: { turnId: 'turn_1' } } as any);
    const onQueued = vi.fn();
    render(<QianjiChatPanel item={item} onQueued={onQueued} />);
    const input = screen.getByLabelText('发送给 守序者');
    fireEvent.change(input, { target: { value: '请解释你的原则' } });
    fireEvent.click(screen.getByRole('button', { name: '排队发送' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Network timeout'));
    expect(input).toHaveProperty('value', '请解释你的原则');
    expect(onQueued).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '排队发送' }));
    await waitFor(() => expect(onQueued).toHaveBeenCalledOnce());
    const keys = vi.mocked(qianjiApi.postQianjiChat).mock.calls.map((call: any[]) => call[2]);
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    expect(input).toHaveProperty('value', '');
  });

  it('keeps the detail column chat-only and runs retirement through a dialog', async () => {
    vi.mocked(qianjiApi.retireQianji).mockResolvedValue(undefined as any);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<QianjiProfilePanel item={item} onRefresh={onRefresh} onQueued={vi.fn()} modalRequest={{ modal: 'retire', nonce: 1 }} />);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByLabelText('发送给 守序者')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '办理退役 · 守序者' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('退役原因'), { target: { value: '转任他处' } });
    fireEvent.click(screen.getByRole('button', { name: '确认退役' }));
    await waitFor(() => expect(qianjiApi.retireQianji).toHaveBeenCalledWith('qj_test', '转任他处', expect.any(String)));
    await waitFor(() => expect(screen.queryByRole('heading', { name: '办理退役 · 守序者' })).toBeNull());
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('reads the history only when the history dialog opens', async () => {
    vi.mocked(qianjiApi.fetchQianjiHistory).mockResolvedValue({
      conclusions: [], events: [], artifacts: { current: null, archives: [] },
      attributed: { modelCalls: [], toolExecutions: [], ledgerEntries: [], messages: [],
        costSummary: { totalCostCny: null, knownCostCny: 0, unknownModelCount: 0, unknownToolCount: 0 } },
    } as any);
    const props = { item, onRefresh: vi.fn().mockResolvedValue(undefined), onQueued: vi.fn() };
    const view = render(<QianjiProfilePanel {...props} />);
    expect(qianjiApi.fetchQianjiHistory).not.toHaveBeenCalled();
    view.rerender(<QianjiProfilePanel {...props} modalRequest={{ modal: 'history', nonce: 2 }} />);
    await waitFor(() => expect(qianjiApi.fetchQianjiHistory).toHaveBeenCalledWith('qj_test', expect.any(AbortSignal)));
    expect(screen.getByText('暂无交付物。')).toBeTruthy();
  });

  it('keeps malformed or rejected narrative edits in the editor for correction', async () => {
    vi.mocked(qianjiApi.updateQianjiNarrative).mockRejectedValue(new Error('NARRATIVE_INVALID'));
    render(<QianjiNarrativeEditor profile={item.profile} onSaved={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('button', { name: '编辑人设' }));
    const editor = screen.getByLabelText('完整人设 JSON');
    fireEvent.change(editor, { target: { value: '{bad json' } });
    fireEvent.click(screen.getByRole('button', { name: '保存人设' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('JSON at position'));
    expect(editor).toHaveProperty('value', '{bad json');
    expect(qianjiApi.updateQianjiNarrative).not.toHaveBeenCalled();
  });

  it('imports an image URL for an editable profile and hides imports after retirement', async () => {
    vi.mocked(qianjiApi.importQianjiPortraitUrl).mockResolvedValue(undefined);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const view = render(<QianjiNarrativeEditor profile={item.profile} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('网络图片地址'), { target: { value: 'https://images.example.org/portrait.png' } });
    fireEvent.click(screen.getByRole('button', { name: '导入网络图片' }));
    await waitFor(() => expect(qianjiApi.importQianjiPortraitUrl).toHaveBeenCalledWith(
      'qj_test', 0, 'https://images.example.org/portrait.png'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    view.rerender(<QianjiNarrativeEditor profile={{ ...item.profile, careerStatus: 'retired' }} onSaved={onSaved} />);
    expect(screen.queryByRole('button', { name: '导入网络图片' })).toBeNull();
    expect(screen.queryByText('导入本地图片')).toBeNull();
  });
});
