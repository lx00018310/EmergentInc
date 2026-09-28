import { apiRequest } from './client';
import type { QianjiProfileDto } from './qianji';

export type GachaResult = { profile: QianjiProfileDto; error: string | null };
export type DrawInput =
  | { mode: 'random'; count: 1 | 10; idempotencyKey: string }
  | { mode: 'appointed'; count: 1; idempotencyKey: string; name?: string; role: string; concept: string }
  | { mode: 'github'; count: 1; idempotencyKey: string; role: string };

export async function drawGacha(body: DrawInput): Promise<GachaResult[]> {
  return (await apiRequest<{ items: GachaResult[] }>('/api/gacha/draw', { method: 'POST', body: JSON.stringify(body) })).items;
}

export async function getGacha(id: string): Promise<GachaResult> {
  return apiRequest<GachaResult>(`/api/gacha/${encodeURIComponent(id)}`);
}

export async function retryGacha(id: string): Promise<GachaResult> {
  return apiRequest<GachaResult>(`/api/gacha/${encodeURIComponent(id)}/retry`, { method: 'POST', body: JSON.stringify({}) });
}

export async function generateGachaImage(id: string): Promise<GachaResult> {
  return apiRequest<GachaResult>(`/api/gacha/${encodeURIComponent(id)}/image`, { method: 'POST', body: JSON.stringify({}) });
}

export interface GachaHistoryPage {
  items: GachaResult[];
  counts: Record<'N' | 'R' | 'SR' | 'SSR', number>;
  total: number;
  nextCursor: { createdAt: number; qianjiId: string } | null;
}

export async function listGachaHistory(cursor?: GachaHistoryPage['nextCursor']): Promise<GachaHistoryPage> {
  const params = new URLSearchParams({ limit: '50' });
  if (cursor) { params.set('beforeCreatedAt', String(cursor.createdAt)); params.set('beforeId', cursor.qianjiId); }
  return apiRequest<GachaHistoryPage>(`/api/gacha/history?${params}`);
}
