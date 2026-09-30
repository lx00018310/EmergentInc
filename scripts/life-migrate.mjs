import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectDatabase, backupDatabase } from './business-maintenance.mjs';

/** Explicit offline migration. Does not load .env, start the server, or call a model. */
export async function migrateLifeWorkspace(workspace, projectRoot, releaseId = 'v22-initial', pointerFile = join(workspace, 'active-generation.json')) {
  const { LineageStore, CurrentStore } = await import('../packages/persistence/dist/index.js');
  const { readGenome, generationDirectory, writeGenerationPointer } = await import('../apps/server/dist/services/life_context.js');
  const { acquireWorkspaceLock } = await import('../apps/server/dist/runtime_config.js');
  workspace = resolve(workspace);
  const unlock = acquireWorkspaceLock(workspace);
  let lineage, current;
  try {
    const source = join(workspace, 'ledger/business.sqlite3');
    const target = join(workspace, 'lineage/lineage.sqlite3');
    if (existsSync(target) || existsSync(join(workspace, 'generations')) || existsSync(join(workspace, 'active-generation.json')))
      throw new Error('LIFE_MIGRATION_TARGET_MUST_BE_NEW');
    const before = inspectDatabase(source);
    if (before.schemaVersion !== 1) throw new Error('V21_SCHEMA_REQUIRED');
    const backup = await backupDatabase(source, target);
    if (JSON.stringify(before.counts) !== JSON.stringify(backup.counts)) throw new Error('MIGRATION_COUNTS_MISMATCH');
    const { manifest, geneHash } = readGenome(resolve(projectRoot));
    lineage = new LineageStore(target);
    const initial = lineage.createGeneration({ id: 'G0001', number: 1, geneHash, releaseId, state: 'ACTIVE' });
    const directory = generationDirectory(workspace, 'G0001');
    current = new CurrentStore(join(directory, 'current.sqlite3'));
    current.initialize(initial, manifest.body_interface_version);
    mkdirSync(join(directory, 'body/skills'), { recursive: true });
    lineage.remember('G0001', 'generation_birth', { point: 'V21 历史已保留，G0001 初始化', reason: 'online backup 与原业务表计数核对通过', effect: '经营事实进入跨代 Lineage，原 business.sqlite3 保留' }, 'birth:G0001');
    current.close(); current = undefined; lineage.close(); lineage = undefined;
    const after = inspectDatabase(target);
    for (const [table, count] of Object.entries(before.counts)) if (after.counts[table] !== count) throw new Error('MIGRATION_COUNTS_MISMATCH');
    const report = { before, backup, after, geneHash, releaseId, retainedSource: source };
    writeFileSync(join(workspace, 'lineage/migration-report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    writeGenerationPointer(workspace, 'G0001', resolve(pointerFile));
    return report;
  } finally { current?.close(); lineage?.close(); unlock(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [workspace, projectRoot, releaseId, pointerFile] = process.argv.slice(2);
  try {
    if (!workspace || !projectRoot) throw new Error('Usage: node scripts/life-migrate.mjs <offline-workspace> <release-root> [release-id]');
    console.log(JSON.stringify(await migrateLifeWorkspace(workspace, projectRoot, releaseId, pointerFile), null, 2));
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
