import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { LineageStore, CurrentStore, readGenome, writeGenerationPointer } from '../packages/persistence/dist/index.js';
import { acquireWorkspaceLock } from '../apps/server/dist/runtime_config.js';
import { snapshotDatabase } from '../supervisor/dist/migration_runner.js';
import { GenerationMigrator } from '../supervisor/dist/generation_migrator.js';
import { freezeLocalRelease, verifyFrozenRelease, ownerEnvironment } from './local-release.mjs';

// Explicit Owner maintenance for a Windows development checkout, never a web API or Linux Root fallback.
const sha = value => createHash('sha256').update(value).digest('hex');
const hash = value => sha(JSON.stringify(value));
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const idCheck = id => { if (!/^local-[a-zA-Z0-9_-]{1,70}$/.test(id)) throw new Error('INVALID_LOCAL_UPGRADE_ID'); return id; };
const directory = (workspace, id) => path.join(workspace, 'runtime/local-upgrades', idCheck(id));
const marker = workspace => path.join(workspace, 'runtime/local-upgrade-pending.json');
/** Node 24 Windows cpSync can abort on non-ASCII paths. Copy checked regular entries explicitly. */
export function copyTreeNew(source, target) {
  const relative = path.relative(path.resolve(source), path.resolve(target));
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('LOCAL_UPGRADE_COPY_TARGET_WITHIN_SOURCE');
  const copy = (from, to) => {
    if (fs.existsSync(to)) throw new Error('LOCAL_UPGRADE_COPY_TARGET_EXISTS');
    const stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error('LOCAL_UPGRADE_SYMLINK_FORBIDDEN');
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) copy(path.join(from, name), path.join(to, name));
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    } else throw new Error('LOCAL_UPGRADE_SPECIAL_FILE_FORBIDDEN');
  }; copy(source, target);
}
function save(file, value) {
  const temporary = file + '.next';
  const fd = fs.openSync(temporary, 'w', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}
function treeHash(root, omitBuildMetadata = false) {
  const result = createHash('sha256');
  if (!fs.existsSync(root)) return result.update('MISSING').digest('hex');
  const walk = relative => {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('LOCAL_UPGRADE_SYMLINK_FORBIDDEN');
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) {
      if (omitBuildMetadata && name.endsWith('.tsbuildinfo')) continue;
      walk(relative ? relative + '/' + name : name);
    }
    else if (stat.isFile()) result.update(relative).update('\0').update(fs.readFileSync(file)).update('\0');
    else throw new Error('LOCAL_UPGRADE_SPECIAL_FILE_FORBIDDEN');
  }; walk(''); return result.digest('hex');
}
function artifacts(root) {
  const dirs = ['apps/server/dist', 'frontend/dist', 'supervisor/dist', ...fs.readdirSync(path.join(root, 'packages')).map(name => `packages/${name}/dist`)];
  return hash(dirs.map(name => {
    if (!fs.existsSync(path.join(root, name))) throw new Error('LOCAL_UPGRADE_BUILD_REQUIRED');
    return [name, treeHash(path.join(root, name), true)];
  }));
}
function database(file, callback) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA query_only=ON; BEGIN;'); return callback(db); } finally { db.close(); }
}
export function dataFingerprint(file) {
  if (!fs.existsSync(file)) return null;
  return database(file, db => {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('LOCAL_UPGRADE_DATA_INTEGRITY_FAILED');
    return hash(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => quote(c.name)).join(',');
      return [name, db.prepare(`SELECT ${columns} FROM ${quote(name)} ORDER BY ${columns}`).all()];
    }));
  });
}
function context(workspace, projectRoot) {
  const pointer = read(path.join(workspace, 'active-generation.json'));
  if (!/^G\d{4,}$/.test(pointer.generation_id)) throw new Error('LOCAL_UPGRADE_INVALID_POINTER');
  const lineageFile = path.join(workspace, 'lineage/lineage.sqlite3');
  const currentFile = path.join(workspace, 'generations', pointer.generation_id, 'current.sqlite3');
  const state = database(lineageFile, db => ({ active: db.prepare("SELECT * FROM generations WHERE state='ACTIVE'").get(),
    next: Number(db.prepare('SELECT COALESCE(MAX(generation_no),0)+1 n FROM generations').get().n),
    pending: Number(db.prepare("SELECT COUNT(*) n FROM business_operations WHERE state IN ('RESERVED','DISPATCHED','OUTCOME_UNKNOWN')").get().n),
    dream: Number(db.prepare("SELECT COUNT(*) n FROM dream_runs WHERE status IN ('RUNNING','OUTCOME_UNKNOWN')").get().n),
    businessFacts: Number(db.prepare('SELECT COUNT(*) n FROM business_events').get().n),
    administrativeFacts: db.prepare('SELECT generation_id,kind,payload,source_ref FROM life_events ORDER BY sequence').all().map(event => {
      const payload = JSON.parse(event.payload);
      const proposal = event.kind === 'gene_proposed' && payload.source === 'owner'
        ? db.prepare('SELECT * FROM gene_proposals WHERE source_ref=?').get(event.source_ref.replace(/^proposal:/, ''))
        : event.kind === 'owner_gene_decision' && payload.decision === 'APPROVED'
          ? db.prepare('SELECT * FROM gene_proposals WHERE id=?').get(payload.proposalId) : undefined;
      if (!proposal || proposal.source !== 'owner' || !['BORN', 'FAILED'].includes(proposal.state) || proposal.generation_id !== event.generation_id || !proposal.source_ref.startsWith('local-')) return false;
      try {
        const stored = read(path.join(directory(workspace, proposal.source_ref), 'record.json'));
        const receipt = checked(workspace, proposal.source_ref, stored.candidateHash);
        const target = db.prepare('SELECT * FROM generations WHERE id=?').get(receipt.c.target);
        if (!target || receipt.c.base.id !== proposal.generation_id || receipt.c.geneHash !== target.gene_hash ||
            receipt.record.proposalId !== proposal.id || receipt.record.ownerAuthorization?.candidateHash !== receipt.record.candidateHash) return false;
        if (proposal.state === 'BORN') return receipt.record.state === 'COMMITTED' && ['ACTIVE', 'RETIRED'].includes(target.state) && proposal.candidate_hash === receipt.record.candidateHash;
        return receipt.record.state === 'FAILED' && target.state === 'FAILED' &&
          (proposal.candidate_hash === null || proposal.candidate_hash === receipt.record.candidateHash);
      } catch { return false; }
    }) }));
  const current = database(currentFile, db => ({ meta: db.prepare('SELECT * FROM current_meta').get(), events: Number(db.prepare('SELECT COUNT(*) n FROM current_events').get().n) }));
  const genome = readGenome(projectRoot);
  if (!state.active || state.active.id !== pointer.generation_id || current.meta.generation_id !== state.active.id ||
      state.active.gene_hash !== current.meta.gene_hash || current.meta.release_id !== state.active.release_id)
    throw new Error('LOCAL_UPGRADE_STORED_STATE_CONFLICT');
  if (state.pending || state.dream) throw new Error('LOCAL_UPGRADE_UNRESOLVED_EFFECTS');
  // Completed operator receipts already have durable structured evidence. Do not fake an LLM Dream.
  if (state.businessFacts || current.events || state.administrativeFacts.some(value => !value)) throw new Error('LOCAL_UPGRADE_FINAL_DREAM_REQUIRED');
  if (genome.manifest.generation !== state.next) throw new Error('LOCAL_UPGRADE_MANIFEST_GENERATION_REQUIRED');
  if (genome.geneHash === state.active.gene_hash) throw new Error('LOCAL_UPGRADE_GENE_CHANGE_REQUIRED');
  const legacyFile = path.join(workspace, 'ledger/v9_core.sqlite3');
  if (fs.existsSync(legacyFile)) database(legacyFile, db => {
    const pending = db.prepare(`SELECT (SELECT COUNT(*) FROM runs WHERE status='RUNNING')+
      (SELECT COUNT(*) FROM reservations WHERE status='OPEN')+
      (SELECT COUNT(*) FROM model_calls WHERE outcome='CALL_OUTCOME_UNKNOWN')+
      (SELECT COUNT(*) FROM messages WHERE status IN ('PROCESSING','RESERVED','CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT'))+
      (SELECT COUNT(*) FROM tool_executions WHERE status IN ('STARTED','UNKNOWN')) n`).get().n;
    if (Number(pending)) throw new Error('LOCAL_UPGRADE_LEGACY_UNRESOLVED_EFFECTS');
  });
  return { base: state.active, target: `G${String(state.next).padStart(4, '0')}`, number: state.next, genome,
    finalDream: state.administrativeFacts.length ? 'OWNER_MAINTENANCE_RECEIPTS_RETAINED' : 'NO_NEW_FACTS',
    fingerprints: { lineage: dataFingerprint(lineageFile), current: dataFingerprint(currentFile), legacy: dataFingerprint(legacyFile), live: treeHash(path.join(workspace, 'live')) } };
}
async function smoke(projectRoot, workspace, generation) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(projectRoot, 'supervisor/candidate_harness.mjs'), 'smoke', projectRoot, workspace, generation],
      { cwd: projectRoot, windowsHide: true, shell: false, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 25000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('LOCAL_UPGRADE_CANDIDATE_SMOKE_FAILED')); });
  });
}
export async function prepareLocalUpgrade(workspace, projectRoot, id, validate = smoke, install) {
  workspace = fs.realpathSync(workspace); projectRoot = fs.realpathSync(projectRoot);
  const unlock = acquireWorkspaceLock(workspace), dir = directory(workspace, id);
  let next, previous, candidateLineage;
  try {
    if (fs.existsSync(dir)) throw new Error('LOCAL_UPGRADE_ID_ALREADY_EXISTS');
    const ctx = context(workspace, projectRoot), buildHash = artifacts(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    const release = await freezeLocalRelease(projectRoot, path.join(dir, 'release'), install);
    if (readGenome(release.directory).geneHash !== ctx.genome.geneHash || artifacts(release.directory) !== buildHash)
      throw new Error('LOCAL_UPGRADE_RELEASE_COPY_MISMATCH');
    const snapshots = {};
    for (const [name, relative] of Object.entries({ lineage: 'lineage/lineage.sqlite3', current: `generations/${ctx.base.id}/current.sqlite3`, legacy: 'ledger/v9_core.sqlite3' })) {
      if (fs.existsSync(path.join(workspace, relative))) snapshots[name] = await snapshotDatabase(path.join(workspace, relative), path.join(dir, 'backup', name + '.sqlite3'));
    }
    for (const relative of ['live', `generations/${ctx.base.id}/body`]) {
      const source = path.join(workspace, relative);
      if (fs.existsSync(source)) {
        const expected = treeHash(source), target = path.join(dir, 'backup/files', relative);
        copyTreeNew(source, target); if (treeHash(target) !== expected) throw new Error('LOCAL_UPGRADE_FILE_BACKUP_MISMATCH');
      }
    }
    const candidateWorkspace = path.join(dir, 'smoke');
    fs.mkdirSync(path.join(candidateWorkspace, 'lineage'), { recursive: true });
    fs.copyFileSync(path.join(dir, 'backup/lineage.sqlite3'), path.join(candidateWorkspace, 'lineage/lineage.sqlite3'));
    if (snapshots.legacy) {
      fs.mkdirSync(path.join(candidateWorkspace, 'ledger'), { recursive: true });
      fs.copyFileSync(path.join(dir, 'backup/legacy.sqlite3'), path.join(candidateWorkspace, 'ledger/v9_core.sqlite3'));
    }
    if (fs.existsSync(path.join(dir, 'backup/files/live'))) copyTreeNew(path.join(dir, 'backup/files/live'), path.join(candidateWorkspace, 'live'));
    candidateLineage = new LineageStore(path.join(candidateWorkspace, 'lineage/lineage.sqlite3'));
    const generation = candidateLineage.createGeneration({ id: ctx.target, number: ctx.number, parentId: ctx.base.id, geneHash: ctx.genome.geneHash, releaseId: id });
    const staged = path.join(dir, 'prepared');
    next = new CurrentStore(path.join(staged, 'current.sqlite3')); next.initialize(generation, ctx.genome.manifest.body_interface_version);
    previous = new DatabaseSync(path.join(dir, 'backup/current.sqlite3'), { readOnly: true });
    const old = { db: previous, meta: () => previous.prepare('SELECT * FROM current_meta').get() };
    new GenerationMigrator().migrate(old, next, path.join(workspace, 'generations', ctx.base.id, 'body/skills'), path.join(staged, 'body/skills'));
    previous.close(); previous = undefined; next.close(); next = undefined; candidateLineage.close(); candidateLineage = undefined;
    copyTreeNew(staged, path.join(candidateWorkspace, 'generations', ctx.target));
    writeGenerationPointer(candidateWorkspace, ctx.target);
    await validate(release.directory, candidateWorkspace, ctx.target);
    const again = context(workspace, projectRoot);
    if (hash(ctx.fingerprints) !== hash(again.fingerprints) || ctx.genome.geneHash !== again.genome.geneHash || buildHash !== artifacts(projectRoot))
      throw new Error('LOCAL_UPGRADE_INPUT_CHANGED');
    const candidate = { id, scope: 'windows_owner_maintenance', workspace, projectRoot, base: ctx.base, target: ctx.target, number: ctx.number,
      geneHash: ctx.genome.geneHash, bodyInterface: ctx.genome.manifest.body_interface_version, buildHash, release, snapshots,
      fingerprints: ctx.fingerprints, preparedHash: treeHash(staged), finalDream: ctx.finalDream, validation: 'COMPILED_CANDIDATE_SMOKE_PASSED' };
    const record = { candidate, candidateHash: hash(candidate), state: 'PREPARED', createdAt: Date.now() };
    save(path.join(dir, 'record.json'), record);
    return record;
  } finally { previous?.close(); next?.close(); candidateLineage?.close(); unlock(); }
}
function checked(workspace, id, exactHash) {
  const dir = directory(workspace, id), record = read(path.join(dir, 'record.json')), c = record.candidate;
  if (c.workspace !== fs.realpathSync(workspace) || c.id !== id || record.candidateHash !== hash(c) || exactHash !== record.candidateHash)
    throw new Error('LOCAL_UPGRADE_EXACT_HASH_REQUIRED');
  return { dir, record, c };
}
export async function startPaused(c, token, logFile) {
  const releaseRoot = verifyFrozenRelease(c, directory(c.workspace, c.id));
  const env = ownerEnvironment(c.projectRoot), host = env.HOST || '127.0.0.1', port = Number(env.PORT || 8765);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) || env.EMERGENTINC_ACTIVE_GENERATION_FILE || !env.EMERGENTINC_OWNER_SECRET || env.EMERGENTINC_OWNER_SECRET.length < 32)
    throw new Error('LOCAL_UPGRADE_LOOPBACK_CONFIGURATION_REQUIRED');
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, host, resolve); });
  await new Promise(resolve => probe.close(resolve));
  const fd = fs.openSync(logFile, 'a', 0o600);
  const child = spawn(process.execPath, [path.join(releaseRoot, 'apps/server/dist/main.js')], { cwd: releaseRoot,
    windowsHide: true, detached: true, shell: false, stdio: ['ignore', fd, fd], env: { ...env,
      EMERGENTINC_RUNTIME_MODE: 'business', EMERGENTINC_WORKSPACE_ROOT: c.workspace, EMERGENTINC_CANDIDATE_MODE: '0',
      EMERGENTINC_START_PAUSED: '1', EMERGENTINC_LOCAL_UPGRADE_TOKEN: token } });
  fs.closeSync(fd); let spawnError; child.once('error', error => { spawnError = error; });
  const base = `http://${host === '::1' ? '[::1]' : host}:${port}`;
  const stop = async () => { if (child.exitCode === null && child.signalCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; } };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (spawnError || child.exitCode !== null || child.signalCode !== null) throw new Error('LOCAL_UPGRADE_START_FAILED');
      try {
        const response = await fetch(base + '/health/ready', { redirect: 'error', signal: AbortSignal.timeout(1000) });
        const value = await response.json();
        ready = response.ok && value.ready === true && value.generation === c.target && value.geneHash === c.geneHash;
        if (ready) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('LOCAL_UPGRADE_READY_FAILED');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ secret: env.EMERGENTINC_OWNER_SECRET }), signal: AbortSignal.timeout(2000) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (!login.ok || !cookie) throw new Error('LOCAL_UPGRADE_AUTH_FAILED');
    const page = await fetch(base + '/QIAN', { redirect: 'error', signal: AbortSignal.timeout(2000) });
    if (!page.ok || !page.headers.get('content-type')?.includes('text/html')) throw new Error('LOCAL_UPGRADE_FRONTEND_MISSING');
    return { pid: child.pid, base, stop, detach: () => child.unref(), resume: async () => {
      const response = await fetch(base + '/api/evolution/resume', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: '{}', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('LOCAL_UPGRADE_RESUME_FAILED');
    } };
  } catch (e) { await stop(); throw e; }
}
export async function recoverLocalUpgrade(workspace, id) {
  const { dir, record, c } = checked(workspace, id, read(path.join(directory(workspace, id), 'record.json')).candidateHash);
  if (record.state === 'COMMITTED') throw new Error('LOCAL_UPGRADE_ALREADY_COMMITTED');
  if (!fs.existsSync(marker(workspace))) throw new Error('LOCAL_UPGRADE_NOT_PENDING');
  const pending = read(marker(workspace));
  if (pending.id !== id) throw new Error('LOCAL_UPGRADE_PENDING_CONFLICT');
  const unlock = acquireWorkspaceLock(workspace, pending.token);
  let lineage;
  try {
    lineage = new LineageStore(path.join(workspace, 'lineage/lineage.sqlite3'));
    const active = lineage.activeGeneration();
    if (active?.id === c.target && active.gene_hash === c.geneHash && active.release_id === id && lineage.generation(c.base.id).state === 'RETIRED') {
      // SQLite commit is authoritative if a crash happened before the journal rename.
      if (read(path.join(workspace, 'active-generation.json')).generation_id !== c.target) throw new Error('LOCAL_UPGRADE_POINTER_CONFLICT');
      const meta = database(path.join(workspace, 'generations', c.target, 'current.sqlite3'), db => db.prepare('SELECT * FROM current_meta').get());
      if (meta.generation_id !== c.target || meta.gene_hash !== c.geneHash || meta.release_id !== id) throw new Error('LOCAL_UPGRADE_STORED_STATE_CONFLICT');
      record.state = 'COMMITTED'; record.runtime = 'RESTART_REQUIRED'; save(path.join(dir, 'record.json'), record); fs.unlinkSync(marker(workspace));
      return record;
    }
    if (active?.id !== c.base.id) throw new Error('LOCAL_UPGRADE_ACTIVE_CHANGED_REQUIRES_REVIEW');
    const target = lineage.db.prepare('SELECT * FROM generations WHERE id=?').get(c.target);
    if (target && (target.parent_id !== c.base.id || target.release_id !== id || target.gene_hash !== c.geneHash || !['BIRTHING','FAILED'].includes(target.state)))
      throw new Error('LOCAL_UPGRADE_TARGET_CONFLICT');
    writeGenerationPointer(workspace, c.base.id);
    if (target) {
      lineage.db.transaction(() => {
        lineage.db.prepare("UPDATE generations SET state='FAILED',failure_reason='owner maintenance interrupted' WHERE id=?").run(c.target);
        lineage.db.prepare("UPDATE gene_proposals SET state='FAILED' WHERE source_ref=? AND state!='BORN'").run(id);
        lineage.remember(c.target, 'generation_failure', { point: '本机升级中断', reason: '启动或切换未完成', effect: '保留新代证据并恢复升级前指针；旧代码兼容性仍须检查' }, `local-upgrade-failed:${id}`);
      });
    }
    record.state = 'FAILED'; save(path.join(dir, 'record.json'), record); fs.unlinkSync(marker(workspace));
    return record;
  } finally { lineage?.close(); unlock(); }
}
export async function applyLocalUpgrade(workspace, id, exactHash, ownerReason, start = startPaused) {
  if (typeof ownerReason !== 'string' || ownerReason.trim().length < 8) throw new Error('OWNER_UPGRADE_REASON_REQUIRED');
  const { dir, record, c } = checked(workspace, id, exactHash);
  if (record.state !== 'PREPARED') throw new Error('LOCAL_UPGRADE_NOT_PREPARED');
  let unlock = acquireWorkspaceLock(workspace), lineage, runtime;
  try {
    const ctx = context(workspace, c.projectRoot);
    if (ctx.base.id !== c.base.id || ctx.target !== c.target || ctx.genome.geneHash !== c.geneHash ||
        artifacts(c.projectRoot) !== c.buildHash || hash(ctx.fingerprints) !== hash(c.fingerprints) || treeHash(path.join(dir, 'prepared')) !== c.preparedHash)
      throw new Error('LOCAL_UPGRADE_INPUT_CHANGED');
    verifyFrozenRelease(c, dir);
    const targetDirectory = path.join(workspace, 'generations', c.target);
    if (fs.existsSync(targetDirectory)) throw new Error('LOCAL_UPGRADE_TARGET_EXISTS');
    const token = randomBytes(32).toString('hex');
    record.state = 'APPLYING'; record.ownerAuthorization = { channel: 'explicit_local_cli', reason: ownerReason, candidateHash: exactHash, at: Date.now() };
    save(path.join(dir, 'record.json'), record); save(marker(workspace), { id, token });
    lineage = new LineageStore(path.join(workspace, 'lineage/lineage.sqlite3'));
    const proposal = lineage.proposeGene(c.base.id, 'owner', { point: '应用 Owner 要求的本机源码升级', reason: ownerReason, effect: `进入 ${c.target}，原人物和运行记录保留` }, id);
    lineage.decideProposal(proposal.id, 'APPROVED'); record.proposalId = proposal.id;
    lineage.db.prepare('UPDATE gene_proposals SET candidate_hash=?,target_generation_id=? WHERE id=?').run(exactHash, c.target, proposal.id);
    lineage.createGeneration({ id: c.target, number: c.number, parentId: c.base.id, geneHash: c.geneHash, releaseId: id });
    copyTreeNew(path.join(dir, 'prepared'), targetDirectory);
    writeGenerationPointer(workspace, c.target);
    record.state = 'STARTING'; save(path.join(dir, 'record.json'), record);
    unlock(); unlock = undefined;
    runtime = await start(c, token, path.join(dir, 'server.log'));
    record.pid = runtime.pid;
    if (readGenome(c.projectRoot).geneHash !== c.geneHash || artifacts(c.projectRoot) !== c.buildHash ||
        dataFingerprint(path.join(workspace, 'ledger/v9_core.sqlite3')) !== c.fingerprints.legacy || treeHash(path.join(workspace, 'live')) !== c.fingerprints.live)
      throw new Error('LOCAL_UPGRADE_INPUT_CHANGED');
    verifyFrozenRelease(c, dir);
    lineage.db.transaction(() => {
      if (lineage.activeGeneration()?.id !== c.base.id) throw new Error('LOCAL_UPGRADE_ACTIVE_CHANGED_REQUIRES_REVIEW');
      lineage.db.prepare("UPDATE generations SET state='RETIRED',retired_at=? WHERE id=?").run(Date.now(), c.base.id);
      lineage.db.prepare("UPDATE generations SET state='ACTIVE',born_at=? WHERE id=? AND state='BIRTHING'").run(Date.now(), c.target);
      lineage.db.prepare("UPDATE gene_proposals SET state='BORN',candidate_hash=?,target_generation_id=? WHERE id=?").run(exactHash, c.target, proposal.id);
      lineage.remember(c.target, 'generation_birth', { point: `${c.target} 本机受控升级完成`, reason: '准确候选、在线备份、迁移与真实启动验证通过', effect: '旧代及其 Hash 保留，人物和历史数据不重置' }, `local-upgrade:${id}`);
    });
    record.state = 'COMMITTED'; record.completedAt = Date.now(); save(path.join(dir, 'record.json'), record); fs.unlinkSync(marker(workspace));
    try { await runtime.resume(); record.runtime = 'RUNNING'; }
    catch { record.runtime = 'PAUSED_RESUME_REQUIRED'; }
    save(path.join(dir, 'record.json'), record); runtime.detach();
    return record;
  } catch (e) {
    if (record.state !== 'COMMITTED') {
      await runtime?.stop(); lineage?.close(); lineage = undefined; unlock?.(); unlock = undefined;
      if (fs.existsSync(marker(workspace))) await recoverLocalUpgrade(workspace, id);
    }
    throw e;
  } finally { if (record.state === 'COMMITTED') runtime?.detach(); lineage?.close(); unlock?.(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.platform !== 'win32') throw new Error('WINDOWS_OWNER_MAINTENANCE_ONLY_USE_INSTALLED_SUPERVISOR_ON_LINUX');
    const [action, workspaceArg, value, exactHash, reason] = process.argv.slice(2), workspace = path.resolve(workspaceArg || '');
    if (!workspaceArg || process.env.EMERGENTINC_ACTIVE_GENERATION_FILE) throw new Error('LOCAL_WORKSPACE_REQUIRED');
    let result;
    if (action === 'prepare') result = await prepareLocalUpgrade(workspace, path.resolve('.'), value);
    else if (action === 'apply') result = await applyLocalUpgrade(workspace, value, exactHash, reason);
    else if (action === 'recover') result = await recoverLocalUpgrade(workspace, value);
    else throw new Error('Usage: local-upgrade prepare <workspace> <id> | apply <workspace> <id> <exact-hash> <owner-reason> | recover <workspace> <id>');
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
