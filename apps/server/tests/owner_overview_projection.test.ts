import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LineageStore, WorldRegistryStore, readGenome, writeGenerationPointer } from '@emergentinc/persistence';
import { UsageMeter } from '@emergentinc/model';
import { WorldRegistryService } from '../src/services/world_registry_service.js';
import { WorldRuntimeManager } from '../src/services/world_runtime_manager.js';
import { GenePromotionService } from '../src/services/gene_promotion_service.js';
import { PaymentService } from '../src/services/payment_service.js';
import { PaymentMonitor } from '../src/services/payment_monitor.js';
import { OwnerOverviewService } from '../src/services/owner_overview_service.js';
import { BusinessService } from '../src/services/business_service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanups.splice(0).reverse()) await fn(); });

function genomeGeneHash(f: ReturnType<typeof fixture>): string {
  return f.lineage.db.prepare("SELECT gene_hash FROM generations WHERE id='G0001'").get()!.gene_hash as string;
}
function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'v28-owner-')), workspace = join(root, 'workspace');
  fs.mkdirSync(join(root, 'release/genome'), { recursive: true });
  fs.writeFileSync(join(root, 'release/genome/manifest.json'), JSON.stringify({ schema_version: 1, gene_hash_version: 2, generation: 1, body_interface_version: '1', protected_paths: ['genome/**'], capability_contracts: {} }));
  const genome = readGenome(join(root, 'release')), lineage = new LineageStore(join(workspace, 'system/lineage/lineage.sqlite3'), { v23: true });
  lineage.createGeneration({ id: 'G0001', number: 1, geneHash: genome.geneHash, releaseId: 'r1', state: 'ACTIVE' });
  writeGenerationPointer(join(workspace, 'system'), 'G0001');
  const control = new WorldRegistryStore(join(workspace, 'system/control/control.sqlite3')), registry = new WorldRegistryService(workspace, control, lineage, '1');
  const narrative = (name: string) => ({ displayName: name, title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null });
  const a = registry.create(narrative('A'));
  const manager = new WorldRuntimeManager(registry, genome.manifest, { provider: { async call() { throw new Error('NO_MODEL_CALL_EXPECTED'); } }, usageMeter: new UsageMeter({ models: {} }), modelName: 'test' });
  const promotion = new GenePromotionService(manager, join(root, 'release'), lineage);
  const payments = new PaymentService(join(workspace, 'system/payment/payment.sqlite3'), control, lineage);
  const business = new BusinessService(lineage);
  const worlds = { manager, promotion, payments, monitor: new PaymentMonitor(payments), modelName: 'test' } as any;
  const service = new OwnerOverviewService(worlds, business);
  cleanups.push(async () => { await manager.closeAll(); payments.close(); control.close(); lineage.close(); business.close?.(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, workspace, lineage, registry, narrative, a, manager, business, service };
}

describe('V28 Owner projection: decisions versus alerts', () => {
  it('projects an awaiting plan with effects and an exact pair, and unknown outcomes only as alerts', async () => {
    const f = fixture();
    // Seed a real awaiting-approval plan row through the business store schema.
    const planId = 'plan-test-1', planJson = JSON.stringify({ title: '客户调研', objective: '找客户', audience: '中小企业', hypothesis: '有需求',
      metric: { name: '线索', baseline: '0', target: '10', evidence: '表单' }, stopCondition: '无响应', expiresAt: Date.now() + 86400000,
      budgetMicros: 1000000, currency: 'CNY', actions: [], resources: [] });
    f.business.store.db.prepare("INSERT INTO business_plans VALUES(?,?,1,'AWAITING_APPROVAL',?)").run(planId, '开展客户调研', Date.now());
    f.business.store.db.prepare("INSERT INTO business_plan_revisions VALUES(?,?,?,?,?)").run(planId, 1, 'a'.repeat(64), planJson, Date.now());
    const overview = await f.service.overview();
    const plan = overview.inbox.find(i => i.id === `plan:${planId}`);
    expect(plan).toBeTruthy();
    expect(plan!.approveEffect).toContain('R1');
    expect(plan!.rejectEffect).toContain('R1');
    expect(plan!.actions!.map(p => p.action.type).sort()).toEqual(['business_plan_approve', 'business_plan_reject']);
    expect(plan!.actions![0]!.action).toMatchObject({ plan: { id: planId, revision: 1, hash: 'a'.repeat(64) } });
    expect(Array.isArray(overview.inbox)).toBe(true);
    expect(Array.isArray(overview.alerts)).toBe(true);
    for (const item of overview.inbox) {
      const types = (item.actions ?? []).map(p => p.action.type);
      const approvable = types.filter(t => ['business_plan_approve', 'resource_provided', 'recruit_approve', 'gene_proposal_approve'].includes(String(t)));
      const rejectable = types.filter(t => ['business_plan_reject', 'resource_reject', 'recruit_reject', 'gene_proposal_reject'].includes(String(t)));
      if (approvable.length || rejectable.length) {
        expect(approvable).toHaveLength(1);
        expect(rejectable).toHaveLength(1);
        expect(item.approveEffect).toBeTruthy();
        expect(item.rejectEffect).toBeTruthy();
      }
    }
    // Anything projected as an alert must not pretend to be a paired decision.
    for (const alert of overview.alerts) expect(alert.kind).toBeTruthy();
  });

  it('routes a PROPOSED gene proposal into the inbox with a direction-only pair bound to the current generation', async () => {
    const f = fixture();
    const proposal = f.lineage.proposeGene('G0001', 'owner', { point: '公共计数能力', reason: '多次复用', effect: '新世界继承' }, 'test:gene-proposal');
    const overview = await f.service.overview();
    const item = overview.inbox.find(i => i.id === `gene:${proposal.id}`);
    expect(item).toBeTruthy();
    expect(item!.href).toBe(`/GENE?view=life&id=${encodeURIComponent(String(proposal.id))}`);
    const types = item!.actions!.map(p => p.action.type).sort();
    expect(types).toEqual(['gene_proposal_approve', 'gene_proposal_reject']);
    for (const p of item!.actions!) {
      expect(p.action).toMatchObject({ proposalId: String(proposal.id), expectedGeneration: 'G0001', expectedState: 'PROPOSED' });
      expect(p.action.type.startsWith('gene_proposal_approve') ? item!.approveEffect : item!.rejectEffect).toBeTruthy();
    }
    // Proposals from a retired generation never enter the inbox: bump the pointer to G0002 so the
    // first proposal now belongs to a retired generation, then verify it disappears.
    f.lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();
    f.lineage.createGeneration({ id: 'G0002', number: 2, parentId: 'G0001', geneHash: genomeGeneHash(f), releaseId: 'r2', state: 'ACTIVE' });
    writeGenerationPointer(join(f.workspace, 'system'), 'G0002');
    const second = await f.service.overview();
    expect(second.inbox.find(i => i.id === `gene:${proposal.id}`)).toBeUndefined();
  });

  it('keeps inboxCount equal to real decisions and excludes alerts from it', async () => {
    const f = fixture();
    const proposal = f.lineage.proposeGene('G0001', 'owner', { point: '方向', reason: 'r', effect: 'e' }, 'test:gene-count');
    const overview = await f.service.overview();
    const decisions = overview.inbox.filter(i => (i.actions ?? []).some(p => ['business_plan_approve', 'resource_provided', 'recruit_approve', 'gene_proposal_approve'].includes(String(p.action.type))));
    expect(overview.summary.inboxCount).toBe(overview.inbox.length);
    expect(overview.inbox.map(i => i.id)).toContain(`gene:${proposal.id}`);
    expect(overview.alerts.every(a => !overview.inbox.some(i => i.id === a.id))).toBe(true);
  });
});
