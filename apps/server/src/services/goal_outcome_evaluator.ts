import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { OwnerGoal } from '@emergentinc/protocol';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import type { OwnerGoalService } from './owner_goal_service.js';
import type { PaymentService } from './payment_service.js';

/** Verifies immutable tool receipts and actual file bytes. An LLM report has no completion authority. */
export class GoalOutcomeEvaluator {
  constructor(private manager: WorldRuntimeManager, private goals: OwnerGoalService,private payments?:PaymentService) {}
  observePayments(goal:OwnerGoal) {
    const acceptance=goal.acceptance;
    if(acceptance.kind!=='confirmed_payments'||!this.payments||['ARCHIVED','STOPPED','COMPLETED'].includes(goal.status))return;
    const receipts=this.payments.db.prepare(`SELECT r.* FROM payment_receipts r JOIN payment_invoices i ON i.invoice_id=r.invoice_id JOIN world_revenue_events v ON v.receipt_id=r.id WHERE r.source='chain_finalized' AND i.status='FINALIZED' AND r.invoice_id IN (${acceptance.invoiceIds.map(()=>'?').join(',')})`).all(...acceptance.invoiceIds);
    this.goals.store.transaction(()=>{
      for(const receipt of receipts){const content=JSON.stringify(receipt),sha=createHash('sha256').update(content).digest('hex');this.goals.store.db.prepare("INSERT OR IGNORE INTO owner_goal_evidence VALUES(?,?,?,'',?,'payment',?,?,?,?)").run(`payment:${goal.id}:${goal.specificationRevision}:${receipt.id}`,goal.id,goal.specificationRevision,String(receipt.world_id??''),String(receipt.invoice_id),sha,Buffer.byteLength(content),Date.now());}
      this.goals.store.db.prepare('UPDATE owner_goals SET verified_count=?,evidence_count=? WHERE id=?').run(receipts.length,receipts.length,goal.id);
      if(receipts.length>=acceptance.targetCount&&['READY','RUNNING','WAITING_RESOURCE','WAITING_APPROVAL'].includes(goal.status))this.goals.state(goal.id,'COMPLETED','OWNER_PAYMENTS_VERIFIED');
      else if(goal.status==='READY')this.goals.state(goal.id,'WAITING_RESOURCE','OWNER_WAITING_PAYMENT');
    });
  }
  collect(goal: OwnerGoal, dispatchId: string, worldId: string, reply?: string | null) {
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
        if(this.goals.store.db.prepare("SELECT 1 FROM owner_goal_evidence WHERE goal_id=? AND specification_revision=? AND kind='artifact' AND sha256=?").get(goal.id,goal.specificationRevision,sha))continue;
        added += Number(this.goals.store.db.prepare("INSERT OR IGNORE INTO owner_goal_evidence VALUES(?,?,?,?,?,'artifact',?,?,?,?)").run(id, goal.id, goal.specificationRevision, run, worldId, receipt.snapshot_relative_path, sha, bytes.length, Date.now()).changes);
      }
    }
    if (reply && runs.length) this.goals.store.db.prepare("INSERT OR IGNORE INTO owner_goal_evidence VALUES(?,?,?,?,?,'report',?,?,?,?)").run(`report:${dispatchId}`, goal.id, goal.specificationRevision, runs.at(-1)!, worldId, dispatchId, createHash('sha256').update(reply).digest('hex'), Buffer.byteLength(reply), Date.now());
    const evidence = this.goals.detail(goal.id).evidence.filter(e => e.specificationRevision === goal.specificationRevision && e.kind === 'artifact');
    const acceptance = goal.acceptance;
    const verified = acceptance.kind === 'artifact' && evidence.some(e => e.reference.endsWith('/' + acceptance.filename) && e.bytes >= acceptance.minBytes);
    this.goals.store.db.prepare('UPDATE owner_goals SET evidence_count=?,verified_count=?,updated_at=? WHERE id=?').run(evidence.length, verified ? 1 : 0, Date.now(), goal.id);
    if (added) this.goals.event(goal.id, 'evidence_collected', { count: added, dispatchId });
    if (verified && !runs.some(id=>runtime.store.runs.getCheckpoint(id)?.resume_pending) && ['READY', 'RUNNING'].includes(this.goals.get(goal.id).status)) this.goals.state(goal.id, 'COMPLETED', 'OWNER_ARTIFACT_VERIFIED');
    return added;
  }
}
