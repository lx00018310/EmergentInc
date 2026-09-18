import React from 'react';
import type { PixelSummaryDto } from '../../api/types';

export interface PixelDetailsProps {
  pixel: PixelSummaryDto | null;
  isTipsUnread?: (pixel: PixelSummaryDto) => boolean;
  onMarkTipsRead?: (pixel: PixelSummaryDto) => void;
  onOpenDoc: (docName: string) => void;
  onOpenArtifacts: () => void;
  onOpenOperation: (tab: 'mandate' | 'reward' | 'cost') => void;
}

export const PixelDetails: React.FC<PixelDetailsProps> = ({
  pixel,
  isTipsUnread,
  onMarkTipsRead,
  onOpenDoc,
  onOpenArtifacts,
  onOpenOperation,
}) => {
  if (!pixel) return null;

  const [x, y, z] = pixel.position;
  const activeNeighborsCount = pixel.neighbors?.length || 0;
  const tipsContent = (pixel.tips_md ?? '').trim();
  const tipsUnread = Boolean(isTipsUnread?.(pixel));

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
      </div>

      <div className="hover-grid">
        <div>
          <span className="h-k">物理坐标:</span>{' '}
          <span className="h-v">
            [{x}, {y}, {z}]
          </span>
        </div>
        <div>
          <span className="h-k">能量(Tokens):</span>{' '}
          <span className="h-v">{Number(pixel.energy).toLocaleString()}</span>
        </div>
        <div>
          <span className="h-k">母体 ID:</span>{' '}
          <span className="h-v">{pixel.parent || 'None (Genesis)'}</span>
        </div>
        <div>
          <span className="h-k">诞生轮次:</span> <span className="h-v">{pixel.born_round}</span>
        </div>
        <div>
          <span className="h-k">代际世代:</span> <span className="h-v">{pixel.generation}</span>
        </div>
        <div>
          <span className="h-k">活跃六邻域:</span>{' '}
          <span className="h-v">{activeNeighborsCount}</span>
        </div>
        <div>
          <span className="h-k">隔离交付物:</span>{' '}
          <span className="h-v">{pixel.artifacts_count} 个</span>
        </div>
        <div>
          <span className="h-k">心智字数:</span>{' '}
          <span className="h-v">{pixel.pixel_md_length} 字</span>
        </div>
      </div>

      <div style={{ marginTop: '8px' }}>
        <div className="h-section-title">Tips (公开提醒):</div>
        <div
          className="pixel-md-preview"
          style={tipsUnread ? { borderLeft: '3px solid #e3b341' } : undefined}
        >
          {tipsUnread && <div style={{ color: '#e3b341', marginBottom: '4px' }}>● 新提醒</div>}
          {tipsContent ? tipsContent : <span style={{ color: '#8b949e' }}>暂无提醒</span>}
        </div>
        {tipsContent && (
          <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {tipsUnread ? (
              <button className="btn btn-xs" onClick={() => onMarkTipsRead?.(pixel)}>
                标记已读
              </button>
            ) : (
              <span style={{ color: '#8b949e', fontSize: '11px' }}>已读</span>
            )}
            <button className="btn btn-xs" onClick={() => onOpenDoc('tips')}>
              完整 tips.md
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: '8px' }}>
        <div className="h-section-title">自主心智概要 (pixel.md):</div>
        <div className="pixel-md-preview">
          {pixel.pixel_md ? pixel.pixel_md.slice(0, 300) : '-'}
        </div>
      </div>

      <div className="hover-actions">
        <button className="btn btn-xs" onClick={() => onOpenDoc('pixel')}>
          完整 pixel.md
        </button>
        <button className="btn btn-xs" onClick={() => onOpenDoc('state')}>
          物理 state.json
        </button>
        <button className="btn btn-xs" onClick={() => onOpenDoc('environment')}>
          全局 environment.md
        </button>
        <button className="btn btn-xs" onClick={onOpenArtifacts}>
          查看交付物
        </button>
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
    </div>
  );
};
