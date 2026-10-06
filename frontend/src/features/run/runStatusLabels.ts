import { t as tr } from '../../i18n';
const stopReasonLabels: Record<string, string> = {
  get USER_STOPPED() { return tr("用户手动停止"); },
  get ROUND_LIMIT_REACHED() { return tr("已达到设定轮数"); },
  get MESSAGE_LIMIT_REACHED() { return tr("已达到单轮消息上限"); },
  get RUN_BUDGET_EXHAUSTED() { return tr("本次运行 Token 预算已耗尽"); },
  get GLOBAL_BUDGET_EXHAUSTED() { return tr("历史运行触发了旧版累计 Token 上限"); },
  get ACTIVE_PIXELS_ZERO() { return tr("没有活跃 Pixel"); },
  get NO_ACTIVE_MESSAGES() { return tr("没有可处理的消息"); },
  get INFRASTRUCTURE_FAILURE() { return tr("系统运行故障"); },
  get MODEL_RESPONSE_INVALID() { return tr("模型响应无效"); },
  get CALL_OUTCOME_UNKNOWN() { return tr("模型调用结果未知"); },
  get TOOL_OUTCOME_UNKNOWN() { return tr("工具执行结果未知"); },
  get PAUSED_RECOVERY_REQUIRED() { return tr("需要处理未决操作"); },
  get READ_LOOP_THRESHOLD_REACHED() { return tr("连续只读循环达到停机阈值"); },
};

const runStatusLabels: Record<string, string> = {
  get UNKNOWN() { return tr("状态未知"); },
  get READY() { return tr("就绪"); },
  get RUNNING() { return tr("运行中"); },
  get STOPPED() { return tr("已停止"); },
  get COMPLETED() { return tr("已完成"); },
  get FAILED() { return tr("失败"); },
  get PAUSED_RECOVERY_REQUIRED() { return tr("需要处理未决操作"); },
  get 'RECOVERY REQUIRED'() { return tr("需要处理未决操作"); },
  get RECOVERY_RESOLVED() { return tr("未决操作已处理"); },
};

export const displayStopReason = (reason: string | null | undefined): string =>
  reason ? (stopReasonLabels[reason] ?? reason) : '';

export const displayRunStatus = (status: string | null | undefined): string =>
  status ? (runStatusLabels[status] ?? status) : '';
