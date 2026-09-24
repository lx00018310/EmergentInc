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
    localStorage.clear();
  });

  it('在私有资料和执行记录旁打开三个独立弹窗入口', () => {
    const onOpenOwnerChat = vi.fn();
    const onOpenGenesisPrompt = vi.fn();
    const onOpenTemporaryPrompt = vi.fn();
    render(<RunControls
      runStatus={null} onOpenEnvironment={vi.fn()} onOpenTools={vi.fn()}
      onOpenPrivateFiles={vi.fn()} onOpenToolExecutions={vi.fn()}
      onOpenOwnerChat={onOpenOwnerChat} onOpenGenesisPrompt={onOpenGenesisPrompt}
      onOpenTemporaryPrompt={onOpenTemporaryPrompt}
      onLogMessage={onLogMessage} onRefresh={onRefresh}
    />);
    fireEvent.click(screen.getByText('老板窗口'));
    fireEvent.click(screen.getByText('创世提示词'));
    fireEvent.click(screen.getByText('临时提示词'));
    expect(onOpenOwnerChat).toHaveBeenCalledOnce();
    expect(onOpenGenesisPrompt).toHaveBeenCalledOnce();
    expect(onOpenTemporaryPrompt).toHaveBeenCalledOnce();
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
      run_budget_tokens: 100000,
    });
    expect(onRefresh).toHaveBeenCalled();
  });

  it('快捷按钮分别提交 100、1000、10000 轮', async () => {
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

    const quickBtn100 = screen.getByText('跑 100 轮');
    await act(async () => {
      fireEvent.click(quickBtn100);
    });

    expect(runApi.startRun).toHaveBeenCalledWith({
      rounds: 100,
      run_budget_tokens: 100000,
    });
    await act(async () => { fireEvent.click(screen.getByText('跑 1000 轮')); });
    await act(async () => { fireEvent.click(screen.getByText('跑 10000 轮')); });
    expect(vi.mocked(runApi.startRun).mock.calls.map(([request]) => request.rounds)).toEqual([100, 1000, 10000]);
  });

  it('Run Tokens 输入值刷新组件后仍从本机存储恢复', () => {
    const props = {
      runStatus: null, onOpenEnvironment: vi.fn(), onOpenTools: vi.fn(),
      onOpenPrivateFiles: vi.fn(), onOpenToolExecutions: vi.fn(), onLogMessage, onRefresh,
    };
    const first = render(<RunControls {...props} />);
    fireEvent.change(screen.getByLabelText('本次运行上限 (Run Tokens):'), { target: { value: '250000' } });
    expect(localStorage.getItem('emergentinc.runBudgetTokens')).toBe('250000');
    expect(screen.queryByLabelText('累计总上限 (Global Tokens):')).toBeNull();
    first.unmount();
    render(<RunControls {...props} />);
    expect((screen.getByLabelText('本次运行上限 (Run Tokens):') as HTMLInputElement).value).toBe('250000');
  });

  it('本页启动的运行因空队列停止时弹窗说明实际完成轮数', async () => {
    vi.mocked(runApi.startRun).mockResolvedValue({ status: 'STARTED', run_id: 'run_empty' });
    const props = {
      onOpenEnvironment: vi.fn(), onOpenTools: vi.fn(), onOpenPrivateFiles: vi.fn(),
      onOpenToolExecutions: vi.fn(), onLogMessage, onRefresh,
    };
    const { rerender } = render(<RunControls {...props} runStatus={null} />);
    await act(async () => { fireEvent.click(screen.getByText('跑 10000 轮')); });
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(<RunControls {...props} runStatus={{
      run_id: 'run_empty', running: false, stop_reason: 'NO_ACTIVE_MESSAGES',
      completed_rounds: 1, requested_rounds: 10000,
    } as any} />);
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(screen.getByText(/完成 1 \/ 10000 轮/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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

  it('正常状态不显示对账按钮，恢复状态才显示', async () => {
    const onReconcile = vi.fn().mockResolvedValue(undefined);
    render(
      <RunControls
        runStatus={{ unfinalized_operations: { hasUnfinalized: true, unsettledReservations: [{ callId: 'c1', runId: 'r1', pixelId: 'p', amount: 1, createdAt: 1 }] } } as any}
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

