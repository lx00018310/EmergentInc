import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { RecoveryConfig } from './config.js';
import { inspectBody } from './health.js';
import { html, js, css } from './ui.js';

const digest = (value: string) => createHash('sha256').update(value).digest();
const equal = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const age = 8 * 3600;
const bodyLimit = 4096;

async function jsonBody(request: IncomingMessage) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') throw new Error('JSON_REQUIRED');
  if (Number(request.headers['content-length'] ?? 0) > bodyLimit) throw new Error('BODY_TOO_LARGE');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > bodyLimit) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** No imports of Body, Store, model provider, application config or application authentication. */
export function createRecoveryServer(config: RecoveryConfig) {
  const sessions = new Map<string, { expires: number; csrf: string }>();
  const cookieName = config.secureCookies ? '__Host-emergent_recovery' : 'emergent_recovery';
  const secretHash = digest(config.secret);
  let attempts = 0, windowStart = Date.now();
  const send = (reply: ServerResponse, status: number, value: unknown) => {
    reply.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); reply.end(JSON.stringify(value));
  };
  const cookie = (value: string, seconds: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${config.secureCookies ? '; Secure' : ''}`;
  const server = createServer({ maxHeaderSize: 16384, requestTimeout: 10000, headersTimeout: 10000 }, (request, reply) => {
    reply.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    reply.setHeader('X-Content-Type-Options', 'nosniff'); reply.setHeader('X-Frame-Options', 'DENY');
    reply.setHeader('Referrer-Policy', 'no-referrer'); reply.setHeader('Cache-Control', 'no-store');
    void (async () => {
      // Bind to configured host, not an attacker-supplied Host/forwarded header.
      if (request.headers.host !== new URL(config.origin).host) return send(reply, 421, { detail: 'HOST_FORBIDDEN' });
      const route = request.url?.split('?')[0];
      const post = request.method === 'POST';
      if ((request.headers.origin && request.headers.origin !== config.origin) ||
          request.headers['sec-fetch-site'] === 'cross-site' || (post && request.headers.origin !== config.origin))
        return send(reply, 403, { detail: 'ORIGIN_FORBIDDEN' });
      if (!['GET', 'POST'].includes(request.method ?? '')) return send(reply, 405, { detail: 'METHOD_NOT_ALLOWED' });
      if (!post && route === '/health/live') return send(reply, 200, { alive: true, role: 'recovery' });
      const assets = new Map([
        ['/GENE', ['text/html; charset=utf-8', html]],
        ['/GENE/app.js', ['text/javascript; charset=utf-8', js]],
        ['/GENE/style.css', ['text/css; charset=utf-8', css]],
      ]);
      const asset = assets.get(route ?? '');
      if (!post && asset) { reply.writeHead(200, { 'Content-Type': asset[0]! }); reply.end(asset[1]); return; }
      const token = request.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
      const session = sessions.get(token);
      const authenticated = Boolean(session && session.expires > Date.now());
      if (session && !authenticated) sessions.delete(token);
      if (!post && route === '/api/recovery/session') return send(reply, 200, { authenticated, ...(authenticated ? { csrfToken: session!.csrf } : {}) });
      if (post && route === '/api/recovery/login') {
        const now = Date.now();
        if (now - windowStart >= 60000) { attempts = 0; windowStart = now; }
        if (++attempts > 10) return send(reply, 429, { detail: 'LOGIN_RATE_LIMITED' });
        const value = await jsonBody(request);
        if (typeof value?.secret !== 'string' || value.secret.length > 1024 || !timingSafeEqual(digest(value.secret), secretHash))
          return send(reply, 401, { detail: 'INVALID_OWNER_SECRET' });
        for (const [key, value] of sessions) if (value.expires <= now) sessions.delete(key);
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value!);
        if (authenticated) sessions.delete(token);
        const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
        sessions.set(id, { expires: now + age * 1000, csrf });
        reply.setHeader('Set-Cookie', cookie(id, age));
        return send(reply, 200, { authenticated: true, csrfToken: csrf });
      }
      if (!route?.startsWith('/api/recovery/')) return send(reply, 404, { detail: 'NOT_FOUND' });
      if (!authenticated) return send(reply, 401, { detail: 'OWNER_LOGIN_REQUIRED' });
      if (post && (typeof request.headers['x-csrf-token'] !== 'string' || !equal(request.headers['x-csrf-token'], session!.csrf)))
        return send(reply, 403, { detail: 'CSRF_REQUIRED' });
      if (!post && route === '/api/recovery/status')
        return send(reply, 200, { recovery: 'READY', body: await inspectBody(config.bodyOrigin), control: 'NOT_CONNECTED' });
      if (post && route === '/api/recovery/logout') {
        sessions.delete(token); reply.setHeader('Set-Cookie', cookie('', 0));
        return send(reply, 200, { authenticated: false });
      }
      return send(reply, 404, { detail: 'NOT_FOUND' });
    })().catch(error => {
      if (!reply.headersSent && !reply.destroyed) send(reply, 400, { detail: error instanceof SyntaxError ? 'INVALID_JSON' : 'REQUEST_REJECTED' });
      else reply.destroy();
    });
  });
  server.on('close', () => sessions.clear());
  return server;
}
