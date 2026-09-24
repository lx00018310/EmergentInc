import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PixelMapRenderer } from './PixelMapRenderer';
import type { EnergySpikeInfo } from './PixelMapRenderer';
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

/* ===== 全屏心跳冲击波：包络 / 颜色 / 半径（呼吸 → 加速 → 双峰跃迁 → 缓落） ===== */
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

/** 波前在第二次跃迁时扫到视口最远角落 */
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

/** 核心辉光半径（px） */
function heartbeatCoreRadius(t: number, reach: number): number {
  return Math.max(70, heartbeatRadius(t, reach) * 0.85);
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

  // 全屏心跳冲击波状态（rAF 直写 CSS 变量，避免每帧 React 重渲染）
  const waveElRef = useRef<HTMLDivElement | null>(null);
  const waveStateRef = useRef<{ start: number; x: number; y: number } | null>(null);
  const waveRafRef = useRef<number | null>(null);
  // 方向罗盘 HUD
  const gizmoRef = useRef<SVGSVGElement | null>(null);

  // 能量突变 → 触发/重置全屏心跳冲击波
  const handleEnergySpike = useCallback((info: EnergySpikeInfo) => {
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    waveStateRef.current = { start: performance.now(), x: canvasRect.left + info.x, y: canvasRect.top + info.y };
    if (waveRafRef.current !== null) return; // 已在播放：仅重置波源与起点
    const step = () => {
      const st = waveStateRef.current;
      const el = waveElRef.current;
      if (!st || !el) {
        waveRafRef.current = null;
        return;
      }
      const t = (performance.now() - st.start) / 1000;
      if (t >= WAVE_TOTAL_SEC) {
        el.style.opacity = '0';
        waveStateRef.current = null;
        waveRafRef.current = null;
        return;
      }
      const [r, g, b] = heartbeatColor(t);
      const reach = Math.hypot(Math.max(st.x, window.innerWidth - st.x), Math.max(st.y, window.innerHeight - st.y));
      el.style.setProperty('--hx', `${st.x}px`);
      el.style.setProperty('--hy', `${st.y}px`);
      el.style.setProperty('--wr', `${heartbeatRadius(t, reach)}px`);
      el.style.setProperty('--cr', `${heartbeatCoreRadius(t, reach)}px`);
      el.style.setProperty('--cRing', `rgba(${r}, ${g}, ${b}, 0.85)`);
      el.style.setProperty(
        '--cCore',
        `rgba(${Math.min(255, r + 40)}, ${Math.min(255, g + 40)}, ${Math.min(255, b + 30)}, 0.9)`
      );
      el.style.opacity = String(Math.min(1, heartbeatEnvelope(t)));
      waveRafRef.current = requestAnimationFrame(step);
    };
    waveRafRef.current = requestAnimationFrame(step);
  }, []);

  // 卸载时停止冲击波 rAF
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

  // 方向罗盘：每帧同步相机系三轴投影（直接改 SVG 属性，无 React 渲染开销）
  useEffect(() => {
    let raf = 0;
    let cached: {
      lines: Record<'x' | 'y' | 'z', SVGLineElement | null>;
      labels: Record<'x' | 'y' | 'z', SVGTextElement | null>;
      tip: SVGCircleElement | null;
    } | null = null;
    const C = 40;
    const AXIS_LEN = 24;
    const LABEL_LEN = 31;
    const tick = () => {
      const renderer = rendererRef.current;
      const svg = gizmoRef.current;
      if (renderer && svg) {
        if (!cached) {
          cached = {
            lines: {
              x: svg.querySelector<SVGLineElement>('.gizmo-x'),
              y: svg.querySelector<SVGLineElement>('.gizmo-y'),
              z: svg.querySelector<SVGLineElement>('.gizmo-z'),
            },
            labels: {
              x: svg.querySelector<SVGTextElement>('.gizmo-x-label'),
              y: svg.querySelector<SVGTextElement>('.gizmo-y-label'),
              z: svg.querySelector<SVGTextElement>('.gizmo-z-label'),
            },
            tip: svg.querySelector<SVGCircleElement>('.gizmo-z-tip'),
          };
        }
        const axes = renderer.getScreenAxes();
        (['x', 'y', 'z'] as const).forEach((k) => {
          const d = axes[k];
          const line = cached!.lines[k];
          if (line) {
            line.setAttribute('x2', String(C + d.x * AXIS_LEN));
            line.setAttribute('y2', String(C + d.y * AXIS_LEN));
            line.style.opacity = k === 'z' ? '1' : d.behind ? '0.3' : '0.95';
          }
          const label = cached!.labels[k];
          if (label) {
            label.setAttribute('x', String(C + d.x * LABEL_LEN));
            label.setAttribute('y', String(C + d.y * LABEL_LEN + 3));
            label.style.opacity = k === 'z' ? '1' : d.behind ? '0.35' : '1';
          }
        });
        if (cached.tip) {
          cached.tip.setAttribute('cx', String(C + axes.z.x * AXIS_LEN));
          cached.tip.setAttribute('cy', String(C + axes.z.y * AXIS_LEN));
          cached.tip.style.opacity = '1';
        }
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

        {/* 方向罗盘：金标 +Z，跟随相机实时投影，一眼辨别方位与上下 */}
        <svg ref={gizmoRef} className="axis-gizmo" viewBox="0 0 80 80" aria-hidden="true">
          <circle className="gizmo-bg" cx="40" cy="40" r="33" />
          <line className="gizmo-line gizmo-x" x1="40" y1="40" x2="40" y2="40" />
          <line className="gizmo-line gizmo-y" x1="40" y1="40" x2="40" y2="40" />
          <line className="gizmo-line gizmo-z" x1="40" y1="40" x2="40" y2="40" />
          <circle className="gizmo-z-tip" cx="40" cy="40" r="3" />
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
      {createPortal(<div ref={waveElRef} className="heartbeat-wave" aria-hidden="true" />, document.body)}
    </div>
  );
};
