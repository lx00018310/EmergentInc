import React from 'react';
import type { WorldDto, RunStatusDto, WorkspaceAuditDto } from '../../api/types';

export interface RunStatusProps {
  world: WorldDto | null;
  runStatus: RunStatusDto | null;
  audit: WorkspaceAuditDto | null;
}

export const RunStatus: React.FC<RunStatusProps> = ({ world, runStatus, audit }) => {
  const round = world?.round ?? runStatus?.current_round ?? 0;
  const pixels = world?.pixels ?? [];
  const alivePixels = pixels.filter((p) => p.active).length;
  const totalPixels = pixels.length;

  const totalEnergy = world?.metrics?.total_energy ?? (pixels.reduce((acc, p) => acc + (p.energy || 0), 0));
  const totalSpentTokens = world?.metrics?.total_spent_tokens ?? 0;
  const totalSpentCny = world?.metrics?.total_spent_cny ?? (Number(totalSpentTokens) / 1000000 * 15);

  let systemHealth = 'READY';
  let systemHealthColor = '#48bb78';

  if (runStatus?.running) {
    systemHealth = 'RUNNING';
    systemHealthColor = 'var(--accent-blue)';
  } else if (audit?.recovery_required || runStatus?.result_status === 'RECOVERY_REQUIRED') {
    systemHealth = 'RECOVERY REQUIRED';
    systemHealthColor = 'var(--accent-red)';
  } else if (runStatus?.last_error) {
    systemHealth = 'ERROR';
    systemHealthColor = 'var(--accent-red)';
  }

  const runId = runStatus?.run_id || runStatus?.current_run || '-';

  return (
    <header className="app-header">
      <div className="logo-title">
        <span className="logo-icon">▣</span>
        <h1>EmergentInc V9 商业元胞自动机</h1>
        <span className="badge" id="run-badge">
          run: {runId}
        </span>
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
          <span className="m-val">¥{Number(totalSpentCny).toFixed(2)}</span>
        </div>
        <div className="metric-item">
          <span className="m-label">系统状态:</span>{' '}
          <span className="m-val" style={{ color: systemHealthColor }}>
            {systemHealth}
          </span>
        </div>
      </div>
    </header>
  );
};
