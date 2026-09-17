import { apiRequest } from './client';
import type { WorldDto, WorkspaceAuditDto } from './types';

export async function fetchWorld(signal?: AbortSignal): Promise<WorldDto> {
  return apiRequest<WorldDto>('/api/world', { signal });
}

export async function fetchWorkspaceAudit(signal?: AbortSignal): Promise<WorkspaceAuditDto> {
  return apiRequest<WorkspaceAuditDto>('/api/audit/workspace', { signal });
}
