import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { inventoryWorkspace } from './life-inventory.mjs';

export const V22_BASELINE = 'db73e0f31b675b578d7ffa566c94d4f772d340bc';
const dataRoots = ['ledger', 'lineage', 'generations', 'live', 'assets', 'active-generation.json'];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
function fileHash(file) {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024), fd = fs.openSync(file, 'r');
  try { let size; while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size)); }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)); };
function resolvedNewPath(value) {
  let ancestor = path.resolve(value); const parts = [];
  while (!fs.existsSync(ancestor)) { const parent = path.dirname(ancestor); if (parent === ancestor) throw new Error('V23_DESTINATION_PARENT_MISSING'); parts.unshift(path.basename(ancestor)); ancestor = parent; }
  return path.join(fs.realpathSync(ancestor), ...parts);
}

/** Physical proof for the entire workspace. Dependency junctions are hashed as links, never followed. */
export function workspaceManifest(root) {
  const entries = [];
  const walk = relative => {
    const file = path.join(root, relative), stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) entries.push({ path: relative, type: 'LINK', sha256: digest(fs.readlinkSync(file)) });
    else if (stat.isDirectory()) {
      if (relative) entries.push({ path: relative, type: 'DIRECTORY' });
      for (const name of fs.readdirSync(file).sort()) walk(relative ? relative + '/' + name : name);
    } else if (stat.isFile()) entries.push({ path: relative, type: 'FILE', bytes: stat.size, sha256: fileHash(file) });
    else throw new Error('V23_SPECIAL_FILE_REQUIRES_REVIEW');
  };
  walk(''); return entries;
}
function copyEntries(source, destination, entries) {
  for (const entry of entries) {
    const from = path.join(source, entry.path), to = path.join(destination, entry.path);
    if (entry.type === 'LINK') throw new Error('V23_DATA_SYMLINK_FORBIDDEN');
    if (entry.type === 'DIRECTORY') fs.mkdirSync(to, { recursive: true, mode: 0o700 });
    else {
      if (!fs.lstatSync(from).isFile() || fs.lstatSync(from).isSymbolicLink()) throw new Error('V23_DATA_FILE_CHANGED');
      fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (fileHash(to) !== entry.sha256) throw new Error('V23_BACKUP_FILE_HASH_MISMATCH');
    }
  }
}
function readonly(file, callback) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA query_only=ON; BEGIN;'); return callback(db); } finally { db.close(); }
}
function databaseEvidence(file) {
  return readonly(file, db => {
    if (db.prepare('PRAGMA integrity_check').all().some(r => r.integrity_check !== 'ok') || db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('V23_SNAPSHOT_INTEGRITY_FAILED');
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
    const tables = schema.filter(row => row.type === 'table').map(({ name }) => {
      const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => quote(c.name)).join(',');
      const statement = db.prepare(`SELECT ${columns} FROM ${quote(name)} ORDER BY ${columns}`); statement.setReadBigInts(true);
      const rows = statement.all();
      const contentHash = createHash('sha256').update(JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? { integer: value.toString() } : value)).digest('hex');
      return { table: name, rows: rows.length, contentHash };
    });
    return { userVersion: Number(db.prepare('PRAGMA user_version').get().user_version), schemaHash: digest(schema), tables };
  });
}
function projection(snapshotRoot, reportDirectory, inspections, rawEntries) {
  const conflicts = [], coreFile = path.join(snapshotRoot, 'ledger/v9_core.sqlite3');
  const core = readonly(coreFile, db => ({
    profiles: db.prepare('SELECT qianji_id,career_status,narrative_revision FROM qianji_profiles ORDER BY qianji_id').all(),
    bindings: db.prepare('SELECT binding_id,qianji_id,pixel_id,incarnation,bound_at,unbound_at FROM qianji_bindings ORDER BY bound_at,binding_id').all(),
    accounts: db.prepare('SELECT pixel_id,active FROM pixel_accounts ORDER BY pixel_id').all(),
  }));
  const currentBindings = core.bindings.filter(b => b.unbound_at === null);
  const pixelRoot = path.join(reportDirectory, 'backup/raw/live/pixels');
  const pixelIds = fs.existsSync(pixelRoot) ? fs.readdirSync(pixelRoot).filter(name => fs.lstatSync(path.join(pixelRoot, name)).isDirectory()).sort() : [];
  const orphanPixels = pixelIds.filter(id => !currentBindings.some(b => b.pixel_id === id));
  for (const pixelId of orphanPixels) conflicts.push({ code: 'ORPHAN_PIXEL', pixelId });
  const worlds = core.profiles.map(profile => {
    const bindings = currentBindings.filter(b => b.qianji_id === profile.qianji_id);
    const worldId = 'world_' + createHash('sha256').update(profile.qianji_id).digest('hex').slice(0, 24);
    const world = { worldId, qianjiId: profile.qianji_id, workspaceRelpath: 'worlds/' + worldId, gatewayPixelId: null, copiedFiles: 0, proposedOnly: true };
    if (bindings.length !== 1) { conflicts.push({ code: 'QIANJI_BINDING_REVIEW_REQUIRED', qianjiId: profile.qianji_id, count: bindings.length }); return world; }
    const binding = bindings[0]; world.gatewayPixelId = binding.pixel_id;
    if (!/^-?\d+_-?\d+_-?\d+$/.test(binding.pixel_id)) { conflicts.push({ code: 'INVALID_PIXEL_DIRECTORY_ID', pixelId: binding.pixel_id }); return world; }
    if (!core.accounts.some(a => a.pixel_id === binding.pixel_id && a.active === 1)) { conflicts.push({ code: 'BOUND_PIXEL_ACCOUNT_INACTIVE_OR_MISSING', pixelId: binding.pixel_id }); return world; }
    if (!pixelIds.includes(binding.pixel_id)) { conflicts.push({ code: 'BOUND_PIXEL_FILES_MISSING', pixelId: binding.pixel_id }); return world; }
    const stateFile = path.join(pixelRoot, binding.pixel_id, 'state.json');
    if (!fs.existsSync(stateFile) || read(stateFile).incarnation !== binding.incarnation) { conflicts.push({ code: 'BOUND_PIXEL_INCARNATION_REVIEW_REQUIRED', pixelId: binding.pixel_id }); return world; }
    const prefix = 'live/pixels/' + binding.pixel_id;
    const entries = rawEntries.filter(e => e.path === prefix || e.path.startsWith(prefix + '/'));
    const target = path.join(reportDirectory, 'rehearsal', world.workspaceRelpath);
    copyEntries(path.join(reportDirectory, 'backup/raw'), target, entries);
    world.copiedFiles = entries.filter(e => e.type === 'FILE').length;
    fs.writeFileSync(path.join(target, 'world-projection.json'), JSON.stringify({ ...world, sourceBindingId: binding.binding_id, incarnation: binding.incarnation }, null, 2), { flag: 'wx', mode: 0o600 });
    return world;
  });
  for (const binding of currentBindings) if (!core.profiles.some(p => p.qianji_id === binding.qianji_id)) conflicts.push({ code: 'BINDING_PROFILE_MISSING', bindingId: binding.binding_id });
  for (const db of inspections.databases) for (const table of db.tables || []) if (table.pending > 0 || table.pending === null)
    conflicts.push({ code: 'UNRESOLVED_EFFECTS', source: db.source, table: table.name, count: table.pending });
  const lineage = readonly(path.join(snapshotRoot, 'lineage/lineage.sqlite3'), db => ({
    generations: db.prepare('SELECT id,generation_no,gene_hash,release_id,state,parent_id FROM generations ORDER BY generation_no').all(),
    active: db.prepare("SELECT id,generation_no,gene_hash,release_id FROM generations WHERE state='ACTIVE'").all(),
  }));
  const active = lineage.active[0], pointer = read(path.join(reportDirectory, 'backup/raw/active-generation.json'));
  if (lineage.active.length !== 1 || pointer.generation_id !== active?.id) conflicts.push({ code: 'ACTIVE_GENERATION_POINTER_CONFLICT' });
  let currentMeta;
  const skills = [];
  for (const database of inspections.databases.filter(d => d.source.startsWith('generations/') && d.state === 'INSPECTED')) {
    const facts = readonly(path.join(snapshotRoot, database.source), db => ({ meta: db.prepare('SELECT * FROM current_meta').get(),
      skills: db.prepare('SELECT skill_id,state,active_change_id,interface_version FROM body_skills ORDER BY skill_id').all() }));
    skills.push({ source: database.source, generationId: facts.meta?.generation_id, skills: facts.skills });
    if (facts.meta?.generation_id === active?.id) currentMeta = facts.meta;
  }
  if (!active || !currentMeta || currentMeta.gene_hash !== active.gene_hash || currentMeta.release_id !== active.release_id)
    conflicts.push({ code: 'ACTIVE_CURRENT_META_CONFLICT' });
  const payments = inspections.databases.filter(d => d.state === 'INSPECTED' && (d.tables || []).some(t => t.name === 'business_payment_events')).map(d => ({
    source: d.source, orderCount: d.tables.find(t => t.name === 'business_orders')?.rows || 0,
    paymentEvidenceCount: d.tables.find(t => t.name === 'business_payment_events').rows, chainVerification: 'NOT_IMPLEMENTED',
  }));
  return {
    inventory: { qianjiCount: core.profiles.length, pixelCount: pixelIds.length, accountCount: core.accounts.length,
      activeAccountCount: core.accounts.filter(a => a.active === 1).length, profiles: core.profiles, currentBindings,
      bindingHistoryCount: core.bindings.length, orphanPixels, generations: lineage.generations,
      activeGeneration: active ? { id: active.id, number: active.generation_no, geneHash: active.gene_hash, releaseId: active.release_id } : null,
      bodySkills: skills, payments },
    rehearsal: { worlds, conflicts, historyReassigned: false, runtimeWorldsCreated: false, databaseSchemaMigrated: false,
      requiredStage1Decisions: ['Shared V22 Run/message/ledger/model-call history remains in the complete legacy snapshot; do not infer ownership from current bindings.',
        'Old global budget and shared live artifacts are retained once; copying them into each World is not an approved allocation.',
        'Stage 1 must define operational World databases, initial shared context and read-only access to legacy history.'] },
  };
}

/** Stage 0 only. Source files are never opened by SQLite, including WAL/SHM; all database work uses replay copies. */
export async function dryRunV23(workspace, destination, baseline = { v22Commit: V22_BASELINE }) {
  const source = fs.realpathSync(workspace), target = resolvedNewPath(destination);
  if (within(source, target)) throw new Error('V23_DESTINATION_MUST_BE_SEPARATE');
  if (fs.existsSync(target)) throw new Error('V23_DESTINATION_MUST_BE_NEW');
  const before = workspaceManifest(source), selected = before.filter(e => dataRoots.some(root => e.path === root || e.path.startsWith(root + '/')));
  if (selected.some(e => e.type === 'LINK')) throw new Error('V23_DATA_SYMLINK_FORBIDDEN');
  for (const required of ['ledger/v9_core.sqlite3', 'lineage/lineage.sqlite3', 'active-generation.json'])
    if (!selected.some(e => e.path === required && e.type === 'FILE')) throw new Error('V23_REQUIRED_BASELINE_FILE_MISSING');
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  try {
    copyEntries(source, path.join(target, 'backup/raw'), selected);
    fs.writeFileSync(path.join(target, 'source-before.json'), JSON.stringify(before, null, 2), { flag: 'wx', mode: 0o600 });
    const replayEntries = selected.filter(e => e.type === 'FILE' && /\.sqlite3(?:-wal|-shm|-journal)?$/.test(e.path));
    copyEntries(path.join(target, 'backup/raw'), path.join(target, 'backup/replay'), replayEntries);
    const inspections = await inventoryWorkspace(path.join(target, 'backup/replay'), path.join(target, 'backup/snapshots'));
    const databases = inspections.databases.filter(d => d.state === 'INSPECTED').map(d => {
      const original = databaseEvidence(path.join(target, 'backup/replay', d.source)), snapshot = databaseEvidence(path.join(target, 'backup/snapshots', d.source));
      if (digest(original) !== digest(snapshot)) throw new Error('V23_SNAPSHOT_LOGICAL_HASH_MISMATCH');
      return { source: d.source, snapshotHash: d.snapshotHash, ...snapshot, verified: true };
    });
    const projected = projection(path.join(target, 'backup/snapshots'), target, inspections, selected);
    const after = workspaceManifest(source);
    fs.writeFileSync(path.join(target, 'source-after.json'), JSON.stringify(after, null, 2), { flag: 'wx', mode: 0o600 });
    if (digest(before) !== digest(after)) throw new Error('V23_SOURCE_CHANGED_DURING_DRY_RUN');
    const rawManifest = workspaceManifest(path.join(target, 'backup/raw'));
    if (digest(rawManifest) !== digest(selected)) throw new Error('V23_RAW_BACKUP_CHANGED');
    const report = { schema: 1, stage: 0, dryRun: true, migrationAppliedToSource: false, sourceUnchanged: true,
      generatedAt: new Date().toISOString(), baseline, sourceManifestHash: digest(before), sourceEntries: before.length,
      backup: { files: selected.filter(e => e.type === 'FILE').length, rawManifestHash: digest(rawManifest), databases }, ...projected };
    fs.writeFileSync(path.join(target, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    return report;
  } catch (error) {
    fs.writeFileSync(path.join(target, 'failed.json'), JSON.stringify({ stage: 0, migrationAppliedToSource: false, error: error.message }), { flag: 'wx', mode: 0o600 });
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [workspace, destination] = process.argv.slice(2);
    if (!workspace || !destination) throw new Error('Usage: node scripts/v23-migration-dry-run.mjs <workspace> <new-directory-outside-workspace>');
    const projectRoot = path.resolve(import.meta.dirname, '..');
    execFileSync('git', ['merge-base', '--is-ancestor', V22_BASELINE, 'HEAD'], { cwd: projectRoot, stdio: 'pipe' });
    const executingCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    const plan = path.join(projectRoot, 'docs/EmergentInc_V23_世界化_基因晋升_链上支付_整改执行_PLAN.md');
    const report = await dryRunV23(workspace, destination, { v22Commit: V22_BASELINE, executingCommit,
      planHash: fileHash(plan), toolHash: fileHash(path.join(projectRoot, 'scripts/v23-migration-dry-run.mjs')),
      inventoryToolHash: fileHash(path.join(projectRoot, 'scripts/life-inventory.mjs')) });
    console.log(JSON.stringify({ stage: report.stage, sourceUnchanged: report.sourceUnchanged, qianjiCount: report.inventory.qianjiCount,
      pixelCount: report.inventory.pixelCount, orphanPixels: report.inventory.orphanPixels, activeGeneration: report.inventory.activeGeneration,
      backupFiles: report.backup.files, databases: report.backup.databases.length, conflicts: report.rehearsal.conflicts, report: path.join(path.resolve(destination), 'report.json') }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
