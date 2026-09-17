import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { FilePreview } from '../src/features/files/FilePreview';
import { fetchPixelArtifact } from '../src/api/files';

describe('FilePreview Component & Artifact API', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('fetchPixelArtifact 请求正确的 /api/pixels/{pixel_id}/artifacts/{filename} 接口', async () => {
    const mockResponse = {
      pixel_id: '0_0',
      filename: 'summary.txt',
      content: '交付物文本内容',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    });

    const result = await fetchPixelArtifact('0_0', 'summary.txt');
    expect(result.content).toBe('交付物文本内容');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/pixels/0_0/artifacts/summary.txt',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
        }),
      })
    );
  });

  it('文本模式：渲染文本并展示下载按钮', () => {
    render(
      <FilePreview
        isOpen={true}
        title="交付物文本查看"
        content="Hello World Text"
        previewType="text"
        downloadUrl="/api/pixels/0_0/artifacts/test.txt/download"
        filename="test.txt"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('交付物文本查看')).toBeDefined();
    expect(screen.getByText('Hello World Text')).toBeDefined();
    const downloadLink = screen.getByText('下载原文件') as HTMLAnchorElement;
    expect(downloadLink.getAttribute('href')).toBe('/api/pixels/0_0/artifacts/test.txt/download');
  });

  it('图片模式：渲染 img 标签并使用 downloadUrl 作为图片源', () => {
    render(
      <FilePreview
        isOpen={true}
        title="交付物图片查看"
        previewType="image"
        downloadUrl="/api/pixels/0_0/artifacts/chart.png/download"
        filename="chart.png"
        onClose={vi.fn()}
      />
    );

    const img = screen.getByAltText('chart.png') as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.getAttribute('src')).toBe('/api/pixels/0_0/artifacts/chart.png/download');
    expect(screen.queryByText('Hello World Text')).toBeNull();
  });

  it('二进制模式：渲染二进制文件提示与突出的下载按钮，不展示文本框', () => {
    render(
      <FilePreview
        isOpen={true}
        title="交付物压缩包查看"
        previewType="binary"
        downloadUrl="/api/pixels/0_0/artifacts/bundle.zip/download"
        filename="bundle.zip"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('bundle.zip')).toBeDefined();
    expect(screen.getByText(/该文件为二进制或非纯文本格式/)).toBeDefined();
    expect(screen.getByText('⬇ 立即下载原始文件')).toBeDefined();
  });
});
