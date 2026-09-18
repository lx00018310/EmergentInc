import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ConsolePanel } from '../src/features/run/ConsolePanel';

describe('ConsolePanel Component', () => {
  it('当处于 PAUSED_RECOVERY_REQUIRED 或有未决操作时显示告警与对账自愈按钮', async () => {
    const onReconcile = vi.fn().mockResolvedValue(undefined);

    render(
      <ConsolePanel
        messages={[]}
        audit={null}
        runStatus={{
          running: false,
          requested_rounds: 1,
          completed_rounds: 0,
          messages_processed: 0,
          model_calls_completed: 0,
          idle_rounds: 0,
          current_round: 26,
          stop_requested: false,
          stop_reason: 'PAUSED_RECOVERY_REQUIRED',
          run_id: 'run_test',
          last_error: null,
          result_status: 'PAUSED_RECOVERY_REQUIRED',
          unfinalized_operations: {
            unsettledReservations: [{ callId: 'c1', runId: 'r1', pixelId: '0_0_0', amount: 100, createdAt: 1 }],
            unknownCalls: [{ callId: 'c1', messageId: 'm1', outcome: 'CALL_OUTCOME_UNKNOWN', createdAt: 1 }],
            callingMessages: [{ messageId: 'm1', status: 'CALL_OUTCOME_UNKNOWN', updatedAt: 1 }],
          },
        }}
        onReconcile={onReconcile}
      />
    );

    expect(screen.getByText(/需逐项审计决策/i)).toBeDefined();
    expect(screen.getByText(/未决预留：1 笔/i)).toBeDefined();
    expect(screen.getByText(/结果未知调用：1 笔/i)).toBeDefined();

    const btn = screen.getByText(/查看未决项/i);
    await act(async () => {
      fireEvent.click(btn);
    });

    expect(onReconcile).toHaveBeenCalledTimes(1);
  });

  it('当处于 RUNNING 状态时，即使存在在途事务，也不显示恢复告警', () => {
    render(
      <ConsolePanel
        messages={[]}
        audit={null}
        runStatus={{
          running: true,
          requested_rounds: 10,
          completed_rounds: 0,
          messages_processed: 0,
          model_calls_completed: 0,
          idle_rounds: 0,
          current_round: 26,
          stop_requested: false,
          stop_reason: null,
          run_id: 'run_test',
          last_error: null,
          result_status: 'RUNNING',
          unfinalized_operations: {
            unsettledReservations: [{ callId: 'c1', runId: 'r1', pixelId: '0_0_0', amount: 100, createdAt: 1 }],
            unknownCalls: [],
            callingMessages: [{ messageId: 'm1', status: 'CALLING', updatedAt: 1 }],
          },
        }}
        onReconcile={vi.fn()}
      />
    );

    expect(screen.queryByText(/需逐项审计决策/i)).toBeNull();
    expect(screen.queryByText(/查看未决项/i)).toBeNull();
  });
});

