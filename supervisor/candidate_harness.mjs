import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const [action, directory, workspace, generation] = process.argv.slice(2);
function command(executable, args, env, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: directory, env, stdio: 'ignore', shell: false });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('RELEASE_CHECK_FAILED')); });
  });
}
const cleanEnv = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: directory, LANG: 'C.UTF-8',
  CI: '1', EMERGENTINC_CANDIDATE_MODE: '1' };
if (action === 'build') {
  const pnpm = process.env.EMERGENTINC_PNPM_PATH;
  if (!pnpm?.startsWith('/')) throw new Error('PNPM_ABSOLUTE_PATH_REQUIRED');
  await command(pnpm, ['install','--offline','--frozen-lockfile','--ignore-scripts','--store-dir', join(directory, '.build-store')], cleanEnv, 300000);
  for (const args of [['run','typecheck'],['test','--maxWorkers=4'],['build'],['--dir','frontend','build']]) await command(pnpm, args, cleanEnv, 300000);
} else if (action === 'smoke') {
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const secret = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [join(directory, 'apps/server/dist/main.js')], { cwd: directory, shell: false,
    env: { ...cleanEnv, EMERGENTINC_WORKSPACE_ROOT: workspace, EMERGENTINC_RUNTIME_MODE: 'business',
      EMERGENTINC_OWNER_SECRET: secret, EMERGENTINC_SECURE_COOKIES: '0', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let error, diagnostics = ''; child.on('error', e => { error = e; });
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
  const base = `http://127.0.0.1:${port}`;
  const get = async (url, cookie) => {
    const response = await fetch(base + url, { headers: cookie ? { cookie } : {}, redirect: 'error', signal: AbortSignal.timeout(2000) });
    if (response.status !== 200) throw new Error('CANDIDATE_SMOKE_HTTP_FAILED'); return response.json();
  };
  try {
    let live = false;
    for (let i = 0; i < 100; i++) {
      if (error || child.exitCode !== null) throw new Error('CANDIDATE_SERVER_START_FAILED: ' + diagnostics);
      try { live = (await get('/health/live')).alive === true; if (live) break; } catch { }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!live) throw new Error('CANDIDATE_LIVE_FAILED');
    const ready = await get('/health/ready'); if (ready.ready !== true || ready.generation !== generation) throw new Error('CANDIDATE_READY_FAILED');
    if ((await fetch(base + '/api/evolution/overview')).status !== 401) throw new Error('CANDIDATE_OWNER_AUTH_FAILED');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }), signal: AbortSignal.timeout(2000) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0]; if (login.status !== 200 || !cookie) throw new Error('CANDIDATE_OWNER_AUTH_FAILED');
    const business = await get('/api/business/overview', cookie), evolution = await get('/api/evolution/overview', cookie);
    const people = await get('/api/qianji', cookie), world = await get('/api/world', cookie), run = await get('/api/run/status', cookie);
    if (!Array.isArray(people.items) || !Array.isArray(world.pixels) || typeof run.running !== 'boolean') throw new Error('CANDIDATE_BODY_API_FAILED');
    if (!Array.isArray(business.plans) || business.modelConfigured !== false || evolution.current.generation_id !== generation ||
        !Array.isArray(evolution.skills) || !Array.isArray(evolution.memories) || !Array.isArray(evolution.proposals)) throw new Error('CANDIDATE_LIFE_SCHEMA_FAILED');
    if ((await fetch(base + '/api/business/intents', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status !== 409)
      throw new Error('CANDIDATE_SIDE_EFFECT_GATE_FAILED');
    if ((await fetch(base + '/api/run/start', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status !== 409)
      throw new Error('CANDIDATE_BODY_SIDE_EFFECT_GATE_FAILED');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) { child.kill('SIGTERM'); const timeout = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timeout); }
  }
} else throw new Error('CANDIDATE_HARNESS_ACTION_INVALID');
