import * as THREE from 'three';

/**
 * 心跳闪电风暴：行走式生长（stepped leader）+ 屏幕空间四边形条带渲染
 *
 * 从世界原点 (0,0,0) 出发，沿世界 XY 平面（Three.js 的 XZ 水平面）径向扩散。
 * 不再预生成整棵树：维护一组"生长尖端"，每帧随机行走进位、沿途概率分叉，
 * 尖端追逐波前半径——肉眼可见地爬行、分叉、蔓延。
 * 每段闪电渲染为四边形条带（2 三角形），顶点着色器内沿屏幕法向外扩，
 * 突破 WebGL 1px 线宽限制，获得真实闪电的粗壮电弧。
 * 手绘心跳曲线的 Y 值同时驱动：
 *   - 颜色（呼吸冷青 → 跃迁熔金 → 主峰白热 → 余烬缓落）
 *   - 波前半径（扩散速度：慢呼吸 → 立方加速 → 双峰扫掠 → 减速蔓延）
 *   - 分叉密度与主干涌流（Y 越高，分叉越密、回击补充的主干越多）
 *   - 闪烁剧烈程度（低强度余烬脉动，高强度疾闪 + 偶发回击增亮）
 * 缓落期波前不再扩张，透明度逐渐熄灭 = 慢慢变暗变淡。
 */

const TOTAL_SEC = 8.4;
/** 波前最大半径（场景单位，略超底盘半径 24，让闪电末端探入星空背景） */
const REACH = 34;
const MAX_SEGMENTS = 12288;
/** 每段 = 四边形条带 = 2 三角形 = 6 顶点 */
const VERTS_PER_SEGMENT = 6;
/** 初始主干数量与尖端行走速度（场景单位/秒） */
const TRUNK_COUNT = 6;
const GROW_SPEED = 26;
/** 单次行走步长：越小锯齿越细腻 */
const STEP_LEN = 0.5;
/** 同时存活的尖端的硬上限（主干 + 分叉） */
const MAX_TIPS = 240;
/** 主干线宽（CSS px），分叉逐层衰减 */
const TRUNK_WIDTH = 3.4;
/** 闪电平面略高于地面底盘，避免 z-fighting */
const PLANE_Y = 0.06;

/** 生长中的闪电尖端：位置 + 行走方向 + 线宽/亮度（分叉递减） */
interface Tip {
  x: number;
  y: number;
  z: number;
  angle: number;
  width: number;
  brightness: number;
  depth: number;
  speed: number;
  alive: boolean;
}

export interface HeartbeatDebugInfo {
  active: boolean;
  t: number;
  intensity: number;
  radius: number;
  segments: number;
}

/* ===== 手绘曲线：两次跃迁，第一峰较低，回落后冲到主峰 ===== */
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
  return Math.exp(-u / 1.8) * (1 + 0.04 * Math.sin(u * 5));
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
        (c0[0] + (c1[0] - c0[0]) * u) / 255,
        (c0[1] + (c1[1] - c0[1]) * u) / 255,
        (c0[2] + (c1[2] - c0[2]) * u) / 255,
      ];
    }
  }
  const last = WAVE_COLOR_KEYS[WAVE_COLOR_KEYS.length - 1]![1];
  return [last[0] / 255, last[1] / 255, last[2] / 255];
}

/** 波前半径：呼吸期在原点附近脉动，主峰时横扫至星空边缘，缓落期停止扩张 */
function heartbeatRadius(t: number, reach: number): number {
  if (t < 2.2) return 1.2 + 2.0 * (t / 2.2) + 0.3 * Math.sin((t * Math.PI * 2) / 1.1);
  if (t < 3.4) {
    const u = (t - 2.2) / 1.2;
    return 3.2 + (reach * 0.1 - 3.2) * u * u * u;
  }
  if (t < 3.7) {
    const u = (t - 3.4) / 0.3;
    return reach * (0.1 + 0.22 * Math.sin(u * Math.PI * 0.5));
  }
  if (t < 4.1) return reach * (0.32 + 0.03 * ((t - 3.7) / 0.4));
  if (t < 4.5) {
    const u = (t - 4.1) / 0.4;
    return reach * (0.35 + 0.7 * u * u * u);
  }
  return reach * (1.05 + 0.15 * Math.min(1, (t - 4.5) / 1.2));
}

/** 原点电荷辉光贴图（白芯径向衰减） */
function createGlowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(canvas);
}

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aOther;
  attribute float aSide;
  attribute float aWidth;
  attribute float aDist;
  uniform vec2 uResolution;
  uniform float uPixelRatio;
  varying float vDist;
  varying float vSide;
  varying vec3 vColor;
  void main() {
    vDist = aDist;
    vSide = aSide;
    vColor = color;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 clipOther = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
    // 屏幕空间垂直外扩：NDC * 分辨率/2 = 像素，线宽与距离无关、恒定像素宽
    vec2 dirPx = (clipOther.xy / clipOther.w - clip.xy / clip.w) * uResolution * 0.5;
    float len = length(dirPx);
    vec2 n = len > 1e-3 ? vec2(-dirPx.y, dirPx.x) / len : vec2(0.0, 1.0);
    vec2 offsetPx = n * aSide * aWidth * uPixelRatio * 0.5;
    clip.xy += (offsetPx / (uResolution * 0.5)) * clip.w;
    gl_Position = clip;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uTint;
  uniform float uRadius;
  uniform float uOpacity;
  varying float vDist;
  varying float vSide;
  varying vec3 vColor;
  void main() {
    // 波前裁切：闪电只传播到当前半径，边沿柔和
    float front = 1.0 - smoothstep(uRadius * 0.9, uRadius, vDist);
    if (front <= 0.002) discard;
    // 横向柔和截面：发光圆管而不是硬边矩形
    float profile = pow(1.0 - abs(vSide), 0.6);
    // 波前前沿白热增亮，像电弧的先锋
    float edge = smoothstep(uRadius * 0.7, uRadius, vDist);
    vec3 col = vColor * uTint * (0.9 + edge * 1.8);
    float a = uOpacity * front * profile;
    if (a <= 0.003) discard;
    gl_FragColor = vec4(col * a, a);
  }
`;

export class HeartbeatLightning {
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly glow: THREE.Sprite;
  private readonly glowMaterial: THREE.SpriteMaterial;
  private readonly glowTexture: THREE.CanvasTexture;

  private readonly positions = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEGMENT * 3);
  private readonly others = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEGMENT * 3);
  private readonly colors = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEGMENT * 3);
  private readonly dists = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEGMENT);
  private readonly sides = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEGMENT);
  private readonly widths = new Float32Array(MAX_SEGMENTS * VERTS_PER_SEGMENT);
  private segmentCursor = 0;

  private readonly tips: Tip[] = [];

  private startAt = -Infinity;
  private lastTickMs = 0;
  private active = false;
  private currentT = 0;
  private currentIntensity = 0;
  private currentRadius = 0;

  constructor(parent: THREE.Object3D) {
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aOther', new THREE.BufferAttribute(this.others, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aDist', new THREE.BufferAttribute(this.dists, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSide', new THREE.BufferAttribute(this.sides, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aWidth', new THREE.BufferAttribute(this.widths, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTint: { value: new THREE.Color(1, 1, 1) },
        uRadius: { value: 0 },
        uOpacity: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPixelRatio: { value: 1 },
      },
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const bolts = new THREE.Mesh(this.geometry, this.material);
    bolts.frustumCulled = false; // 缓冲区复用，包围球不可靠
    this.group.add(bolts);

    this.glowTexture = createGlowTexture();
    this.glowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0,
    });
    this.glow = new THREE.Sprite(this.glowMaterial);
    this.glow.position.set(0, 0.3, 0);
    this.group.add(this.glow);

    this.group.visible = false;
    parent.add(this.group);
  }

  /** 触发一次完整的心跳闪电周期（8.4s）；offsetSec 可直接跳到周期中间（测试用） */
  public trigger(nowMs: number, offsetSec = 0): void {
    this.startAt = nowMs - offsetSec * 1000;
    this.lastTickMs = nowMs;
    this.active = true;
    this.group.visible = true;
    this.resetGrowth();
  }

  /** 视口分辨率（绘制缓冲像素）与像素比：屏幕空间恒定线宽所需 */
  public setViewport(width: number, height: number, pixelRatio: number): void {
    (this.material.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
    this.material.uniforms.uPixelRatio!.value = pixelRatio;
  }

  /** 清空缓冲区并从原点重新播种主干尖端 */
  private resetGrowth(): void {
    this.segmentCursor = 0;
    this.geometry.setDrawRange(0, 0);
    this.tips.length = 0;
    for (let i = 0; i < TRUNK_COUNT; i++) {
      const angle = (i / TRUNK_COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      this.tips.push(this.makeTip(0, PLANE_Y, 0, angle, TRUNK_WIDTH, 1, 0));
    }
  }

  private makeTip(
    x: number,
    y: number,
    z: number,
    angle: number,
    width: number,
    brightness: number,
    depth: number
  ): Tip {
    return {
      x,
      y,
      z,
      angle,
      width,
      brightness,
      depth,
      speed: GROW_SPEED * (0.85 + Math.random() * 0.3),
      alive: true,
    };
  }

  /** 每帧推进：曲线 → 颜色/波前 + 尖端行走生长 + 电气闪烁 */
  public tick(timeMs: number): void {
    if (!this.active) return;
    const t = (timeMs - this.startAt) / 1000;
    if (t >= TOTAL_SEC) {
      this.active = false;
      this.group.visible = false;
      this.material.uniforms.uOpacity!.value = 0;
      this.glowMaterial.opacity = 0;
      return;
    }
    this.currentT = t;
    const intensity = heartbeatEnvelope(t);
    const radius = heartbeatRadius(t, REACH);
    const tint = heartbeatColor(t);
    this.currentIntensity = intensity;
    this.currentRadius = radius;

    // 行走式生长：尖端每帧随机行走进位、概率分叉，追逐波前半径
    const dtSec = Math.min(0.05, Math.max(0, (timeMs - this.lastTickMs) / 1000));
    this.lastTickMs = timeMs;
    if (this.grow(dtSec, radius, intensity, t)) {
      this.geometry.setDrawRange(0, this.segmentCursor * VERTS_PER_SEGMENT);
    }

    // 帧间电气抖动：低强度时像余烬缓慢脉动，高强度时剧烈闪烁 + 偶发回击增亮
    let flicker =
      intensity < 0.15
        ? 0.88 + 0.12 * Math.sin(timeMs * 0.011)
        : 0.78 + 0.38 * Math.random();
    if (intensity > 0.45 && Math.random() < 0.06) flicker *= 1.7;

    (this.material.uniforms.uTint!.value as THREE.Color).setRGB(tint[0], tint[1], tint[2]);
    this.material.uniforms.uRadius!.value = radius;
    this.material.uniforms.uOpacity!.value = Math.min(1, intensity * 1.15) * flicker;

    // 原点电荷辉光（收敛强度，避免洗白地面）
    this.glowMaterial.color.setRGB(tint[0], tint[1], tint[2]);
    this.glowMaterial.opacity = intensity * 0.3 * flicker;
    const glowScale = 1.4 + intensity * 4.2;
    this.glow.scale.set(glowScale, glowScale, 1);
  }

  public getDebug(): HeartbeatDebugInfo {
    return {
      active: this.active,
      t: Math.round(this.currentT * 100) / 100,
      intensity: Math.round(this.currentIntensity * 1000) / 1000,
      radius: Math.round(this.currentRadius * 100) / 100,
      segments: this.segmentCursor,
    };
  }

  /**
   * 行走式生长一帧：每个存活尖端按速度前进 STEP_LEN 小步，方向随机抖动形成锯齿，
   * 沿途概率分叉（更细更暗、层级更深）；尖端到达波前后等待其继续扩张，
   * 落后于波前的尖端加速追赶（相位跳转/涌流补种时快速就位）。返回本帧是否写入新段。
   */
  private grow(dtSec: number, radius: number, intensity: number, t: number): boolean {
    if (dtSec <= 0) return false;
    let dirtyFrom = -1;

    // 峰值涌流：强度越高补充越多主干（回击）；缓落期不再播种
    if (t < 4.5) {
      const desiredTrunks = Math.round(TRUNK_COUNT * (0.6 + intensity * 0.9));
      let trunks = 0;
      for (const tip of this.tips) {
        if (tip.alive && tip.depth === 0) trunks++;
      }
      for (let i = trunks; i < desiredTrunks && this.tips.length < MAX_TIPS; i++) {
        this.tips.push(this.makeTip(0, PLANE_Y, 0, Math.random() * Math.PI * 2, TRUNK_WIDTH, 1, 0));
      }
    }

    for (const tip of this.tips) {
      if (!tip.alive) continue;
      let dist = Math.hypot(tip.x, tip.z);
      // 落后波前越多走得越快（追赶加速），贴住波前后以常速行走
      const catchUp = Math.min(6, Math.max(1, (radius - dist) * 0.6));
      let travel = tip.speed * catchUp * dtSec;

      while (travel > 0) {
        if (dist >= radius) break; // 已到波前，等待其扩张
        if (this.segmentCursor >= MAX_SEGMENTS) {
          tip.alive = false;
          break;
        }
        const step = Math.min(STEP_LEN, travel, radius - dist + STEP_LEN * 0.5);
        travel -= step;
        // 方向随机抖动 = 闪电锯齿；分叉比主干更飘忽
        tip.angle += (Math.random() - 0.5) * (tip.depth === 0 ? 0.55 : 0.85);
        const nx = tip.x + Math.cos(tip.angle) * step;
        const nz = tip.z + Math.sin(tip.angle) * step;
        const ny = PLANE_Y + (Math.random() - 0.5) * 0.06;
        if (dirtyFrom < 0) dirtyFrom = this.segmentCursor * VERTS_PER_SEGMENT;
        this.emitSegment(tip, nx, ny, nz);
        tip.x = nx;
        tip.y = ny;
        tip.z = nz;
        dist = Math.hypot(nx, nz);

        // 沿途分叉：强度越高越密；子支更细更暗
        if (tip.depth < 2 && this.tips.length < MAX_TIPS) {
          const branchProb = (0.05 + 0.1 * intensity) * (tip.depth === 0 ? 1 : 0.4);
          if (Math.random() < branchProb) {
            const sign = Math.random() < 0.5 ? -1 : 1;
            this.tips.push(
              this.makeTip(
                nx,
                ny,
                nz,
                tip.angle + sign * (0.4 + Math.random() * 0.55),
                Math.max(1.3, tip.width * 0.62),
                tip.brightness * 0.62,
                tip.depth + 1
              )
            );
          }
        }
        // 分叉随机熄灭（主干不熄，保证心跳主轮廓完整）
        if (tip.depth > 0 && Math.random() < 0.018) {
          tip.alive = false;
          break;
        }
      }
    }

    if (dirtyFrom < 0) return false;
    this.uploadRange(dirtyFrom, this.segmentCursor * VERTS_PER_SEGMENT - dirtyFrom);
    return true;
  }

  /** 写入一段闪电的四边形条带（2 三角形 = 6 顶点，顶点着色器内屏幕空间外扩） */
  private emitSegment(tip: Tip, nx: number, ny: number, nz: number): void {
    const distA = Math.hypot(tip.x, tip.z);
    const distB = Math.hypot(nx, nz);
    const brightness = tip.brightness * (0.88 + Math.random() * 0.24);
    let vi = this.segmentCursor * VERTS_PER_SEGMENT;
    // 三角形 (a- a+ b+) 与 (a- b+ b-)
    vi = this.writeVertex(vi, tip.x, tip.y, tip.z, nx, ny, nz, -1, brightness, distA, tip.width);
    vi = this.writeVertex(vi, tip.x, tip.y, tip.z, nx, ny, nz, +1, brightness, distA, tip.width);
    vi = this.writeVertex(vi, nx, ny, nz, tip.x, tip.y, tip.z, +1, brightness, distB, tip.width);
    vi = this.writeVertex(vi, tip.x, tip.y, tip.z, nx, ny, nz, -1, brightness, distA, tip.width);
    vi = this.writeVertex(vi, nx, ny, nz, tip.x, tip.y, tip.z, +1, brightness, distB, tip.width);
    this.writeVertex(vi, nx, ny, nz, tip.x, tip.y, tip.z, -1, brightness, distB, tip.width);
    this.segmentCursor++;
  }

  private writeVertex(
    vi: number,
    px: number,
    py: number,
    pz: number,
    ox: number,
    oy: number,
    oz: number,
    side: number,
    brightness: number,
    dist: number,
    width: number
  ): number {
    const i3 = vi * 3;
    this.positions[i3] = px;
    this.positions[i3 + 1] = py;
    this.positions[i3 + 2] = pz;
    this.others[i3] = ox;
    this.others[i3 + 1] = oy;
    this.others[i3 + 2] = oz;
    this.colors[i3] = brightness;
    this.colors[i3 + 1] = brightness;
    this.colors[i3 + 2] = brightness;
    this.dists[vi] = dist;
    this.sides[vi] = side;
    this.widths[vi] = width;
    return vi + 1;
  }

  /** 仅上传本帧新写入的缓冲区区间（追加式生长，避免每帧全量上传） */
  private uploadRange(fromVertex: number, vertexCount: number): void {
    const entries: Array<[string, number]> = [
      ['position', 3],
      ['aOther', 3],
      ['color', 3],
      ['aDist', 1],
      ['aSide', 1],
      ['aWidth', 1],
    ];
    for (const [name, itemSize] of entries) {
      const attr = this.geometry.getAttribute(name) as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(fromVertex * itemSize, vertexCount * itemSize);
      attr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
    this.glowTexture.dispose();
  }
}

