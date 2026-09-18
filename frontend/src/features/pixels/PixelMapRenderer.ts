import type { PixelSummaryDto, MessageFlowDto } from '../../api/types';

export interface PixelMapRendererOptions {
  canvas: HTMLCanvasElement;
  onSelectPixel: (pixelId: string) => void;
  onHoverPixel: (pixelId: string | null) => void;
}

export class PixelMapRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private onSelectPixel: (pixelId: string) => void;
  private onHoverPixel: (pixelId: string | null) => void;

  private pixels: PixelSummaryDto[] = [];
  private messageFlow: MessageFlowDto[] = [];
  private selectedPixelId: string | null = null;
  private hoveredPixelId: string | null = null;
  private unreadTipsPixelIds: Set<string> = new Set();

  public zoom = 1.0;
  public offsetX = 0;
  public offsetY = 0;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private animationFrameId: number | null = null;
  private animOffset = 0;

  // 保存绑定的监听器用于 dispose
  private handleResizeBound: () => void;
  private handleMouseDownBound: (e: MouseEvent) => void;
  private handleMouseMoveBound: (e: MouseEvent) => void;
  private handleMouseUpBound: () => void;
  private handleWheelBound: (e: WheelEvent) => void;
  private handleClickBound: (e: MouseEvent) => void;

  constructor(options: PixelMapRendererOptions) {
    this.canvas = options.canvas;
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context not supported');
    }
    this.ctx = context;
    this.onSelectPixel = options.onSelectPixel;
    this.onHoverPixel = options.onHoverPixel;

    this.handleResizeBound = () => this.resize();
    this.handleMouseDownBound = (e) => this.onMouseDown(e);
    this.handleMouseMoveBound = (e) => this.onMouseMove(e);
    this.handleMouseUpBound = () => this.onMouseUp();
    this.handleWheelBound = (e) => this.onWheel(e);
    this.handleClickBound = (e) => this.onClick(e);

    this.initEvents();
    this.resize();
    this.startAnimationLoop();
  }

  public setData(pixels: PixelSummaryDto[], messageFlow: MessageFlowDto[], selectedId: string | null, unreadTipsPixelIds?: Set<string>): void {
    this.pixels = pixels || [];
    this.messageFlow = messageFlow || [];
    this.selectedPixelId = selectedId;
    if (unreadTipsPixelIds) this.unreadTipsPixelIds = unreadTipsPixelIds;
    this.render();
  }

  public setSelectedPixel(pixelId: string | null): void {
    this.selectedPixelId = pixelId;
    this.render();
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    if (this.offsetX === 0 && this.offsetY === 0) {
      this.resetView();
    } else {
      this.render();
    }
  }

  public resetView(): void {
    this.zoom = 1.0;
    this.offsetX = this.canvas.width / 2;
    this.offsetY = this.canvas.height / 2 + 40;
    this.render();
  }

  public zoomIn(): void {
    this.zoom = Math.min(2.5, this.zoom * 1.2);
    this.render();
  }

  public zoomOut(): void {
    this.zoom = Math.max(0.4, this.zoom / 1.2);
    this.render();
  }

  private project(x: number, y: number, z: number): { x: number; y: number } {
    const CELL_X = 56 * this.zoom;
    const CELL_Y = 28 * this.zoom;
    const CELL_Z = 38 * this.zoom;

    const screenX = (x - y) * CELL_X + this.offsetX;
    const screenY = (x + y) * CELL_Y - z * CELL_Z + this.offsetY;
    return { x: screenX, y: screenY };
  }

  private initEvents(): void {
    window.addEventListener('resize', this.handleResizeBound);
    this.canvas.addEventListener('mousedown', this.handleMouseDownBound);
    window.addEventListener('mousemove', this.handleMouseMoveBound);
    window.addEventListener('mouseup', this.handleMouseUpBound);
    this.canvas.addEventListener('wheel', this.handleWheelBound, { passive: false });
    this.canvas.addEventListener('click', this.handleClickBound);
  }

  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    window.removeEventListener('resize', this.handleResizeBound);
    this.canvas.removeEventListener('mousedown', this.handleMouseDownBound);
    window.removeEventListener('mousemove', this.handleMouseMoveBound);
    window.removeEventListener('mouseup', this.handleMouseUpBound);
    this.canvas.removeEventListener('wheel', this.handleWheelBound);
    this.canvas.removeEventListener('click', this.handleClickBound);
  }

  private onMouseDown(e: MouseEvent): void {
    this.isDragging = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  }

  private onMouseMove(e: MouseEvent): void {
    if (this.isDragging) {
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.offsetX += dx;
      this.offsetY += dy;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.render();
    } else {
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let found: PixelSummaryDto | null = null;
      for (const p of this.pixels) {
        const [x, y, z] = p.position;
        const pt = this.project(x, y, z);
        const dist = Math.hypot(mouseX - pt.x, mouseY - pt.y);
        if (dist <= 24 * this.zoom) {
          found = p;
          break;
        }
      }

      if (found?.id !== this.hoveredPixelId) {
        this.hoveredPixelId = found ? found.id : null;
        this.onHoverPixel(this.hoveredPixelId);
        this.render();
      }
    }
  }

  private onMouseUp(): void {
    this.isDragging = false;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    this.zoom = Math.max(0.4, Math.min(2.5, this.zoom * factor));
    this.render();
  }

  private onClick(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    let clicked: PixelSummaryDto | null = null;
    for (const p of this.pixels) {
      const [x, y, z] = p.position;
      const pt = this.project(x, y, z);
      const dist = Math.hypot(mouseX - pt.x, mouseY - pt.y);
      if (dist <= 24 * this.zoom) {
        clicked = p;
        break;
      }
    }

    if (clicked) {
      this.selectedPixelId = clicked.id;
      this.onSelectPixel(clicked.id);
      this.render();
    }
  }

  private startAnimationLoop(): void {
    const loop = () => {
      this.animOffset = (this.animOffset + 0.5) % 20;
      if (this.messageFlow.length > 0) {
        this.render();
      }
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  public render(): void {
    const { ctx, canvas } = this;
    if (!canvas.width || !canvas.height) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. 绘制 Z=0 平面网格
    this.drawGrid();

    // 2. 绘制消息流连线
    this.drawMessageFlow();

    // 3. 排序元胞：先画 Z 投影辅助线，再画圆点
    const sorted = [...this.pixels].sort((a, b) => {
      const [ax, ay, az] = a.position;
      const [bx, by, bz] = b.position;
      return (ax + ay + az) - (bx + by + bz);
    });

    for (const pixel of sorted) {
      this.drawZDropLine(pixel);
    }
    for (const pixel of sorted) {
      this.drawPixelNode(pixel);
    }

    // 4. XYZ 方向指示
    this.drawAxisHint();
  }

  private drawGrid(): void {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = '#161b22';
    ctx.lineWidth = 1;

    const range = 5;
    for (let x = -range; x <= range; x++) {
      const p1 = this.project(x, -range, 0);
      const p2 = this.project(x, range, 0);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    for (let y = -range; y <= range; y++) {
      const p1 = this.project(-range, y, 0);
      const p2 = this.project(range, y, 0);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // 标注该网格为 Z=0 平面
    ctx.fillStyle = '#3d444d';
    ctx.font = `${Math.max(9, Math.floor(9 * this.zoom))}px monospace`;
    ctx.textAlign = 'left';
    const origin = this.project(-range, -range, 0);
    ctx.fillText('Z=0 Plane', origin.x - 10 * this.zoom, origin.y - 6 * this.zoom);

    ctx.restore();
  }

  /** z != 0 的元胞从实际位置到 (x, y, 0) 画淡色虚线，解决 Z 高度难辨识 */
  private drawZDropLine(pixel: PixelSummaryDto): void {
    const [x, y, z] = pixel.position;
    if (!z) return;
    const { ctx } = this;
    const center = this.project(x, y, z);
    const ground = this.project(x, y, 0);
    ctx.save();
    ctx.strokeStyle = 'rgba(139, 148, 158, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * this.zoom, 3 * this.zoom]);
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(ground.x, ground.y);
    ctx.stroke();
    // 投影位置画极小空心圆
    ctx.beginPath();
    ctx.arc(ground.x, ground.y, 2.5 * this.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 固定位置的三条短轴方向提示（与 project() 的等轴方向一致） */
  private drawAxisHint(): void {
    const { ctx, canvas } = this;
    const ox = 46;
    const oy = canvas.height - 46;
    const len = 26;
    // X: project(+1,0,0) 方向 → 屏幕右下
    const xAxis = { x: (1 - 0) * 56, y: (1 + 0) * 28 };
    // Y: project(0,+1,0) 方向 → 屏幕左下
    const yAxis = { x: (0 - 1) * 56, y: (0 + 1) * 28 };
    // Z: project(0,0,+1) 方向 → 屏幕正上
    const zAxis = { x: 0, y: -38 };
    const norm = (v: { x: number; y: number }) => {
      const m = Math.hypot(v.x, v.y);
      return { x: (v.x / m) * len, y: (v.y / m) * len };
    };
    const axes: Array<{ v: { x: number; y: number }; label: string; color: string }> = [
      { v: norm(xAxis), label: 'X', color: '#58a6ff' },
      { v: norm(yAxis), label: 'Y', color: '#3fb950' },
      { v: norm(zAxis), label: 'Z', color: '#d29922' },
    ];
    ctx.save();
    ctx.fillStyle = 'rgba(22, 27, 34, 0.85)';
    ctx.beginPath();
    ctx.arc(ox, oy, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { v, label, color } of axes) {
      const ex = ox + v.x;
      const ey = oy + v.y;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(label, ox + v.x * 1.35, oy + v.y * 1.35);
    }
    ctx.restore();
  }

  private drawMessageFlow(): void {
    const { ctx } = this;
    if (!this.messageFlow.length) return;

    ctx.save();
    ctx.strokeStyle = '#3fb950';
    ctx.lineWidth = 2 * this.zoom;
    ctx.setLineDash([4 * this.zoom, 4 * this.zoom]);
    ctx.lineDashOffset = -this.animOffset * this.zoom;

    for (const flow of this.messageFlow) {
      const srcId = flow.source || flow.from;
      const tgtId = flow.target || flow.to;
      const src = this.pixels.find((p) => p.id === srcId);
      const tgt = this.pixels.find((p) => p.id === tgtId);

      if (src && tgt) {
        const p1 = this.project(...src.position);
        const p2 = this.project(...tgt.position);

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        // 略带曲线弧度
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2 - 20 * this.zoom;
        ctx.quadraticCurveTo(midX, midY, p2.x, p2.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawPixelNode(pixel: PixelSummaryDto): void {
    const { ctx } = this;
    const [x, y, z] = pixel.position;
    const center = this.project(x, y, z);
    const radius = 10 * this.zoom;

    const isSelected = pixel.id === this.selectedPixelId;
    const isHovered = pixel.id === this.hoveredPixelId;
    const isActive = pixel.active;
    const hasUnreadTips = this.unreadTipsPixelIds.has(pixel.id);

    ctx.save();

    // 悬停/选中光晕（描边在主体之上，不覆盖黄色主体）
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius + (isSelected ? 8 : 5) * this.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = isSelected ? 'rgba(88, 166, 255, 0.7)' : 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.stroke();
    }

    // 圆点主体：黄色 = 未读 Tips 优先，其次蓝色 = Active，灰色 = Dead
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hasUnreadTips ? '#e3b341' : isActive ? '#58a6ff' : '#484f58';
    ctx.fill();
    ctx.strokeStyle = '#0e1117';
    ctx.lineWidth = 1;
    ctx.stroke();

    // ID 标签
    ctx.fillStyle = isSelected ? '#f0f6fc' : '#8b949e';
    ctx.font = `${Math.max(10, Math.floor(10 * this.zoom))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(pixel.id, center.x, center.y + radius + 14 * this.zoom);

    ctx.restore();
  }
}
