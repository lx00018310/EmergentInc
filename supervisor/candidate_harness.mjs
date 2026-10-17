import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes, randomInt } from 'node:crypto';
import { join } from 'node:path';
import * as fs from 'node:fs';
const [action, directory, workspace, generation] = process.argv.slice(2);
const cleanEnv = { PATH: process.platform === 'win32' ? process.env.PATH : '/usr/local/bin:/usr/bin:/bin', SystemRoot: process.env.SystemRoot, LANG: 'C.UTF-8', CI: '1', EMERGENTINC_CANDIDATE_MODE: '1' };
async function command(executable, args) {
  await new Promise((resolve, reject) => { const child = spawn(executable, args, { cwd: directory, env: cleanEnv, stdio: 'ignore', shell: false, windowsHide: true }), timer = setTimeout(() => child.kill(), 900000); child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('RELEASE_CHECK_FAILED')); }); });
}
if (action === 'build') {
  const pnpm = process.env.EMERGENTINC_PNPM_PATH; if (!pnpm?.startsWith('/')) throw new Error('PNPM_ABSOLUTE_PATH_REQUIRED');
  await command(pnpm, ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', join(directory, '.build-store')]);
  for (const args of [['run', 'typecheck'], ['build'], ['--dir', 'frontend', 'build'], ['test', '--maxWorkers=1', '--testTimeout=30000']]) await command(pnpm, args);
} else if (action === 'smoke') {
  const format = JSON.parse(fs.readFileSync(join(workspace, 'workspace-format.json'), 'utf8'));
  if (format.product !== 'BOSS-AFK' || format.format !== 34) throw new Error('V34_CANDIDATE_FORMAT_REQUIRED');
  let port;
  for(let attempt=0;attempt<20;attempt++){
    const listener=createServer(),candidate=randomInt(49152,65536);
    try{await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(candidate,'127.0.0.1',resolve);});await new Promise(resolve=>listener.close(resolve));port=candidate;break;}
    catch(error){if(error.code!=='EADDRINUSE'&&!(process.platform==='win32'&&error.code==='EACCES'))throw error;}
  }
  if(!port)throw new Error('CANDIDATE_HTTP_PORT_UNAVAILABLE');
  const secret = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [join(directory, 'apps/server/dist/main.js')], { cwd: directory, shell: false, windowsHide: true, env: { ...cleanEnv, EMERGENTINC_WORKSPACE_ROOT: workspace, EMERGENTINC_RUNTIME_MODE: 'business', EMERGENTINC_OWNER_SECRET: secret, EMERGENTINC_SECURE_COOKIES: '0', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let error, diagnostics = ''; child.on('error', e => { error = e; }); child.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
  const base = `http://127.0.0.1:${port}`, get = async (route, cookie) => { const response = await fetch(base + route, { headers: cookie ? { cookie } : {}, redirect: 'error', signal: AbortSignal.timeout(3000) }); if (response.status !== 200) throw new Error('CANDIDATE_SMOKE_HTTP_FAILED: ' + route); return response.json(); };
  try {
    let live = false, lastFailure='';
    for (let i = 0; i < 100; i++) { if (error || child.exitCode !== null) throw new Error('CANDIDATE_SERVER_START_FAILED: ' + diagnostics); try { live = (await get('/health/live')).alive === true; if (live) break; } catch(e) {lastFailure=String(e.cause?.message??e.message);} await new Promise(resolve => setTimeout(resolve, 100)); }
    if (!live) throw new Error('CANDIDATE_LIVE_FAILED: '+lastFailure+' '+diagnostics);
    const ready = await get('/health/ready'); if (ready.ready !== true || ready.generation !== generation || ready.version !== 'boss-afk-v34') throw new Error('CANDIDATE_READY_FAILED');
    if ((await fetch(base + '/api/boss/overview')).status !== 401) throw new Error('CANDIDATE_OWNER_AUTH_FAILED');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }), signal: AbortSignal.timeout(3000) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0]; if (login.status !== 200 || !cookie) throw new Error('CANDIDATE_OWNER_AUTH_FAILED');
    const boss = await get('/api/boss/overview', cookie), site = await get('/api/public/site'), products = await get('/api/public/products');
    if (boss.instanceId !== format.instanceId || boss.modelConfigured !== false || !Array.isArray(boss.inbox) || !Array.isArray(boss.revenue) || boss.automation.desiredMode !== 'OFF' || boss.automation.inFlight !== 0 || boss.budget.activatedAt !== null) throw new Error('CANDIDATE_BOSS_OFF_FAILED');
    if (typeof site.headline_en !== 'string' || typeof site.headline_zh !== 'string' || !Array.isArray(products.items)) throw new Error('CANDIDATE_PUBLIC_STORE_FAILED');
    if ((await fetch(base + '/api/public-site')).status !== 401) throw new Error('CANDIDATE_PUBLIC_OWNER_BOUNDARY_FAILED');
    for (const route of ['/api/gacha', '/api/meetings', '/api/qianji', '/api/worlds', '/api/business/overview', '/api/evolution/overview', '/api/run/status']) if ((await fetch(base + route, { headers: { cookie } })).status !== 404) throw new Error('CANDIDATE_RETIRED_API_PRESENT: ' + route);
    const mutation = await fetch(base + '/api/owner/automation', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ desiredMode: 'ON', expectedRevision: boss.automation.revision, idempotencyKey: 'candidate-side-effect-check' }) });
    if (mutation.status !== 409) throw new Error('CANDIDATE_SIDE_EFFECT_GATE_FAILED');
    for (const route of ['/', '/BOSS']) { const response = await fetch(base + route); if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('CANDIDATE_FRONTEND_FAILED'); }
  } finally {
    if (child.exitCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer); }
  }
} else throw new Error('CANDIDATE_HARNESS_ACTION_INVALID');
