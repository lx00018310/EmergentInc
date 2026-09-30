import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { LineageStore, CurrentStore, readGenome, writeGenerationPointer } from '@emergentinc/persistence';
import { LifeContext } from '../src/services/life_context.js';
import { acquireWorkspaceLock } from '../src/runtime_config.js';
// @ts-expect-error Administrative command uses compiled production migration primitives.
import { prepareLocalUpgrade, applyLocalUpgrade, recoverLocalUpgrade, dataFingerprint, copyTreeNew } from '../../../scripts/local-upgrade.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), '本机升级-')); roots.push(root);
  const project = join(root, 'project'), workspace = join(root, 'workspace');
  for (const dir of ['genome','apps/server/dist','frontend/dist','supervisor/dist','packages']) fs.mkdirSync(join(project, dir), { recursive: true });
  fs.writeFileSync(join(project, 'genome/manifest.json'), JSON.stringify({ schema_version: 1, generation: 2, body_interface_version: '1', protected_paths: ['genome/**'], capability_contracts: {} }));
  const lineage = new LineageStore(join(workspace, 'lineage/lineage.sqlite3'));
  const initial = lineage.createGeneration({ id: 'G0001', number: 1, geneHash: 'a'.repeat(64), releaseId: 'old', state: 'ACTIVE' });
  lineage.remember('G0001', 'generation_birth', { point: 'old', reason: 'keep', effect: 'retained' }, 'birth:G0001');
  const current = new CurrentStore(join(workspace, 'generations/G0001/current.sqlite3')); current.initialize(initial, '1'); current.close(); lineage.close();
  writeGenerationPointer(workspace, 'G0001');
  fs.mkdirSync(join(workspace, 'ledger')); const legacy = new DatabaseSync(join(workspace, 'ledger/v9_core.sqlite3'));
  legacy.exec("CREATE TABLE runs(id TEXT,status TEXT); INSERT INTO runs VALUES('old-run','COMPLETED'); CREATE TABLE reservations(status TEXT); CREATE TABLE model_calls(outcome TEXT); CREATE TABLE messages(status TEXT); CREATE TABLE tool_executions(status TEXT); CREATE TABLE qianji_profiles(id TEXT,name TEXT); INSERT INTO qianji_profiles VALUES('person-1','preserve');"); legacy.close();
  fs.mkdirSync(join(workspace, 'live')); fs.writeFileSync(join(workspace, 'live/world.json'), '{"round":7}');
  const validate = vi.fn(async (_root: string, candidate: string, generation: string) => {
    const genome = readGenome(project), life = LifeContext.open(candidate, genome.manifest, genome.geneHash, 'ignored');
    try { expect(life.current.meta().generation_id).toBe(generation); } finally { life.close(); }
  });
  const start = vi.fn(async (candidate: any, token: string) => {
    expect(() => acquireWorkspaceLock(workspace)).toThrow('LOCAL_UPGRADE_RECOVERY_REQUIRED');
    const unlock = acquireWorkspaceLock(workspace, token); unlock();
    const stored = new LineageStore(join(workspace, 'lineage/lineage.sqlite3'));
    try { expect(stored.activeGeneration()!.id).toBe('G0001'); expect(stored.generation('G0002').state).toBe('BIRTHING'); } finally { stored.close(); }
    return { pid: 123, resume: vi.fn(async () => {}), stop: vi.fn(async () => {}), detach: vi.fn() };
  });
  return { root, project, workspace, validate, start };
}

describe('explicit Windows Owner upgrade (process adapter doubles)', () => {
  it('requires exact approval, creates a new generation and preserves original hashes, people, runs and memories', async () => {
    const f = fixture(), original = dataFingerprint(join(f.workspace, 'ledger/v9_core.sqlite3'));
    const prepared = await prepareLocalUpgrade(f.workspace, f.project, 'local-test', f.validate);
    expect(prepared.state).toBe('PREPARED');
    await expect(applyLocalUpgrade(f.workspace, 'local-test', 'wrong', 'Owner requested preservation and upgrade', f.start)).rejects.toThrow('EXACT_HASH');
    expect(f.start).not.toHaveBeenCalled();
    const result = await applyLocalUpgrade(f.workspace, 'local-test', prepared.candidateHash, 'Owner requested preservation and upgrade', f.start);
    expect(result).toMatchObject({ state: 'COMMITTED', runtime: 'RUNNING' });
    const lineage = new LineageStore(join(f.workspace, 'lineage/lineage.sqlite3'));
    try {
      expect(lineage.activeGeneration()!.id).toBe('G0002');
      expect(lineage.generation('G0001')).toMatchObject({ gene_hash: 'a'.repeat(64), state: 'RETIRED' });
      expect(lineage.proposals()[0]).toMatchObject({ state: 'BORN', candidate_hash: prepared.candidateHash });
      expect(lineage.relevantMemories({ generationId: 'G0001' })).toHaveLength(1);
    } finally { lineage.close(); }
    expect(dataFingerprint(join(f.workspace, 'ledger/v9_core.sqlite3'))).toBe(original);
    expect(fs.readFileSync(join(f.workspace, 'live/world.json'), 'utf8')).toBe('{"round":7}');
    expect(fs.existsSync(join(f.workspace, 'runtime/local-upgrade-pending.json'))).toBe(false);
    const old = new CurrentStore(join(f.workspace, 'generations/G0001/current.sqlite3'));
    try { expect(old.meta().gene_hash).toBe('a'.repeat(64)); } finally { old.close(); }
  });
  it('rejects stale data, changed sources and concurrent runtime ownership before touching the active generation', async () => {
    const f = fixture(), prepared = await prepareLocalUpgrade(f.workspace, f.project, 'local-stale', f.validate);
    const unlock = acquireWorkspaceLock(f.workspace);
    await expect(applyLocalUpgrade(f.workspace, 'local-stale', prepared.candidateHash, 'Owner explicit upgrade request', f.start)).rejects.toThrow('ALREADY_RUNNING'); unlock();
    fs.writeFileSync(join(f.workspace, 'live/world.json'), 'changed');
    await expect(applyLocalUpgrade(f.workspace, 'local-stale', prepared.candidateHash, 'Owner explicit upgrade request', f.start)).rejects.toThrow('INPUT_CHANGED');
    fs.writeFileSync(join(f.workspace, 'live/world.json'), '{"round":7}');
    fs.writeFileSync(join(f.project, 'genome/new-rule.txt'), 'changed');
    await expect(applyLocalUpgrade(f.workspace, 'local-stale', prepared.candidateHash, 'Owner explicit upgrade request', f.start)).rejects.toThrow('INPUT_CHANGED');
    expect(fs.existsSync(join(f.workspace, 'generations/G0002'))).toBe(false);
  });
  it('restores the previous pointer on failed real-start validation and retains the failure history', async () => {
    const f = fixture(), prepared = await prepareLocalUpgrade(f.workspace, f.project, 'local-failure', f.validate);
    await expect(applyLocalUpgrade(f.workspace, 'local-failure', prepared.candidateHash, 'Owner explicit upgrade request', async () => { throw new Error('START_FAILED'); })).rejects.toThrow('START_FAILED');
    expect(JSON.parse(fs.readFileSync(join(f.workspace, 'active-generation.json'), 'utf8')).generation_id).toBe('G0001');
    const lineage = new LineageStore(join(f.workspace, 'lineage/lineage.sqlite3'));
    try {
      expect(lineage.activeGeneration()!.id).toBe('G0001'); expect(lineage.generation('G0002').state).toBe('FAILED');
      expect(lineage.relevantMemories({ kind: 'generation_failure' })).toHaveLength(1); expect(lineage.proposals()[0].state).toBe('FAILED');
    } finally { lineage.close(); }
  });
  it('recovers interruption before new Current creation without needing the absent database', async () => {
    const f = fixture(), prepared = await prepareLocalUpgrade(f.workspace, f.project, 'local-interrupted', f.validate);
    const lineage = new LineageStore(join(f.workspace, 'lineage/lineage.sqlite3'));
    lineage.createGeneration({ id: 'G0002', number: 2, parentId: 'G0001', geneHash: prepared.candidate.geneHash, releaseId: 'local-interrupted' }); lineage.close();
    fs.writeFileSync(join(f.workspace, 'runtime/local-upgrade-pending.json'), JSON.stringify({ id: 'local-interrupted', token: 'c'.repeat(64) }));
    expect((await recoverLocalUpgrade(f.workspace, 'local-interrupted')).state).toBe('FAILED');
    expect(fs.existsSync(join(f.workspace, 'generations/G0002/current.sqlite3'))).toBe(false);
  });
  it('recognizes a committed database after interruption before the journal update', async () => {
    const f = fixture(), prepared = await prepareLocalUpgrade(f.workspace, f.project, 'local-commit-gap', f.validate);
    const lineage = new LineageStore(join(f.workspace, 'lineage/lineage.sqlite3'));
    lineage.createGeneration({ id: 'G0002', number: 2, parentId: 'G0001', geneHash: prepared.candidate.geneHash, releaseId: 'local-commit-gap' });
    lineage.db.transaction(() => {
      lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();
      lineage.db.prepare("UPDATE generations SET state='ACTIVE' WHERE id='G0002'").run();
    }); lineage.close();
    copyTreeNew(join(f.workspace, 'runtime/local-upgrades/local-commit-gap/prepared'), join(f.workspace, 'generations/G0002'));
    writeGenerationPointer(f.workspace, 'G0002');
    fs.writeFileSync(join(f.workspace, 'runtime/local-upgrade-pending.json'), JSON.stringify({ id: 'local-commit-gap', token: 'c'.repeat(64) }));
    expect(await recoverLocalUpgrade(f.workspace, 'local-commit-gap')).toMatchObject({ state: 'COMMITTED', runtime: 'RESTART_REQUIRED' });
    expect(JSON.parse(fs.readFileSync(join(f.workspace, 'active-generation.json'), 'utf8')).generation_id).toBe('G0002');
  });
  it('requires unfinished life facts to be processed rather than inventing a successful Final Dream', async () => {
    const f = fixture();
    const current = new CurrentStore(join(f.workspace, 'generations/G0001/current.sqlite3'));
    current.event('new_work', { work: 'not processed' }); current.close();
    await expect(prepareLocalUpgrade(f.workspace, f.project, 'local-needs-dream', f.validate)).rejects.toThrow('FINAL_DREAM_REQUIRED');
    expect(f.validate).not.toHaveBeenCalled();
    expect(fs.existsSync(join(f.workspace, 'runtime/local-upgrades/local-needs-dream'))).toBe(false);
  });
  it('does not bypass an upgrade marker with a missing or invalid token', () => {
    const f = fixture();
    fs.mkdirSync(join(f.workspace, 'runtime'), { recursive: true });
    fs.writeFileSync(join(f.workspace, 'runtime/local-upgrade-pending.json'), '{}');
    expect(() => acquireWorkspaceLock(f.workspace)).toThrow('LOCAL_UPGRADE_RECOVERY_REQUIRED');
  });
});
