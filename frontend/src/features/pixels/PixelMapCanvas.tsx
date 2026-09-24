import React, { useEffect, useRef, useState } from 'react';
import { PixelMapRenderer } from './PixelMapRenderer';
import { PixelHoverTooltip } from './PixelHoverTooltip';
import { PixelListPanel } from './PixelListPanel';
import type { PixelSummaryDto, MessageFlowDto, RunStatusDto } from '../../api/types';
import { RecoveryOperations } from '../run/RecoveryOperations';

export interface PixelMapCanvasProps {
  pixels: PixelSummaryDto[];
  messageFlow: MessageFlowDto[];
  selectedPixelId: string | null;
  unreadTipsPixelIds?: Set<string>;
  onSelectPixel: (pixelId: string) => void;
  onHoverPixel: (pixelId: string | null) => void;
  runStatus?: RunStatusDto | null;
  onRefresh?: () => Promise<void>;
}

export const PixelMapCanvas: React.FC<PixelMapCanvasProps> = ({
  pixels,
  messageFlow,
  selectedPixelId,
  unreadTipsPixelIds,
  onSelectPixel,
  onHoverPixel,
  runStatus,
  onRefresh,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PixelMapRenderer | null>(null);
  const onSelectPixelRef = useRef(onSelectPixel);
  const onHoverPixelRef = useRef<(id: string | null) => void>(() => {});

  const [isRecoveryDismissed, setIsRecoveryDismissed] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [viewMode, setViewMode] = useState<'3d' | 'list'>('3d');
  const prevUnfinalizedCountRef = useRef(0);

  // 悬停 tooltip 状态（局部即可，父组件 onHoverPixel 仍透传）
  const [hoveredPixelId, setHoveredPixelId] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const hoveredPixel = hoveredPixelId ? pixels.find((p) => p.id === hoveredPixelId) ?? null : null;

  const handleHoverPixel = (id: string | null) => {
    setHoveredPixelId(id);
    if (!id) setHoverPos(null);
    onHoverPixel(id);
  };

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!hoveredPixelId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const ops = runStatus?.unfinalized_operations;
  const isRunning = Boolean(runStatus?.running);
  const unfinalizedCount =
    (ops?.unsettledReservations?.length || 0) +
    (ops?.unknownCalls?.length || 0) +
    (ops?.callingMessages?.length || 0) +
    (ops?.startedToolExecutions?.length || 0) +
    (ops?.pendingRuns?.length || 0);

  const hasUnfinalized = !isRunning && unfinalizedCount > 0;

  useEffect(() => {
    if (unfinalizedCount > prevUnfinalizedCountRef.current && unfinalizedCount > 0) {
      setIsRecoveryDismissed(false);
    }
    prevUnfinalizedCountRef.current = unfinalizedCount;
  }, [unfinalizedCount]);

  useEffect(() => {
    onSelectPixelRef.current = onSelectPixel;
    onHoverPixelRef.current = handleHoverPixel;
  });

  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new PixelMapRenderer({
      canvas: canvasRef.current,
      onSelectPixel: (id) => onSelectPixelRef.current(id),
      onHoverPixel: (id) => onHoverPixelRef.current(id),
    });
    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setData(pixels, messageFlow, selectedPixelId, unreadTipsPixelIds);
    }
  }, [pixels, messageFlow, selectedPixelId, unreadTipsPixelIds]);

  const handleZoomIn = () => rendererRef.current?.zoomIn();
  const handleZoomOut = () => rendererRef.current?.zoomOut();
  const handleResetView = () => rendererRef.current?.resetView();
  /** 列表点击：选中 + 相机聚焦该元胞 */
  const handleListSelect = (id: string) => {
    onSelectPixel(id);
    rendererRef.current?.focusPixel(id);
    setViewMode('3d');
  };

  return (
    <div className="right-panel">
      <div className="canvas-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="toolbar-title">活体晶格 · LIVING LATTICE</span>
          {hasUnfinalized && (
            <button
              type="button"
              className="btn btn-xs btn-danger"
              style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
              onClick={() => setIsRecoveryDismissed(false)}
              title="打开待决审计审批弹窗"
            >
              <span>⚠️</span> 需审计决策 ({unfinalizedCount})
            </button>
          )}
          <button className="btn btn-xs" onClick={() => setShowLegend((v) => !v)} title="显示/隐藏图例">
            图例
          </button>
          {showLegend && (
            <span className="canvas-legend">
              <span className="legend-item">
                <span className="dot active-dot" /> 存活活跃
              </span>
              <span className="legend-item">
                <span className="dot inactive-dot" /> 零能量失活
              </span>
              <span className="legend-item">
                <span className="dot" style={{ background: 'var(--accent-yellow)' }} /> 未读提醒
              </span>
              <span className="legend-item">
                <span className="dot" style={{ border: '2px solid #ff4500', borderRadius: '50%', width: '9px', height: '9px', background: 'transparent' }} /> 选中外环
              </span>
              <span className="legend-item">
                <span className="flow-line-legend" /> 传递方向(≤10)
              </span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : ''}`}
            onClick={() => setViewMode((v) => (v === '3d' ? 'list' : '3d'))}
            title="切换 3D / 列表视图"
          >
            {viewMode === '3d' ? '列表' : '3D'}
          </button>
          <button className="btn btn-sm" onClick={handleZoomIn} title="放大">
            +
          </button>
          <button className="btn btn-sm" onClick={handleZoomOut} title="缩小">
            -
          </button>
          <button className="btn btn-sm" onClick={handleResetView}>
            重置视角
          </button>
        </div>
      </div>

      <div
        className="canvas-container"
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={() => setHoverPos(null)}
        onPointerDown={() => setHoverPos(null)}
      >
        <canvas ref={canvasRef} id="pixel-canvas" />

        {/* 列表视图覆盖层（3D 渲染器保持运行，切回无重初始化开销） */}
        {viewMode === 'list' && (
          <PixelListPanel
            pixels={pixels}
            selectedPixelId={selectedPixelId}
            unreadTipsPixelIds={unreadTipsPixelIds}
            onSelectPixel={handleListSelect}
          />
        )}

        {/* 悬停轻量概要（零点击可见，不遮挡交互） */}
        {hoveredPixel && hoverPos && (
          <PixelHoverTooltip pixel={hoveredPixel} x={hoverPos.x} y={hoverPos.y} />
        )}

        {/* 呈现在 3D Crystal Lattice / 六邻域空间 上方的审计决策弹窗 */}
        {hasUnfinalized && !isRecoveryDismissed && runStatus && onRefresh && (
          <RecoveryOperations
            status={runStatus}
            onRefresh={async () => {
              await onRefresh();
            }}
            onClose={() => setIsRecoveryDismissed(true)}
          />
        )}
      </div>
    </div>
  );
};
