/**
 * Pixel Map: 2D Canvas Isometric (2.5D) Projection Renderer
 */

class PixelMap {
  constructor(canvasId, hoverCardId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.hoverCard = document.getElementById(hoverCardId);

    this.pixels = [];
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
    this.offsetY = this.canvas.height / 2 + 50;
    this.render();
  }

  setPixels(pixels) {
    this.pixels = pixels || [];
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
    const CELL_X = 54 * this.zoom;
    const CELL_Y = 27 * this.zoom;
    const CELL_Z = 36 * this.zoom;

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
      this.zoom = Math.max(0.4, Math.min(3.0, this.zoom * zoomFactor));
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
      }
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.zoom = Math.min(3.0, this.zoom * 1.2);
      this.render();
    });

    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.zoom = Math.max(0.4, this.zoom / 1.2);
      this.render();
    });

    document.getElementById('btn-reset-view')?.addEventListener('click', () => {
      this.resetView();
    });
  }

  findPixelAt(mx, my) {
    const hitRadius = 24 * this.zoom;
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
    statusSpan.textContent = p.active ? 'ACTIVE' : 'INACTIVE';
    statusSpan.className = 'hover-status ' + (p.active ? 'active' : 'inactive');

    const pos = p.position || [0, 0, 0];
    document.getElementById('hover-pos').textContent = `[${pos.join(', ')}]`;
    document.getElementById('hover-resource').textContent = p.resource.toFixed(1);
    document.getElementById('hover-problem').textContent = p.current_problem || 'None';
    document.getElementById('hover-parent').textContent = p.parent || 'None (Genesis)';
    document.getElementById('hover-born').textContent = p.born_round;
    document.getElementById('hover-grace').textContent = p.grace_remaining;
    document.getElementById('hover-waiting').textContent = p.waiting ? (p.waiting_external_request || 'Yes') : 'No';

    const caps = (p.capabilities && p.capabilities.length > 0) ? p.capabilities.join(', ') : 'None';
    document.getElementById('hover-caps').textContent = caps;

    const gn = p.genome || {};
    const tendencies = gn.tendencies || gn;
    const gnText = `Risk: ${tendencies.risk_tolerance ?? '-'} | Spawn: ${tendencies.spawn_preference ?? '-'} | CostSens: ${tendencies.cost_sensitivity ?? '-'}`;
    document.getElementById('hover-genome-text').textContent = gnText;

    const mem = p.memory || {};
    const workingMemory = Array.isArray(mem.working_memory) ? mem.working_memory.join('; ') : mem.working_memory;
    const memText = workingMemory || (mem.consolidated_lessons ? mem.consolidated_lessons.join('; ') : '-');
    document.getElementById('hover-memory-text').textContent = memText || '(Empty)';

    const activity = p.latest_activity;
    document.getElementById('hover-last-action').textContent = activity
      ? `R${activity.round} · ${activity.action} · ${activity.result}`
      : '暂无动作记录';
    document.getElementById('hover-last-reasoning').textContent = activity?.reasoning_summary || '-';
    const output = activity?.work_output;
    const hasOutput = output && (output.summary || (output.details && output.details.length > 0));
    const outputText = hasOutput
      ? [output.summary, ...(output.details || [])].filter(Boolean).join('；')
      : (activity?.result_detail || '-');
    document.getElementById('hover-last-output').textContent = outputText;
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
    const r = 16 * this.zoom;
    const h = 18 * this.zoom;

    const cx = proj.x;
    const cy = proj.y;

    const isActive = p.active;
    const isWaiting = p.waiting;
    const isHovered = (this.hoveredPixel && this.hoveredPixel.id === p.id) || (this.selectedPixel && this.selectedPixel.id === p.id);

    // Cube base points
    // Top face vertices
    const top = { x: cx, y: cy - h - r * 0.5 };
    const right = { x: cx + r, y: cy - h };
    const bottom = { x: cx, y: cy - h + r * 0.5 };
    const left = { x: cx - r, y: cy - h };

    // Bottom face vertices
    const bRight = { x: cx + r, y: cy };
    const bBottom = { x: cx, y: cy + r * 0.5 };
    const bLeft = { x: cx - r, y: cy };

    // Palette
    let topColor = '#58a6ff';
    let leftColor = '#1f6feb';
    let rightColor = '#1158c7';
    let strokeColor = '#79c0ff';

    if (!isActive) {
      topColor = '#30363d';
      leftColor = '#21262d';
      rightColor = '#161b22';
      strokeColor = '#484f58';
    } else if (isWaiting) {
      topColor = '#e3b341';
      leftColor = '#b08800';
      rightColor = '#947600';
      strokeColor = '#f2cc60';
    }

    if (isHovered) {
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

    // Capability badge (small purple pip)
    if (p.capabilities && p.capabilities.length > 0) {
      ctx.fillStyle = '#bc8cff';
      ctx.beginPath();
      ctx.arc(cx, top.y - 4, 3 * this.zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    // Label
    ctx.fillStyle = isHovered ? '#ffffff' : (isActive ? '#c9d1d9' : '#8b949e');
    ctx.font = `${Math.max(10, Math.round(11 * this.zoom))}px "SFMono-Regular", Consolas, monospace`;
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
    ctx.strokeStyle = 'rgba(88, 166, 255, 0.4)';
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

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw background isometric grid
    this.drawGrid();

    // Draw parent-child connections
    this.drawConnections();

    // Sort pixels from back to front for proper isometric occlusion (x + y + z)
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
  }
}

window.PixelMap = PixelMap;
