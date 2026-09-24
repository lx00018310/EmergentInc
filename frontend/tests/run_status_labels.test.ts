import { describe, expect, it } from 'vitest';
import { displayRunStatus, displayStopReason } from '../src/features/run/runStatusLabels';

describe('运行状态中文显示', () => {
  it('把运行结束原因显示为中文', () => {
    expect(displayStopReason('ROUND_LIMIT_REACHED')).toBe('已达到设定轮数');
    expect(displayStopReason('GLOBAL_BUDGET_EXHAUSTED')).toBe('历史运行触发了旧版累计 Token 上限');
    expect(displayStopReason('NO_ACTIVE_MESSAGES')).toBe('没有可处理的消息');
  });

  it('把状态显示为中文，未知代码仍保留供诊断', () => {
    expect(displayRunStatus('COMPLETED')).toBe('已完成');
    expect(displayStopReason('NEW_REASON')).toBe('NEW_REASON');
  });
});
