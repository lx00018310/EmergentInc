import React, { useEffect, useRef, useState } from 'react';
import { PixelMapRenderer } from './PixelMapRenderer';
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
  const onHoverPixelRef = useRef(onHoverPixel);

  const [isRecoveryDismissed, setIsRecoveryDismissed] = useState(false);
  const prevUnfinalizedCountRef = useRef(0);

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
    onHoverPixelRef.current = onHoverPixel;
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

  return (
    <div className="right-panel">
      <div className="canvas-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="toolbar-title">3D Crystal Lattice / 六邻域空间 (Vertical = World Z)</span>
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
          <span className="canvas-legend">
            <span className="legend-item">
              <span className="dot active-dot" /> 存活活跃 (Active)
            </span>
            <span className="legend-item">
              <span className="dot inactive-dot" /> 零能量失活 (Dead)
            </span>
            <span className="legend-item">
              <span className="dot" style={{ background: '#e3b341' }} /> 未读提醒 (Unread Tips)
            </span>
            <span className="legend-item">
              <span className="dot" style={{ border: '2px solid #ff4500', borderRadius: '50%', width: '9px', height: '9px', background: 'transparent' }} /> 选中外环 (Selected)
            </span>
            <span className="legend-item">
              <span className="flow-line-legend" /> 传递方向箭头曲线 (保留≤10次)
            </span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
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

      <div className="canvas-container">
        <canvas ref={canvasRef} id="pixel-canvas" />

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
