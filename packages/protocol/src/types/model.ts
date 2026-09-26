import { ModelCallOutcome } from "../enums.js";

/**
 * 模型用量与成本核算
 */
export interface ModelUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  actualTokens: number | null;
  costCny: number | null;
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
  callId: string;
  runId: string;
  outcome: ModelCallOutcome;
  pixelId: string;
  round: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  actualTokens?: number | null;
  modelCost: number | null;
  toolCost: number | null;
}

/** Aggregate known subtotals are not a substitute for nullable complete totals. */
export interface CostSummary {
  totalCostCny: number | null;
  knownCostCny: number;
  modelCostCny: number | null;
  toolCostCny: number | null;
  unknownModelCount: number;
  unknownToolCount: number;
}

/**
 * 模型调用完整落库记录
 */
export interface ModelCallRecord {
  callId: string;
  runId: string;
  executionId?: string | null;
  pixelId: string;
  messageId?: string | null;
  bindingId?: string | null;
  narrativeRevision?: number | null;
  roundNum?: number | null;
  model: string;
  pricingRevision?: string | null;
  promptHash?: string | null;
  rawResponse?: string | null;
  normalizedResponse?: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedTokens: number | null;
  actualTokens: number | null;
  costCny: number | null;
  toolCost?: number | null;
  outcome: ModelCallOutcome;
  createdAt: number;
}
