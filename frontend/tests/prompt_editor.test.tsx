import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { PromptEditor } from '../src/features/prompts/PromptEditor';

describe('PromptEditor Component', () => {
  it('正确展示初始提示词并支持编辑', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClear = vi.fn().mockResolvedValue(undefined);

    const initialData = {
      active: true,
      content: '初始化创世规则',
      revision: 3,
      hash: 'abc12345',
    };

    render(
      <PromptEditor
        cardId="test-card"
        title="创世提示词"
        hint="提示词说明"
        placeholder="请输入内容"
        promptData={initialData}
        isRunning={false}
        onSave={onSave}
        onClear={onClear}
      />
    );

    expect(screen.getByText('创世提示词')).toBeDefined();
    expect(screen.getByText('生效中')).toBeDefined();
    expect(screen.getByText('3')).toBeDefined();

    const textarea = screen.getByPlaceholderText('请输入内容') as HTMLTextAreaElement;
    expect(textarea.value).toBe('初始化创世规则');

    // 修改输入
    await act(async () => {
      fireEvent.change(textarea, { target: { value: '更新后的规则' } });
    });
    expect(textarea.value).toBe('更新后的规则');
    expect(screen.getByText('(未保存)')).toBeDefined();

    // 点击保存
    const saveBtn = screen.getByText('保存提示词');
    await act(async () => {
      fireEvent.click(saveBtn);
    });
    expect(onSave).toHaveBeenCalledWith('更新后的规则');
  });

  it('在 isRunning 为 true 时禁用编辑与保存按钮', () => {
    const onSave = vi.fn();
    const onClear = vi.fn();

    render(
      <PromptEditor
        cardId="test-card"
        title="创世提示词"
        hint="提示词说明"
        placeholder="请输入内容"
        promptData={{ active: false, content: '运行中无法修改', revision: 1 }}
        isRunning={true}
        onSave={onSave}
        onClear={onClear}
      />
    );

    const textarea = screen.getByPlaceholderText('请输入内容') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);

    const saveBtn = screen.getByText('保存提示词') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });
});
