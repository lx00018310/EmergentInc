import { describe, it, expect, vi } from 'vitest';
import { PixelMapRenderer } from '../src/features/pixels/PixelMapRenderer';

describe('PixelMapRenderer', () => {
  it('支持初始化、设置数据与销毁清理', () => {
    // 模拟 Canvas 元素与 2D Context
    const canvas = document.createElement('canvas');
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      quadraticCurveTo: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx);
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

    const onSelect = vi.fn();
    const onHover = vi.fn();

    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: onSelect,
      onHoverPixel: onHover,
    });

    expect(renderer.zoom).toBe(1.0);

    // 缩放操作
    renderer.zoomIn();
    expect(renderer.zoom).toBeGreaterThan(1.0);

    renderer.zoomOut();
    renderer.resetView();
    expect(renderer.zoom).toBe(1.0);

    // 设置数据
    renderer.setData(
      [
        {
          id: '0_0_0',
          position: [0, 0, 0],
          active: true,
          energy: 1000,
          parent: null,
          born_round: 0,
          generation: 0,
          neighbors: [],
          pixel_md: 'mind content',
          pixel_md_length: 12,
          artifacts_count: 0,
        },
      ],
      [],
      '0_0_0'
    );

    expect(mockCtx.clearRect).toHaveBeenCalled();

    // 正常销毁
    renderer.dispose();
  });

  it('在多次轮询调用 setData 更新数据时保持用户设定的缩放视角不被重置', () => {
    const canvas = document.createElement('canvas');
    const mockCtx = {
      clearRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fillText: vi.fn(),
      quadraticCurveTo: vi.fn(),
      setLineDash: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(canvas, 'getContext').mockReturnValue(mockCtx);
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

    const renderer = new PixelMapRenderer({
      canvas,
      onSelectPixel: vi.fn(),
      onHoverPixel: vi.fn(),
    });

    // 用户手动放大
    renderer.zoomIn();
    const zoomedVal = renderer.zoom;
    expect(zoomedVal).toBeGreaterThan(1.0);

    // 跨 3 个轮询周期更新数据
    for (let r = 1; r <= 3; r++) {
      renderer.setData(
        [
          {
            id: '0_0_0',
            position: [0, 0, 0],
            active: true,
            energy: 1000 - r * 10,
            parent: null,
            born_round: 0,
            generation: 0,
            neighbors: [],
            pixel_md: 'mind',
            pixel_md_length: 4,
            artifacts_count: 0,
          },
        ],
        [],
        '0_0_0'
      );
      // 视角必须保持，绝对不被重置
      expect(renderer.zoom).toBe(zoomedVal);
    }

    renderer.dispose();
  });
});
