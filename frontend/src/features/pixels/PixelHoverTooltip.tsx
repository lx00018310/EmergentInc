import React from 'react';
import type { PixelSummaryDto } from '../../api/types';

export interface PixelHoverTooltipProps {
  pixel: PixelSummaryDto;
  /** 相对画布容器的像素坐标 */
  x: number;
  y: number;
}

/**
 * 悬停轻量提示：零点击展示元胞概要（ID / 能量 / 状态 / 最近动作一句话）。
 * 纯展示，pointer-events: none，不拦截 OrbitControls 交互。
 */
export const PixelHoverTooltip: React.FC<PixelHoverTooltipProps> = ({ pixel, x, y }) => {
  const activity = pixel.latest_activity ?? null;
  const actionLine = activity
    ? `R${activity.round} ${activity.action}${activity.intent ? ` · ${activity.intent}` : ''}`.slice(0, 48)
    : '暂无活动记录';

  return (
    <div
      className="pixel-tooltip"
      style={{ left: x + 14, top: y + 14 }}
      role="tooltip"
    >
      <div className="pixel-tooltip-title">
        <span className="pixel-tooltip-id">{pixel.id}</span>
        <span style={{ color: pixel.active ? 'var(--accent-blue)' : 'var(--text-dim)' }}>
          {pixel.active ? 'Active' : 'Dead'}
        </span>
      </div>
      <div className="pixel-tooltip-line">能量: {Number(pixel.energy).toLocaleString()}</div>
      <div className="pixel-tooltip-line pixel-tooltip-action">{actionLine}</div>
    </div>
  );
};
