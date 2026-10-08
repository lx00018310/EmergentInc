import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { listenTestHttp } from '../../../tests/http_port.js';
import { spawn } from 'node:child_process';
import { LocalWorldRuntime } from '../../../supervisor/local_world_runtime.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), 'local-runtime-'));
  cleanups.push(async () => { fs.rmSync(directory, { recursive: true, force: true }); });
  const workspace = join(directory, 'workspace');fs.mkdirSync(join(workspace, 'runtime'), { recursive: true });
  fs.writeFileSync(join(workspace, 'runtime/instance.lock'), JSON.stringify({ pid: process.pid }));
  const state = { processId: process.pid, ready: true, generation: 'G0014' }, requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url!);res.setHeader('Content-Type', 'application/json');
    if (req.url === '/health/live') res.end(JSON.stringify({ alive: true, processId: state.processId }));
    else { res.statusCode = state.ready ? 200 : 503;res.end(JSON.stringify({ ready: state.ready, generation: state.generation })); }
  });
  const port = await listenTestHttp(server);
  const close = () => new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
  cleanups.push(async () => { if (server.listening) await close(); });
  const runtime = new LocalWorldRuntime({ workspace, releases: join(directory, 'releases'), stateDirectory: join(directory, 'state'),
    activeReleaseFile: join(directory, 'active.json'), appUrl: `http://127.0.0.1:${port}`, ownerEnvironment: { EMERGENTINC_OWNER_SECRET: 's'.repeat(64) } });
  return { runtime, state, requests, close, workspace };
}
describe('local publication preflight', () => {
  it('finishes stopping an already exited process without requiring an HTTP response',async()=>{
    const f=await fixture(),child=spawn(process.execPath,['-e',''],{windowsHide:true,stdio:'ignore'});
    await new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject);});
    fs.writeFileSync(join(f.workspace,'runtime/instance.lock'),JSON.stringify({pid:child.pid}));await f.close();
    await expect(f.runtime.stop()).resolves.toBeUndefined();expect(f.requests).toHaveLength(0);
  });
  it('keeps a live process untouched when its HTTP identity differs from the lock',async()=>{
    const f=await fixture();f.state.processId++;
    await expect(f.runtime.stop()).rejects.toThrow('LOCAL_CONTROL_PROCESS_IDENTITY_CONFLICT');
    expect(()=>process.kill(process.pid,0)).not.toThrow();
  });
  it('accepts only a ready service matching the workspace lock and generation without Owner actions', async () => {
    const f = await fixture();await f.runtime.checkRunning('G0014');
    expect(f.requests).toEqual(['/health/live', '/health/ready']);
  });
  it('reports a stopped server explicitly', async () => {
    const f = await fixture();await f.close();
    await expect(f.runtime.checkRunning('G0014')).rejects.toThrow('MAIN_SERVICE_UNAVAILABLE');
  });
  it('distinguishes startup from an offline service', async () => {
    const f = await fixture();f.state.ready = false;
    await expect(f.runtime.checkRunning('G0014')).rejects.toThrow('MAIN_SERVICE_NOT_READY');
  });
  it.each(['process', 'generation', 'lock'])('rejects %s identity mismatches', async field => {
    const f = await fixture();
    if (field === 'process') f.state.processId++;
    else if (field === 'generation') f.state.generation = 'G0013';
    else fs.unlinkSync(join(f.workspace, 'runtime/instance.lock'));
    await expect(f.runtime.checkRunning('G0014')).rejects.toThrow('LOCAL_CONTROL_PROCESS_IDENTITY_CONFLICT');
  });
});
