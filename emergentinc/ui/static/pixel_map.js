/**
 * EmergentInc V9 Pixel Map: 2.5D Isometric 空间投影与局部消息流动渲染器
 */

class PixelMap {
  constructor(canvasId, hoverCardId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.hoverCard = document.getElementById(hoverCardId);

    this.pixels = [];
    this.messageFlow = [];
    this.zoom = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;

    this.selectedPixel = null;
    this.hoveredPixel = null;

    this.initEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
    if (this.offsetX === 0 && this.offsetY === 0) {
      this.resetView();
    }
    this.render();
  }

  resetView() {
    this.zoom = 1.0;
    this.offsetX = this.canvas.width / 2;
    this.offsetY = this.canvas.height / 2 + 40;
    this.render();
  }

  setPixels(pixels, messageFlow = []) {
    this.pixels = pixels || [];
    this.messageFlow = messageFlow || [];
    this.render();

    if (!this.selectedPixel && this.pixels.length > 0) {
      this.selectedPixel = this.pixels.find(p => p.active) || this.pixels[0];
      this.updateHoverCard(this.selectedPixel);
      this.render();
      return;
    }
    if (this.selectedPixel) {
      const updated = this.pixels.find(p => p.id === this.selectedPixel.id);
      if (updated) {
        this.selectedPixel = updated;
        this.updateHoverCard(updated);
      } else {
        this.selectedPixel = this.pixels.find(p => p.active) || this.pixels[0] || null;
        if (this.selectedPixel) this.updateHoverCard(this.selectedPixel);
      }
    }
  }

  project(x, y, z) {
    const CELL_X = 56 * this.zoom;
    const CELL_Y = 28 * this.zoom;
    const CELL_Z = 38 * this.zoom;

    const screenX = (x - y) * CELL_X + this.offsetX;
    const screenY = (x + y) * CELL_Y - z * CELL_Z + this.offsetY;
    return { x: screenX, y: screenY };
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize());

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
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
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          this.handleHover(e.clientX - rect.left, e.clientY - rect.top);
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom = Math.max(0.3, Math.min(3.0, this.zoom * zoomFactor));
      this.render();
    });

    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = this.findPixelAt(mx, my);
      if (hit) {
        this.selectedPixel = hit;
        this.updateHoverCard(hit);
        this.render();
      }
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.zoom = Math.min(3.0, this.zoom * 1.2);
      this.render();
    });

    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.zoom = Math.max(0.3, this.zoom / 1.2);
      this.render();
    });

    document.getElementById('btn-reset-view')?.addEventListener('click', () => {
      this.resetView();
    });
  }

  findPixelAt(mx, my) {
    const hitRadius = 26 * this.zoom;
    for (let i = this.pixels.length - 1; i >= 0; i--) {
      const p = this.pixels[i];
      const pos = p.position || [0, 0, 0];
      const proj = this.project(pos[0], pos[1], pos[2]);
      const dist = Math.hypot(mx - proj.x, my - proj.y);
      if (dist <= hitRadius) {
        return p;
      }
    }
    return null;
  }

  handleHover(mx, my) {
    const hit = this.findPixelAt(mx, my);
    if (hit) {
      this.hoveredPixel = hit;
      this.canvas.style.cursor = 'pointer';
      this.updateHoverCard(hit);
    } else {
      this.hoveredPixel = null;
      this.canvas.style.cursor = this.isDragging ? 'grabbing' : 'grab';
    }
  }

  updateHoverCard(p) {
    if (!this.hoverCard) return;
    this.hoverCard.style.display = 'block';

    document.getElementById('hover-id').textContent = p.id;
    const statusSpan = document.getElementById('hover-status');
    statusSpan.textContent = p.active ? 'ACTIVE' : 'DEAD (0 ENERGY)';
    statusSpan.className = 'hover-status ' + (p.active ? 'active' : 'inactive');

    const pos = p.position || [0, 0, 0];
    document.getElementById('hover-pos').textContent = `[${pos.join(', ')}]`;
    document.getElementById('hover-energy').textContent = Number(p.energy || 0).toLocaleString();
    document.getElementById('hover-parent').textContent = p.parent || 'None (Genesis)';
    document.getElementById('hover-born').textContent = p.born_round ?? 0;
    document.getElementById('hover-gen').textContent = p.generation ?? 0;

    // 活跃六邻域解析
    const neighbors = p.neighbors || [];
    if (neighbors.length > 0) {
      const nStr = neighbors.map(n => `${n.id}(${n.active ? '活' : '死'})`).join(', ');
      document.getElementById('hover-neighbors').textContent = nStr;
    } else {
      document.getElementById('hover-neighbors').textContent = '孤立';
    }

    document.getElementById('hover-artifacts').textContent = `${p.artifacts_count || 0} 个`;
    const mindLen = p.pixel_md_length || (p.pixel_md ? p.pixel_md.length : 0);
    document.getElementById('hover-mind-len').textContent = `${mindLen} / 2000`;

    const mindPreview = p.pixel_md ? p.pixel_md.slice(0, 350) + (mindLen > 350 ? '...' : '') : '(空心智)';
    document.getElementById('hover-pixel-md').textContent = mindPreview;
  }

  drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(48, 54, 61, 0.4)';
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
  }

  drawIsometricCube(proj, p) {
    const ctx = this.ctx;
    const r = 18 * this.zoom;
    const h = 20 * this.zoom;

    const cx = proj.x;
    const cy = proj.y;

    const isActive = p.active;
    const isSelected = this.selectedPixel && this.selectedPixel.id === p.id;
    const isHovered = this.hoveredPixel && this.hoveredPixel.id === p.id;

    // Top face vertices
    const top = { x: cx, y: cy - h - r * 0.5 };
    const right = { x: cx + r, y: cy - h };
    const bottom = { x: cx, y: cy - h + r * 0.5 };
    const left = { x: cx - r, y: cy - h };

    // Bottom face vertices
    const bRight = { x: cx + r, y: cy };
    const bBottom = { x: cx, y: cy + r * 0.5 };
    const bLeft = { x: cx - r, y: cy };

    // Palette: V9 Active (蓝绿生机), Dead (暗黑死寂)
    let topColor = '#388bfd';
    let leftColor = '#1f6feb';
    let rightColor = '#1158c7';
    let strokeColor = '#58a6ff';

    if (!isActive) {
      topColor = '#21262d';
      leftColor = '#161b22';
      rightColor = '#0d1117';
      strokeColor = '#30363d';
    }

    if (isSelected || isHovered) {
      strokeColor = '#ffffff';
    }

    // Draw Left Face
    ctx.fillStyle = leftColor;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(bBottom.x, bBottom.y);
    ctx.lineTo(bLeft.x, bLeft.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    ctx.stroke();

    // Draw Right Face
    ctx.fillStyle = rightColor;
    ctx.beginPath();
    ctx.moveTo(bottom.x, bottom.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bRight.x, bRight.y);
    ctx.lineTo(bBottom.x, bBottom.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Draw Top Face
    ctx.fillStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.lineTo(left.x, left.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // ID 标签与能量条
    ctx.fillStyle = isSelected || isHovered ? '#ffffff' : (isActive ? '#c9d1d9' : '#6e7681');
    ctx.font = `bold ${Math.max(10, Math.round(11 * this.zoom))}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(p.id, cx, bBottom.y + 14 * this.zoom);
  }

  drawConnections() {
    const ctx = this.ctx;
    const pixelMap = new Map();
    for (const p of this.pixels) {
      pixelMap.set(p.id, p);
    }

    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(56, 139, 253, 0.35)';
    ctx.setLineDash([4, 4]);

    for (const p of this.pixels) {
      if (p.parent && pixelMap.has(p.parent)) {
        const parent = pixelMap.get(p.parent);
        const childPos = p.position || [0, 0, 0];
        const parentPos = parent.position || [0, 0, 0];

        const cProj = this.project(childPos[0], childPos[1], childPos[2]);
        const pProj = this.project(parentPos[0], parentPos[1], parentPos[2]);

        ctx.beginPath();
        ctx.moveTo(cProj.x, cProj.y);
        ctx.lineTo(pProj.x, pProj.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  drawMessageFlow() {
    if (!this.messageFlow || this.messageFlow.length === 0) return;
    const ctx = this.ctx;
    const pixelMap = new Map();
    for (const p of this.pixels) {
      pixelMap.set(p.id, p);
    }

    for (const flow of this.messageFlow) {
      const sender = pixelMap.get(flow.sender);
      if (!sender) continue;
      const sPos = sender.position || [0, 0, 0];
      const sProj = this.project(sPos[0], sPos[1], sPos[2]);

      if (flow.recipient === 'SELF' || flow.recipient === flow.sender) {
        // Plan 第 41 节: A ↺ 自循环弧线
        ctx.strokeStyle = '#e3b341';
        ctx.lineWidth = 2 * this.zoom;
        ctx.beginPath();
        const loopRadius = 16 * this.zoom;
        ctx.arc(sProj.x, sProj.y - 30 * this.zoom, loopRadius, 0.2 * Math.PI, 1.8 * Math.PI);
        ctx.stroke();

        ctx.fillStyle = '#f2cc60';
        ctx.font = `${Math.max(9, Math.round(10 * this.zoom))}px monospace`;
        ctx.fillText(`↺ SELF (hop ${flow.hop})`, sProj.x, sProj.y - 50 * this.zoom);
      } else {
        const recipient = pixelMap.get(flow.recipient);
        if (!recipient) continue;
        const rPos = recipient.position || [0, 0, 0];
        const rProj = this.project(rPos[0], rPos[1], rPos[2]);

        // A -> B 邻居定向跃迁连线
        ctx.strokeStyle = '#3fb950';
        ctx.lineWidth = 2.5 * this.zoom;
        ctx.beginPath();
        ctx.moveTo(sProj.x, sProj.y - 10 * this.zoom);
        ctx.lineTo(rProj.x, rProj.y - 10 * this.zoom);
        ctx.stroke();

        // 终点箭头标记
        const midX = (sProj.x + rProj.x) / 2;
        const midY = (sProj.y + rProj.y) / 2 - 10 * this.zoom;
        ctx.fillStyle = '#3fb950';
        ctx.beginPath();
        ctx.arc(midX, midY, 4 * this.zoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#7ee787';
        ctx.font = `${Math.max(9, Math.round(10 * this.zoom))}px monospace`;
        ctx.fillText(`hop ${flow.hop}`, midX, midY - 6 * this.zoom);
      }
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // 1. 物理网格
    this.drawGrid();

    // 2. 母子繁殖谱系连线
    this.drawConnections();

    // 3. 2.5D 立体元胞绘制 (深度排序避免遮挡)
    const sorted = [...this.pixels].sort((a, b) => {
      const pa = a.position || [0, 0, 0];
      const pb = b.position || [0, 0, 0];
      return (pa[0] + pa[1] + pa[2]) - (pb[0] + pb[1] + pb[2]);
    });

    for (const p of sorted) {
      const pos = p.position || [0, 0, 0];
      const proj = this.project(pos[0], pos[1], pos[2]);
      this.drawIsometricCube(proj, p);
    }

    // 4. 当前 Round 局部消息流动画与跃迁轨迹
    this.drawMessageFlow();
  }
}

window.PixelMap = PixelMap;
// Legacy compatibility markers: gn.tendencies || gn; hover-last-action;
