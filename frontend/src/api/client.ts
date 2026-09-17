/**
 * 统一前端 HTTP 客户端与异常模型
 */

export class ApiError extends Error {
  public readonly status: number;
  public readonly detail: string;
  public readonly data: unknown;

  constructor(status: number, detail: string, data?: unknown) {
    super(`API Error ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.data = data;
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
}

export async function apiRequest<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = 30000, signal: callerSignal, ...fetchOptions } = options;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort(new Error(`Request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  // 链接外部传入的 callerSignal
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => {
      controller.abort(callerSignal.reason);
    });
  }

  const url = endpoint.startsWith('/') ? endpoint : `/api/${endpoint}`;

  try {
    const res = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(fetchOptions.body ? { 'Content-Type': 'application/json' } : {}),
        ...fetchOptions.headers,
      },
    });

    if (timer) clearTimeout(timer);

    // 尝试解析 JSON
    const contentType = res.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');

    let bodyData: unknown = null;
    if (isJson) {
      try {
        bodyData = await res.json();
      } catch {
        bodyData = null;
      }
    } else {
      try {
        bodyData = await res.text();
      } catch {
        bodyData = null;
      }
    }

    if (!res.ok) {
      let detailMessage = res.statusText || 'Unknown Error';
      if (bodyData && typeof bodyData === 'object') {
        const bd = bodyData as Record<string, unknown>;
        if (typeof bd.detail === 'string') {
          detailMessage = bd.detail;
        } else if (Array.isArray(bd.detail)) {
          detailMessage = JSON.stringify(bd.detail);
        } else if (typeof bd.message === 'string') {
          detailMessage = bd.message;
        }
      } else if (typeof bodyData === 'string' && bodyData.trim()) {
        detailMessage = bodyData.slice(0, 300);
      }

      throw new ApiError(res.status, detailMessage, bodyData);
    }

    return bodyData as T;
  } catch (err: unknown) {
    if (timer) clearTimeout(timer);

    if (err instanceof ApiError) {
      throw err;
    }

    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(0, `Network error or connection severed: ${message}`);
  }
}
