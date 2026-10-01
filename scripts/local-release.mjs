import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const sourceRoots = new Set(['apps', 'packages', 'frontend', 'genome', 'scripts', 'supervisor', 'deploy', 'resources', 'tests', 'docs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts', 'vitest.workspace.ts',
  'README.md', 'AGENTS.md', 'LICENSE', 'EmergentInc_UI.bat', 'EmergentInc_UI.ps1']);
const excluded = new Set(['.git', 'node_modules', 'workspace', 'owner_private', 'cache', '.codex', '.agents', '.aws']);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Full release integrity includes compiled assets and installed dependencies, unlike the Gene identity. */
export function frozenReleaseHash(root) {
  const hash = createHash('sha256'), absoluteRoot = fs.realpathSync(root);
  const walk = relative => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(absolute), inside = path.relative(absoluteRoot, target);
      if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) throw new Error('LOCAL_RELEASE_EXTERNAL_SYMLINK');
      // pnpm Windows junctions contain absolute paths. Releases stay at their approved location.
      hash.update(relative).update('\0link\0').update(fs.readlinkSync(absolute)).update('\0');
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) walk(relative ? relative + '/' + name : name);
    } else if (stat.isFile()) hash.update(relative).update('\0file\0').update(fs.readFileSync(absolute)).update('\0');
    else throw new Error('LOCAL_RELEASE_SPECIAL_FILE');
  };
  walk(''); return hash.digest('hex');
}

export async function installReleaseDependencies(directory) {
  if (!fs.existsSync(path.join(directory, 'package.json')) || !fs.existsSync(path.join(directory, 'pnpm-lock.yaml')))
    throw new Error('LOCAL_RELEASE_LOCKFILE_REQUIRED');
  await new Promise((resolve, reject) => {
    // Constant command, cwd passed separately: no path or user text is interpolated into cmd.exe.
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd install --offline --frozen-lockfile --ignore-scripts'],
          { cwd: directory, windowsHide: true, shell: false, env: { ...process.env, CI: '1' }, stdio: 'ignore' })
      : spawn('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], { cwd: directory, shell: false, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('LOCAL_RELEASE_OFFLINE_INSTALL_FAILED')); });
  });
}

export async function freezeLocalRelease(source, destination, install = installReleaseDependencies) {
  if (fs.existsSync(destination)) throw new Error('LOCAL_RELEASE_TARGET_EXISTS');
  const copy = relative => {
    const from = path.join(source, relative), to = path.join(destination, relative), stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error('LOCAL_RELEASE_SOURCE_SYMLINK');
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        if (!relative && !sourceRoots.has(name)) continue;
        if (excluded.has(name) || name.startsWith('.env') || name.endsWith('.tsbuildinfo') || /\.(?:log|pem|key|sqlite3(?:-wal|-shm)?)$/.test(name)) continue;
        copy(relative ? relative + '/' + name : name);
      }
    } else if (stat.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error('LOCAL_RELEASE_SPECIAL_FILE');
  };
  copy(''); await install(destination);
  return { directory: destination, hash: frozenReleaseHash(destination) };
}

export function verifyFrozenRelease(candidate, recordDirectory) {
  if (!candidate.release || candidate.release.directory !== path.join(recordDirectory, 'release')) throw new Error('LOCAL_RELEASE_UPGRADE_REQUIRED');
  const directory = candidate.release.directory;
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory || frozenReleaseHash(directory) !== candidate.release.hash)
    throw new Error('LOCAL_RELEASE_INTEGRITY_FAILED');
  return directory;
}

export async function initializeLocalRelease(projectRoot, workspace, install) {
  if (fs.existsSync(path.join(workspace, 'lineage/lineage.sqlite3')) || fs.existsSync(path.join(workspace, 'active-generation.json')) ||
      fs.existsSync(path.join(workspace, 'ledger/business.sqlite3')))
    throw new Error('LOCAL_RELEASE_INITIALIZATION_REQUIRES_EMPTY_LINEAGE');
  const id = 'local-initial-' + randomUUID(), recordDirectory = path.join(workspace, 'runtime/local-upgrades', id);
  const release = await freezeLocalRelease(projectRoot, path.join(recordDirectory, 'release'), install);
  const { readGenome } = await import(pathToFileURL(path.join(release.directory, 'packages/persistence/dist/index.js')).href);
  const { geneHash } = readGenome(release.directory);
  const candidate = { id, scope: 'windows_owner_initialization', workspace: fs.realpathSync(workspace), projectRoot,
    target: 'G0001', geneHash, release };
  const candidateHash = jsonHash(candidate);
  fs.writeFileSync(path.join(recordDirectory, 'record.json'), JSON.stringify({ candidate, candidateHash, state: 'COMMITTED',
    ownerAuthorization: { channel: 'explicit_first_launch', candidateHash, reason: 'Owner first launch of an empty lineage' } }, null, 2), { flag: 'wx', mode: 0o600 });
  return { directory: release.directory, generation: { id: 'G0001', gene_hash: geneHash, release_id: id } };
}

/** Select only the committed Owner receipt matching both physical databases and the active pointer. */
export function approvedLocalRelease(workspace) {
  if (fs.existsSync(path.join(workspace, 'runtime/local-upgrade-pending.json'))) throw new Error('LOCAL_UPGRADE_RECOVERY_REQUIRED');
  const id = read(path.join(workspace, 'active-generation.json')).generation_id;
  if (!/^G\d{4,}$/.test(id)) throw new Error('LOCAL_RELEASE_INVALID_POINTER');
  const lineage = new DatabaseSync(path.join(workspace, 'lineage/lineage.sqlite3'), { readOnly: true });
  let generation;
  try {
    const active = lineage.prepare("SELECT * FROM generations WHERE state='ACTIVE'").all();
    if (active.length !== 1 || active[0].id !== id) throw new Error('LOCAL_RELEASE_STORED_STATE_CONFLICT');
    generation = active[0];
  } finally { lineage.close(); }
  if (!/^local-[a-zA-Z0-9_-]{1,70}$/.test(generation.release_id)) throw new Error('LOCAL_RELEASE_UPGRADE_REQUIRED');
  const recordDirectory = path.join(workspace, 'runtime/local-upgrades', generation.release_id);
  const record = read(path.join(recordDirectory, 'record.json')), c = record.candidate;
  if (record.state !== 'COMMITTED' || record.candidateHash !== jsonHash(c) ||
      record.ownerAuthorization?.candidateHash !== record.candidateHash || !['windows_owner_maintenance', 'windows_owner_initialization'].includes(c.scope) ||
      c.workspace !== workspace || c.id !== generation.release_id || c.target !== id || c.geneHash !== generation.gene_hash)
    throw new Error('LOCAL_RELEASE_RECEIPT_CONFLICT');
  const current = new DatabaseSync(path.join(workspace, 'generations', id, 'current.sqlite3'), { readOnly: true });
  try {
    const meta = current.prepare('SELECT * FROM current_meta').get();
    if (!meta || meta.generation_id !== id || meta.gene_hash !== generation.gene_hash || meta.release_id !== generation.release_id)
      throw new Error('LOCAL_RELEASE_STORED_STATE_CONFLICT');
  } finally { current.close(); }
  return { directory: verifyFrozenRelease(c, recordDirectory), generation };
}

export function ownerEnvironment(root) {
  const env = { ...process.env }, file = path.join(root, '.env');
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const item = line.trim(), at = item.indexOf('=');
    if (!item || item.startsWith('#') || at < 1) continue;
    const key = item.slice(0, at).trim(); if (!env[key]) env[key] = item.slice(at + 1).trim().replace(/^["'](.*)["']$/, '$1');
  }
  return env;
}
