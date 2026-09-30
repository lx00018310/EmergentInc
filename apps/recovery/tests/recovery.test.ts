import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, Server } from 'node:http';
import { once } from 'node:events';
import { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fork, ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRecoveryServer } from '../src/server.js';
import { recoveryConfig, RecoveryConfig } from '../src/config.js';
import { inspectBody } from '../src/health.js';

const servers: Server[] = [];
const children: ChildProcess[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}
async function reservePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function setup() {
  const secret = randomBytes(32).toString('hex');
  const port = await reservePort();
  const config: RecoveryConfig = { origin: `http://localhost:${port}`, host: '127.0.0.1', port,
    secret, secureCookies: false, bodyOrigin: 'http://127.0.0.1:1' };
  const server = createRecoveryServer(config); servers.push(server);
  server.listen(port, '127.0.0.1'); await once(server, 'listening');
  const request = (path: string, options: RequestInit = {}) => fetch(`${config.origin}${path}`, { ...options, redirect: 'manual' });
  const login = () => request('/api/recovery/login', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
  return { request, login, config };
}

describe('independent recovery host', () => {
  it('logs in without a Body or database, binds sessions and validates CSRF, Host and Origin', async () => {
    const { request, login, config } = await setup();
    expect((await request('/GENE')).status).toBe(200);
    expect((await request('/api/recovery/status')).status).toBe(401);
    const response = await login(), session = await response.json();
    expect(response.status).toBe(200);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly; SameSite=Strict'); expect(cookie).not.toContain('Domain=');
    expect(JSON.stringify(session)).not.toContain(config.secret);
    const headers = { Cookie: cookie.split(';')[0] };
    expect(await (await request('/api/recovery/status', { headers })).json()).toMatchObject({ recovery: 'READY', body: { state: 'UNAVAILABLE' } });
    for (const Origin of ['null', config.bodyOrigin, 'https://attacker.invalid']) {
      expect((await request('/api/recovery/logout', { method: 'POST', headers: { ...headers, Origin, 'X-CSRF-Token': session.csrfToken } })).status).toBe(403);
    }
    expect((await request('/api/recovery/logout', { method: 'POST', headers: { ...headers, Origin: config.origin } })).status).toBe(403);
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(`${config.origin}/api/recovery/status`, { headers: { ...headers, Host: 'attacker.invalid' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(badHost).toBe(421);
    expect((await request('/api/recovery/logout', { method: 'POST', headers: { ...headers, Origin: config.origin, 'X-CSRF-Token': session.csrfToken } })).status).toBe(200);
    expect((await request('/api/recovery/status', { headers })).status).toBe(401);
  });

  it('does not accept the Body session, expose an arbitrary proxy, or serve mutable Body assets', async () => {
    const { request, config } = await setup();
    expect((await request('/api/recovery/status', { headers: { Cookie: 'emergent_owner=body-session' } })).status).toBe(401);
    expect((await request('/api/login', { method: 'POST', headers: { Origin: config.origin } })).status).toBe(404);
    expect((await request('/assets/body.js')).status).toBe(404);
    expect((await request('/GENE/../.env')).status).toBe(404);
    const page = await request('/GENE');
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(await page.text()).not.toContain('/assets/');
    expect((await request('/api/recovery/login', { method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json' }, body: '{invalid' })).status).toBe(400);
  });

  it('probes health without forwarding credentials and only returns bounded known metadata', async () => {
    let cookie: string | undefined;
    const port = await listen(createServer((req, res) => {
      cookie = req.headers.cookie;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: true, generation: 'G0001', bodyRevision: 3, secret: 'body-secret', arbitraryHtml: '<script>bad()</script>' }));
    }));
    expect(await inspectBody(`http://127.0.0.1:${port}`)).toEqual({ state: 'REACHABLE', reason: 'HEALTH_ENDPOINT_READY', generation: 'G0001', bodyRevision: 3 });
    expect(cookie).toBeUndefined();
    const largePort = await listen(createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ready: true, data: 'a'.repeat(20000) })); }));
    expect(await inspectBody(`http://127.0.0.1:${largePort}`)).toMatchObject({ state: 'UNAVAILABLE', reason: 'HEALTH_RESPONSE_TOO_LARGE' });
    const slowPort = await listen(createServer(() => {}));
    expect(await inspectBody(`http://127.0.0.1:${slowPort}`, 30)).toMatchObject({ state: 'UNAVAILABLE', reason: 'HEALTH_TIMEOUT' });
  });

  it('keeps an actual recovery process usable after an actual Body process exits, with corrupt Current and no frontend bundle', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'recovery-process-')); directories.push(directory);
    mkdirSync(join(directory, 'generations/G0001'), { recursive: true });
    writeFileSync(join(directory, 'generations/G0001/current.sqlite3'), 'broken database');
    const fixture = join(directory, 'body.cjs');
    writeFileSync(fixture, "const http=require('node:http');const s=http.createServer((q,r)=>{r.writeHead(q.url==='/health/ready'?200:503,{'Content-Type':'application/json'});r.end(JSON.stringify({ready:true}));});s.listen(0,'127.0.0.1',()=>process.send({port:s.address().port}));");
    const body = fork(fixture, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }); children.push(body);
    const [message] = await once(body, 'message') as [{ port: number }];
    const port = await reservePort(), secret = randomBytes(32).toString('hex'), origin = `http://localhost:${port}`;
    const recovery = fork(resolve(import.meta.dirname, '../dist/main.js'), [], {
      cwd: directory, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, EMERGENTINC_RECOVERY_SECRET: secret,
        EMERGENTINC_RECOVERY_ORIGIN: origin, EMERGENTINC_BODY_ORIGIN: `http://127.0.0.1:${message.port}`,
        EMERGENTINC_WORKSPACE_ROOT: directory },
    }); children.push(recovery);
    await Promise.race([once(recovery, 'message'), once(recovery, 'exit').then(([code]) => { throw new Error(`recovery exited ${code}`); })]);
    const request = (path: string, options: RequestInit = {}) => fetch(`${origin}${path}`, options);
    const login = await request('/api/recovery/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) });
    expect(login.status).toBe(200);
    const headers = { Cookie: login.headers.get('set-cookie')!.split(';')[0] };
    expect(await (await request('/api/recovery/status', { headers })).json()).toMatchObject({ body: { state: 'REACHABLE' } });
    const exited = once(body, 'exit'); body.kill(); await exited;
    expect(await (await request('/api/recovery/status', { headers })).json()).toMatchObject({ recovery: 'READY', body: { state: 'UNAVAILABLE' } });
    expect((await request('/GENE')).status).toBe(200);
    expect(await (await request('/api/recovery/session', { headers })).json()).toMatchObject({ authenticated: true });
  }, 10000);
});

describe('recovery configuration', () => {
  const secret = randomBytes(32).toString('hex');
  it('requires its own credential and a different Cookie host', () => {
    expect(() => recoveryConfig({ EMERGENTINC_OWNER_SECRET: secret })).toThrow('RECOVERY_SECRET');
    expect(() => recoveryConfig({ EMERGENTINC_RECOVERY_SECRET: secret, EMERGENTINC_BODY_ORIGIN: 'http://localhost:8765' })).toThrow('COOKIE_HOST');
    expect(() => recoveryConfig({ EMERGENTINC_RECOVERY_SECRET: secret, EMERGENTINC_RECOVERY_ORIGIN: 'http://example.com' })).toThrow('LOOPBACK');
    expect(() => recoveryConfig({ EMERGENTINC_RECOVERY_SECRET: secret, EMERGENTINC_RECOVERY_PORT: '-1' })).toThrow('PORT_INVALID');
    expect(recoveryConfig({ EMERGENTINC_RECOVERY_SECRET: secret })).toMatchObject({ port: 8766, secureCookies: false });
  });
});
