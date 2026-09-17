import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useWorldPolling } from '../src/hooks/useWorldPolling';
import * as worldApi from '../src/api/world';
import * as runApi from '../src/api/run';

describe('useWorldPolling Hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('成功加载世界与运行状态并在卸载时取消定时器', async () => {
    const mockWorld = {
      round: 3,
      pixels: [],
      environment_md: '',
      metrics: {},
      latest_message_flow: [],
    };
    const mockRun = {
      running: false,
      requested_rounds: 0,
      completed_rounds: 0,
      messages_processed: 0,
      model_calls_completed: 0,
      idle_rounds: 0,
      current_round: 3,
      stop_requested: false,
      stop_reason: null,
      run_id: 'run_1',
      last_error: null,
      result_status: null,
    };

    vi.spyOn(worldApi, 'fetchWorld').mockResolvedValue(mockWorld);
    vi.spyOn(runApi, 'fetchRunStatus').mockResolvedValue(mockRun);
    vi.spyOn(worldApi, 'fetchWorkspaceAudit').mockResolvedValue({
      audit_status: 'OK',
      allowed_to_start: true,
      recovery_required: false,
      block_reasons: [],
    });

    const { result, unmount } = renderHook(() => useWorldPolling());

    await waitFor(() => {
      expect(result.current.world?.round).toBe(3);
      expect(result.current.runStatus?.run_id).toBe('run_1');
    });

    unmount();
  });
});
