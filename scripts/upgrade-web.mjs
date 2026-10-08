import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { registerOwnerAuth } from '../apps/server/dist/owner_auth.js';
import { ownerEnvironment } from './local-release.mjs';
import { upgradeConfig, ownerReleaseInput } from './version-upgrade.mjs';
import { readAppCodeReport } from './prepare-app-code.mjs';
import { LocalWorldRuntime } from '../supervisor/dist/local_world_runtime.js';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const fastify = require('fastify');
export const projectRoot = path.resolve(import.meta.dirname, '..');
export const upgradeWebUrl = config => `http://127.0.0.1:${Number(new URL(config.appUrl).port) + 1}`;
function logTail(file) {
  if (!fs.existsSync(file)) return '';
  const fd = fs.openSync(file, 'r');
  try { const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(Math.min(size, 8000));
    fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return buffer.toString('utf8');
  } finally { fs.closeSync(fd); }
}

export function readUpgradeStatus(root, config) {
  const readDb = (file, sql, params=[]) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { return db.prepare(sql).all(...params); } finally { db.close(); }
  };
  const active = readDb(path.join(config.workspace, 'system/lineage/lineage.sqlite3'), "SELECT id,release_id FROM generations WHERE state='ACTIVE'")[0];
  const file = path.join(config.stateDirectory, 'evolution.sqlite3');
  if(active&&fs.existsSync(file)){
    const request=readDb(file,'SELECT request_json FROM candidates WHERE id=?',[active.release_id])[0];
    if(request)active.label=JSON.parse(request.request_json).owner_release?.label;
  }
  const candidates = fs.existsSync(file) ? readDb(file, 'SELECT id,state,phase,failure_reason,created_at,candidate_json,request_json FROM candidates ORDER BY created_at DESC LIMIT 30')
    .map(row => ({ ...row, candidate: row.candidate_json ? JSON.parse(row.candidate_json) : null, request: JSON.parse(row.request_json) }))
    .filter(row => row.request.owner_release || row.request.app_code_report).map(({ candidate_json, request_json, ...row }) => ({ ...row,
      validationLog: /^[a-zA-Z0-9_-]+$/.test(row.id) ? logTail(path.join(config.stateDirectory, 'validation-' + row.id + '.log')) : '' })) : [];
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim());
  return { active, candidates, dirty, appUrl: config.appUrl };
}

export function runUpgradeCommand(root, args, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/version-upgrade.mjs'), ...args],
      { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', chunk => {
      if (stream === child.stderr) diagnostic = (diagnostic + chunk).slice(-8000);
      onOutput(chunk);
    }); }
    child.once('error', reject);
    child.once('exit', code => {
      const detail = diagnostic.split(/\r?\n/).find(line => ['MAIN_SERVICE_UNAVAILABLE', 'MAIN_SERVICE_NOT_READY', 'LOCAL_CONTROL_PROCESS_IDENTITY_CONFLICT'].includes(line));
      code === 0 ? resolve() : reject(new Error(detail ?? `UPGRADE_COMMAND_FAILED:${args[0]}`));
    });
  });
}

// This Owner maintenance process stays outside the release being replaced.
export async function createUpgradeWeb({ root, config, secret, runCommand = runUpgradeCommand, status = readUpgradeStatus,
  checkRunning = generation => new LocalWorldRuntime({ ...config, ownerEnvironment: { EMERGENTINC_OWNER_SECRET: secret } }).checkRunning(generation) }) {
  const app = fastify({ logger: false, bodyLimit: 8192 });
  const jobFile = path.join(config.stateDirectory, 'upgrade-web-job.json');
  let job = fs.existsSync(jobFile) ? JSON.parse(fs.readFileSync(jobFile, 'utf8')) : null;
  if (job?.state === 'running') job = { ...job, state: 'interrupted', error: 'UPGRADE_INTERRUPTED_CHECK_RECOVERY' };
  let busy = false;
  const appReportSession = {};
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site')
      return reply.status(403).send({ detail: 'ORIGIN_FORBIDDEN' });
  });
  registerOwnerAuth(app, { secret, secureCookies: false, cookieName: 'emergent_upgrade_owner' }, 'upgrade');
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  });
  app.get('/', async (_req, reply) => reply.type('text/html').send(fs.readFileSync(path.join(root, 'resources/upgrade-web.html'), 'utf8')));
  app.get('/health/live', async () => ({ alive: true, service: 'owner-upgrade', projectRoot: root }));
  // Loopback read-only projection. Never expose private paths, logs, credentials or approval capabilities.
  app.get('/status', async () => {
    const current = status(root, config);
    return { service: 'owner-upgrade', active: current.active?.id ?? null, busy, startedAt: job?.startedAt ?? 0,
      candidates: current.candidates.map(row => ({ id: row.id, state: row.state, createdAt: Number(row.created_at ?? 0),
        sourceCommit: row.request?.owner_release?.source_commit ?? row.candidate?.source_commit ?? null,
        hash: row.candidate?.candidate_hash ?? null, baseGeneration: row.candidate?.base_generation ?? null })) };
  });
  app.get('/api/upgrades', async () => ({ ...status(root, config), job, busy }));
  app.get('/api/code-reports/:id',async(req,reply)=>{
    try{return await readAppCodeReport(config,req.params.id,secret,fetch,appReportSession);}catch(error){return reply.status(409).send({detail:error.message});}
  });
  app.post('/api/upgrades', async (req, reply) => {
    if (busy) return reply.status(409).send({ detail: 'UPGRADE_ALREADY_RUNNING' });
    const body = req.body ?? {}, current = status(root, config);
    let commands,version;
    if (body.action === 'prepare') {
      let input;
      try{input=ownerReleaseInput(body.version,body.reason);}catch(error){return reply.status(400).send({detail:error.message});}
      if (current.dirty) return reply.status(409).send({ detail: 'OWNER_RELEASE_REQUIRES_CLEAN_COMMITTED_CHECKOUT' });
      version=input.label;commands = [['prepare', version, input.reason]];
    } else if (body.action === 'prepare-code') {
      if(!/^code_[a-f0-9]{32}$/.test(body.id??'')||!/^[a-f0-9]{64}$/.test(body.hash??''))return reply.status(400).send({detail:'APP_CODE_REPORT_INVALID'});
      commands=[['prepare-code',body.id,body.hash]];
    } else if (body.action === 'publish') {
      const candidate = current.candidates.find(item => item.id === body.id);
      if (!candidate || !['VALIDATED', 'APPROVED'].includes(candidate.state) || candidate.candidate?.base_generation !== current.active?.id ||
        typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash) || body.hash !== candidate.candidate?.candidate_hash)
        return reply.status(409).send({ detail: 'UPGRADE_CANDIDATE_CONFLICT' });
      commands = [['approve', body.id, body.hash], ['apply', body.id]];
    } else if (body.action === 'recover') commands = [['recover']];
    else return reply.status(400).send({ detail: 'VERSION_UPGRADE_ACTION_INVALID' });
    busy = true;
    job = { action: body.action, id: body.id ?? null, ...(version?{version}:{}), state: 'running', startedAt: Date.now(), log: '', error: null };
    const save = () => fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
    try { save(); } catch (error) { busy = false; throw error; }
    const execute = async () => {
      try {
        if (body.action === 'publish') await checkRunning(current.active.id);
        for (const args of commands) await runCommand(root, args, chunk => { job.log = (job.log + chunk).slice(-8000); });
        job.state = 'succeeded';
      } catch (error) { job.state = 'failed'; job.error = error.message; }
      finally { job.finishedAt = Date.now(); busy = false; save(); }
    };
    void execute();
    return reply.status(202).send({ accepted: true });
  });
  app.setErrorHandler((error, _req, reply) => reply.status(500).send({ detail: error.message }));
  await app.ready();
  return app;
}

export async function ensureUpgradeWeb(root = projectRoot) {
  const { config } = upgradeConfig(root), url = upgradeWebUrl(config);
  try {
    const response = await fetch(url + '/health/live', { signal: AbortSignal.timeout(2000) }), value = await response.json();
    if (response.ok && value.service === 'owner-upgrade' && value.projectRoot === root) return url;
    throw new Error('UPGRADE_WEB_PORT_CONFLICT');
  } catch (error) { if (error.message === 'UPGRADE_WEB_PORT_CONFLICT') throw error; }
  const log = fs.openSync(path.join(config.stateDirectory, 'upgrade-web.log'), 'a');
  try {
    const child = spawn(process.execPath, [path.join(root, 'scripts/upgrade-web.mjs')],
      { cwd: root, shell: false, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { fs.closeSync(log); }
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(url + '/health/live'); const value = await response.json();
      if (response.ok && value.service === 'owner-upgrade' && value.projectRoot === root) return url;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('UPGRADE_WEB_START_FAILED');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { config } = upgradeConfig(projectRoot), secret = ownerEnvironment(projectRoot).EMERGENTINC_OWNER_SECRET;
  const app = await createUpgradeWeb({ root: projectRoot, config, secret });
  await app.listen({ host: '127.0.0.1', port: Number(new URL(upgradeWebUrl(config)).port) });
  console.log('Owner upgrade page: ' + upgradeWebUrl(config));
}
