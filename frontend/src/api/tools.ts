import { apiRequest } from './client';
import type { ToolSpecDto, ToolExecutionDto } from './types';

export async function fetchToolsCatalog(signal?: AbortSignal): Promise<{ tools: ToolSpecDto[] }> {
  return apiRequest<{ tools: ToolSpecDto[] }>('/api/tools', { signal });
}

export interface ToolExecutionsQuery {
  run_id?: string;
  pixel_id?: string;
  limit?: number;
}

export async function fetchToolExecutions(
  query: ToolExecutionsQuery = {},
  signal?: AbortSignal
): Promise<{ executions: ToolExecutionDto[] }> {
  const params = new URLSearchParams();
  if (query.run_id) params.set('run_id', query.run_id);
  if (query.pixel_id) params.set('pixel_id', query.pixel_id);
  if (query.limit) params.set('limit', String(query.limit));

  const qs = params.toString();
  const endpoint = qs ? `/api/tool-executions?${qs}` : '/api/tool-executions';
  return apiRequest<{ executions: ToolExecutionDto[] }>(endpoint, { signal });
}
