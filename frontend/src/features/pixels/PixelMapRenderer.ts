import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PixelSummaryDto, MessageFlowDto } from '../../api/types';

export interface PixelMapRendererOptions {
  canvas: HTMLCanvasElement;
  onSelectPixel: (pixelId: string) => void;
  onHoverPixel: (pixelId: string | null) => void;
}

const SPACING = 2.5;
const ACTIVE_COLOR = 0x3b82f6;
const DEAD_COLOR = 0xb8bec7;
const TIPS_COLOR = 0xf2b01e;
const EDGE_COLOR = 0xcbd1d8;
const FLOW_COLOR = 0x22a447;
const DRAG_THRESHOLD_PX = 5;

/**
 * True 3D Crystal Lattice renderer (Three.js + OrbitControls).
 * World (x, y, z) → Three (x, z, y): World Z is the vertical axis.
 * Public API mirrors the previous Canvas 2.5D renderer so PixelMapCanvas
 * keeps calling it unchanged.
 */
export class PixelMapRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster: THREE.Raycaster;

  private pixelGroup: THREE.Group;
  private edgeGroup: THREE.Group;
  private messageGroup: THREE.Group;

  private sphereGeometry: THREE.SphereGeometry;
  private edgeMaterial: THREE.LineBasicMaterial;
  private flowMaterial: THREE.LineBasicMaterial;

  private pixels: PixelSummaryDto[] = [];
  private messageFlow: MessageFlowDto[] = [];
  private selectedPixelId: string | null = null;
  private hoveredPixelId: string | null = null;
  private unreadTipsPixelIds: Set<string> = new Set();

  private onSelectPixel: (pixelId: string) => void;
  private onHoverPixel: (pixelId: string | null) => void;

  private animationFrameId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pointerDownPos: { x: number; y: number } | null = null;

  private handlePointerDownBound: (e: PointerEvent) => void;
  private handlePointerMoveBound: (e: PointerEvent) => void;
  private handlePointerUpBound: (e: PointerEvent) => void;
  private handleResizeBound: () => void;

  constructor(options: PixelMapRendererOptions) {
    this.canvas = options.canvas;
    this.onSelectPixel = options.onSelectPixel;
    this.onHoverPixel = options.onHoverPixel;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf7f8fa);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.camera.position.set(8, 8, 8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;
    this.controls.enablePan = true;
    this.controls.target.set(0, 0, 0);

    // 光照：环境光 + 单方向光，产生亮面/暗面/高光
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(8, 12, 10);
    this.scene.add(dirLight);

    // 地面网格：世界 z=0 → Three Y=0
    const grid = new THREE.GridHelper(30, 20, 0xd0d7de, 0xe7ebef);
    grid.position.y = 0;
    this.scene.add(grid);

    // 坐标轴：Three Y = World Z
    this.scene.add(new THREE.AxesHelper(3));

    this.pixelGroup = new THREE.Group();
    this.edgeGroup = new THREE.Group();
    this.messageGroup = new THREE.Group();
    this.scene.add(this.edgeGroup, this.pixelGroup, this.messageGroup);

    this.sphereGeometry = new THREE.SphereGeometry(0.32, 24, 16);
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.6 });
    this.flowMaterial = new THREE.LineBasicMaterial({ color: FLOW_COLOR, transparent: true, opacity: 0.85 });

    this.raycaster = new THREE.Raycaster();

    this.handlePointerDownBound = (e) => this.onPointerDown(e);
    this.handlePointerMoveBound = (e) => this.onPointerMove(e);
    this.handlePointerUpBound = (e) => this.onPointerUp(e);
    this.handleResizeBound = () => this.resize();

    this.canvas.addEventListener('pointerdown', this.handlePointerDownBound);
    this.canvas.addEventListener('pointermove', this.handlePointerMoveBound);
    this.canvas.addEventListener('pointerup', this.handlePointerUpBound);
    window.addEventListener('resize', this.handleResizeBound);
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      if (this.canvas.parentElement) this.resizeObserver.observe(this.canvas.parentElement);
    }

    this.resize();
    this.startAnimationLoop();
  }

  /** World (x, y, z) → Three (x, z, y)：World Z 竖直向上 */
  private worldToScene([x, y, z]: [number, number, number]): THREE.Vector3 {
    return new THREE.Vector3(x * SPACING, z * SPACING, y * SPACING);
  }

  public setData(pixels: PixelSummaryDto[], messageFlow: MessageFlowDto[], selectedId: string | null, unreadTipsPixelIds?: Set<string>): void {
    this.pixels = pixels || [];
    this.messageFlow = messageFlow || [];
    this.selectedPixelId = selectedId;
    if (unreadTipsPixelIds) this.unreadTipsPixelIds = unreadTipsPixelIds;
    this.rebuildSceneObjects();
  }

  public setSelectedPixel(pixelId: string | null): void {
    this.selectedPixelId = pixelId;
    this.rebuildSceneObjects();
  }

  public resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public resetView(): void {
    this.fitCameraToPixels();
  }

  public zoomIn(): void {
    this.dollyBy(0.8);
  }

  public zoomOut(): void {
    this.dollyBy(1.25);
  }

  /** 以 controls.target 为中心拉近/拉远相机（不使用 OrbitControls 私有 API） */
  private dollyBy(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /** 简单 helper：根据 Pixel 包围盒把相机摆到能同时看到 X/Y/Z 的斜上方视角 */
  private fitCameraToPixels(): void {
    let maxDim = 4;
    if (this.pixels.length > 0) {
      const box = new THREE.Box3();
      for (const p of this.pixels) {
        box.expandByPoint(this.worldToScene(p.position));
      }
      const size = box.getSize(new THREE.Vector3());
      maxDim = Math.max(size.x, size.y, size.z, 4);
      const center = box.getCenter(new THREE.Vector3());
      this.controls.target.copy(center);
    } else {
      this.controls.target.set(0, 0, 0);
    }
    const distance = Math.max(10, maxDim * 1.8);
    const direction = new THREE.Vector3(1, 0.85, 1).normalize();
    this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(distance));
    this.controls.update();
  }

  private disposeGroup(group: THREE.Group, disposeMaterial: boolean): void {
    for (const child of [...group.children]) {
      group.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== this.sphereGeometry) mesh.geometry.dispose();
      const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      // 共享材质（edge/flow/sphere 材质）统一在 dispose() 释放
      if (disposeMaterial && material && material !== this.edgeMaterial && material !== this.flowMaterial) {
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    }
  }

  /** 每次 world polling 更新时全量重建（当前 Pixel 数量级下足够） */
  private rebuildSceneObjects(): void {
    this.disposeGroup(this.pixelGroup, true);
    this.disposeGroup(this.edgeGroup, false);
    this.disposeGroup(this.messageGroup, false);

    const idSet = new Set(this.pixels.map((p) => p.id));
    const positions = new Map<string, THREE.Vector3>();
    for (const p of this.pixels) {
      positions.set(p.id, this.worldToScene(p.position));
    }

    // 六邻域晶格连线：每条边只画一次
    for (const pixel of this.pixels) {
      for (const neighborId of pixel.neighbors || []) {
        if (!idSet.has(neighborId) || pixel.id >= neighborId) continue;
        const a = positions.get(pixel.id);
        const b = positions.get(neighborId);
        if (!a || !b) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
        this.edgeGroup.add(new THREE.Line(geometry, this.edgeMaterial));
      }
    }

    // Message Flow：静态绿色连线
    for (const flow of this.messageFlow) {
      const srcId = flow.source || flow.from;
      const tgtId = flow.target || flow.to;
      if (!srcId || !tgtId || srcId === tgtId) continue;
      const a = positions.get(srcId);
      const b = positions.get(tgtId);
      if (!a || !b) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
      this.messageGroup.add(new THREE.Line(geometry, this.flowMaterial));
    }

    // 球体：黄色 = 未读 Tips 优先，其次蓝色 = Active，浅灰 = Dead
    for (const pixel of this.pixels) {
      const color = this.unreadTipsPixelIds.has(pixel.id)
        ? TIPS_COLOR
        : pixel.active
          ? ACTIVE_COLOR
          : DEAD_COLOR;
      const isSelected = pixel.id === this.selectedPixelId;
      const isHovered = pixel.id === this.hoveredPixelId;
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: isSelected ? new THREE.Color(color).multiplyScalar(0.35) : new THREE.Color(0x000000),
        roughness: 0.35,
        metalness: 0.05,
      });
      const mesh = new THREE.Mesh(this.sphereGeometry, material);
      mesh.position.copy(positions.get(pixel.id)!);
      const scale = isSelected ? 1.25 : isHovered ? 1.1 : 1.0;
      mesh.scale.setScalar(scale);
      mesh.userData.pixelId = pixel.id;
      this.pixelGroup.add(mesh);
    }
  }

  private pickPixel(e: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pixelGroup.children, false);
    const first = hits.find((h) => h.object.userData.pixelId);
    return first ? String(first.object.userData.pixelId) : null;
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointerDownPos) return; // 拖动旋转中不做 hover 检测
    const hovered = this.pickPixel(e);
    if (hovered !== this.hoveredPixelId) {
      this.hoveredPixelId = hovered;
      this.onHoverPixel(hovered);
      this.rebuildSceneObjects();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const down = this.pointerDownPos;
    this.pointerDownPos = null;
    if (!down) return;
    // 拖动阈值：位移 > 5px 视为旋转/平移，不触发选择
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD_PX) return;
    const clicked = this.pickPixel(e);
    if (clicked) {
      this.selectedPixelId = clicked;
      this.onSelectPixel(clicked);
      this.rebuildSceneObjects();
    }
  }

  private startAnimationLoop(): void {
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationFrameId = requestAnimationFrame(loop);
    };
    this.animationFrameId = requestAnimationFrame(loop);
  }

  public dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.canvas.removeEventListener('pointerdown', this.handlePointerDownBound);
    this.canvas.removeEventListener('pointermove', this.handlePointerMoveBound);
    this.canvas.removeEventListener('pointerup', this.handlePointerUpBound);
    window.removeEventListener('resize', this.handleResizeBound);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    this.disposeGroup(this.pixelGroup, true);
    this.disposeGroup(this.edgeGroup, true);
    this.disposeGroup(this.messageGroup, true);
    this.sphereGeometry.dispose();
    this.edgeMaterial.dispose();
    this.flowMaterial.dispose();
    this.renderer.dispose();
  }
}
