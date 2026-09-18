import React, { useEffect, useRef } from 'react';
import { PixelMapRenderer } from './PixelMapRenderer';
import type { PixelSummaryDto, MessageFlowDto } from '../../api/types';

export interface PixelMapCanvasProps {
  pixels: PixelSummaryDto[];
  messageFlow: MessageFlowDto[];
  selectedPixelId: string | null;
  unreadTipsPixelIds?: Set<string>;
  onSelectPixel: (pixelId: string) => void;
  onHoverPixel: (pixelId: string | null) => void;
}

export const PixelMapCanvas: React.FC<PixelMapCanvasProps> = ({
  pixels,
  messageFlow,
  selectedPixelId,
  unreadTipsPixelIds,
  onSelectPixel,
  onHoverPixel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PixelMapRenderer | null>(null);
  const onSelectPixelRef = useRef(onSelectPixel);
  const onHoverPixelRef = useRef(onHoverPixel);

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
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span className="toolbar-title">3D 六邻域空间投影地图 (Isometric 2.5D)</span>
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
              <span className="flow-line-legend" /> 消息流跃迁 (Message Flow)
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
      </div>
    </div>
  );
};
