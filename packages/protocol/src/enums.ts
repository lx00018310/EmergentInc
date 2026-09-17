/**
 * EmergentInc V10 协议层：统一状态枚举定义
 */

/**
 * 消息处理生命周期状态
 * 
 * 正常流转路径：
 * QUEUED → PROCESSING → RESERVED → CALLING → RESPONSE_STORED → COMMITTED
 */
export type MessageStatus =
  | "QUEUED"
  | "PROCESSING"
  | "RESERVED"
  | "CALLING"
  | "RESPONSE_STORED"
  | "COMMITTED"
  | "WAITING_PIXEL_BUDGET"
  | "WAITING_RUN_BUDGET"
  | "CALL_OUTCOME_UNKNOWN";

export const MESSAGE_STATUSES: Record<MessageStatus, MessageStatus> = {
  QUEUED: "QUEUED",
  PROCESSING: "PROCESSING",
  RESERVED: "RESERVED",
  CALLING: "CALLING",
  RESPONSE_STORED: "RESPONSE_STORED",
  COMMITTED: "COMMITTED",
  WAITING_PIXEL_BUDGET: "WAITING_PIXEL_BUDGET",
  WAITING_RUN_BUDGET: "WAITING_RUN_BUDGET",
  CALL_OUTCOME_UNKNOWN: "CALL_OUTCOME_UNKNOWN",
};

/**
 * Run 状态枚举
 */
export type RunStatus =
  | "RUNNING"
  | "COMPLETED"
  | "STOPPED"
  | "PAUSED_RECOVERY_REQUIRED"
  | "FAILED";

/**
 * 模型调用结果
 */
export type ModelCallOutcome =
  | "SUCCESS"
  | "CALL_OUTCOME_UNKNOWN"
  | "CALL_OUTCOME_RECONCILED"
  | "INFRASTRUCTURE_FAILURE"
  | "MODEL_RESPONSE_INVALID";

/**
 * 工具执行状态
 */
export type ToolExecutionStatus =
  | "STARTED"
  | "SUCCESS"
  | "FAILED"
  | "UNKNOWN"
  | "SKIPPED";

/**
 * 副作用处理状态
 */
export type EffectStatus =
  | "PENDING"
  | "APPLIED"
  | "FAILED"
  | "SKIPPED"
  | "UNKNOWN";

/**
 * 调度/运行终止原因
 */
export type StopReason =
  | "USER_STOPPED"
  | "ROUND_LIMIT_REACHED"
  | "MESSAGE_LIMIT_REACHED"
  | "RUN_BUDGET_EXHAUSTED"
  | "GLOBAL_BUDGET_EXHAUSTED"
  | "ACTIVE_PIXELS_ZERO"
  | "NO_ACTIVE_MESSAGES"
  | "INFRASTRUCTURE_FAILURE"
  | "MODEL_RESPONSE_INVALID"
  | "CALL_OUTCOME_UNKNOWN"
  | "TOOL_OUTCOME_UNKNOWN"
  | "PAUSED_RECOVERY_REQUIRED"
  | "READ_LOOP_THRESHOLD_REACHED";

/**
 * 副作用类型
 */
export type EffectType =
  | "UPDATE_MIND"
  | "CAPABILITY_UNAVAILABLE"
  | "READ_ENVIRONMENT"
  | "TOOL_CALL"
  | "TRANSFER_ENERGY"
  | "REPRODUCE"
  | "ROUTE_MESSAGE"
  | "ENGINE_FEEDBACK";

/**
 * 消息来源类型
 */
export type SourceType = "pixel" | "system" | "human" | "material" | "environment" | "feedback";
