import { apiRequest } from './client';
import type { RunStatusDto, RunStartRequest } from './types';

export async function fetchRunStatus(signal?: AbortSignal): Promise<RunStatusDto> {
  return apiRequest<RunStatusDto>('/api/run/status', { signal });
}

export async function startRun(req: RunStartRequest): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>('/api/run/start', {
    method: 'POST',
    body: JSON.stringify(req),
  });
}

export async function stopRun(): Promise<Record<string, unknown>> {
  return apiRequest<Record<string, unknown>>('/api/run/stop', {
    method: 'POST',
  });
}

export interface ReconcileResultDto {
  status: string;
  reconciled: {
    reconciledRuns: number;
    reconciledReservations: number;
    reconciledMessages: number;
    reconciledCalls: number;
    reconciledTools: number;
  };
}

export async function reconcileRun(): Promise<ReconcileResultDto> {
  return apiRequest<ReconcileResultDto>('/api/run/reconcile', {
    method: 'POST',
  });
}

