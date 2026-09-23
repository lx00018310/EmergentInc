import React, { useState } from 'react';
import { startRun, stopRun } from '../../api/run';
import { ApiError } from '../../api/client';
import type { RunStatusDto } from '../../api/types';
import { parseCommand } from './commandParser';

export interface RunControlsProps {
  runStatus: RunStatusDto | null;
  onOpenEnvironment: () => void;
  onOpenTools: () => void;
  onOpenPrivateFiles: () => void;
  onOpenToolExecutions: () => void;
  onLogMessage: (type: 'info' | 'success' | 'warn' | 'error', text: string) => void;
  onRefresh: () => Promise<void>;
  onReconcile?: () => Promise<void>;
}

export const RunControls: React.FC<RunControlsProps> = ({
  runStatus,
  onOpenEnvironment,
  onOpenTools,
  onOpenPrivateFiles,
  onOpenToolExecutions,
  onLogMessage,
  onRefresh,
  onReconcile,
}) => {
  const [command, setCommand] = useState<string>('');
  const [runBudget, setRunBudget] = useState<number>(100000);
  const [globalBudget, setGlobalBudget] = useState<number>(1000000);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isRunning = Boolean(runStatus?.running);
  const recoveryRequired = Boolean(runStatus?.unfinalized_operations);

  const handleStart = async (cmdText?: string) => {
    if (isSubmitting) return;

    const actualCommand = (cmdText !== undefined ? cmdText : command).trim();
    const parsed = parseCommand(actualCommand);

    if (parsed.action === 'STOP') {
      setCommand('');
      if (isRunning) {
        await handleStop();
      } else {
        onLogMessage('warn', '[STOP] 当前演化处于空闲状态，无需停止。');
      }
      return;
    }

    if (parsed.action === 'UNKNOWN') {
      onLogMessage(
        'warn',
        `[CMD WARN] 未识别指令: "${actualCommand}"。支持格式：跑10轮 / run 5 / 5轮 / 停止`
      );
      return;
    }

    if (isRunning) return;

    if (runBudget <= 0 || globalBudget <= 0) {
      onLogMessage('error', '[ERROR] 预算上限必须为大于 0 的整数 Token。');
      return;
    }

    setIsSubmitting(true);
    onLogMessage('info', `[DISPATCH] 发送推进请求：rounds=${parsed.rounds}, command="${actualCommand || '默认推进'}"...`);

    try {
      await startRun({
        rounds: parsed.rounds,
        run_budget_tokens: Number(runBudget),
        global_budget_tokens: Number(globalBudget),
      });
      onLogMessage('success', `[SUCCESS] 推进任务已成功启动 (${parsed.rounds} 轮)。`);
      setCommand('');
      await onRefresh();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        onLogMessage('error', `[API REJECT ${err.status}] ${err.detail}`);
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        onLogMessage('error', `[START FAILED] ${msg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStop = async () => {
    if (isSubmitting || !isRunning) return;
    setIsSubmitting(true);
    onLogMessage('warn', '[STOP] 正在请求停止演化调度...');
    try {
      await stopRun();
      onLogMessage('info', '[STOP ACK] 停止信号已送达。');
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onLogMessage('error', `[STOP FAILED] ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="panel-card" id="control-card">
      <div className="panel-header">
        <h2>系统控制 &amp; 演化命令</h2>
        <span
          className={`run-status-indicator ${isRunning ? 'running' : 'stopped'}`}
        >
          {isRunning ? 'RUNNING' : 'IDLE'}
        </span>
      </div>

      {isRunning && runStatus && (
        <div className="run-progress" role="status">
          <div className="run-progress-bar">
            <div
              className="run-progress-fill"
              style={{
                width:
                  runStatus.requested_rounds > 0
                    ? `${Math.min(100, (runStatus.completed_rounds / runStatus.requested_rounds) * 100)}%`
                    : '0%',
              }}
            />
          </div>
          <div className="run-progress-text">
            进度 {runStatus.completed_rounds}/{runStatus.requested_rounds} 轮 · 消息 {runStatus.messages_processed} · 模型调用 {runStatus.model_calls_completed}
          </div>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '8px',
          fontSize: '12px',
        }}
      >
        <div style={{ flex: 1 }}>
          <label htmlFor="input-run-budget">本次运行上限 (Run Tokens):</label>
          <input
            id="input-run-budget"
            className="text-input"
            type="number"
            value={runBudget}
            min={1000}
            step={1000}
            disabled={isRunning || isSubmitting}
            onChange={(e) => setRunBudget(Number(e.target.value))}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor="input-global-budget">累计总上限 (Global Tokens):</label>
          <input
            id="input-global-budget"
            className="text-input"
            type="number"
            value={globalBudget}
            min={10000}
            step={10000}
            disabled={isRunning || isSubmitting}
            onChange={(e) => setGlobalBudget(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="command-input-group">
        <input
          type="text"
          value={command}
          placeholder="输入命令，例如：跑10轮 / run 5 / 停止"
          disabled={isRunning || isSubmitting || recoveryRequired}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleStart();
            }
          }}
        />
        <button
          className="btn btn-primary"
          disabled={isRunning || isSubmitting || recoveryRequired}
          onClick={() => handleStart()}
        >
          演化推进
        </button>
        <button
          className="btn btn-danger"
          disabled={!isRunning || isSubmitting}
          onClick={handleStop}
        >
          停止
        </button>
      </div>

      <div className="quick-action-bar">
        <button
          className="btn btn-sm run-quick-btn"
          disabled={isRunning || isSubmitting || recoveryRequired}
          onClick={() => handleStart('跑1轮')}
        >
          跑 1 轮
        </button>
        <button
          className="btn btn-sm run-quick-btn"
          disabled={isRunning || isSubmitting || recoveryRequired}
          onClick={() => handleStart('跑5轮')}
        >
          跑 5 轮
        </button>
        <button
          className="btn btn-sm run-quick-btn"
          disabled={isRunning || isSubmitting || recoveryRequired}
          onClick={() => handleStart('跑10轮')}
        >
          跑 10 轮
        </button>
        <button className="btn btn-sm" onClick={onOpenEnvironment}>
          外部环境
        </button>
        <button className="btn btn-sm" onClick={onOpenTools}>
          工具目录
        </button>
        <button className="btn btn-sm" onClick={onOpenPrivateFiles}>
          私有资料
        </button>
        <button className="btn btn-sm" onClick={onOpenToolExecutions}>
          执行记录
        </button>
        {onReconcile && recoveryRequired && (
          <button
            type="button"
            className="btn btn-sm"
            style={{
              borderColor: 'var(--accent-red)',
              color: 'var(--accent-red)',
            }}
            disabled={isRunning || isSubmitting}
            onClick={() => onReconcile()}
          >
            安全对账
          </button>
        )}
      </div>
    </div>
  );
};
