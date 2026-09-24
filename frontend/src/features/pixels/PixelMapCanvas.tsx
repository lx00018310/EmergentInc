import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PixelMapRenderer } from './PixelMapRenderer';
import type { EnergySpikeInfo } from './PixelMapRenderer';
import { makeLightning, paintSkyLightning } from './SkyLightning';
import type { LightningBolt } from './SkyLightning';
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

/* ===== 星空闪电心跳：曲线控制颜色、扩散速度与分叉密度 ===== */
const WAVE_TOTAL_SEC = 8.4;

/** 手绘的两次跃迁：第一峰较低，回落后冲到主峰 */
function heartbeatEnvelope(t: number): number {
  if (t < 2.2) {
    return 0.02 + 0.1 * (t / 2.2) + 0.015 * Math.sin((t * Math.PI * 2) / 1.1);
  }
  if (t < 3.4) {
    const u = (t - 2.2) / 1.2;
    return 0.12 + 0.18 * u * u * u;
  }
  if (t < 3.7) {
    const u = (t - 3.4) / 0.3;
    return 0.3 + 0.32 * Math.sin(u * Math.PI * 0.5);
  }
  if (t < 4.1) {
    const u = (t - 3.7) / 0.4;
    return 0.62 - 0.34 * u;
  }
  if (t < 4.5) {
    const u = (t - 4.1) / 0.4;
    return 0.28 + 0.72 * Math.sin(u * Math.PI * 0.5);
  }
  const u = t - 4.5;
  return Math.exp(-u / 1.2) * (1 + 0.04 * Math.sin(u * 5));
}

/** 在两个峰值前短促变色，保留慢呼吸期的冷青色 */
const WAVE_COLOR_KEYS: Array<[number, [number, number, number]]> = [
  [0, [79, 216, 255]],
  [3.6, [79, 216, 255]],
  [3.7, [255, 200, 97]],
  [4.1, [255, 138, 61]],
  [4.4, [255, 138, 61]],
  [4.5, [255, 246, 220]],
  [6.0, [240, 178, 92]],
  [8.4, [38, 60, 112]],
];

function heartbeatColor(t: number): [number, number, number] {
  for (let i = 0; i < WAVE_COLOR_KEYS.length - 1; i++) {
    const [t0, c0] = WAVE_COLOR_KEYS[i]!;
    const [t1, c1] = WAVE_COLOR_KEYS[i + 1]!;
    if (t <= t1) {
      const u = Math.max(0, Math.min(1, (t - t0) / (t1 - t0)));
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * u),
        Math.round(c0[1] + (c1[1] - c0[1]) * u),
        Math.round(c0[2] + (c1[2] - c0[2]) * u),
      ];
    }
  }
  return WAVE_COLOR_KEYS[WAVE_COLOR_KEYS.length - 1]![1];
}

/** 闪电前沿在第二次跃迁时扫到星空最远角落 */
function heartbeatRadius(t: number, reach: number): number {
  if (t < 2.2) return 18 + 18 * (t / 2.2) + 4 * Math.sin((t * Math.PI * 2) / 1.1);
  if (t < 3.4) {
    const u = (t - 2.2) / 1.2;
    return 36 + (reach * 0.08 - 36) * u * u * u;
  }
  if (t < 3.7) {
    const u = (t - 3.4) / 0.3;
    return reach * (0.08 + 0.22 * Math.sin(u * Math.PI * 0.5));
  }
  if (t < 4.1) return reach * (0.3 + 0.03 * ((t - 3.7) / 0.4));
  if (t < 4.5) {
    const u = (t - 4.1) / 0.4;
    return reach * (0.33 + 0.72 * u * u * u);
  }
  return reach * (1.05 + 0.15 * Math.min(1, (t - 4.5) / 1.2));
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

  // 星空闪电心跳状态（在独立画布上逐帧绘制，不触发 React 重渲染）
  const lightningCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveStateRef = useRef<{ start: number; x: number; y: number; bolts: LightningBolt[] } | null>(null);
  const waveRafRef = useRef<number | null>(null);
  const gizmoRef = useRef<SVGSVGElement | null>(null);

  // 能量突变 → 从星空中的色点扩散分叉闪电
  const handleEnergySpike = useCallback((info: EnergySpikeInfo) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const skyBottom = rendererRef.current?.getSkyBoundaryY() ?? canvasRect.height * 0.3;
    const x = Math.max(0, Math.min(canvasRect.width, info.x));
    const y = Math.max(20, Math.min(info.y, skyBottom * 0.55));
    const reach = Math.hypot(Math.max(x, canvasRect.width - x), Math.max(y, skyBottom - y));
    waveStateRef.current = { start: performance.now(), x, y, bolts: makeLightning(x, y, reach) };
    if (waveRafRef.current !== null) return;
    const step = () => {
      const st = waveStateRef.current;
      const canvas = lightningCanvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!st || !canvas || !ctx) {
        waveRafRef.current = null;
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = (performance.now() - st.start) / 1000;
      if (t >= WAVE_TOTAL_SEC) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        waveStateRef.current = null;
        waveRafRef.current = null;
        return;
      }
      const skyBottom = rendererRef.current?.getSkyBoundaryY() ?? rect.height * 0.3;
      const reach = Math.hypot(Math.max(st.x, rect.width - st.x), Math.max(st.y, skyBottom - st.y));
      paintSkyLightning(ctx, st.bolts, { x: st.x, y: st.y },
        { width: rect.width, height: rect.height, skyBottom },
        heartbeatRadius(t, reach), heartbeatEnvelope(t), heartbeatColor(t));
      waveRafRef.current = requestAnimationFrame(step);
    };
    waveRafRef.current = requestAnimationFrame(step);
  }, []);

  // 卸载时停止绘制
  useEffect(
    () => () => {
      if (waveRafRef.current !== null) cancelAnimationFrame(waveRafRef.current);
    },
    []
  );

  // 开发环境预览钩子：x/y 为相对画布的坐标
  useEffect(() => {
    if (!(import.meta as { env?: { DEV?: boolean } }).env?.DEV) return;
    (window as unknown as Record<string, unknown>).__triggerHeartbeatWave = (x?: number, y?: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      handleEnergySpike({
        x: x ?? (rect ? rect.width * 0.5 : 200),
        y: y ?? (rect ? rect.height * 0.45 : 150),
      });
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__triggerHeartbeatWave;
    };
  }, [handleEnergySpike]);

  // 右下角方向罗盘随相机转动；它独立于场景中央的 3D 信标。
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const renderer = rendererRef.current;
      const svg = gizmoRef.current;
      if (renderer && svg) {
        const axes = renderer.getScreenAxes();
        for (const k of ['x', 'y', 'z'] as const) {
          const d = axes[k];
          const line = svg.querySelector<SVGLineElement>(`.gizmo-${k}`);
          const label = svg.querySelector<SVGTextElement>(`.gizmo-${k}-label`);
          if (line) {
            line.setAttribute('x2', String(40 + d.x * 24));
            line.setAttribute('y2', String(40 + d.y * 24));
            line.style.opacity = k === 'z' ? '1' : d.behind ? '0.3' : '0.95';
          }
          if (label) {
            label.setAttribute('x', String(40 + d.x * 31));
            label.setAttribute('y', String(43 + d.y * 31));
            label.style.opacity = k === 'z' ? '1' : d.behind ? '0.35' : '1';
          }
        }
        const d = axes.z;
        const len = Math.hypot(d.x, d.y) || 1;
        const ux = d.x / len;
        const uy = d.y / len;
        const tipX = 40 + d.x * 24;
        const tipY = 40 + d.y * 24;
        svg.querySelector<SVGPolygonElement>('.gizmo-z-tip')?.setAttribute(
          'points',
          `${tipX},${tipY} ${tipX - ux * 8 - uy * 4},${tipY - uy * 8 + ux * 4} ${tipX - ux * 8 + uy * 4},${tipY - uy * 8 - ux * 4}`
        );
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
      onEnergySpike: handleEnergySpike,
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
                <span className="dot flow-line-legend" /> 传递方向(≤10)
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
        <canvas ref={lightningCanvasRef} className="sky-lightning" aria-hidden="true" />

        <svg ref={gizmoRef} className="axis-gizmo" viewBox="0 0 80 80" aria-hidden="true">
          <circle className="gizmo-bg" cx="40" cy="40" r="33" />
          <line className="gizmo-line gizmo-x" x1="40" y1="40" x2="40" y2="40" />
          <line className="gizmo-line gizmo-y" x1="40" y1="40" x2="40" y2="40" />
          <line className="gizmo-line gizmo-z" x1="40" y1="40" x2="40" y2="40" />
          <polygon className="gizmo-z-tip" points="40,40" />
          <text className="gizmo-label gizmo-x-label" x="40" y="40">X</text>
          <text className="gizmo-label gizmo-y-label" x="40" y="40">Y</text>
          <text className="gizmo-label gizmo-z-label" x="40" y="40">+Z</text>
        </svg>

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
