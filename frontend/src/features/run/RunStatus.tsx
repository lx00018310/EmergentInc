import React from 'react';
import type { WorldDto, RunStatusDto, WorkspaceAuditDto } from '../../api/types';
import { displayRunStatus } from './runStatusLabels';

export interface RunStatusProps {
  world: WorldDto | null;
  runStatus: RunStatusDto | null;
  audit: WorkspaceAuditDto | null;
  onOpenHelp?: () => void;
}

export const RunStatus: React.FC<RunStatusProps> = ({ world, runStatus, onOpenHelp }) => {
  const round = world?.round ?? runStatus?.current_round ?? 0;
  const pixels = world?.pixels ?? [];
  const alivePixels = pixels.filter((p) => p.active).length;
  const totalPixels = pixels.length;

  const totalEnergy = world?.metrics?.total_energy ?? (pixels.reduce((acc, p) => acc + (p.energy || 0), 0));
  // V11: 成本必须来自真实台账；未计量显示"未知"，绝不推算或当作 0
  const metrics = world?.metrics ?? {};
  const rawSpentCny = metrics.total_spent_cny;
  const hasExplicitCny = Object.prototype.hasOwnProperty.call(metrics, 'total_spent_cny') && rawSpentCny != null;
  const totalSpentCny = hasExplicitCny ? rawSpentCny : null;

  let systemHealth = runStatus ? 'READY' : 'UNKNOWN';
  let systemHealthColor = 'var(--accent-green)';

  if (runStatus?.running) {
    systemHealth = 'RUNNING';
    systemHealthColor = 'var(--accent-blue)';
  } else if (runStatus?.unfinalized_operations) {
    systemHealth = 'RECOVERY REQUIRED';
    systemHealthColor = 'var(--accent-red)';
  } else if (runStatus?.result_status === 'FAILED') {
    systemHealth = 'FAILED';
    systemHealthColor = 'var(--accent-red)';
  } else if (runStatus?.result_status === 'STOPPED') {
    systemHealth = 'STOPPED';
    systemHealthColor = 'var(--accent-yellow)';
  } else if (runStatus?.result_status === 'COMPLETED') {
    systemHealth = 'COMPLETED';
  }

  const runId = runStatus?.run_id || runStatus?.current_run || '-';

  return (
    <header className="app-header">
      <div className="logo-title">
        <span className="logo-icon">◈</span>
        <h1>EmergentInc <span className="logo-cn">元胞会社</span></h1>
        <span className="logo-sub">MIDNIGHT FOUNDRY // CELLULAR SOCIETY OBSERVATORY</span>
        <span className="badge" id="run-badge">run: {runId}</span>
      </div>
      <div className="header-metrics">
        <div className="metric-item">
          <span className="m-label">Round:</span> <span className="m-val">{round}</span>
        </div>
        <div className="metric-item">
          <span className="m-label">活跃元胞:</span>{' '}
          <span className="m-val">
            {alivePixels} / {totalPixels}
          </span>
        </div>
        <div className="metric-item">
          <span className="m-label">总能量(Tokens):</span>{' '}
          <span className="m-val">{Number(totalEnergy).toLocaleString()}</span>
        </div>
        <div className="metric-item">
          <span className="m-label">支出折算:</span>{' '}
          <span className="m-val">{totalSpentCny == null ? '未知' : `¥${Number(totalSpentCny).toFixed(2)}`}</span>
        </div>
        <div className="metric-item">
          <span className="m-label">系统状态:</span>{' '}
          <span className="m-val" style={{ color: systemHealthColor }}>
            {displayRunStatus(systemHealth)}
          </span>
        </div>
        {onOpenHelp && (
          <button
            className="btn btn-xs"
            title="V11 五层上下文说明"
            aria-label="帮助"
            onClick={onOpenHelp}
          >
            ?
          </button>
        )}
      </div>
    </header>
  );
};
