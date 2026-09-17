import { TraceContext } from "./trace.js";
import { PixelState } from "./pixel.js";
import { MessageEnvelope } from "./message.js";
import { AgentDecision } from "./decision.js";
import { Effect } from "./effect.js";
import { ModelUsage } from "./model.js";

/**
 * 步骤输入契约
 */
export interface AgentStepInput {
  trace: TraceContext;
  pixelState: PixelState;
  pixelMind: string;
  message: MessageEnvelope;
  round: number;
}

/**
 * 步骤执行结果契约
 */
export interface AgentStepResult {
  decision: AgentDecision;
  usage?: ModelUsage;
  effects: Effect[];
  trace: TraceContext;
}
