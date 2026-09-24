type Point = { x: number; y: number };
type Fork = { points: Point[]; threshold: number };
export type LightningBolt = { points: Point[]; forks: Fork[] };

/** 固定一次闪电的形状，避免每帧随机跳动。 */
export function makeLightning(x: number, y: number, reach: number): LightningBolt[] {
  let seed = (Math.random() * 0xffffffff) >>> 0;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n ^= n + Math.imul(n ^ (n >>> 7), 61 | n);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
  const jagged = (start: Point, end: Point, roughness: number, levels: number): Point[] => {
    let points = [start, end];
    let offset = roughness;
    for (let level = 0; level < levels; level++) {
      const next = [points[0]!];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const shift = (random() - 0.5) * offset;
        next.push({ x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * shift, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * shift }, b);
      }
      points = next;
      offset *= 0.55;
    }
    return points;
  };

  return Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2 + (random() - 0.5) * 0.2;
    const end = { x: x + Math.cos(angle) * reach * 1.2, y: y + Math.sin(angle) * reach * 1.2 };
    const points = jagged({ x, y }, end, reach * 0.16, 5);
    const forks: Fork[] = [];
    for (const index of [9, 17, 25]) {
      const from = points[index]!;
      const forkAngle = angle + (random() < 0.5 ? -1 : 1) * (0.35 + random() * 0.45);
      const length = reach * (0.16 + random() * 0.13);
      const to = { x: from.x + Math.cos(forkAngle) * length, y: from.y + Math.sin(forkAngle) * length };
      forks.push({ points: jagged(from, to, length * 0.25, 4), threshold: 0.3 + random() * 0.55 });
    }
    return { points, forks };
  });
}

function trace(ctx: CanvasRenderingContext2D, points: Point[], source: Point, radius: number): boolean {
  if (Math.hypot(points[0]!.x - source.x, points[0]!.y - source.y) >= radius) return false;
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const da = Math.hypot(a.x - source.x, a.y - source.y);
    const db = Math.hypot(b.x - source.x, b.y - source.y);
    if (db >= radius) {
      const u = Math.max(0, Math.min(1, (radius - da) / (db - da || 1)));
      ctx.lineTo(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      return true;
    }
    ctx.lineTo(b.x, b.y);
  }
  return true;
}

export function paintSkyLightning(
  ctx: CanvasRenderingContext2D,
  bolts: LightningBolt[],
  source: Point,
  size: { width: number; height: number; skyBottom: number },
  radius: number,
  intensity: number,
  color: [number, number, number]
): void {
  ctx.clearRect(0, 0, size.width, size.height);
  if (size.skyBottom <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size.width, size.skyBottom);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';

  const rgb = `${color[0]}, ${color[1]}, ${color[2]}`;
  const glow = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, 35 + intensity * 110);
  glow.addColorStop(0, `rgba(${rgb}, ${0.22 * intensity})`);
  glow.addColorStop(1, `rgba(${rgb}, 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size.width, size.skyBottom);

  const charge = Math.max(0, (intensity - 0.1) / 0.9);
  if (charge > 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const bolt of bolts) {
      const paths = [bolt.points, ...bolt.forks.filter((fork) => intensity >= fork.threshold).map((fork) => fork.points)];
      for (const points of paths) {
        for (const glowPass of [true, false]) {
          ctx.beginPath();
          if (!trace(ctx, points, source, radius)) continue;
          ctx.lineWidth = glowPass ? 7 : 1.6;
          ctx.strokeStyle = `rgba(${rgb}, ${charge * (glowPass ? 0.16 : 0.78)})`;
          ctx.shadowColor = `rgb(${rgb})`;
          ctx.shadowBlur = glowPass ? 18 : 3;
          ctx.stroke();
        }
      }
    }
  }
  // 地平线附近柔和消隐，避免闪电被水平裁成一条硬边。
  const fade = ctx.createLinearGradient(0, size.skyBottom - 30, 0, size.skyBottom);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, size.width, size.skyBottom);
  ctx.restore();
}
