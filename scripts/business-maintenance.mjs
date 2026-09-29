import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function inspectDatabase(filename) {
  if (!existsSync(filename)) throw new Error('SOURCE_DATABASE_NOT_FOUND');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all().map(r => r.integrity_check);
    if (integrity.length !== 1 || integrity[0] !== 'ok') throw new Error('DATABASE_INTEGRITY_FAILED');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const counts = Object.fromEntries(tables.map(({ name }) => [name, db.prepare(`SELECT COUNT(*) n FROM "${name.replaceAll('"', '""')}"`).get().n]));
    return { schemaVersion: db.prepare('PRAGMA user_version').get().user_version, integrity: 'ok', counts };
  } finally { db.close(); }
}

/** SQLite backup API creates a consistent snapshot, including committed WAL content. Never overwrite a target. */
export async function backupDatabase(source, destination) {
  source = resolve(source); destination = resolve(destination);
  if (source === destination || existsSync(destination) || existsSync(`${destination}.manifest.json`)) throw new Error('BACKUP_TARGET_MUST_BE_NEW');
  if (!existsSync(source)) throw new Error('SOURCE_DATABASE_NOT_FOUND');
  mkdirSync(dirname(destination), { recursive: true });
  // Reserve a new destination exclusively so a second invocation cannot overwrite this backup.
  writeFileSync(destination, '', { flag: 'wx', mode: 0o600 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, destination); } finally { db.close(); }
  const inspection = inspectDatabase(destination);
  const sha256 = createHash('sha256').update(readFileSync(destination)).digest('hex');
  const manifest = { createdAt: new Date().toISOString(), source, sha256, ...inspection };
  writeFileSync(`${destination}.manifest.json`, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [action, source, destination] = process.argv.slice(2);
  try {
    if (action === 'inspect' && source) console.log(JSON.stringify(inspectDatabase(resolve(source)), null, 2));
    else if (action === 'backup' && source && destination) console.log(JSON.stringify(await backupDatabase(source, destination), null, 2));
    else throw new Error('Usage: node scripts/business-maintenance.mjs inspect <database> | backup <database> <new-copy>');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
