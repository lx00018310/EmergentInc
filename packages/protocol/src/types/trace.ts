/**
 * 链路跟踪上下文
 */
export interface TraceContext {
  runId: string;
  round: number;
  pixelId?: string;
  messageId?: string;
  modelCallId?: string;
  operationId?: string;
  effectId?: string;
}
