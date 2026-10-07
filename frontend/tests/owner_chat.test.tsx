import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { OwnerChat } from '../src/features/owner/OwnerChat';
import { Modal } from '../src/components/Modal';
import * as ownerApi from '../src/api/ownerChat';
import { setLanguage } from '../src/i18n';

vi.mock('../src/api/ownerChat', () => ({ askOwner: vi.fn() }));

describe('OwnerChat', () => {
  beforeEach(() => { localStorage.clear(); localStorage.setItem('emergentinc.language', 'zh-CN'); vi.clearAllMocks(); });

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
  it('将历史助手回答渲染为 Markdown，保持用户原文并阻止 HTML 和脚本链接', () => {
    const markdown = '# 进展报告\n\n**已完成**：原型。\n\n- 第一项\n- 第二项\n\n| 项目 | 状态 |\n| --- | --- |\n| 原型 | 完成 |\n\n> 请核实结果\n\n```ts\nconst ready = true;\n```\n\n[依据](https://example.com/report)\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))';
    localStorage.setItem('emergentinc.ownerChat.history', JSON.stringify([{role:'user',content:'**保留原文**'}, {role:'assistant',content:markdown}]));
    const {container}=render(<OwnerChat/>);
    expect(screen.getByRole('heading',{name:'进展报告'})).toBeTruthy();
    expect(screen.getByText('已完成').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('cell',{name:'完成'})).toBeTruthy();
    expect(screen.getByText('请核实结果').closest('blockquote')).toBeTruthy();
    expect(screen.getByText('const ready = true;').closest('pre')).toBeTruthy();
    expect(screen.getByRole('link',{name:'依据'}).getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText('危险链接').getAttribute('href')).not.toMatch(/^javascript:/i);
    expect(screen.getByText('**保留原文**')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('emergentinc.ownerChat.history')!)[1].content).toBe(markdown);
  });
  it('使用独立脚注锚点，并同步脚注中英文标签', () => {
    localStorage.setItem('emergentinc.ownerChat.history', JSON.stringify([{role:'assistant',content:'第一条[^1]。\n\n[^1]: 第一份依据。'}, {role:'assistant',content:'第二条[^1]。\n\n[^1]: 第二份依据。'}]));
    render(<OwnerChat/>);
    const references=screen.getAllByRole('link',{name:'1'});
    expect(references[0].getAttribute('href')).not.toBe(references[1].getAttribute('href'));
    for(const link of references){expect(link.getAttribute('target')).toBeNull();expect(document.querySelector(link.getAttribute('href')!)).toBeTruthy();}
    expect(screen.getAllByRole('heading',{name:'脚注'})).toHaveLength(2);
    act(()=>setLanguage('en'));
    expect(screen.getAllByRole('heading',{name:'Footnotes'})).toHaveLength(2);
    expect(screen.getAllByRole('link',{name:'Back to reference'})).toHaveLength(2);
  });
});
