import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchWorld, fetchWorkspaceAudit } from '../api/world';
import { fetchRunStatus } from '../api/run';
import type { WorldDto, RunStatusDto, WorkspaceAuditDto } from '../api/types';

export interface UseWorldPollingResult {
  world: WorldDto | null;
  runStatus: RunStatusDto | null;
  audit: WorkspaceAuditDto | null;
  isLoading: boolean;
  error: string | null;
  refreshImmediately: () => Promise<void>;
}

export function useWorldPolling(): UseWorldPollingResult {
  const [world, setWorld] = useState<WorldDto | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatusDto | null>(null);
  const [audit, setAudit] = useState<WorkspaceAuditDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const activeAbortControllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const isRunningRef = useRef<boolean>(false);

  const fetchCycle = useCallback(async () => {
    // 终止前一个未完成请求
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }

    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    const { signal } = controller;

    try {
      // 并行拉取 world 与 run status
      const [worldRes, runRes] = await Promise.all([
        fetchWorld(signal),
        fetchRunStatus(signal),
      ]);

      if (!isMountedRef.current) return;

      setWorld(worldRes);
      setRunStatus(runRes);
      setError(null);
      isRunningRef.current = Boolean(runRes?.running);

      // 如果非运行状态，异步检测一次审计状态 (非阻塞)
      if (!runRes?.running) {
        fetchWorkspaceAudit(signal)
          .then((auditRes) => {
            if (isMountedRef.current) {
              setAudit(auditRes);
            }
          })
          .catch(() => {
            // 忽略审计单独偶发超时
          });
      } else {
        setAudit(null);
      }
    } catch (err: unknown) {
      if (!isMountedRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (!isMountedRef.current) return;
      setIsLoading(false);

      // 依据当前运行状态动态调度下一批：运行中 ~600ms，空闲 ~1500ms
      const delay = isRunningRef.current ? 600 : 1500;
      timerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          fetchCycle();
        }
      }, delay);
    }
  }, []);

  const refreshImmediately = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await fetchCycle();
  }, [fetchCycle]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchCycle();

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, [fetchCycle]);

  return {
    world,
    runStatus,
    audit,
    isLoading,
    error,
    refreshImmediately,
  };
}
