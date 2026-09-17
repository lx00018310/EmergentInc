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
 * 模型调用完整落库记录
 */
export interface ModelCallRecord {
  callId: string;
  runId: string;
  pixelId: string;
  messageId?: string | null;
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
  outcome: ModelCallOutcome;
  createdAt: number;
}
