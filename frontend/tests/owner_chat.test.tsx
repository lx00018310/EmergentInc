import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { OwnerChat } from '../src/features/owner/OwnerChat';
import { Modal } from '../src/components/Modal';
import * as ownerApi from '../src/api/ownerChat';

vi.mock('../src/api/ownerChat', () => ({ askOwner: vi.fn() }));

describe('OwnerChat', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('显示回答与来源，刷新组件后恢复本机对话', async () => {
    vi.mocked(ownerApi.askOwner).mockResolvedValue({
      answer: '目前完成了原型。', sources: ['workspace/live/pixels/0_0_0/pixel.md'],
      as_of: '2026-09-24T00:00:00.000Z', usage: { tokens: 15, cost_cny: null },
    });
    const first = render(<OwnerChat />);
    fireEvent.change(screen.getByLabelText('向老板窗口提问'), { target: { value: '进度如何？' } });
    await act(async () => { fireEvent.click(screen.getByText('发送')); });
    expect(screen.getByText('目前完成了原型。')).toBeDefined();
    expect(screen.getByText(/workspace\/live\/pixels\/0_0_0\/pixel.md/)).toBeDefined();
    expect(ownerApi.askOwner).toHaveBeenCalledWith('进度如何？', []);
    first.unmount();
    render(<OwnerChat />);
    expect(screen.getByText('目前完成了原型。')).toBeDefined();
  });

  it('弹窗关闭期间完成的回答仍保留', async () => {
    let finish!: (value: Awaited<ReturnType<typeof ownerApi.askOwner>>) => void;
    vi.mocked(ownerApi.askOwner).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const Shell = () => {
      const [open, setOpen] = useState(true);
      return <>
        <button onClick={() => setOpen(value => !value)}>切换窗口</button>
        <Modal isOpen={open} keepMounted title="老板窗口" onClose={() => setOpen(false)}><OwnerChat /></Modal>
      </>;
    };
    render(<Shell />);
    fireEvent.change(screen.getByLabelText('向老板窗口提问'), { target: { value: '进度？' } });
    fireEvent.click(screen.getByText('发送'));
    fireEvent.click(screen.getByText('切换窗口'));
    await act(async () => finish({ answer: '已完成原型。', sources: [], as_of: '2026-09-24T00:00:00.000Z', usage: { tokens: 5, cost_cny: null } }));
    fireEvent.click(screen.getByText('切换窗口'));
    expect(screen.getByText('已完成原型。')).toBeDefined();
  });
});
