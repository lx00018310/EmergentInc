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

  public setData(pixels: PixelSummaryDto[], messageFlow: MessageFlowDto[], selectedId: string | null): void {
    this.pixels = pixels || [];
    this.messageFlow = messageFlow || [];
    this.selectedPixelId = selectedId;
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

    // 1. 绘制背景暗格
    this.drawGrid();

    // 2. 绘制消息流连线
    this.drawMessageFlow();

    // 3. 排序元胞并绘制 3D 等轴立方体
    const sorted = [...this.pixels].sort((a, b) => {
      const [ax, ay, az] = a.position;
      const [bx, by, bz] = b.position;
      return (ax + ay + az) - (bx + by + bz);
    });

    for (const pixel of sorted) {
      this.drawPixelCube(pixel);
    }
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

  private drawPixelCube(pixel: PixelSummaryDto): void {
    const { ctx } = this;
    const [x, y, z] = pixel.position;
    const center = this.project(x, y, z);
    const size = 18 * this.zoom;

    const isSelected = pixel.id === this.selectedPixelId;
    const isHovered = pixel.id === this.hoveredPixelId;
    const isActive = pixel.active;

    ctx.save();

    // 选中或悬停光晕
    if (isSelected || isHovered) {
      ctx.beginPath();
      ctx.arc(center.x, center.y, size * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? 'rgba(88, 166, 255, 0.25)' : 'rgba(255, 255, 255, 0.15)';
      ctx.fill();
    }

    // 立方体顶点计算
    const topCenter = { x: center.x, y: center.y - size * 0.7 };
    const bottomCenter = { x: center.x, y: center.y + size * 0.7 };
    const left = { x: center.x - size, y: center.y - size * 0.2 };
    const right = { x: center.x + size, y: center.y - size * 0.2 };

    let colTop = '#1f2937';
    let colLeft = '#111827';
    let colRight = '#374151';

    if (isActive) {
      colTop = '#60a5fa';
      colLeft = '#2563eb';
      colRight = '#3b82f6';
    }

    // 顶面
    ctx.beginPath();
    ctx.moveTo(topCenter.x, topCenter.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(center.x, center.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.fillStyle = colTop;
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#58a6ff' : '#0e1117';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 左面
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(center.x, center.y);
    ctx.lineTo(bottomCenter.x, bottomCenter.y);
    ctx.lineTo(left.x, bottomCenter.y - (center.y - left.y));
    ctx.closePath();
    ctx.fillStyle = colLeft;
    ctx.fill();
    ctx.stroke();

    // 右面
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(right.x, bottomCenter.y - (center.y - right.y));
    ctx.lineTo(bottomCenter.x, bottomCenter.y);
    ctx.closePath();
    ctx.fillStyle = colRight;
    ctx.fill();
    ctx.stroke();

    // ID 标签
    ctx.fillStyle = isSelected ? '#f0f6fc' : '#8b949e';
    ctx.font = `${Math.max(10, Math.floor(10 * this.zoom))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(pixel.id, center.x, bottomCenter.y + 14 * this.zoom);

    ctx.restore();
  }
}
