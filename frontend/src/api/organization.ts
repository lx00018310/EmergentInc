import { apiRequest } from './client';

export type MissionStatus = 'draft' | 'issued' | 'running' | 'awaiting_acceptance' | 'completed' | 'failed' | 'cancelled';
export interface MissionDto {
  missionId: string; title: string; missionType: string; objective: string; acceptanceCriteria: string;
  budgetTokens: number; roundsLimit: number; deadlineRound: number | null; status: MissionStatus;
  ownerQianjiId: string; acceptanceNote: string | null; createdAt: number; completedAt: number | null;
  executionId: string | null; participants: Array<{ qianjiId: string; bindingId: string; duty: string | null }>;
  execution?: { status: string; roundsUsed: number; roundsLimit: number; spentTokens: number; reservedTokens: number; budgetTokens: number } | null;
}
export interface CandidateDto {
  candidateId: string; qianjiId: string; bindingId: string; executionId: string; ordinal: number;
  selected: boolean; evidence: unknown[] | null;
  execution?: { status: string; spentTokens: number; reservedTokens: number; roundsUsed: number; roundsLimit: number;
    knownCostCny: number; totalCostCny: number | null; unknownModelCount: number; unknownToolCount: number;
    stopReason: string | null; errorSummary: string | null; evidence: Array<{ evidenceId: string; sha256: string | null; sizeBytes: number | null }> } | null;
}
export interface TrialDto {
  trialId: string; recruitmentId: string | null; challengeText: string; acceptanceCriteria: string;
  totalBudgetTokens: number; candidateBudgetTokens: number; roundsPerCandidate: number; allowedTools: string[];
  modelName: string; status: 'draft' | 'running' | 'awaiting_selection' | 'completed' | 'cancelled';
  winnerQianjiId: string | null; decisionReason: string | null; pauseReason: string | null; candidates: CandidateDto[];
}
export interface ProductDto {
  productId: string; name: string; description: string; targetUser: string; problemStatement: string;
  ownerQianjiId: string; status: 'idea' | 'validation' | 'building' | 'live' | 'paused' | 'retired';
  previousStatus: string | null; retirementReason: string | null; createdAt: number; missions: string[];
}
export interface RevenueDto {
  externalTxId: string; amountFen: number | null; currency: string | null; productId: string | null;
  missionId: string | null; primaryQianjiId: string | null; evidenceRef: string | null; recordSource: string; refundFen: number;
  verified: boolean; contributions: Array<{ qianjiId: string; shareBps: number }>;
}

const post = <T>(url: string, body: unknown) => apiRequest<T>(url, { method: 'POST', body: JSON.stringify(body) });

export async function listMissions(): Promise<MissionDto[]> { return (await apiRequest<{ items: MissionDto[] }>('/api/missions')).items; }
export const createMission = (body: unknown) => post<MissionDto>('/api/missions', body);
export const issueMission = (id: string) => post<MissionDto>(`/api/missions/${encodeURIComponent(id)}/issue`, {});
export const startMission = (id: string, rounds = 1) => post(`/api/missions/${encodeURIComponent(id)}/start`, { rounds });
export const resumeMission = (id: string, rounds = 1) => post(`/api/missions/${encodeURIComponent(id)}/resume`, { rounds });
export async function missionEvidence(id: string) { return (await apiRequest<{ evidence: Array<{ evidenceId: string; sha256: string | null; sizeBytes: number | null }> }>(`/api/missions/${encodeURIComponent(id)}/evidence`)).evidence; }
export const acceptMission = (id: string, body: unknown) => post<MissionDto>(`/api/missions/${encodeURIComponent(id)}/accept`, body);
export const cancelMission = (id: string, reason: string) => post<MissionDto>(`/api/missions/${encodeURIComponent(id)}/cancel`, { reason });

export async function listRecruitments() { return (await apiRequest<{ items: any[] }>('/api/recruitments')).items; }
export const createRecruitment = (body: unknown) => post<any>('/api/recruitments', body);
export async function listTrials(): Promise<TrialDto[]> { return (await apiRequest<{ items: TrialDto[] }>('/api/trials')).items; }
export const createTrial = (body: unknown) => post<TrialDto>('/api/trials', body);
export const addTrialCandidate = (id: string, body: unknown) => post<CandidateDto>(`/api/trials/${encodeURIComponent(id)}/candidates`, body);
export const startTrial = (id: string) => post(`/api/trials/${encodeURIComponent(id)}/start`, {});
export const resumeTrial = (id: string, rounds?: number) => post(`/api/trials/${encodeURIComponent(id)}/resume`, rounds ? { rounds } : {});
export const decideTrial = (id: string, body: unknown) => post<TrialDto>(`/api/trials/${encodeURIComponent(id)}/select`, body);
export const cancelTrial = (id: string, reason: string) => post<TrialDto>(`/api/trials/${encodeURIComponent(id)}/cancel`, { reason });

export async function listProducts(): Promise<ProductDto[]> { return (await apiRequest<{ items: ProductDto[] }>('/api/products')).items; }
export const createProduct = (body: unknown) => post<ProductDto>('/api/products', body);
export const transitionProduct = (id: string, status: string, reason?: string) => post<ProductDto>(`/api/products/${encodeURIComponent(id)}/transition`, { status, ...(reason ? { reason } : {}) });
export const linkProductMission = (id: string, missionId: string) => post<ProductDto>(`/api/products/${encodeURIComponent(id)}/missions`, { missionId });
export async function listFeedback(productId?: string): Promise<any[]> { return (await apiRequest<{ items: any[] }>(`/api/feedback${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`)).items; }
export const createFeedback = (body: unknown) => post<any>('/api/feedback', body);
export async function listDeliveries(productId?: string): Promise<any[]> { return (await apiRequest<{ items: any[] }>(`/api/deliveries${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`)).items; }
export const createDelivery = (body: unknown) => post<any>('/api/deliveries', body);
export const transitionDelivery = (id: string, status: string, note?: string) => post<any>(`/api/deliveries/${encodeURIComponent(id)}/transition`, { status, ...(note ? { note } : {}) });
export async function listRevenues(): Promise<RevenueDto[]> { return (await apiRequest<{ items: RevenueDto[] }>('/api/revenues')).items; }
export const createRevenue = (body: unknown) => post<RevenueDto>('/api/revenues', body);
export const createRefund = (txId: string, body: unknown) => post<any>(`/api/revenues/${encodeURIComponent(txId)}/refunds`, body);
export const businessMetrics = (scope = 'organization', id?: string) => apiRequest<any>(`/api/business/metrics?scope=${scope}${id ? `&id=${encodeURIComponent(id)}` : ''}`);
export const exportFacts = (from: string, to: string) => apiRequest<any>(`/api/narrative/export?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
export const createNarrativeArtifact = (body: unknown) => post<any>('/api/narrative/artifacts', body);
export interface ChronicleEventDto {
  eventId: string; eventType: string; subjectType: string; subjectId: string; qianjiId: string | null;
  bindingId: string | null; pixelId: string | null; createdAt: number; payload: Record<string, unknown>;
}
export interface ChronicleDto {
  period: { from: string; to: string }; events: ChronicleEventDto[];
  narratives: Array<{ artifactId: string; title: string; body: string; sourceEventIds: string[]; sourceMissionIds: string[]; contentRevision: number; createdAt: number }>;
}
export async function listNarrativeArtifacts() { return (await apiRequest<{ items: ChronicleDto['narratives'] }>('/api/narrative/artifacts')).items; }
export async function listChronicle(filters: { from: string; to: string; qianjiId?: string; missionId?: string; productId?: string; limit?: number }): Promise<ChronicleDto> {
  const params = new URLSearchParams({ from: filters.from, to: filters.to, limit: String(filters.limit ?? 100) });
  if (filters.qianjiId) params.set('qianjiId', filters.qianjiId);
  if (filters.missionId) params.set('missionId', filters.missionId);
  if (filters.productId) params.set('productId', filters.productId);
  return apiRequest<ChronicleDto>(`/api/chronicle?${params.toString()}`);
}
