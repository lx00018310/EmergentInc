import { ModelCallOutcome } from "../enums.js";

/**
 * 模型用量与成本核算
 */
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  actualTokens: number;
  costCny: number;
}

/**
 * 组装后的模型请求结构
 */
export interface PreparedModelRequest {
  model: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  temperature?: number;
  maxTokens?: number;
  promptHash: string;
  estimatedTokens?: number;
  pricingRevision?: string;
}

/**
 * 模型原始响应
 */
export interface RawModelResponse {
  rawText: string;
  usage?: Partial<ModelUsage>;
}

/**
 * Pixel 单步成本台账 (V11 Cost Ledger)
 */
export interface PixelStepCost {
  pixelId: string;
  round: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  actualTokens?: number;
  modelCost: number;
  toolCost: number;
}

/**
 * 模型调用完整落库记录
 */
export interface ModelCallRecord {
  callId: string;
  runId: string;
  pixelId: string;
  messageId?: string | null;
  roundNum?: number;
  model: string;
  pricingRevision?: string | null;
  promptHash?: string | null;
  rawResponse?: string | null;
  normalizedResponse?: string | null;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  actualTokens: number;
  costCny: number;
  toolCost?: number;
  outcome: ModelCallOutcome;
  createdAt: number;
}
