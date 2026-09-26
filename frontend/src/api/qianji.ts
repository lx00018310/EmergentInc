import { apiRequest } from './client';

export type QianjiCareerStatus = 'candidate' | 'trial' | 'active' | 'retired';

export interface QianjiNarrativeDto {
  displayName: string;
  title?: string | null;
  roleLabel?: string | null;
  traits: Record<string, number>;
  behaviorProfile: string[];
  flaw?: string | null;
  shortBio?: string | null;
  appearanceSpec?: string | null;
  portraitAsset?: string | null;
  contentRevision?: string | null;
}

export interface QianjiProfileDto {
  qianjiId: string;
  careerStatus: QianjiCareerStatus;
  narrative: QianjiNarrativeDto;
  narrativeRevision: number;
  createdAt: number;
  retiredAt: number | null;
  retiredReason: string | null;
}

export interface QianjiBindingDto {
  bindingId: string;
  qianjiId: string;
  pixelId: string;
  incarnation: number;
  boundAt: number;
  unboundAt: number | null;
  birthEffectId: string | null;
  archiveRelativePath: string | null;
}

export interface QianjiListItemDto {
  profile: QianjiProfileDto;
  currentBinding: QianjiBindingDto | null;
  bindingHistory: QianjiBindingDto[];
  physical: {
    accountExists: boolean;
    active: boolean | null;
    energy: number | null;
    refundDeficitTokens: number | null;
    stateIncarnation: number | null;
    bindingConsistent: boolean;
  } | null;
}

export interface WorldEventDto {
  eventId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  qianjiId: string | null;
  bindingId: string | null;
  pixelId: string | null;
  roundNum: number | null;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface WorldPresentationDto {
  organizationName: string;
  hallName: string;
  sectionLabels?: Record<string, string>;
  eventLabels?: Record<string, string>;
  revision: number;
}

export interface QianjiChatTurnDto {
  turnId: string;
  qianjiId: string;
  bindingId: string;
  messageId: string;
  question: string;
  reply: string | null;
  replyCallId: string | null;
  createdAt: number;
  repliedAt: number | null;
  status: 'queued' | 'processing' | 'replied' | 'no_reply' | 'blocked' | 'failed';
}

export interface QianjiHistoryDto {
  career?: {
    modelCallCount: number; actualTokens: number; toolExecutionCount: number; trialCount: number;
    completedMissionCount: number; failedMissionCount: number; successRate: number | null;
    acceptedByMissionType: Array<{ missionType: string; count: number; evidenceIds: string[] }>;
  };
  attributed: {
    modelCalls: Array<{ callId: string; costCny: number | null; [key: string]: unknown }>;
    toolExecutions: Array<{ operationId: string; costCny: number | null; [key: string]: unknown }>;
    ledgerEntries: Array<Record<string, unknown>>;
    messages: Array<Record<string, unknown>>;
    costSummary: { totalCostCny: number | null; knownCostCny: number; unknownModelCount: number; unknownToolCount: number };
    carrierLegacy: {
      modelCalls: Array<{ callId: string; costCny: number | null; [key: string]: unknown }>;
      toolExecutions: Array<{ operationId: string; costCny: number | null; [key: string]: unknown }>;
      ledgerEntries: Array<Record<string, unknown>>;
      messages: Array<Record<string, unknown>>;
      costSummary: { totalCostCny: number | null; knownCostCny: number; unknownModelCount: number; unknownToolCount: number };
    };
  };
  events: WorldEventDto[];
  artifacts: {
    current: { bindingId: string; pixelId: string; files: Array<{ name: string; size: number }> } | null;
    archives: Array<{ bindingId: string; pixelId: string; files: Array<{ name: string; size: number }>; archivedPixelDirectoryExists: boolean }>;
  };
}

export async function fetchQianjiList(signal?: AbortSignal, careerStatus?: QianjiCareerStatus): Promise<QianjiListItemDto[]> {
  const response = await apiRequest<{ items: QianjiListItemDto[] }>(`/api/qianji${careerStatus ? `?careerStatus=${careerStatus}` : ''}`, { signal });
  return response.items;
}

export async function fetchWorldEvents(signal?: AbortSignal): Promise<WorldEventDto[]> {
  const response = await apiRequest<{ items: WorldEventDto[] }>('/api/world/events?limit=20', { signal });
  return response.items;
}

export async function fetchWorldPresentation(signal?: AbortSignal): Promise<WorldPresentationDto> {
  return apiRequest<WorldPresentationDto>('/api/world/presentation', { signal });
}

export async function fetchQianjiHistory(qianjiId: string, signal?: AbortSignal): Promise<QianjiHistoryDto> {
  return apiRequest<QianjiHistoryDto>(`/api/qianji/${encodeURIComponent(qianjiId)}/history?limit=50`, { signal });
}

export async function retireQianji(qianjiId: string, reason: string, idempotencyKey: string): Promise<void> {
  await apiRequest(`/api/qianji/${encodeURIComponent(qianjiId)}/retire`, {
    method: 'POST', body: JSON.stringify({ reason, idempotencyKey }),
  });
}

export async function fetchQianjiChat(qianjiId: string, signal?: AbortSignal): Promise<QianjiChatTurnDto[]> {
  const response = await apiRequest<{ items: QianjiChatTurnDto[] }>(`/api/qianji/${encodeURIComponent(qianjiId)}/chat?limit=50`, { signal });
  return response.items;
}

export async function postQianjiChat(qianjiId: string, content: string, idempotencyKey: string): Promise<{ turn: QianjiChatTurnDto; created: boolean }> {
  return apiRequest(`/api/qianji/${encodeURIComponent(qianjiId)}/chat`, {
    method: 'POST', body: JSON.stringify({ content, idempotencyKey }),
  });
}

export async function updateQianjiNarrative(qianjiId: string, expectedRevision: number, narrative: QianjiNarrativeDto): Promise<QianjiProfileDto> {
  const response = await apiRequest<{ profile: QianjiProfileDto }>(`/api/qianji/${encodeURIComponent(qianjiId)}/narrative`, {
    method: 'PUT', body: JSON.stringify({ expectedRevision, narrative }),
  });
  return response.profile;
}

export async function uploadQianjiPortrait(qianjiId: string, expectedRevision: number, mimeType: string, dataBase64: string): Promise<void> {
  await apiRequest(`/api/qianji/${encodeURIComponent(qianjiId)}/portrait`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, mimeType, dataBase64 }),
  });
}

export function qianjiPortraitUrl(qianjiId: string): string {
  return `/api/qianji/${encodeURIComponent(qianjiId)}/portrait`;
}

export function qianjiArtifactUrl(qianjiId: string, bindingId: string, filename: string): string {
  return `/api/qianji/${encodeURIComponent(qianjiId)}/history/artifacts/${encodeURIComponent(bindingId)}/${encodeURIComponent(filename)}`;
}
