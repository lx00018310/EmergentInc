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
});
