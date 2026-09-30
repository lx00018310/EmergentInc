import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CoreStore, LineageStore } from '../packages/persistence/dist/index.js';

const quote = value => '"' + value.replaceAll('"', '""') + '"';
const names = db => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
const raw = store => ({ prepare: sql => store.db.prepare(sql), exec: sql => store.db.exec(sql) });
const digestRows = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');

/** Rehearsal ONLY. Writes an explicitly new destination; never switches pointers or source authorities. */
export async function dryRunCoreMerge(snapshotDirectory, destinationDirectory) {
  const sourceRoot = fs.realpathSync(snapshotDirectory), destination = path.resolve(destinationDirectory);
  if (fs.existsSync(destination)) throw new Error('DRY_RUN_DESTINATION_MUST_BE_NEW');
  if (destination === sourceRoot || destination.startsWith(sourceRoot + path.sep)) throw new Error('DRY_RUN_DESTINATION_MUST_BE_SEPARATE');
  const core = new DatabaseSync(path.join(sourceRoot, 'ledger/v9_core.sqlite3'), { readOnly: true });
  let originalLineage, target, lineage;
  try {
    core.exec('PRAGMA query_only=ON; BEGIN;');
    originalLineage = new DatabaseSync(path.join(sourceRoot, 'lineage/lineage.sqlite3'), { readOnly: true });
    const existingNames = new Set(names(originalLineage));
    const sourceTables = names(core);
    if (sourceTables.some(name => existingNames.has(name))) throw new Error('DRY_RUN_TABLE_COLLISION_REQUIRES_REVIEW');
    fs.mkdirSync(destination, { recursive: true });
    const file = path.join(destination, 'lineage.sqlite3');
    await backup(originalLineage, file);
    // The candidate uses the real current schema code, not guessed CREATE TABLE statements.
    lineage = new LineageStore(file); lineage.close(); lineage = undefined;
    target = new CoreStore(file);
    const targetNames = new Set(names(raw(target)));
    const unknown = sourceTables.filter(name => !targetNames.has(name));
    if (unknown.length) throw new Error('DRY_RUN_UNKNOWN_TABLE_REQUIRES_REVIEW');
    const evidence = [];
    target.transaction(() => {
      target.db.exec('PRAGMA defer_foreign_keys=ON;');
      for (const name of sourceTables) {
        const columns = core.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
        const targetColumns = new Set(target.db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name));
        if (columns.some(name => !targetColumns.has(name))) throw new Error('DRY_RUN_UNKNOWN_COLUMN_REQUIRES_REVIEW');
        // Only new Core tables can be cleared; existing Lineage tables were excluded above.
        target.db.exec(`DELETE FROM ${quote(name)}`);
        const insert = target.db.prepare(`INSERT INTO ${quote(name)} (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
        const order = columns.map(quote).join(',');
        const rows = core.prepare(`SELECT ${order} FROM ${quote(name)} ORDER BY ${order}`).all();
        for (const row of rows) insert.run(...columns.map(column => row[column]));
        const copied = target.db.prepare(`SELECT ${order} FROM ${quote(name)} ORDER BY ${order}`).all();
        const sourceHash = digestRows(rows), copiedHash = digestRows(copied);
        if (sourceHash !== copiedHash) throw new Error('DRY_RUN_ROW_HASH_MISMATCH');
        evidence.push({ table: name, rows: rows.length, destination: 'LINEAGE', contentHash: sourceHash });
      }
      if (target.db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('DRY_RUN_FOREIGN_KEY_ERROR');
    });
    for (const name of existingNames) {
      const columns = originalLineage.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name);
      const select = `SELECT ${columns.map(quote).join(',')} FROM ${quote(name)} ORDER BY ${columns.map(quote).join(',')}`;
      if (digestRows(originalLineage.prepare(select).all()) !== digestRows(target.db.prepare(select).all())) throw new Error('DRY_RUN_LINEAGE_FACT_CHANGED');
    }
    return { schema: 1, dryRun: true, migrationAppliedToSource: false, candidateOnly: true, tables: evidence,
      preservedLineageTables: existingNames.size, integrity: target.db.prepare('PRAGMA quick_check').all(),
      limitations: ['No live authority switch', 'No automatic grant transfer', 'No new generation', 'Current working projections and Run budget integration remain pending'] };
  } finally { target?.db.close(); lineage?.close(); originalLineage?.close(); core.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error('Usage: node scripts/life-core-dry-run.mjs <snapshot-directory> <new-destination-directory>');
  console.log(JSON.stringify(await dryRunCoreMerge(source, destination), null, 2));
}
