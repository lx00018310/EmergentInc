import React, { useMemo, useState } from 'react';
import type { PixelSummaryDto } from '../../api/types';

export interface PixelListPanelProps {
  pixels: PixelSummaryDto[];
  selectedPixelId: string | null;
  unreadTipsPixelIds?: Set<string>;
  onSelectPixel: (pixelId: string) => void;
}

/**
 * 元胞列表视图：按能量排序、可按 ID 搜索，作为 3D 视图的快速定位互补。
 */
export const PixelListPanel: React.FC<PixelListPanelProps> = ({
  pixels,
  selectedPixelId,
  unreadTipsPixelIds,
  onSelectPixel,
}) => {
  const [query, setQuery] = useState('');

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...pixels]
      .filter((p) => !q || p.id.toLowerCase().includes(q))
      .sort((a, b) => (Number(b.energy) || 0) - (Number(a.energy) || 0));
  }, [pixels, query]);

  return (
    <div className="pixel-list-panel">
      <input
        className="text-input"
        type="text"
        placeholder={`搜索元胞 ID (${pixels.length})…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: '6px' }}
      />
      <div className="pixel-list-body">
        {sorted.length === 0 && <div className="text-muted" style={{ padding: '8px' }}>无匹配元胞</div>}
        {sorted.map((p) => {
          const unread = unreadTipsPixelIds?.has(p.id);
          return (
            <div
              key={p.id}
              className={`pixel-list-row ${p.id === selectedPixelId ? 'selected' : ''}`}
              onClick={() => onSelectPixel(p.id)}
              role="button"
            >
              <span className="pixel-list-id" style={{ color: p.active ? 'var(--accent-blue)' : 'var(--text-dim)' }}>
                {unread ? '● ' : ''}{p.id}
              </span>
              <span className="pixel-list-energy">{Number(p.energy).toLocaleString()}</span>
              <span className="pixel-list-status text-muted">{p.active ? 'Active' : 'Dead'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
