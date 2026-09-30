import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoreStore, LineageStore } from '@emergentinc/persistence';
// @ts-expect-error Administrative JS command intentionally has no production Store dependency.
import { inventoryWorkspace } from '../../../scripts/life-inventory.mjs';
// @ts-expect-error Offline command exercises the compiled production schema in a new destination.
import { dryRunCoreMerge } from '../../../scripts/life-core-dry-run.mjs';

describe('read-only life inventory', () => {
  it('snapshots WAL state, counts unsettled effects without exposing row contents or migrating the source', async () => {
    const root = mkdtempSync(join(tmpdir(), 'life-inventory-'));
    const snapshots = join(root, 'snapshots');
    mkdirSync(join(root, 'ledger'));
    const file = join(root, 'ledger/v9_core.sqlite3');
    const db = new DatabaseSync(file);
    try {
      db.exec("PRAGMA journal_mode=WAL; CREATE TABLE tool_executions(id TEXT PRIMARY KEY,status TEXT,secret TEXT); INSERT INTO tool_executions VALUES('a','UNKNOWN','never-output-this');");
      const before = readFileSync(file);
      const report = await inventoryWorkspace(root, snapshots);
      expect(report.migrationApplied).toBe(false);
      expect(report.databases[0]).toMatchObject({ state: 'INSPECTED', integrity: ['ok'], userVersion: 0, foreignKeyErrors: 0 });
      expect(report.databases[0].snapshotHash).toMatch(/^[a-f0-9]{64}$/);
      expect(report.databases[0].tables[0]).toMatchObject({ rows: 1, primaryKey: ['id'], pending: 1, destination: 'REVIEW_REQUIRED' });
      expect(JSON.stringify(report)).not.toContain('never-output-this');
      expect(readFileSync(file)).toEqual(before);
      expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(0);
      expect(report.databases[1].state).toBe('MISSING');
      expect(existsSync(join(root, 'ledger/business.sqlite3'))).toBe(false);
      await expect(inventoryWorkspace(root, snapshots)).rejects.toThrow('INVENTORY_SNAPSHOT_MUST_BE_NEW');
    } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
  });

  it('rehearses the real Core schema on a Lineage copy while preserving source rows and rejecting collisions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'life-merge-'));
    const source = join(root, 'source'), destination = join(root, 'candidate');
    const core = new CoreStore(join(source, 'ledger/v9_core.sqlite3'));
    const lineage = new LineageStore(join(source, 'lineage/lineage.sqlite3'));
    try {
      core.db.prepare("UPDATE global_budget SET total_reserved=123,total_spent=456 WHERE id='GLOBAL'").run();
      lineage.createGeneration({ id: 'G0001', number: 1, geneHash: 'a'.repeat(64), releaseId: 'base', state: 'ACTIVE' });
      lineage.remember('G0001', 'owner_feedback', { point: 'keep', reason: 'fact', effect: 'retained' }, 'proof');
      const report = await dryRunCoreMerge(source, destination);
      expect(report).toMatchObject({ dryRun: true, migrationAppliedToSource: false, preservedLineageTables: 20 });
      const target = new DatabaseSync(join(destination, 'lineage.sqlite3'), { readOnly: true });
      try {
        expect(target.prepare("SELECT total_reserved,total_spent FROM global_budget WHERE id='GLOBAL'").get()).toMatchObject({ total_reserved: 123, total_spent: 456 });
        expect(target.prepare("SELECT point FROM memories WHERE source_ref='proof'").get()).toMatchObject({ point: 'keep' });
      } finally { target.close(); }
      expect(core.db.prepare("SELECT total_reserved FROM global_budget WHERE id='GLOBAL'").get()!.total_reserved).toBe(123);
      expect(lineage.db.prepare("SELECT name FROM sqlite_schema WHERE name='global_budget'").get()).toBeUndefined();
      await expect(dryRunCoreMerge(source, destination)).rejects.toThrow('DESTINATION_MUST_BE_NEW');
      lineage.db.exec('CREATE TABLE global_budget(id TEXT);');
      await expect(dryRunCoreMerge(source, join(root, 'collision'))).rejects.toThrow('TABLE_COLLISION');
      expect(existsSync(join(root, 'collision'))).toBe(false);
    } finally { core.db.close(); lineage.close(); rmSync(root, { recursive: true, force: true }); }
  });
});
