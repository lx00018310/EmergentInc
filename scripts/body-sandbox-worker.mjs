import { createServer } from 'node:http';
import { chmodSync, existsSync, unlinkSync, lstatSync } from 'node:fs';
import { RootlessSandbox, bodyCandidate, boundedJson } from '../packages/tools/dist/index.js';
import { acquireWorkspaceLock } from '../apps/server/dist/runtime_config.js';

if (process.platform !== 'linux' || !process.getuid?.()) throw new Error('ROOTLESS_LINUX_REQUIRED');
const socket = process.env.EMERGENTINC_BODY_SANDBOX_SOCKET;
const state = process.env.EMERGENTINC_BODY_WORKER_STATE;
if (!socket?.startsWith('/') || !state?.startsWith('/')) throw new Error('BODY_WORKER_CONFIGURATION_REQUIRED');
const unlock = acquireWorkspaceLock(state);
if (existsSync(socket)) {
  const stale = lstatSync(socket);
  if (!stale.isSocket() || stale.uid !== process.getuid()) { unlock(); throw new Error('BODY_SOCKET_REQUIRES_REVIEW'); }
  unlinkSync(socket);
}
const runner = new RootlessSandbox({ dockerPath: process.env.EMERGENTINC_DOCKER_PATH ?? '/usr/bin/docker',
  socket: `unix:///run/user/${process.getuid()}/docker.sock`, image: process.env.EMERGENTINC_SANDBOX_IMAGE ?? '' });
try { await runner.recoverInterrupted({ exclusiveSupervisorLockHeld: true }); } catch (e) { unlock(); throw e; }
let busy = false;
const app = createServer(async (req, res) => {
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (busy) return send(409, { detail: 'SUPERVISOR_BUSY' });
  if (req.method !== 'POST' || !['/probe','/ready','/run'].includes(req.url)) return send(404, { detail: 'BODY_WORKER_ROUTE_NOT_FOUND' });
  busy = true;
  try {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 140000) throw new Error('SANDBOX_INPUT_LIMIT'); }
    const body = JSON.parse(raw || '{}');
    let result;
    if (req.url === '/ready') { await runner.probe(); result = { removed: 0 }; }
    else if (req.url === '/probe') result = await runner.probe();
    else {
      // Reapply policy at the executor boundary. No caller-supplied options, mounts, tests, or permissions.
      bodyCandidate({ skill_id: 'worker', purpose: 'JSON function', source: body.source,
        interface_version: '1', tests: [{ input: {}, expected: {} }] }, '1');
      result = boundedJson(await runner.runBody(body.source, boundedJson(body.input)));
    }
    send(200, { result });
  } catch (e) { send(400, { detail: /^[A-Z_]+$/.test(e.message) ? e.message : 'BODY_EXECUTION_FAILED' }); }
  finally { busy = false; }
});
app.requestTimeout = 30000;
app.listen(socket, () => chmodSync(socket, 0o660));
app.on('error', e => { unlock(); throw e; });
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => app.close(() => { if (existsSync(socket)) unlinkSync(socket); unlock(); }));
