import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, ApiError } from '../src/api/client';

describe('API Client', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('正确解析成功的 JSON 响应', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ status: 'ok', round: 5 }),
    });

    const data = await apiRequest<{ status: string; round: number }>('/api/world');
    expect(data.status).toBe('ok');
    expect(data.round).toBe(5);
  });

  it('在收到 409 状态码时抛出带有后端 detail 的 ApiError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ detail: 'Cannot start run while another is running' }),
    });

    await expect(apiRequest('/api/run/start', { method: 'POST' })).rejects.toThrowError(
      'Cannot start run while another is running'
    );
  });

  it('在收到非 JSON 错误响应时正确提取文本', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'Database locked error',
    });

    try {
      await apiRequest('/api/world');
      expect.unreachable('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).detail).toContain('Database locked error');
    }
  });

  it('支持传入外部 AbortSignal 并响应中断', async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const err = new DOMException('The operation was aborted.', 'AbortError');
            reject(err);
          });
        }
      });
    });

    const promise = apiRequest('/api/world', { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow();
  });
});
