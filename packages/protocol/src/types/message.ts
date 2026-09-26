import { MessageStatus, SourceType } from "../enums.js";

/**
 * 消息信封契约
 */
export interface MessageEnvelope {
  messageId: string;
  runId: string | null;
  executionId?: string | null;
  roundNum: number;
  hop: number;
  sender: string;
  recipient: string;
  content: string;
  status: MessageStatus;
  abandonedReason?: string | null;
  isFeedback: boolean;
  sourceType: SourceType;
  senderBindingId?: string | null;
  recipientBindingId?: string | null;
  bindingSnapshotCaptured?: boolean;
  narrativeRevision?: number | null;
  identitySnapshotCaptured?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * 新消息入队参数
 */
export interface EnqueueMessageParams {
  messageId?: string;
  runId?: string | null;
  executionId?: string | null;
  roundNum: number;
  hop?: number;
  sender: string;
  recipient: string;
  content: string;
  isFeedback?: boolean;
  sourceType?: SourceType;
  status?: MessageStatus;
  senderBindingId?: string | null;
  recipientBindingId?: string | null;
}
