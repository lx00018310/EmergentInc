import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { CoreStore, LineageStore, CurrentStore, writeGenerationPointer } from '@emergentinc/persistence';
// @ts-expect-error Read-only administrative command uses Node built-ins rather than production Stores.
import { dryRunV23, workspaceManifest } from '../../../scripts/v23-migration-dry-run.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'V23-迁移演练-')); roots.push(root);
  const source = join(root, 'workspace'), destination = join(root, 'stage0');
  const core = new CoreStore(join(source, 'ledger/v9_core.sqlite3'));
  for (const [qianjiId, pixelId] of [['qj_a', '0_0_0'], ['qj_b', '1_0_0']]) {
    core.qianji.createProfile({ qianjiId, careerStatus: 'active' });
    core.pixels.upsertPixelAccount({ pixelId, energy: 100, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    core.qianji.createBinding({ qianjiId, pixelId, incarnation: 1, bindingId: 'binding_' + qianjiId });
    fs.mkdirSync(join(source, 'live/pixels', pixelId), { recursive: true });
    fs.writeFileSync(join(source, 'live/pixels', pixelId, 'state.json'), JSON.stringify({ incarnation: 1, energy: 100 }));
    fs.writeFileSync(join(source, 'live/pixels', pixelId, 'pixel.md'), 'private-pixel-content-do-not-publish');
  }
  core.db.prepare("UPDATE global_budget SET total_spent=123,total_reserved=45 WHERE id='GLOBAL'").run();
  const lineage = new LineageStore(join(source, 'lineage/lineage.sqlite3'));
  lineage.createGeneration({ id: 'G0001', number: 1, geneHash: '1'.repeat(64), releaseId: 'old', state: 'RETIRED' });
  lineage.createGeneration({ id: 'G0003', number: 3, parentId: 'G0001', geneHash: '3'.repeat(64), releaseId: 'failed', state: 'FAILED' });
  const generation = lineage.createGeneration({ id: 'G0005', number: 5, parentId: 'G0001', geneHash: '5'.repeat(64), releaseId: 'approved-v22', state: 'ACTIVE' });
  lineage.remember('G0001', 'generation_birth', { point: 'original', reason: 'retain', effect: 'history' }, 'birth:G0001');
  lineage.db.exec(`INSERT INTO business_plans VALUES('p','direction',1,'ACTIVE',1);
    INSERT INTO business_plan_revisions VALUES('p',1,'hash','{}',1);
    INSERT INTO business_orders VALUES('o','p',1,'description','private-customer',10,'CNY','PAID','DELIVERED',1,'proof',1);
    INSERT INTO business_payment_events VALUES('pay','o','manual','account','external','PAYMENT',10,'CNY',NULL,'customer','owner_confirmed','private-payment-evidence','hash',1);`);
  const current = new CurrentStore(join(source, 'generations/G0005/current.sqlite3')); current.initialize(generation, '1');
  current.setWorkingState('0_0_0', { secret: 'private-state' }, true);
  current.setObjective('keep', '0_0_0', 'private-objective', 'OPEN', true);
  fs.mkdirSync(join(source, 'generations/G0005/body/skills'), { recursive: true });
  fs.writeFileSync(join(source, 'generations/G0005/body/skills/example.json'), '{"private":"body-code"}');
  fs.writeFileSync(join(source, 'live/world_state.json'), '{"round":7}');
  fs.mkdirSync(join(source, 'assets')); fs.writeFileSync(join(source, 'assets/portrait.png'), Buffer.from([0, 255, 13, 10]));
  fs.mkdirSync(join(source, 'private')); fs.writeFileSync(join(source, 'private/owner.key'), 'private-owner-key');
  writeGenerationPointer(source, 'G0005');
  current.close(); lineage.close(); core.close();
  return { root, source, destination };
}

describe('V23 Stage 0 only: physical backup and candidate rehearsal', () => {
  it('retains V22 bytes, identities, budgets, failure history, Current and manual payment evidence without changing runtime authority', async () => {
    const f = fixture(), before = workspaceManifest(f.source);
    const report = await dryRunV23(f.source, f.destination);
    expect(workspaceManifest(f.source)).toEqual(before);
    expect(report).toMatchObject({ stage: 0, dryRun: true, sourceUnchanged: true, migrationAppliedToSource: false });
    expect(report.inventory).toMatchObject({ qianjiCount: 2, pixelCount: 2, orphanPixels: [], activeGeneration: { id: 'G0005', geneHash: '5'.repeat(64) } });
    expect(report.inventory.currentBindings).toHaveLength(2);
    expect(report.inventory.payments).toContainEqual(expect.objectContaining({ source: 'lineage/lineage.sqlite3', paymentEvidenceCount: 1, chainVerification: 'NOT_IMPLEMENTED' }));
    expect(report.rehearsal.worlds).toHaveLength(2);
    for (const world of report.rehearsal.worlds) {
      const original = fs.readFileSync(join(f.source, 'live/pixels', world.gatewayPixelId, 'pixel.md'));
      expect(fs.readFileSync(join(f.destination, 'rehearsal', world.workspaceRelpath, 'live/pixels', world.gatewayPixelId, 'pixel.md'))).toEqual(original);
    }
    expect(report.rehearsal.historyReassigned).toBe(false);
    expect(fs.existsSync(join(f.source, 'worlds'))).toBe(false);
    expect(fs.existsSync(join(f.source, 'system'))).toBe(false);
    const backup = new DatabaseSync(join(f.destination, 'backup/snapshots/ledger/v9_core.sqlite3'), { readOnly: true });
    try {
      expect(backup.prepare("SELECT total_spent,total_reserved FROM global_budget WHERE id='GLOBAL'").get()).toMatchObject({ total_spent: 123, total_reserved: 45 });
      expect(backup.prepare("SELECT name FROM sqlite_schema WHERE name='qianji_worlds'").get()).toBeUndefined();
    } finally { backup.close(); }
    expect(JSON.stringify(report)).not.toMatch(/private-pixel-content|private-payment-evidence|private-owner-key|private-objective|private-state/);
    expect(fs.existsSync(join(f.destination, 'backup/raw/private/owner.key'))).toBe(false);
    expect(report.backup.databases.every((d: any) => d.verified)).toBe(true);
    expect(fs.readFileSync(join(f.destination, 'backup/raw/lineage/lineage.sqlite3'))).toEqual(fs.readFileSync(join(f.source, 'lineage/lineage.sqlite3')));
    expect(fs.readFileSync(join(f.destination, 'backup/raw/assets/portrait.png'))).toEqual(fs.readFileSync(join(f.source, 'assets/portrait.png')));
  });
  it('backs up committed WAL without opening or changing the original database and sidecars', async () => {
    const f = fixture(), core = new CoreStore(join(f.source, 'ledger/v9_core.sqlite3'));
    try {
      core.db.prepare("UPDATE global_budget SET total_spent=789 WHERE id='GLOBAL'").run();
      expect(fs.statSync(join(f.source, 'ledger/v9_core.sqlite3-wal')).size).toBeGreaterThan(0);
      const before = workspaceManifest(f.source), report = await dryRunV23(f.source, f.destination);
      expect(workspaceManifest(f.source)).toEqual(before);
      const backup = new DatabaseSync(join(f.destination, 'backup/snapshots/ledger/v9_core.sqlite3'), { readOnly: true });
      try { expect(backup.prepare("SELECT total_spent FROM global_budget WHERE id='GLOBAL'").get()!.total_spent).toBe(789); } finally { backup.close(); }
      expect(report.sourceUnchanged).toBe(true);
    } finally { core.close(); }
  });
  it('reports orphan and missing Pixel ownership instead of assigning it to a guessed World', async () => {
    const f = fixture(); fs.mkdirSync(join(f.source, 'live/pixels/2_0_0')); fs.writeFileSync(join(f.source, 'live/pixels/2_0_0/pixel.md'), 'orphan');
    fs.rmSync(join(f.source, 'live/pixels/1_0_0'), { recursive: true });
    const report = await dryRunV23(f.source, f.destination);
    expect(report.inventory.orphanPixels).toContain('2_0_0');
    expect(report.rehearsal.conflicts).toContainEqual(expect.objectContaining({ code: 'BOUND_PIXEL_FILES_MISSING', pixelId: '1_0_0' }));
    expect(report.rehearsal.conflicts).toContainEqual(expect.objectContaining({ code: 'ORPHAN_PIXEL', pixelId: '2_0_0' }));
    expect(report.rehearsal.worlds.find((w: any) => w.qianjiId === 'qj_b').copiedFiles).toBe(0);
  });
  it('refuses destinations inside the source, including a parent junction, and never overwrites evidence', async () => {
    const f = fixture();
    await expect(dryRunV23(f.source, join(f.source, 'runtime/v23'))).rejects.toThrow('DESTINATION_MUST_BE_SEPARATE');
    fs.symlinkSync(f.source, join(f.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(dryRunV23(f.source, join(f.root, 'alias/new-backup'))).rejects.toThrow('DESTINATION_MUST_BE_SEPARATE');
    fs.mkdirSync(f.destination); fs.writeFileSync(join(f.destination, 'proof.txt'), 'retain');
    await expect(dryRunV23(f.source, f.destination)).rejects.toThrow('DESTINATION_MUST_BE_NEW');
    expect(fs.readFileSync(join(f.destination, 'proof.txt'), 'utf8')).toBe('retain');
  });
  it('rejects source data junctions before making a backup or reading outside the workspace', async () => {
    const f = fixture(), external = join(f.root, 'external'); fs.mkdirSync(external);
    fs.symlinkSync(external, join(f.source, 'live/escape'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(dryRunV23(f.source, f.destination)).rejects.toThrow('DATA_SYMLINK_FORBIDDEN');
    expect(fs.existsSync(f.destination)).toBe(false);
  });
  it('refuses to certify a snapshot if the source changes during the rehearsal', async () => {
    const f = fixture(); let changed = false;
    const watcher = fs.watch(f.root, (_event, name) => {
      if (name?.toString() === 'stage0' && !changed) {
        changed = true; fs.writeFileSync(join(f.source, 'live/world_state.json'), '{"round":8}');
      }
    });
    try {
      await expect(dryRunV23(f.source, f.destination)).rejects.toThrow('SOURCE_CHANGED_DURING_DRY_RUN');
      expect(changed).toBe(true);
      expect(fs.existsSync(join(f.destination, 'report.json'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(join(f.destination, 'failed.json'), 'utf8')).migrationAppliedToSource).toBe(false);
    } finally { watcher.close(); }
  });
  it('marks unsettled effects and a conflicting generation pointer as blockers without rewriting either', async () => {
    const f = fixture(); writeGenerationPointer(f.source, 'G0001');
    const lineage = new LineageStore(join(f.source, 'lineage/lineage.sqlite3'));
    lineage.db.exec("INSERT INTO business_operations VALUES('unknown','draft',NULL,'probe','hash','{}',1,'OUTCOME_UNKNOWN',NULL,1,NULL)");
    lineage.close();
    const report = await dryRunV23(f.source, f.destination);
    expect(report.rehearsal.conflicts).toContainEqual(expect.objectContaining({ code: 'ACTIVE_GENERATION_POINTER_CONFLICT' }));
    expect(report.rehearsal.conflicts).toContainEqual(expect.objectContaining({ code: 'UNRESOLVED_EFFECTS', table: 'business_operations', count: 1 }));
    expect(JSON.parse(fs.readFileSync(join(f.source, 'active-generation.json'), 'utf8')).generation_id).toBe('G0001');
  });
});
