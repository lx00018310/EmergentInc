import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OwnerGoal,OwnerGoalEvidence } from '@emergentinc/protocol';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import type { OwnerGoalService } from './owner_goal_service.js';
import type { PaymentService } from './payment_service.js';
import { CompanyArtifactService } from './company_artifact_service.js';

/** Verifies immutable tool receipts and actual file bytes. An LLM report has no completion authority. */
export class GoalOutcomeEvaluator {
  constructor(private manager: WorldRuntimeManager, private goals: OwnerGoalService,private payments?:PaymentService) {}
  verify(e:OwnerGoalEvidence){
    if(e.kind==='report')return;
    if(e.kind==='payment'){
      const r=this.payments?.db.prepare("SELECT * FROM payment_receipts WHERE id=? AND invoice_id=? AND source='chain_finalized'").get(e.id.split(':').at(-1)!,e.reference);
      if(!r||createHash('sha256').update(JSON.stringify(r)).digest('hex')!==e.sha256)throw new Error('OWNER_EVIDENCE_CHANGED');return;
    }
    if(!e.worldId){new CompanyArtifactService(this.goals.store,this.manager.registry.workspace).read(e);return;}const parts=e.reference.split('/');
    if(parts[0]!=='evidence'||parts.some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))throw new Error('OWNER_EVIDENCE_CHANGED');
    let file=this.manager.registry.directory(e.worldId);for(const part of parts){file=path.join(file,part);if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())throw new Error('OWNER_EVIDENCE_CHANGED');}
    if(!fs.statSync(file).isFile()||fs.statSync(file).size!==e.bytes||e.bytes>2000000||createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==e.sha256)throw new Error('OWNER_EVIDENCE_CHANGED');
  }
  observePayments(goal:OwnerGoal) {
    const acceptance=goal.acceptance;
    if(acceptance.kind!=='confirmed_payments'||!this.payments||['ARCHIVED','STOPPED','COMPLETED'].includes(goal.status))return;
    const receipts=this.payments.db.prepare(`SELECT r.* FROM payment_receipts r JOIN payment_invoices i ON i.invoice_id=r.invoice_id JOIN world_revenue_events v ON v.receipt_id=r.id WHERE r.source='chain_finalized' AND i.status='FINALIZED' AND r.invoice_id IN (${acceptance.invoiceIds.map(()=>'?').join(',')})`).all(...acceptance.invoiceIds);
    this.goals.store.transaction(()=>{
      for(const receipt of receipts){const content=JSON.stringify(receipt),sha=createHash('sha256').update(content).digest('hex');this.goals.store.db.prepare("INSERT OR IGNORE INTO owner_goal_evidence VALUES(?,?,?,'',?,'payment',?,?,?,?)").run(`payment:${goal.id}:${goal.specificationRevision}:${receipt.id}`,goal.id,goal.specificationRevision,String(receipt.world_id??''),String(receipt.invoice_id),sha,Buffer.byteLength(content),Date.now());}
      this.goals.store.db.prepare('UPDATE owner_goals SET verified_count=?,evidence_count=? WHERE id=?').run(receipts.length,receipts.length,goal.id);
      if(receipts.length>=acceptance.targetCount&&['READY','RUNNING','WAITING_RESOURCE','WAITING_APPROVAL'].includes(goal.status))this.goals.state(goal.id,'WAITING_APPROVAL','OWNER_PAYMENTS_VERIFIED');
      else if(goal.status==='READY')this.goals.state(goal.id,'WAITING_RESOURCE','OWNER_WAITING_PAYMENT');
    });
  }
  collect(goal: OwnerGoal, dispatchId: string, worldId: string, reply?: string | null) {
    if(this.goals.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='company_legacy_runs'").get()&&this.goals.store.db.prepare('SELECT 1 FROM company_legacy_runs l JOIN company_execution_attempts a ON a.run_id=l.run_id WHERE a.dispatch_id=?').get(dispatchId))return this.collectWorker(goal,dispatchId,reply);
    if(this.goals.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='company_worker_launches'").get()&&this.goals.store.db.prepare('SELECT 1 FROM company_execution_attempts a JOIN company_worker_launches w ON w.attempt_id=a.id WHERE a.dispatch_id=?').get(dispatchId))return this.collectWorker(goal,dispatchId,reply);
    const runtime = this.manager.peek(worldId); if (!runtime) return 0;
    const runs = this.goals.store.db.prepare('SELECT run_id FROM owner_run_permits WHERE dispatch_id=?').all(dispatchId).map(r => String(r.run_id));
    let added = 0;
    for (const run of runs) {
      for (const tool of runtime.store.db.prepare("SELECT * FROM tool_executions WHERE run_id=? AND tool='save_artifact' AND status='SUCCESS'").all(run)) {
        const receipt = JSON.parse(String(tool.result));
        if (typeof receipt.snapshot_relative_path !== 'string' || typeof receipt.filename !== 'string') continue;
        const segments = receipt.snapshot_relative_path.split('/');
        if (segments[0] !== 'evidence' || segments[1] !== `owner-${dispatchId}` || segments.some((s: string) => !s || s === '.' || s === '..' || s.includes('\\') || s.includes(':'))) continue;
        let file = runtime.directory, valid = true;
        for (const segment of segments) { file = path.join(file, segment); if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) { valid = false; break; } }
        if (!valid || !fs.statSync(file).isFile() || fs.statSync(file).size > 2_000_000) continue;
        const bytes = fs.readFileSync(file), sha = createHash('sha256').update(bytes).digest('hex');
        if (sha !== receipt.sha256 || bytes.length !== receipt.size_bytes) continue;
        const id = `artifact:${tool.operation_id}`;
        if(this.goals.store.db.prepare("SELECT 1 FROM owner_goal_evidence WHERE goal_id=? AND specification_revision=? AND run_id=? AND kind='artifact' AND sha256=?").get(goal.id,goal.specificationRevision,run,sha))continue;
        added += Number(this.goals.store.db.prepare("INSERT OR IGNORE INTO owner_goal_evidence VALUES(?,?,?,?,?,'artifact',?,?,?,?)").run(id, goal.id, goal.specificationRevision, run, worldId, receipt.snapshot_relative_path, sha, bytes.length, Date.now()).changes);
      }
    }
    if (reply && runs.length) this.goals.store.db.prepare("INSERT OR IGNORE INTO owner_goal_evidence VALUES(?,?,?,?,?,'report',?,?,?,?)").run(`report:${dispatchId}`, goal.id, goal.specificationRevision, runs.at(-1)!, worldId, dispatchId, createHash('sha256').update(reply).digest('hex'), Buffer.byteLength(reply), Date.now());
    const evidence = this.goals.detail(goal.id).evidence.filter(e => e.specificationRevision === goal.specificationRevision && e.kind === 'artifact');
    const acceptance = goal.acceptance;
    const verified = acceptance.kind === 'artifact' && evidence.some(e => e.reference.endsWith('/' + acceptance.filename) && e.bytes >= acceptance.minBytes);
    this.goals.store.db.prepare('UPDATE owner_goals SET evidence_count=?,verified_count=?,updated_at=? WHERE id=?').run(evidence.length, verified ? 1 : 0, Date.now(), goal.id);
    if (added) this.goals.event(goal.id, 'evidence_collected', { count: added, dispatchId });
    if (verified && !runs.some(id=>runtime.store.runs.getCheckpoint(id)?.resume_pending) && ['READY', 'RUNNING'].includes(this.goals.get(goal.id).status)) this.goals.state(goal.id, 'WAITING_APPROVAL', 'OWNER_ARTIFACT_VERIFIED');
    return added;
  }
  private collectWorker(goal:OwnerGoal,dispatchId:string,reply?:string|null) {
    const db=this.goals.store.db,attempt=db.prepare('SELECT * FROM company_execution_attempts WHERE dispatch_id=? ORDER BY fence DESC LIMIT 1').get(dispatchId);
    if(!attempt)return 0;
    const evidence=this.goals.detail(goal.id).evidence.filter(e=>e.kind==='artifact'&&e.specificationRevision===goal.specificationRevision);
    for(const e of evidence)this.verify(e);
    if(reply)db.prepare("INSERT INTO owner_goal_evidence VALUES(?,?,?,?,'','report',?,?,?,?) ON CONFLICT(id) DO NOTHING").run(`report:${dispatchId}`,goal.id,goal.specificationRevision,attempt.run_id,dispatchId,createHash('sha256').update(reply).digest('hex'),Buffer.byteLength(reply),Date.now());
    const acceptance=goal.acceptance,accepted=acceptance.kind==='artifact'&&evidence.some(e=>e.reference.endsWith('/'+acceptance.filename)&&e.bytes>=acceptance.minBytes);
    db.prepare('UPDATE owner_goals SET evidence_count=?,verified_count=?,updated_at=? WHERE id=? AND specification_revision=?').run(evidence.length,accepted?1:0,Date.now(),goal.id,goal.specificationRevision);
    if(accepted&&attempt.state==='COMPLETED'&&['READY','RUNNING'].includes(this.goals.get(goal.id).status))this.goals.state(goal.id,'WAITING_APPROVAL','OWNER_ARTIFACT_VERIFIED');
    return evidence.filter(e=>e.runId===attempt.run_id).length;
  }
}
