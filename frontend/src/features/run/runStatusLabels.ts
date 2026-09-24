const stopReasonLabels: Record<string, string> = {
  USER_STOPPED: '用户手动停止',
  ROUND_LIMIT_REACHED: '已达到设定轮数',
  MESSAGE_LIMIT_REACHED: '已达到单轮消息上限',
  RUN_BUDGET_EXHAUSTED: '本次运行 Token 预算已耗尽',
  GLOBAL_BUDGET_EXHAUSTED: '历史运行触发了旧版累计 Token 上限',
  ACTIVE_PIXELS_ZERO: '没有活跃 Pixel',
  NO_ACTIVE_MESSAGES: '没有可处理的消息',
  INFRASTRUCTURE_FAILURE: '系统运行故障',
  MODEL_RESPONSE_INVALID: '模型响应无效',
  CALL_OUTCOME_UNKNOWN: '模型调用结果未知',
  TOOL_OUTCOME_UNKNOWN: '工具执行结果未知',
  PAUSED_RECOVERY_REQUIRED: '需要处理未决操作',
  READ_LOOP_THRESHOLD_REACHED: '连续只读循环达到停机阈值',
};

const runStatusLabels: Record<string, string> = {
  UNKNOWN: '状态未知',
  READY: '就绪',
  RUNNING: '运行中',
  STOPPED: '已停止',
  COMPLETED: '已完成',
  FAILED: '失败',
  PAUSED_RECOVERY_REQUIRED: '需要处理未决操作',
  'RECOVERY REQUIRED': '需要处理未决操作',
  RECOVERY_RESOLVED: '未决操作已处理',
};

export const displayStopReason = (reason: string | null | undefined): string =>
  reason ? (stopReasonLabels[reason] ?? reason) : '';

export const displayRunStatus = (status: string | null | undefined): string =>
  status ? (runStatusLabels[status] ?? status) : '';
