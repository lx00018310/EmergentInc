import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { RunStatus } from '../src/features/run/RunStatus';
import { RecoveryOperations } from '../src/features/run/RecoveryOperations';
import { ToolExecutionHistory } from '../src/features/tools/ToolExecutionHistory';
import type { RunStatusDto, WorldDto } from '../src/api/types';
import * as runApi from '../src/api/run';

vi.mock('../src/api/run', () => ({ resolveRecovery: vi.fn() }));

const baseStatus: RunStatusDto = {
  running: false, requested_rounds: 1, completed_rounds: 0, messages_processed: 0,
  model_calls_completed: 0, idle_rounds: 0, current_round: 1, stop_requested: false,
  stop_reason: 'INFRASTRUCTURE_FAILURE', run_id: 'run_x', last_error: 'socket closed',
  result_status: 'FAILED', unfinalized_operations: null,
};

describe('V11 status truthfulness', () => {
  afterEach(cleanup);

  it('FAILED run shows FAILED, never READY, with persisted error details', () => {
    render(<RunStatus world={null} runStatus={baseStatus} audit={null} />);
    expect(screen.getByText('FAILED')).toBeDefined();
    expect(screen.queryByText('READY')).toBeNull();
  });

  it('unfinalized operations force RECOVERY REQUIRED regardless of other flags', () => {
    render(<RunStatus world={null} runStatus={{ ...baseStatus, result_status: 'PAUSED_RECOVERY_REQUIRED', stop_reason: 'PAUSED_RECOVERY_REQUIRED', last_error: null }} audit={null} />);
    expect(screen.getByText('RECOVERY REQUIRED')).toBeDefined();
  });

  it('exposes error_code and error_summary through the status DTO', () => {
    expect(baseStatus.error_code).toBeUndefined();
  });
});

describe('per-item recovery decisions', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(cleanup);

  const status: RunStatusDto = {
    ...baseStatus, result_status: 'PAUSED_RECOVERY_REQUIRED', stop_reason: 'PAUSED_RECOVERY_REQUIRED',
    unfinalized_operations: {
      hasUnfinalized: true,
      unsettledReservations: [{ callId: 'call-1', runId: 'run_x', pixelId: 'p1', amount: 100, createdAt: 1 }],
      unknownCalls: [{ callId: 'call-2', messageId: 'm1', outcome: 'CALL_OUTCOME_UNKNOWN', createdAt: 2 }],
      callingMessages: [],
      startedToolExecutions: ['op-9'],
      pendingRuns: ['run_old'],
    },
  };

  it('lists every unfinalized item and submits single item approve/reject with optional reason', async () => {
    vi.mocked(runApi.resolveRecovery).mockResolvedValue({});
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<RecoveryOperations status={status} onRefresh={onRefresh} />);
    expect(screen.getByText(/call-1/)).toBeDefined();
    expect(screen.getByText(/call-2/)).toBeDefined();
    expect(screen.getByText(/op-9/)).toBeDefined();
    expect(screen.getByText(/run_old/)).toBeDefined();

    // 理由选填：不填也可直接点击
    const approveButtons = screen.getAllByRole('button', { name: '通过' });
    expect(approveButtons[0].hasAttribute('disabled')).toBe(false);

    // 填写理由后点击通过
    fireEvent.change(screen.getByLabelText(/核实依据/), { target: { value: 'provider billing checked' } });
    fireEvent.click(approveButtons[0]);
    await waitFor(() => expect(runApi.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'model',
      id: 'call-1',
      decision: 'confirm_not_billed',
      reason: 'provider billing checked',
    })));
    expect(onRefresh).toHaveBeenCalled();

    // 点击拒绝
    const rejectButtons = screen.getAllByRole('button', { name: '拒绝' });
    fireEvent.click(rejectButtons[0]);
    await waitFor(() => expect(runApi.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'model',
      id: 'call-1',
      decision: 'abandon',
      reason: 'provider billing checked',
    })));
  });

  it('supports batch actions: 全部通过 and 全部拒绝', async () => {
    vi.mocked(runApi.resolveRecovery).mockResolvedValue({});
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<RecoveryOperations status={status} onRefresh={onRefresh} />);

    // 全部通过
    const batchApprove = screen.getByRole('button', { name: '全部通过' });
    fireEvent.click(batchApprove);
    await waitFor(() => expect(runApi.resolveRecovery).toHaveBeenCalledTimes(4));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('lists callingMessages and allows submitting message recovery decision with 通过 / 拒绝', async () => {
    vi.mocked(runApi.resolveRecovery).mockResolvedValue({});
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const msgStatus: RunStatusDto = {
      ...baseStatus,
      result_status: 'PAUSED_RECOVERY_REQUIRED',
      unfinalized_operations: {
        hasUnfinalized: true,
        callingMessages: [{ messageId: 'msg-calling-1', status: 'CALLING', updatedAt: 1 }],
      },
    };
    render(<RecoveryOperations status={msgStatus} onRefresh={onRefresh} />);
    expect(screen.getByText(/msg-calling-1/)).toBeDefined();
    expect(screen.queryByText(/未提供可决策操作 ID/)).toBeNull();

    // 未填理由直接点击通过
    fireEvent.click(screen.getByRole('button', { name: '通过' }));
    await waitFor(() => expect(runApi.resolveRecovery).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'message',
      id: 'msg-calling-1',
      decision: 'confirm_not_billed',
      reason: '',
    })));
    expect(onRefresh).toHaveBeenCalled();
  });
});

describe('tool execution started_at contract', () => {
  afterEach(cleanup);

  it('renders started and finished times instead of Invalid Date', async () => {
    vi.mock('../src/api/tools', () => ({
      fetchToolExecutions: vi.fn().mockResolvedValue({
        executions: [{ operation_id: 'op-1', run_id: 'r', message_id: 'm', pixel_id: 'p', op_index: 0, tool: 'save_artifact', args_hash: 'h', status: 'SUCCESS', started_at: 1758000000, finished_at: 1758000060, result: null }],
      }),
    }));
    const { fetchToolExecutions } = await import('../src/api/tools');
    const onLogMessage = vi.fn();
    render(<ToolExecutionHistory isOpen onClose={vi.fn()} onLogMessage={onLogMessage} />);
    await waitFor(() => expect(screen.getByText('op-1')).toBeDefined());
    const row = screen.getByText('op-1').closest('tr')!;
    expect(row.textContent).not.toContain('Invalid Date');
    expect(row.textContent).not.toContain('NaN');
    expect(fetchToolExecutions).toHaveBeenCalled();
  });
});
