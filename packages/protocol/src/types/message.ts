import { MessageStatus, SourceType } from "../enums.js";

/**
 * 消息信封契约
 */
export interface MessageEnvelope {
  messageId: string;
  runId: string | null;
  roundNum: number;
  hop: number;
  sender: string;
  recipient: string;
  content: string;
  status: MessageStatus;
  isFeedback: boolean;
  sourceType: SourceType;
  createdAt: number;
  updatedAt: number;
}

/**
 * 新消息入队参数
 */
export interface EnqueueMessageParams {
  messageId?: string;
  runId?: string | null;
  roundNum: number;
  hop?: number;
  sender: string;
  recipient: string;
  content: string;
  isFeedback?: boolean;
  sourceType?: SourceType;
  status?: MessageStatus;
}
