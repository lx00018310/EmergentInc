import { apiRequest } from './client';
import type { PromptDto, EnvironmentResponseDto } from './types';

export async function fetchGenesisPrompt(signal?: AbortSignal): Promise<PromptDto> {
  return apiRequest<PromptDto>('/api/genesis-prompt', { signal });
}

export async function updateGenesisPrompt(content: string): Promise<PromptDto> {
  return apiRequest<PromptDto>('/api/genesis-prompt', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function fetchTemporaryPrompt(signal?: AbortSignal): Promise<PromptDto> {
  return apiRequest<PromptDto>('/api/temporary-prompt', { signal });
}

export async function updateTemporaryPrompt(content: string): Promise<PromptDto> {
  return apiRequest<PromptDto>('/api/temporary-prompt', {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function fetchEnvironment(signal?: AbortSignal): Promise<EnvironmentResponseDto> {
  return apiRequest<EnvironmentResponseDto>('/api/environment', { signal });
}

export async function updateEnvironment(content: string): Promise<{ status: string; length: number }> {
  return apiRequest<{ status: string; length: number }>('/api/environment', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}
