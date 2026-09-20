import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PixelSummaryDto, MessageFlowDto } from '../../api/types';

export interface PixelMapRendererOptions {
  canvas: HTMLCanvasElement;
  onSelectPixel: (pixelId: string) => void;
  onHoverPixel: (pixelId: string | null) => void;
}

export interface TransferRecord {
  id: string;
  sourceId: string;
  targetId: string;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startTime: number;
  durationMs: number;
  status: 'animating' | 'completed';
  container: THREE.Group;
  curve?: THREE.QuadraticBezierCurve3;
  packetMesh?: THREE.Mesh;
  pipeMesh?: THREE.Mesh;
  arrowMesh?: THREE.Mesh;
}

const SPACING = 2.5;
const ACTIVE_COLOR = 0x3b82f6;
const DEAD_COLOR = 0xb8bec7;
const TIPS_COLOR = 0xf2b01e;
const EDGE_COLOR = 0xcbd1d8;
const FLOW_COLOR = 0x16a34a; // 高对比度鲜明翠绿
const PACKET_COLOR = 0x22c55e; // 飞行动效发光小球
const SELECTION_RING_COLOR = 0xff4500; // 醒目鲜橙红，在浅色背景和所有小球上极具辨识度
const DRAG_THRESHOLD_PX = 5;
const MAX_COMPLETED_TRANSFERS = 10; // 最多保留10次传递状态

const TUBE_RADIUS = 0.005; // 极细立体曲线管道半径，细腻精致且不粗重
const ARROW_RADIUS = 0.022; // 灵巧箭头底面半径，与细线和谐匹配
const ARROW_HEIGHT = 0.07; // 灵巧箭头高度
const ARROW_POSITION_T = 1 / 3; // 箭头置于绿色传递曲线的前进方向 1/3 处

/**
 * 3D Crystal Lattice 渲染器 (Three.js + OrbitControls)
 * World (x, y, z) → Three (x, z, y): World Z 垂直向上
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

  // 选中外围圈 (Billboard 面向相机)
  private selectionRingGeometry: THREE.BufferGeometry;
  private selectionRingMaterial: THREE.MeshBasicMaterial;
  private selectionRingMesh: THREE.Mesh;

  private sphereGeometry: THREE.SphereGeometry;
  private edgeMaterial: THREE.LineBasicMaterial;
  private flowMaterial: THREE.MeshBasicMaterial;

  private pixels: PixelSummaryDto[] = [];
  private messageFlow: MessageFlowDto[] = [];
  private selectedPixelId: string | null = null;
  private hoveredPixelId: string | null = null;
  private unreadTipsPixelIds: Set<string> = new Set();

  // 传递动效与状态管理
  private transfers: TransferRecord[] = [];
  private knownFlowKeys: Set<string> = new Set();
  private isFirstDataCall: boolean = true;

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

    // 光照：环境光 + 单方向光
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
    this.flowMaterial = new THREE.MeshBasicMaterial({ color: FLOW_COLOR, side: THREE.DoubleSide });

    // 构造醒目的外围选择圈 (RingGeometry，半径 0.46 ~ 0.55，包围小球)
    this.selectionRingGeometry = new THREE.RingGeometry(0.46, 0.55, 48);
    this.selectionRingMaterial = new THREE.MeshBasicMaterial({
      color: SELECTION_RING_COLOR,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
    });
    this.selectionRingMesh = new THREE.Mesh(this.selectionRingGeometry, this.selectionRingMaterial);
    this.selectionRingMesh.visible = false;
    this.scene.add(this.selectionRingMesh);

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

  public setData(
    pixels: PixelSummaryDto[],
    messageFlow: MessageFlowDto[],
    selectedId: string | null,
    unreadTipsPixelIds?: Set<string>
  ): void {
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

  /** 将 OrbitControls 焦点对准指定元胞（阻尼循环自动平滑过渡） */
  public focusPixel(pixelId: string): void {
    const pixel = this.pixels.find((p) => p.id === pixelId);
    if (!pixel) return;
    this.controls.target.copy(this.worldToScene(pixel.position));
  }

  public zoomIn(): void {
    this.dollyBy(0.8);
  }

  public zoomOut(): void {
    this.dollyBy(1.25);
  }

  /** 以 controls.target 为中心拉近/拉远相机 */
  private dollyBy(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  /** 视角对齐 Helper */
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
      if (mesh.geometry && mesh.geometry !== this.sphereGeometry && mesh.geometry !== this.selectionRingGeometry) {
        mesh.geometry.dispose();
      }
      const material = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (
        disposeMaterial &&
        material &&
        material !== this.edgeMaterial &&
        material !== this.flowMaterial &&
        material !== this.selectionRingMaterial
      ) {
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material.dispose();
      }
    }
  }

  private getFlowKey(flow: MessageFlowDto, src: string, tgt: string, index: number): string {
    if (flow.message_id) return flow.message_id;
    return `${flow.round ?? 0}_${src}_${tgt}_${index}`;
  }

  /**
   * 构建空间二次贝塞尔曲线：
   * 同一对元胞之间的多次传递通过统一的参考法线展开，无论同向或反向传递均不重合
   */
  private buildTransferCurve(
    startPos: THREE.Vector3,
    endPos: THREE.Vector3,
    indexInPair: number,
    totalInPair: number,
    isNaturalOrder: boolean = true
  ): THREE.QuadraticBezierCurve3 {
    const mid = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
    const dist = startPos.distanceTo(endPos);

    // 统一两元胞间的基准轴向，消除因起始点调换导致的局部法线反向对称重合
    const refDir = isNaturalOrder
      ? new THREE.Vector3().subVectors(endPos, startPos).normalize()
      : new THREE.Vector3().subVectors(startPos, endPos).normalize();

    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(refDir.dot(up)) > 0.88) {
      up = new THREE.Vector3(1, 0, 0);
    }
    const side = new THREE.Vector3().crossVectors(refDir, up).normalize();
    const actualUp = new THREE.Vector3().crossVectors(side, refDir).normalize();

    // 基础拱起高度，自适应节点间距
    const baseArc = Math.max(0.42, dist * 0.2);

    const offset = new THREE.Vector3();
    if (totalInPair <= 1) {
      offset.copy(actualUp).multiplyScalar(baseArc);
    } else {
      // 扇形分布在侧向和向上，彻底拉开间距，完全避免重合
      const spreadStep = 0.52;
      const centeredIdx = indexInPair - (totalInPair - 1) / 2;
      const angle = centeredIdx * spreadStep;
      const scale = 1.0 + Math.abs(centeredIdx) * 0.24;
      const spreadUp = actualUp.clone().multiplyScalar(Math.cos(angle));
      const spreadSide = side.clone().multiplyScalar(Math.sin(angle));
      offset.add(spreadUp).add(spreadSide).normalize().multiplyScalar(baseArc * scale);
    }

    const controlPoint = mid.clone().add(offset);
    return new THREE.QuadraticBezierCurve3(startPos, controlPoint, endPos);
  }

  /** 将已完成的传递状态在 3D 空间中可视化呈现为立体粗曲线与末端定向圆锥箭头 */
  private attachCompletedVisuals(record: TransferRecord): void {
    if (!record.curve) return;

    // 1. 生成带实体粗细的立体曲线管道 (TubeGeometry)
    if (!record.pipeMesh) {
      const tubeGeo = new THREE.TubeGeometry(record.curve, 24, TUBE_RADIUS, 8, false);
      const pipe = new THREE.Mesh(tubeGeo, this.flowMaterial);
      record.pipeMesh = pipe;
      record.container.add(pipe);
    }

    // 2. 曲线 1/3 处的定向圆锥箭头 (ConeGeometry) 精确指向目标元胞
    if (!record.arrowMesh) {
      const arrowGeo = new THREE.ConeGeometry(ARROW_RADIUS, ARROW_HEIGHT, 14);
      const arrow = new THREE.Mesh(arrowGeo, this.flowMaterial);

      // 取曲线 1/3 处 (ARROW_POSITION_T) 的位置和切线
      const tPos = record.curve.getPoint(ARROW_POSITION_T);
      const tangent = record.curve.getTangent(ARROW_POSITION_T).normalize();
      arrow.position.copy(tPos);

      // ConeGeometry 默认轴向为 Y 轴 (0, 1, 0)，通过四元数旋转至沿 tangent 切线方向
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
      record.arrowMesh = arrow;
      record.container.add(arrow);
    }
  }

  /** 限制传递状态总数不超过 MAX_COMPLETED_TRANSFERS(10次)，超出部分清空释放 */
  private trimTransfers(): void {
    while (this.transfers.length > MAX_COMPLETED_TRANSFERS) {
      const old = this.transfers.shift();
      if (!old) break;
      this.messageGroup.remove(old.container);
      this.disposeGroup(old.container, true);
    }
  }

  /** 动态刷新每条传递的曲线控制点（同对多条不重叠）及几何体 */
  private refreshTransferCurves(positions: Map<string, THREE.Vector3>): void {
    // 1. 按 pair 分组（无序 pairKey）
    const pairGroups = new Map<string, TransferRecord[]>();
    for (const record of this.transfers) {
      const p1 = record.sourceId < record.targetId ? record.sourceId : record.targetId;
      const p2 = record.sourceId < record.targetId ? record.targetId : record.sourceId;
      const pairKey = `${p1}__${p2}`;
      if (!pairGroups.has(pairKey)) pairGroups.set(pairKey, []);
      pairGroups.get(pairKey)!.push(record);
    }

    // 2. 重新构建扇形展开曲线并更新立体管道与箭头
    for (const [, records] of pairGroups) {
      const total = records.length;
      for (let i = 0; i < total; i++) {
        const r = records[i]!;
        const pStart = positions.get(r.sourceId) || r.startPos;
        const pEnd = positions.get(r.targetId) || r.endPos;
        r.startPos.copy(pStart);
        r.endPos.copy(pEnd);
        r.curve = this.buildTransferCurve(pStart, pEnd, i, total, r.sourceId < r.targetId);

        // 如果已挂载立体管道，更新网格几何体
        if (r.pipeMesh) {
          r.pipeMesh.geometry.dispose();
          r.pipeMesh.geometry = new THREE.TubeGeometry(r.curve, 24, TUBE_RADIUS, 8, false);
        }
        // 如果已挂载定向箭头，更新位置与切线旋转 (位于 1/3 处)
        if (r.arrowMesh) {
          const tPos = r.curve.getPoint(ARROW_POSITION_T);
          const tangent = r.curve.getTangent(ARROW_POSITION_T).normalize();
          r.arrowMesh.position.copy(tPos);
          r.arrowMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
        }
      }
    }
  }

  /** 处理消息流：检测新传递启动动效、维护最多10次完成状态 */
  private processMessageFlows(positions: Map<string, THREE.Vector3>): void {
    // 首次加载页面时：将既有消息流（最新至多10条）初始化为完成状态
    if (this.isFirstDataCall) {
      this.isFirstDataCall = false;
      const initialFlows = (this.messageFlow || []).slice(-MAX_COMPLETED_TRANSFERS);
      for (let i = 0; i < initialFlows.length; i++) {
        const flow = initialFlows[i];
        if (!flow) continue;
        const srcId = flow.source || flow.from;
        const tgtId = flow.target || flow.to;
        if (!srcId || !tgtId || srcId === tgtId) continue;
        const start = positions.get(srcId);
        const end = positions.get(tgtId);
        if (!start || !end) continue;
        const key = this.getFlowKey(flow, srcId, tgtId, i);
        this.knownFlowKeys.add(key);

        const container = new THREE.Group();
        this.messageGroup.add(container);

        const record: TransferRecord = {
          id: key,
          sourceId: srcId,
          targetId: tgtId,
          startPos: start.clone(),
          endPos: end.clone(),
          startTime: performance.now(),
          durationMs: 850,
          status: 'completed',
          container,
        };
        this.transfers.push(record);
      }
      this.refreshTransferCurves(positions);
      for (const r of this.transfers) {
        this.attachCompletedVisuals(r);
      }
      return;
    }

    // 后续刷新更新：检测新发生的传递
    for (let i = 0; i < (this.messageFlow || []).length; i++) {
      const flow = this.messageFlow[i];
      if (!flow) continue;
      const srcId = flow.source || flow.from;
      const tgtId = flow.target || flow.to;
      if (!srcId || !tgtId || srcId === tgtId) continue;
      const key = this.getFlowKey(flow, srcId, tgtId, i);
      if (this.knownFlowKeys.has(key)) continue;

      // 发现新发生的传递！启动动效
      this.knownFlowKeys.add(key);
      const start = positions.get(srcId);
      const end = positions.get(tgtId);
      if (!start || !end) continue;

      const container = new THREE.Group();
      const packetGeo = new THREE.SphereGeometry(0.045, 16, 12);
      const packetMat = new THREE.MeshBasicMaterial({ color: PACKET_COLOR });
      const packetMesh = new THREE.Mesh(packetGeo, packetMat);
      packetMesh.position.copy(start);
      container.add(packetMesh);
      this.messageGroup.add(container);

      const record: TransferRecord = {
        id: key,
        sourceId: srcId,
        targetId: tgtId,
        startPos: start.clone(),
        endPos: end.clone(),
        startTime: performance.now(),
        durationMs: 850,
        status: 'animating',
        container,
        packetMesh,
      };

      this.transfers.push(record);
    }

    // 保持最多 10 次传递状态，超出的历史传递直接清空
    this.trimTransfers();

    // 重新计算并展开所有传递曲线
    this.refreshTransferCurves(positions);
  }

  /** 重建元胞小球、邻域边与选择外圈 */
  private rebuildSceneObjects(): void {
    this.disposeGroup(this.pixelGroup, true);
    this.disposeGroup(this.edgeGroup, false);

    const idSet = new Set(this.pixels.map((p) => p.id));
    const positions = new Map<string, THREE.Vector3>();
    for (const p of this.pixels) {
      positions.set(p.id, this.worldToScene(p.position));
    }

    // 六邻域晶格连线
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

    // 更新消息传递动效与状态队列
    this.processMessageFlows(positions);

    // 小球节点渲染（能量编码：半径随能量映射、死亡缩小淡化）
    const energies = this.pixels.map((p) => Number(p.energy) || 0);
    const maxEnergy = Math.max(1, ...energies);
    let selectedPos: THREE.Vector3 | null = null;
    for (const pixel of this.pixels) {
      const color = this.unreadTipsPixelIds.has(pixel.id)
        ? TIPS_COLOR
        : pixel.active
          ? ACTIVE_COLOR
          : DEAD_COLOR;
      const isSelected = pixel.id === this.selectedPixelId;
      const isHovered = pixel.id === this.hoveredPixelId;
      const pos = positions.get(pixel.id)!;
      if (isSelected) {
        selectedPos = pos;
      }

      // 能量归一化映射到 0.75 ~ 1.30 半径（上限保证选中放大后仍被选中外环 0.55 包住）；死亡元胞额外缩小降透明
      const energyNorm = Math.max(0, Math.min(1, (Number(pixel.energy) || 0) / maxEnergy));
      const energyScale = 0.75 + 0.55 * energyNorm;
      const deadFactor = pixel.active ? 1.0 : 0.55;

      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: isSelected ? new THREE.Color(color).multiplyScalar(0.35) : new THREE.Color(0x000000),
        roughness: 0.35,
        metalness: 0.05,
        transparent: !pixel.active,
        opacity: pixel.active ? 1.0 : 0.45,
      });
      const mesh = new THREE.Mesh(this.sphereGeometry, material);
      mesh.position.copy(pos);
      const interactScale = isSelected ? 1.25 : isHovered ? 1.1 : 1.0;
      mesh.scale.setScalar(energyScale * deadFactor * interactScale);
      mesh.userData.pixelId = pixel.id;
      this.pixelGroup.add(mesh);
    }

    // 更新外围选择圈位置与可见性
    if (selectedPos) {
      this.selectionRingMesh.position.copy(selectedPos);
      this.selectionRingMesh.visible = true;
    } else {
      this.selectionRingMesh.visible = false;
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
    if (this.pointerDownPos) return; // 拖拽旋转中不做 hover 检测
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
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_THRESHOLD_PX) return;
    const clicked = this.pickPixel(e);
    if (clicked) {
      this.selectedPixelId = clicked;
      this.onSelectPixel(clicked);
      this.rebuildSceneObjects();
    }
  }

  private startAnimationLoop(): void {
    const loop = (time: number) => {
      this.controls.update();

      // 1. 保持外围选择圈始终面向镜头，并施加轻微呼吸微动效
      if (this.selectionRingMesh && this.selectionRingMesh.visible) {
        this.selectionRingMesh.quaternion.copy(this.camera.quaternion);
        const pulse = 1.0 + 0.05 * Math.sin(time * 0.006);
        this.selectionRingMesh.scale.set(pulse, pulse, pulse);
      }

      // 2. 更新正在进行的传递动效（沿对应的空间贝塞尔曲线飞行）
      for (const record of this.transfers) {
        if (record.status === 'animating') {
          const elapsed = time - record.startTime;
          const progress = Math.min(1.0, elapsed / record.durationMs);

          // 沿空间曲线路径飞行
          if (record.curve) {
            const currentPos = record.curve.getPoint(progress);
            if (record.packetMesh) {
              record.packetMesh.position.copy(currentPos);
            }
          }

          // 传递完成：显示带箭头的完成曲线管道
          if (progress >= 1.0) {
            record.status = 'completed';
            if (record.packetMesh) {
              record.container.remove(record.packetMesh);
              record.packetMesh.geometry.dispose();
              (record.packetMesh.material as THREE.Material).dispose();
              record.packetMesh = undefined;
            }
            this.attachCompletedVisuals(record);
            this.trimTransfers();
          }
        }
      }

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

    if (this.selectionRingMesh) {
      this.scene.remove(this.selectionRingMesh);
    }
    this.selectionRingGeometry.dispose();
    this.selectionRingMaterial.dispose();

    for (const t of this.transfers) {
      this.messageGroup.remove(t.container);
      this.disposeGroup(t.container, true);
    }
    this.transfers = [];

    this.disposeGroup(this.pixelGroup, true);
    this.disposeGroup(this.edgeGroup, true);
    this.disposeGroup(this.messageGroup, true);
    this.sphereGeometry.dispose();
    this.edgeMaterial.dispose();
    this.flowMaterial.dispose();
    this.renderer.dispose();
  }
}
