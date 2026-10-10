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
import { createServer } from '../src/app.js';
import { OwnerWorkService } from '../src/services/owner_work_service.js';

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
  return { root, workspace, lineage, registry, narrative, a, manager, business, service, worlds };
}

describe('V28 Owner projection: decisions versus alerts', () => {
  it('returns every unresolved verification item beyond the old twenty-item display cap',async()=>{
    const f=fixture(),work=new OwnerWorkService(f.manager);cleanups.push(async()=>work.close());
    const insert=f.registry.control.db.prepare("INSERT INTO owner_work_tasks(id,request_key,person_id,person_name,instruction,state,reason,created_at,updated_at) VALUES(?,?,?,?,?,'BLOCKED','WAITING_PIXEL_BUDGET',?,?)");
    for(let index=0;index<25;index++)insert.run(`task-${index}`,`request-${index}`,f.a.qianji_id,'A','Report',index+1,index+1);
    const overview=await new OwnerOverviewService(f.worlds,f.business,undefined,work).overview();
    expect(overview.alerts).toHaveLength(25);expect(overview.alerts.map(item=>item.id)).toContain('task:task-24');
    expect(overview.summary.pendingApprovals).toBe(0);expect(overview.inbox).toHaveLength(0);
  });
  it('reports readiness, upgrade pause and runtime failures through the actual Owner endpoint',async()=>{
    const f=fixture();await f.manager.open(f.a.world_id);let paused=false;
    const app=await createServer({workspaceRoot:f.workspace,runtimeMode:'business',worlds:f.worlds,businessService:f.business,
      evolution:{life:{current:{meta:()=>({generation_id:'G0001'})}},quiesced:()=>paused} as any});
    cleanups.push(async()=>{await app.close();});
    const summary=async()=>{const response=await app.inject({method:'GET',url:'/api/owner/overview'});expect(response.statusCode).toBe(200);return response.json().summary;};
    expect(await summary()).toMatchObject({serviceStatus:'ready',pixelCount:1,availableEnergy:100000,pendingApprovals:0});
    paused=true;expect((await summary()).serviceStatus).toBe('paused');
    f.manager.diagnose(f.a.world_id,'WORLD_DATABASE_UNAVAILABLE');
    expect((await summary()).serviceStatus).toBe('attention');
    expect((await app.inject({method:'GET',url:'/health/ready'})).statusCode).toBe(503);
  });
  it('aggregates complete active-World pixel counts and spendable balances without changing reservations', async () => {
    const f=fixture(), b=f.registry.create(f.narrative('B'));
    const a=await f.manager.open(f.a.world_id), second=await f.manager.open(b.world_id);
    for(let index=1;index<=34;index++){
      const id=`${index}_0_0`, directory=join(a.directory,'live/pixels',id);
      fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(join(directory,'pixel.md'),'Test pixel');
      a.store.pixels.upsertPixelAccount({pixelId:id,energy:100,active:true,refundDeficitTokens:0,spendBlockedReason:null});
    }
    a.store.pixels.upsertPixelAccount({pixelId:'1_0_0',energy:100,active:false,refundDeficitTokens:0,spendBlockedReason:null});
    a.store.pixels.upsertPixelAccount({pixelId:'2_0_0',energy:100,active:true,refundDeficitTokens:1,spendBlockedReason:'refund'});
    a.store.db.prepare("INSERT INTO reservations(call_id,run_id,pixel_id,amount,status,created_at) VALUES('overview-reserved','test','0_0_0',200,'OPEN',1)").run();
    const proposal=f.lineage.proposeGene('G0001','owner',{point:'Direction',reason:'r',effect:'e'},'overview:approval');
    const overview=await new OwnerOverviewService(f.worlds,f.business,undefined,undefined,()=> 'ready').overview();
    expect(overview.summary).toMatchObject({currentGeneration:'G0001',pixelCount:36,availableEnergy:203000,pendingApprovals:1,serviceStatus:'ready'});
    expect(overview.people.find(person=>person.worldId===f.a.world_id)!.pixels).toHaveLength(30);
    expect(overview.inbox.map(item=>item.id)).toContain(`gene:${proposal.id}`);
    expect(a.store.db.prepare("SELECT amount,status FROM reservations WHERE call_id='overview-reserved'").get()).toMatchObject({amount:200,status:'OPEN'});
    expect(second.store.pixels.getPixelAccount('0_0_0')!.energy).toBe(100000);
    await f.manager.close(b.world_id);
    const incomplete=await f.service.overview();
    expect(incomplete.summary.pixelCount).toBeNull();expect(incomplete.summary.availableEnergy).toBeNull();
    f.registry.control.db.prepare("UPDATE qianji_worlds SET status='ARCHIVED' WHERE world_id=?").run(b.world_id);
    const activeOnly=await f.service.overview();
    expect(activeOnly.summary).toMatchObject({pixelCount:35,availableEnergy:103000});
  });
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
