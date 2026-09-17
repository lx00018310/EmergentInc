import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { RunControls } from '../src/features/run/RunControls';
import * as runApi from '../src/api/run';

vi.mock('../src/api/run', () => ({
  startRun: vi.fn(),
  stopRun: vi.fn(),
}));

describe('RunControls Component', () => {
  const onLogMessage = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('输入“跑5轮”并提交，正确传递 rounds: 5', async () => {
    vi.mocked(runApi.startRun).mockResolvedValue({ status: 'STARTED', loop_id: 'run_1' });

    render(
      <RunControls
        runStatus={null}
        onOpenEnvironment={vi.fn()}
        onOpenTools={vi.fn()}
        onOpenPrivateFiles={vi.fn()}
        onOpenToolExecutions={vi.fn()}
        onLogMessage={onLogMessage}
        onRefresh={onRefresh}
      />
    );

    const input = screen.getByPlaceholderText(/输入命令/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: '跑5轮' } });
    });

    const runBtn = screen.getByText('演化推进');
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(runApi.startRun).toHaveBeenCalledWith({
      rounds: 5,
      command: '跑5轮',
      run_budget_tokens: 100000,
      global_budget_tokens: 1000000,
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('点击“跑 10 轮”快捷按钮，正确传递 rounds: 10', async () => {
    vi.mocked(runApi.startRun).mockResolvedValue({ status: 'STARTED', loop_id: 'run_2' });

    render(
      <RunControls
        runStatus={null}
        onOpenEnvironment={vi.fn()}
        onOpenTools={vi.fn()}
        onOpenPrivateFiles={vi.fn()}
        onOpenToolExecutions={vi.fn()}
        onLogMessage={onLogMessage}
        onRefresh={onRefresh}
      />
    );

    const quickBtn10 = screen.getByText('跑 10 轮');
    await act(async () => {
      fireEvent.click(quickBtn10);
    });

    expect(runApi.startRun).toHaveBeenCalledWith({
      rounds: 10,
      command: '跑10轮',
      run_budget_tokens: 100000,
      global_budget_tokens: 1000000,
    });
  });

  it('空闲时输入“停止”并提交，不启动运行，不调用 startRun', async () => {
    render(
      <RunControls
        runStatus={{ running: false } as any}
        onOpenEnvironment={vi.fn()}
        onOpenTools={vi.fn()}
        onOpenPrivateFiles={vi.fn()}
        onOpenToolExecutions={vi.fn()}
        onLogMessage={onLogMessage}
        onRefresh={onRefresh}
      />
    );

    const input = screen.getByPlaceholderText(/输入命令/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: '停止' } });
    });

    const runBtn = screen.getByText('演化推进');
    await act(async () => {
      fireEvent.click(runBtn);
    });

    // 绝对不调用 startRun
    expect(runApi.startRun).not.toHaveBeenCalled();
    expect(onLogMessage).toHaveBeenCalledWith('warn', expect.stringContaining('空闲状态，无需停止'));
  });

  it('运行时输入“停止”并提交，调用 stopRun 而非 startRun', async () => {
    vi.mocked(runApi.stopRun).mockResolvedValue({ status: 'STOPPING' });

    // 假设组件当前因为某种原因允许触发（例如按 Enter）
    render(
      <RunControls
        runStatus={{ running: true } as any}
        onOpenEnvironment={vi.fn()}
        onOpenTools={vi.fn()}
        onOpenPrivateFiles={vi.fn()}
        onOpenToolExecutions={vi.fn()}
        onLogMessage={onLogMessage}
        onRefresh={onRefresh}
      />
    );

    // 点击红色的“停止”按钮
    const stopBtn = screen.getByText('停止');
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(runApi.stopRun).toHaveBeenCalled();
    expect(runApi.startRun).not.toHaveBeenCalled();
  });

  it('输入未知命令并提交，不启动运行，给出警告提示', async () => {
    render(
      <RunControls
        runStatus={null}
        onOpenEnvironment={vi.fn()}
        onOpenTools={vi.fn()}
        onOpenPrivateFiles={vi.fn()}
        onOpenToolExecutions={vi.fn()}
        onLogMessage={onLogMessage}
        onRefresh={onRefresh}
      />
    );

    const input = screen.getByPlaceholderText(/输入命令/i);
    await act(async () => {
      fireEvent.change(input, { target: { value: 'random_bad_command' } });
    });

    const runBtn = screen.getByText('演化推进');
    await act(async () => {
      fireEvent.click(runBtn);
    });

    expect(runApi.startRun).not.toHaveBeenCalled();
    expect(onLogMessage).toHaveBeenCalledWith('warn', expect.stringContaining('未识别指令'));
  });

  it('点击“安全对账”按钮，触发 onReconcile 回调', async () => {
    const onReconcile = vi.fn().mockResolvedValue(undefined);
    render(
      <RunControls
        runStatus={null}
        onOpenEnvironment={vi.fn()}
        onOpenTools={vi.fn()}
        onOpenPrivateFiles={vi.fn()}
        onOpenToolExecutions={vi.fn()}
        onLogMessage={onLogMessage}
        onRefresh={onRefresh}
        onReconcile={onReconcile}
      />
    );

    const reconcileBtn = screen.getByText('安全对账');
    await act(async () => {
      fireEvent.click(reconcileBtn);
    });

    expect(onReconcile).toHaveBeenCalledTimes(1);
  });
});

