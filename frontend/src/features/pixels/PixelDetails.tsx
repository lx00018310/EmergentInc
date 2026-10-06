import { t as tr, useLanguage } from '../../i18n';
import React, { useState } from 'react';
import type { PixelSummaryDto } from '../../api/types';

export interface PixelDetailsProps {
  pixel: PixelSummaryDto | null;
  isTipsUnread?: (pixel: PixelSummaryDto) => boolean;
  onMarkTipsRead?: (pixel: PixelSummaryDto) => void;
  onOpenDoc: (docName: string) => void;
  onOpenArtifacts: () => void;
  onOpenOperation: (tab: 'mandate' | 'reward' | 'cost') => void;
  onClose?: () => void;
}

export const PixelDetails: React.FC<PixelDetailsProps> = ({
  pixel,
  isTipsUnread,
  onMarkTipsRead,
  onOpenDoc,
  onOpenArtifacts,
  onOpenOperation,
  onClose,
}) => {
  useLanguage();
  const [collapsed, setCollapsed] = useState(false);
  if (!pixel) return null;

  const [x, y, z] = pixel.position;
  const activeNeighborsCount = pixel.neighbors?.length || 0;
  const tipsContent = (pixel.tips_md ?? '').trim();
  const tipsUnread = Boolean(isTipsUnread?.(pixel));
  const activity = pixel.latest_activity ?? null;

  return (
    <div className="pixel-hover-card">
      <div className="hover-header">
        <span className="hover-id">{pixel.id}</span>
        <span
          className="hover-status"
          style={{
            backgroundColor: pixel.active ? 'rgba(88, 166, 255, 0.2)' : 'rgba(139, 148, 158, 0.2)',
            color: pixel.active ? 'var(--accent-blue)' : 'var(--text-dim)',
          }}
        >
          {pixel.active ? 'Active' : 'Dead'}
        </span>
        <button
          className="btn btn-xs"
          title={collapsed ? (tr("展开详情")) : (tr("折叠详情"))}
          onClick={() => setCollapsed((v) => !v)}
        >
          {collapsed ? (tr("展开")) : (tr("折叠"))}
        </button>
        {onClose && (
          <button className="btn btn-xs" title={tr("关闭详情卡")} aria-label={tr("关闭详情卡")} onClick={onClose}>
            ×
          </button>
        )}
      </div>

      {/* 最近一轮活动：最高频诉求，零点击可见 */}
      <div className="latest-activity">
        <div className="h-section-title">{tr("最近一轮:")}</div>
        {activity ? (
          <div className="latest-activity-body">
            <span className="h-v">R{activity.round}</span>{' '}
            <span style={{ color: 'var(--accent-blue)' }}>{activity.action}</span>
            {activity.intent && <span> · {activity.intent}</span>}
            {activity.result && <div className="latest-activity-result">→ {activity.result}</div>}
          </div>
        ) : (
          <div className="latest-activity-body latest-activity-empty">{tr("暂无活动记录")}</div>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="hover-grid">
            <div>
              <span className="h-k">{tr("能量(Tokens):")}</span>{' '}
              <span className="h-v">{Number(pixel.energy).toLocaleString()}</span>
            </div>
            <div>
              <span className="h-k">{tr("隔离交付物:")}</span>{' '}
              <span className="h-v">{pixel.artifacts_count} {" " + tr("个")}</span>
            </div>
          </div>

          <details className="debug-props">
            <summary>{tr("调试属性")}</summary>
            <div className="hover-grid" style={{ marginTop: '6px' }}>
              <div>
                <span className="h-k">{tr("物理坐标:")}</span>{' '}
                <span className="h-v">
                  [{x}, {y}, {z}]
                </span>
              </div>
              <div>
                <span className="h-k">{tr("母体 ID:")}</span>{' '}
                <span className="h-v">{pixel.parent || 'None (Genesis)'}</span>
              </div>
              <div>
                <span className="h-k">{tr("诞生轮次:")}</span> <span className="h-v">{pixel.born_round}</span>
              </div>
              <div>
                <span className="h-k">{tr("代际世代:")}</span> <span className="h-v">{pixel.generation}</span>
              </div>
              <div>
                <span className="h-k">{tr("活跃六邻域:")}</span>{' '}
                <span className="h-v">{activeNeighborsCount}</span>
              </div>
              <div>
                <span className="h-k">{tr("心智字数:")}</span>{' '}
                <span className="h-v">{pixel.pixel_md_length} {" " + tr("字")}</span>
              </div>
            </div>
          </details>

          <div style={{ marginTop: '8px' }}>
            <div className="h-section-title">{tr("Tips (公开提醒):")}</div>
            <div
              className="pixel-md-preview"
              style={tipsUnread ? { borderLeft: '3px solid var(--accent-yellow)' } : undefined}
            >
              {tipsUnread && <div style={{ color: 'var(--accent-yellow)', marginBottom: '4px' }}>{tr("● 新提醒")}</div>}
              {tipsContent ? tipsContent : <span className="text-muted">{tr("暂无提醒")}</span>}
            </div>
            {tipsContent && (
              <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {tipsUnread ? (
                  <button className="btn btn-xs" onClick={() => onMarkTipsRead?.(pixel)}>
                    {tr("标记已读")}</button>
                ) : (
                  <span className="text-muted" style={{ fontSize: '11px' }}>{tr("已读")}</span>
                )}
                <button className="btn btn-xs" onClick={() => onOpenDoc('tips')}>
                  {tr("完整 tips.md")}</button>
              </div>
            )}
          </div>

          <div style={{ marginTop: '8px' }}>
            <div className="h-section-title">{tr("自主心智概要 (pixel.md):")}</div>
            <div className="pixel-md-preview">
              {pixel.pixel_md ? pixel.pixel_md.slice(0, 300) : '-'}
            </div>
          </div>

          <div className="hover-actions">
            <button className="btn btn-xs" onClick={() => onOpenDoc('pixel')} title="pixel.md / tips.md / state.json / environment.md">
              {tr("查看文档")}</button>
            <button className="btn btn-xs" onClick={onOpenArtifacts}>
              {tr("查看交付物")}</button>
            <button className="btn btn-xs" onClick={() => onOpenOperation('mandate')}>
              Human Mandate
            </button>
            <button className="btn btn-xs" onClick={() => onOpenOperation('reward')}>
              External Reward
            </button>
            <button className="btn btn-xs" onClick={() => onOpenOperation('cost')}>
              Step Cost
            </button>
          </div>
        </>
      )}
    </div>
  );
};
