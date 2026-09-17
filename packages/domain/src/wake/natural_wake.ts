/**
 * 自然唤醒规则 (Domain Logic)
 */

export interface NaturalWakeCheckParams {
  pixelId: string;
  active: boolean;
  lastActiveRound: number;
  currentRound: number;
  naturalWakeThreshold: number;
  hasPendingMessages: boolean;
}

export function shouldNaturalWake(params: NaturalWakeCheckParams): boolean {
  if (!params.active) return false;
  if (params.hasPendingMessages) return false;
  const idleRounds = params.currentRound - params.lastActiveRound;
  return idleRounds >= params.naturalWakeThreshold;
}
