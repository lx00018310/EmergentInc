import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { PixelMapRenderer } from '../src/features/pixels/PixelMapRenderer';

/**
 * jsdom 无 WebGL 上下文：在构造 renderer 前把 WebGLRenderer 的 GL 相关方法替换为 stub，
 * 只验证渲染器的场景组织与生命周期逻辑，不做真实 GL 渲染。
 * 注意：WebGLRenderer 方法挂在实例上而非 prototype，因此直接替换构造函数。
 */
const renderSpy = vi.fn();
const setSizeSpy = vi.fn();
const disposeRendererSpy = vi.fn();

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class WebGLRendererStub {
    domElement: HTMLCanvasElement;
    render = renderSpy;
    setSize = setSizeSpy;
    dispose = disposeRendererSpy;
    setPixelRatio = vi.fn();
    constructor(params: any) {
      this.domElement = params?.canvas ?? document.createElement('canvas');
    }
  }
  return { ...actual, WebGLRenderer: WebGLRendererStub };
});

function createMockCanvas(): { canvas: HTMLCanvasElement; parent: HTMLDivElement } {
  const canvas = document.createElement('canvas');
  const parent = document.createElement('div');
  parent.appendChild(canvas);
  vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 600,
    top: 0,
    left: 0,
    bottom: 600,
    right: 800,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  return { canvas, parent };
}

function makePixel(id: string, position: [number, number, number], extra: Record<string, unknown> = {}) {
  return {
    id,
    position,
    active: true,
    energy: 1000,
    parent: null,
    born_round: 0,
    generation: 0,
    neighbors: [],
    pixel_md: 'mind content',
    pixel_md_length: 12,
    artifacts_count: 0,
    ...extra,
  } as any;
}

describe('PixelMapRenderer (Three.js Crystal Lattice)', () => {
  it('支持初始化、设置数据、选中与销毁清理', () => {
    const { canvas, parent } = createMockCanvas();

    const onSelect = vi.fn();
    const onHover = vi.fn();

    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: onSelect,
      onHoverPixel: onHover,
    });

    // 初始视角：斜上方三维视角，同时可见 X/Y/Z
    const cameraPos = (renderer as any).camera.position as THREE.Vector3;
    expect(cameraPos.length()).toBeGreaterThan(0);
    expect(cameraPos.y).toBeGreaterThan(0);

    // 设置数据：生成球体 + 六邻域连线
    renderer.setData(
      [
        makePixel('0_0_0', [0, 0, 0], { neighbors: ['1_0_0'] }),
        makePixel('1_0_0', [1, 0, 0]),
      ],
      [{ source: '0_0_0', target: '1_0_0' }],
      '0_0_0'
    );

    const pixelGroup = (renderer as any).pixelGroup as THREE.Group;
    const edgeGroup = (renderer as any).edgeGroup as THREE.Group;
    const messageGroup = (renderer as any).messageGroup as THREE.Group;
    expect(pixelGroup.children).toHaveLength(2);
    expect(edgeGroup.children).toHaveLength(1); // 每条邻边只画一次
    expect(messageGroup.children).toHaveLength(1);

    // 未读 Tips 球体为黄色材质
    renderer.setData(
      [makePixel('0_0_0', [0, 0, 0])],
      [],
      null,
      new Set(['0_0_0'])
    );
    const sphere = pixelGroup.children[0] as THREE.Mesh;
    expect((sphere.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xf2b01e);

    // 正常销毁不抛错
    expect(() => renderer.dispose()).not.toThrow();
  });

  it('多次轮询调用 setData 重建场景时保持用户相机视角不被重置', () => {
    const { canvas, parent } = createMockCanvas();

    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: vi.fn(),
      onHoverPixel: vi.fn(),
    });

    renderer.setData([makePixel('0_0_0', [0, 0, 0])], [], null);
    // 记录初始相机位置（等效于用户视角）
    const initialCam = (renderer as any).camera.position.clone();

    // 跨 3 个轮询周期更新数据：视角必须保持，绝对不被重置
    for (let r = 1; r <= 3; r++) {
      renderer.setData(
        [makePixel('0_0_0', [0, 0, 0], { energy: 1000 - r * 10 })],
        [],
        '0_0_0'
      );
      expect((renderer as any).camera.position.equals(initialCam)).toBe(true);
    }

    renderer.dispose();
  });

  it('被选中元胞时渲染外围显著高亮选择圈，取消选中后隐藏', () => {
    const { canvas } = createMockCanvas();
    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: vi.fn(),
      onHoverPixel: vi.fn(),
    });

    const pixels = [
      makePixel('0_0_0', [0, 0, 0]),
      makePixel('1_1_1', [1, 1, 1]),
    ];

    // 初始未选中：外围圈不可见
    renderer.setData(pixels, [], null);
    const ringMesh = (renderer as any).selectionRingMesh as THREE.Mesh;
    expect(ringMesh).toBeDefined();
    expect(ringMesh.visible).toBe(false);

    // 选中 1_1_1：外围圈可见，吸附到该元胞坐标，且使用鲜橙红显著颜色 (0xff4500)
    renderer.setSelectedPixel('1_1_1');
    expect(ringMesh.visible).toBe(true);
    expect(ringMesh.position.x).toBeCloseTo(1 * 2.5);
    expect(ringMesh.position.y).toBeCloseTo(1 * 2.5);
    expect(ringMesh.position.z).toBeCloseTo(1 * 2.5);
    const ringMat = (renderer as any).selectionRingMaterial as THREE.MeshBasicMaterial;
    expect(ringMat.color.getHex()).toBe(0xff4500);

    // 取消选中：外围圈隐藏
    renderer.setSelectedPixel(null);
    expect(ringMesh.visible).toBe(false);

    renderer.dispose();
  });

  it('消息传递支持动效与完成状态，且超过10次时自动清空历史超出记录', () => {
    const { canvas } = createMockCanvas();
    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: vi.fn(),
      onHoverPixel: vi.fn(),
    });

    const pixels = [
      makePixel('p0', [0, 0, 0]),
      makePixel('p1', [1, 0, 0]),
      makePixel('p2', [0, 1, 0]),
    ];

    // 首次加载初始化 2 条传递
    renderer.setData(pixels, [
      { source: 'p0', target: 'p1', message_id: 'm1' },
      { source: 'p1', target: 'p2', message_id: 'm2' },
    ], null);

    const transfers = (renderer as any).transfers as any[];
    const messageGroup = (renderer as any).messageGroup as THREE.Group;
    expect(transfers).toHaveLength(2);
    expect(messageGroup.children).toHaveLength(2);
    expect(transfers[0].status).toBe('completed');

    // 模拟后续刷新周期，陆续推入新传递，总数达到 14 条（超过 10 条上限）
    for (let i = 3; i <= 14; i++) {
      renderer.setData(pixels, [
        { source: 'p0', target: 'p1', message_id: `m_${i}` },
      ], null);
    }

    // 严格清空超出 10 次的历史记录，仅保留最新 10 次
    expect(transfers).toHaveLength(10);
    expect(messageGroup.children).toHaveLength(10);
    // 验证最早的 m1, m2, m3, m4 已被淘汰，最早保留的是 m_5
    expect(transfers[0].id).toBe('m_5');
    expect(transfers[transfers.length - 1].id).toBe('m_14');

    renderer.dispose();
  });

  it('两点间发生多次传递时各自沿独立弧度展开不重叠，并包含定向圆锥箭头', () => {
    const { canvas } = createMockCanvas();
    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: vi.fn(),
      onHoverPixel: vi.fn(),
    });

    const pixels = [
      makePixel('p0', [0, 0, 0]),
      makePixel('p1', [2, 0, 0]),
    ];

    // 在 p0 和 p1 之间发生 3 次传递
    renderer.setData(pixels, [
      { source: 'p0', target: 'p1', message_id: 'flow_1' },
      { source: 'p0', target: 'p1', message_id: 'flow_2' },
      { source: 'p1', target: 'p0', message_id: 'flow_3' },
    ], null);

    const transfers = (renderer as any).transfers as any[];
    expect(transfers).toHaveLength(3);

    // 验证每条传递生成的贝塞尔曲线控制点不重叠
    const ctrl0 = transfers[0].curve.v1 as THREE.Vector3;
    const ctrl1 = transfers[1].curve.v1 as THREE.Vector3;
    const ctrl2 = transfers[2].curve.v1 as THREE.Vector3;

    expect(ctrl0.distanceTo(ctrl1)).toBeGreaterThan(0.2);
    expect(ctrl1.distanceTo(ctrl2)).toBeGreaterThan(0.2);
    expect(ctrl0.distanceTo(ctrl2)).toBeGreaterThan(0.2);

    // 验证每条传递挂载了立体管道 (pipeMesh) 和定向箭头 (arrowMesh)，且箭头位于曲线 1/3 处
    for (const r of transfers) {
      expect(r.pipeMesh).toBeDefined();
      expect(r.arrowMesh).toBeDefined();
      expect(r.pipeMesh.geometry).toBeInstanceOf(THREE.TubeGeometry);
      expect(r.arrowMesh.geometry).toBeInstanceOf(THREE.ConeGeometry);
      const pointAtThird = r.curve.getPoint(1 / 3);
      expect(r.arrowMesh.position.distanceTo(pointAtThird)).toBeCloseTo(0, 4);
    }

    renderer.dispose();
  });
});
