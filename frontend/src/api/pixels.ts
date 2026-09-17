/**
 * Pixel 级 Human Mandate / External Reward / Step Cost 客户端 (V11)
 */
import { apiRequest } from './client';
import type {
  MandateDto,
  ExternalRewardDto,
  StepCostDto,
} from './types';

function encPixel(pixelId: string): string {
  return encodeURIComponent(pixelId);
}

// ---------- Human Mandate (独立 External Input) ----------

export async function fetchMandate(pixelId: string, signal?: AbortSignal): Promise<MandateDto> {
  return apiRequest<MandateDto>(`/api/pixels/${encPixel(pixelId)}/mandate`, { signal });
}

export async function updateMandate(
  pixelId: string,
  mandate: string,
  signal?: AbortSignal
): Promise<MandateDto> {
  return apiRequest<MandateDto>(
    `/api/pixels/${encPixel(pixelId)}/mandate`,
    { method: 'PUT', body: JSON.stringify({ mandate }), signal }
  );
}

export async function deleteMandate(
  pixelId: string,
  signal?: AbortSignal
): Promise<{ pixel_id: string; status: string }> {
  return apiRequest<{ pixel_id: string; status: string }>(
    `/api/pixels/${encPixel(pixelId)}/mandate`,
    { method: 'DELETE', signal }
  );
}

// ---------- External Reward ----------

export interface RewardRequest {
  amount: number;
  reason?: string;
  source?: string;
}

export async function postExternalReward(
  pixelId: string,
  req: RewardRequest,
  signal?: AbortSignal
): Promise<{ newBalance: number; [key: string]: unknown }> {
  return apiRequest<{ newBalance: number; [key: string]: unknown }>(
    `/api/pixels/${encPixel(pixelId)}/reward`,
    { method: 'POST', body: JSON.stringify(req), signal }
  );
}

export async function fetchExternalRewards(
  pixelId: string,
  signal?: AbortSignal
): Promise<{ pixel_id: string; rewards: ExternalRewardDto[] }> {
  return apiRequest<{ pixel_id: string; rewards: ExternalRewardDto[] }>(
    `/api/pixels/${encPixel(pixelId)}/rewards`,
    { signal }
  );
}

// ---------- Step Cost 观察 ----------

export async function fetchStepCosts(
  pixelId: string,
  signal?: AbortSignal
): Promise<{ pixel_id: string; costs: StepCostDto[] }> {
  return apiRequest<{ pixel_id: string; costs: StepCostDto[] }>(
    `/api/pixels/${encPixel(pixelId)}/step-costs`,
    { signal }
  );
}
