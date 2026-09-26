import { ToolCall } from "./tool.js";

/**
 * 能量划转请求
 */
export interface EnergyTransferRequest {
  target: string;
  amount: number;
}

/**
 * 繁殖分裂请求
 */
export interface ReproduceRequest {
  direction: string;
  initial_energy: number;
}

/**
 * 模型决策结构 (由 ResponseParser 标准化输出)
 */
export interface AgentDecision {
  pixel_md?: string | null;
  tips_md?: string | null;
  environment_read?: boolean;
  operations?: ToolCall[];
  energy_transfer?: EnergyTransferRequest[];
  reproduce?: ReproduceRequest | null;
  send_to?: string | null;
  message_md?: string | null;
  owner_request?: Record<string, any> | null;
  owner_reply?: string | null;
  raw_thought?: string | null;
}
