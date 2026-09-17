import React, { useEffect, useRef } from 'react';
import { PixelMapRenderer } from './PixelMapRenderer';
import type { PixelSummaryDto, MessageFlowDto } from '../../api/types';

export interface PixelMapCanvasProps {
  pixels: PixelSummaryDto[];
  messageFlow: MessageFlowDto[];
  selectedPixelId: string | null;
  onSelectPixel: (pixelId: string) => void;
  onHoverPixel: (pixelId: string | null) => void;
}

export const PixelMapCanvas: React.FC<PixelMapCanvasProps> = ({
  pixels,
  messageFlow,
  selectedPixelId,
  onSelectPixel,
  onHoverPixel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<PixelMapRenderer | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new PixelMapRenderer({
      canvas: canvasRef.current,
      onSelectPixel,
      onHoverPixel,
    });
    rendererRef.current = renderer;

    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [onSelectPixel, onHoverPixel]);

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.setData(pixels, messageFlow, selectedPixelId);
    }
  }, [pixels, messageFlow, selectedPixelId]);

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
