import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const currentTables = new Set(['current_meta', 'pixel_working_state', 'objectives', 'body_skills', 'body_needs', 'body_candidates', 'current_events']);
const unresolved = {
  reservations: ["status='OPEN'"],
  model_calls: ["outcome='UNKNOWN' OR outcome='CALL_OUTCOME_UNKNOWN'"],
  messages: ["status IN ('PROCESSING','RESERVED','CALLING','CALL_OUTCOME_UNKNOWN','AWAITING_SETTLEMENT')"],
  runs: ["status='RUNNING'"],
  tool_executions: ["status IN ('STARTED','UNKNOWN')"],
  business_operations: ["state IN ('RESERVED','DISPATCHED','OUTCOME_UNKNOWN')"],
};
const identifier = value => '"' + value.replaceAll('"', '""') + '"';
const hashFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Read existing databases only. Never instantiate a Store: constructors migrate schemas. */
export async function inspectLifeDatabase(file, snapshotFile) {
  if (!fs.existsSync(file)) return { state: 'MISSING' };
  if (!fs.lstatSync(file).isFile()) throw new Error('INVENTORY_REGULAR_DATABASE_REQUIRED');
  const source = new DatabaseSync(file, { readOnly: true });
  let db = source;
  try {
    source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000;');
    if (snapshotFile) {
      if (fs.existsSync(snapshotFile)) throw new Error('INVENTORY_SNAPSHOT_MUST_BE_NEW');
      fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
      await backup(source, snapshotFile);
      db = new DatabaseSync(snapshotFile, { readOnly: true });
    }
    db.exec('BEGIN;');
    const integrity = db.prepare('PRAGMA quick_check').all().map(row => Object.values(row)[0]);
    const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
      const columns = db.prepare(`PRAGMA table_info(${identifier(name)})`).all();
      const row = { name, rows: Number(db.prepare(`SELECT COUNT(*) n FROM ${identifier(name)}`).get().n),
        primaryKey: columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name),
        columns: columns.map(c => ({ name: c.name, type: c.type })),
        references: db.prepare(`PRAGMA foreign_key_list(${identifier(name)})`).all().map(r => ({ table: r.table, from: r.from, to: r.to })),
        destination: currentTables.has(name) ? 'CURRENT' : 'REVIEW_REQUIRED' };
      if (unresolved[name]) {
        try { row.pending = Number(db.prepare(`SELECT COUNT(*) n FROM ${identifier(name)} WHERE ${unresolved[name][0]}`).get().n); }
        catch { row.pending = null; row.pendingReview = 'SOURCE_SCHEMA_DIFFERS'; }
      }
      return row;
    });
    const version = Number(db.prepare('PRAGMA user_version').get().user_version);
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all().length;
    db.exec('COMMIT;');
    return { state: 'INSPECTED', userVersion: version, integrity, foreignKeyErrors, tables,
      ...(snapshotFile ? { snapshotHash: hashFile(snapshotFile) } : {}),
      migrationApplied: false };
  } finally { if (db !== source) db.close(); source.close(); }
}

export async function inventoryWorkspace(workspace, snapshotDirectory) {
  const root = fs.realpathSync(workspace);
  const files = ['ledger/v9_core.sqlite3', 'ledger/business.sqlite3', 'lineage/lineage.sqlite3'];
  const generationRoot = path.join(root, 'generations');
  if (fs.existsSync(generationRoot)) {
    if (!fs.lstatSync(generationRoot).isDirectory() || fs.lstatSync(generationRoot).isSymbolicLink()) throw new Error('INVENTORY_GENERATION_DIRECTORY_INVALID');
    for (const entry of fs.readdirSync(generationRoot, { withFileTypes: true })) {
      if (/^G\d{4,}$/.test(entry.name)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('INVENTORY_GENERATION_DIRECTORY_INVALID');
        files.push(`generations/${entry.name}/current.sqlite3`);
      }
    }
  }
  const databases = [];
  for (const relative of files) {
    const file = path.join(root, relative);
    if (fs.existsSync(file)) {
      const resolved = fs.realpathSync(file), within = path.relative(root, resolved);
      if (within.startsWith('..') || path.isAbsolute(within)) throw new Error('INVENTORY_DATABASE_OUTSIDE_WORKSPACE');
    }
    databases.push({ source: relative, ...await inspectLifeDatabase(file, snapshotDirectory ? path.join(snapshotDirectory, relative) : undefined) });
  }
  return { schema: 1, migrationApplied: false, generatedAt: new Date().toISOString(), databases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [workspace, snapshots] = process.argv.slice(2);
  if (!workspace) throw new Error('Usage: node scripts/life-inventory.mjs <workspace> [new-snapshot-directory]');
  console.log(JSON.stringify(await inventoryWorkspace(workspace, snapshots), null, 2));
}
