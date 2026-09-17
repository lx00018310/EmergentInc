/**
 * 元胞相关协议定义
 */

export interface PixelPosition {
  x: number;
  y: number;
}

export interface PixelState {
  pixelId: string;
  position: PixelPosition;
  energy: number;
  active: boolean;
  parentPixelId?: string | null;
  generation: number;
  createdAtRound: number;
  lastActiveRound: number;
  refundDeficitTokens?: number;
  spendBlockedReason?: string | null;
}

export interface PixelAccount {
  pixelId: string;
  energy: number;
  active: boolean;
  refundDeficitTokens: number;
  spendBlockedReason: string | null;
  updatedAt: number;
}

export interface NeighborInfo {
  pixelId: string;
  position: PixelPosition;
  active: boolean;
  distance: number;
}
