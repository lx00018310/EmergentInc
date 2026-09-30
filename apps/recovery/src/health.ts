/** Health is evidence, not authorization to replay work or roll back a generation. */
export async function inspectBody(origin: string, timeoutMs = 2000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(new URL('/health/ready', origin), { signal: abort.signal, redirect: 'error', credentials: 'omit' });
    if (!response.ok) return { state: 'UNAVAILABLE', reason: 'HEALTH_HTTP_ERROR', status: response.status };
    if (!response.headers.get('content-type')?.includes('application/json')) return { state: 'UNAVAILABLE', reason: 'HEALTH_INVALID_RESPONSE' };
    const reader = response.body?.getReader();
    if (!reader) return { state: 'UNAVAILABLE', reason: 'HEALTH_INVALID_RESPONSE' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); return { state: 'UNAVAILABLE', reason: 'HEALTH_RESPONSE_TOO_LARGE' }; }
      chunks.push(value);
    }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || value.ready !== true) return { state: 'UNAVAILABLE', reason: 'HEALTH_NOT_READY' };
    // Never forward arbitrary health data, HTML, filesystem paths, environment or credentials.
    return { state: 'REACHABLE', reason: 'HEALTH_ENDPOINT_READY',
      ...(typeof value.generation === 'string' && /^G\d{4,}$/.test(value.generation) ? { generation: value.generation } : {}),
      ...(typeof value.geneHash === 'string' && /^[a-f0-9]{64}$/.test(value.geneHash) ? { geneHash: value.geneHash } : {}),
      ...(Number.isSafeInteger(value.bodyRevision) && value.bodyRevision >= 0 ? { bodyRevision: value.bodyRevision } : {}) };
  } catch { return { state: 'UNAVAILABLE', reason: abort.signal.aborted ? 'HEALTH_TIMEOUT' : 'HEALTH_CONNECTION_FAILED' }; }
  finally { clearTimeout(timer); }
}
