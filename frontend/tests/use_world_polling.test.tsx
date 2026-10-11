import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useWorldPolling } from '../src/hooks/useWorldPolling';
import * as worldApi from '../src/api/world';
import * as runApi from '../src/api/run';
import { enableWorlds, selectWorld } from '../src/api/worldScope';

describe('useWorldPolling Hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    enableWorlds(false); selectWorld(null);
  });

  it('does not replace the selected World audit with an earlier response', async () => {
    enableWorlds(true); selectWorld('world_a');
    let finish!: (value: any) => void;
    vi.spyOn(worldApi, 'fetchWorld').mockResolvedValue({ round: 1 } as any);
    vi.spyOn(runApi, 'fetchRunStatus').mockResolvedValue({ running: false } as any);
    vi.spyOn(worldApi, 'fetchWorkspaceAudit').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ audit_status: 'WORLD_B' } as any);
    const { result } = renderHook(() => useWorldPolling());
    await waitFor(() => expect(result.current.worldId).toBe('world_a'));
    selectWorld('world_b'); await act(async () => result.current.refreshImmediately());
    await waitFor(() => expect(result.current.audit?.audit_status).toBe('WORLD_B'));
    await act(async () => finish({ audit_status: 'WORLD_A' }));
    expect(result.current.audit?.audit_status).toBe('WORLD_B');
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
