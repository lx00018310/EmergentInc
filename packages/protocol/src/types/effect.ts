import { EffectStatus, EffectType } from "../enums.js";
import { ToolCall } from "./tool.js";
import { EnergyTransferRequest, ReproduceRequest } from "./decision.js";

/**
 * 基础副作用接口
 */
export interface BaseEffect {
  effectId: string;
  messageId: string;
  effectType: EffectType;
  effectIndex: number;
  payloadHash: string;
  status: EffectStatus;
  details?: Record<string, any>;
  createdAt?: number;
}

export interface UpdateMindEffect extends BaseEffect {
  effectType: "UPDATE_MIND";
  pixelId: string;
  content: string;
  /** New tips.md content when the model supplied tips_md; undefined keeps existing tips. */
  tipsContent?: string;
}

export interface CapabilityUnavailableEffect extends BaseEffect {
  effectType: "CAPABILITY_UNAVAILABLE";
  pixelId: string;
  capability: string;
  rawRequest?: Record<string, any>;
}

export interface ReadEnvironmentEffect extends BaseEffect {
  effectType: "READ_ENVIRONMENT";
  pixelId: string;
}

export interface ToolCallEffect extends BaseEffect {
  effectType: "TOOL_CALL";
  pixelId: string;
  operationId: string;
  toolCall: ToolCall;
}

export interface TransferEnergyEffect extends BaseEffect {
  effectType: "TRANSFER_ENERGY";
  fromPixelId: string;
  transfer: EnergyTransferRequest;
}

export interface ReproduceEffect extends BaseEffect {
  effectType: "REPRODUCE";
  parentPixelId: string;
  request: ReproduceRequest;
}

export interface RouteMessageEffect extends BaseEffect {
  effectType: "ROUTE_MESSAGE";
  sender: string;
  recipient: string;
  content: string;
  hop: number;
}

export interface OwnerReplyEffect extends BaseEffect {
  effectType: "OWNER_REPLY";
  pixelId: string;
  reply: string;
}

export interface EngineFeedbackEffect extends BaseEffect {
  effectType: "ENGINE_FEEDBACK";
  recipient: string;
  feedbackContent: string;
  reason: string;
}

/**
 * 统一 Effect 联合类型
 */
export type Effect =
  | UpdateMindEffect
  | CapabilityUnavailableEffect
  | ReadEnvironmentEffect
  | ToolCallEffect
  | TransferEnergyEffect
  | ReproduceEffect
  | RouteMessageEffect
  | OwnerReplyEffect
  | EngineFeedbackEffect;
