import { randomUUID } from 'node:crypto';
import type { OwnerGoal } from '@emergentinc/protocol';
import type { OwnerWorkService } from './owner_work_service.js';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import type { OwnerAutomationGate } from './owner_automation_gate.js';
import { GoalOutcomeEvaluator } from './goal_outcome_evaluator.js';
import type { PaymentService } from './payment_service.js';

export class OwnerGoalScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private flight?: Promise<void>;
  private closed = false;
  private evaluator: GoalOutcomeEvaluator;
  constructor(private manager: WorldRuntimeManager, private work: OwnerWorkService, readonly gate: OwnerAutomationGate,payments?:PaymentService) { this.evaluator = new GoalOutcomeEvaluator(manager, gate.goals,payments); }
  start() { this.closed = false; this.timer = setInterval(() => { void this.tick().catch(e => this.gate.halt(e instanceof Error ? e.message : 'OWNER_SCHEDULER_FAILED')); }, 1000); this.timer.unref(); }
  async close() { this.closed = true; if (this.timer) clearInterval(this.timer); await this.flight; }
  tick(): Promise<void> { if (this.flight) return this.flight; this.flight = this.run().finally(() => { this.flight = undefined; }); return this.flight; }
  private async run() {
    if (this.closed) return;
    const db = this.gate.store.db, goals = this.gate.goals;
    for(const goal of goals.list())this.evaluator.observePayments(goal);
    for(const world of this.manager.list()){const runtime=this.manager.peek(world.world_id);if(runtime)this.gate.reconcileWorld(runtime.store,world.world_id);}
    // Observation and receipt reconciliation also run while OFF. They cannot dispatch work.
    for (const d of db.prepare("SELECT d.*,s.attempts FROM owner_goal_dispatches d JOIN owner_goal_steps s USING(id) WHERE d.state IN ('QUEUED','RUNNING') ORDER BY s.created_at").all()) {
      const goal = goals.get(String(d.goal_id)), runtime = this.manager.peek(String(d.world_id));
      const task = d.task_id ? db.prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(d.task_id) : undefined;
      const revoked = goal.specificationRevision !== d.goal_revision || ['STOPPED', 'ARCHIVED'].includes(goal.status);
      if (revoked) {
        runtime?.run.requestSuspend(); if (runtime?.run.getStatus().running) continue;
        if (runtime?.store.getUnfinalizedOperations().unknownCalls.length || runtime?.store.getUnfinalizedOperations().startedToolExecutions.length) continue;
        if (task?.turn_id && runtime) {
          runtime.store.db.prepare("UPDATE messages SET status='ABANDONED' WHERE status IN ('QUEUED','RESPONSE_STORED','PROCESSING','RESERVED','WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET') AND message_id IN (SELECT message_id FROM world_chat_inbox WHERE turn_id=? UNION SELECT message_id FROM world_chat_continuations WHERE turn_id=?)").run(task.turn_id, task.turn_id);
          for (const r of db.prepare('SELECT run_id FROM owner_run_permits WHERE dispatch_id=?').all(d.id)) { runtime.store.runs.setResumePending(String(r.run_id), false); this.gate.cancelRun(String(r.run_id)); }
        }
        db.prepare("UPDATE owner_goal_dispatches SET state='CANCELLED',reason='OWNER_GOAL_PERMISSION_CHANGED' WHERE id=?").run(d.id);
        if (task) db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason='OWNER_GOAL_PERMISSION_CHANGED' WHERE id=?").run(task.id);
        continue;
      }
      if (goal.status === 'PAUSED') { runtime?.run.requestSuspend(); continue; }
      if (!task) continue; // Durable QUEUED intent is completed below using the same key.
      if (runtime?.run.getStatus().running) {if(goal.status==='READY')goals.state(goal.id,'RUNNING');continue;}
      const added = this.evaluator.collect(goal, String(d.id), String(d.world_id), task.reply as string | null);
      if (runtime?.store.runs.getCheckpoint(String(task.run_id))?.resume_pending) {
        if(runtime.run.getStatus().stop_reason==='INFRASTRUCTURE_FAILURE'&&goal.status!=='BLOCKED')goals.state(goal.id,'BLOCKED',runtime.run.getStatus().error_summary??'INFRASTRUCTURE_FAILURE');
        continue;
      }
      if(db.prepare("SELECT 1 FROM owner_goal_recruits r JOIN owner_recruit_requests q ON q.id=r.request_id WHERE r.goal_id=? AND r.goal_revision=? AND q.state='PENDING'").get(goal.id,goal.specificationRevision)){
        goals.state(goal.id,'WAITING_APPROVAL','OWNER_RECRUITMENT_REQUIRED');this.finish(String(d.id));continue;
      }
      if (task.state === 'QUEUED' || task.state === 'RUNNING') continue;
      if (goals.get(goal.id).status === 'COMPLETED') { this.finish(String(d.id)); continue; }
      const reason = String(task.reason ?? runtime?.run.getStatus().stop_reason ?? 'OWNER_GOAL_NEEDS_VERIFICATION');
      if (['BLOCKED', 'NO_REPLY'].includes(String(task.state)) && ['ROUND_LIMIT_REACHED', 'MESSAGE_LIMIT_REACHED'].includes(reason)) {
        const attempts = added ? 0 : Number(d.attempts) + 1;
        db.prepare('UPDATE owner_goal_steps SET attempts=? WHERE id=?').run(attempts, d.id);
        if (attempts >= 3) { goals.state(goal.id, 'BLOCKED', 'OWNER_NO_PROGRESS'); this.finish(String(d.id)); }
        else { db.prepare("UPDATE owner_work_tasks SET state='QUEUED',run_id=NULL,reason=NULL WHERE id=?").run(task.id); goals.state(goal.id, 'READY'); }
      } else {
        this.finish(String(d.id));
        goals.state(goal.id, task.state === 'REPLIED' ? 'WAITING_APPROVAL' : 'BLOCKED', task.state === 'REPLIED' ? 'OWNER_GOAL_NEEDS_VERIFICATION' : reason);
      }
    }
    this.gate.enforceLimits();
    if (!this.gate.isOn() || this.manager.list().some(w => w.running)) return;
    await this.work.tick();
    if (!this.gate.isOn() || this.manager.list().some(w => w.running)) return;
    // Finish a durable dispatch intent after a crash before OwnerWork creation.
    const pending = db.prepare("SELECT * FROM owner_goal_dispatches WHERE task_id IS NULL AND state='QUEUED' ORDER BY rowid LIMIT 1").get();
    if (pending) { await this.dispatch(goals.get(String(pending.goal_id)), String(pending.id), String(pending.world_id)); return; }
    const continuation=db.prepare("SELECT d.*,g.last_scheduled_at FROM owner_goal_dispatches d JOIN owner_goals g ON g.id=d.goal_id JOIN owner_work_tasks t ON t.id=d.task_id WHERE d.state IN ('QUEUED','RUNNING') AND t.state='QUEUED' AND t.run_id IS NULL AND g.status IN ('READY','RUNNING') ORDER BY g.last_scheduled_at,d.id LIMIT 1").get();
    const eligible = goals.list().filter(g => g.status === 'READY' && !db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE goal_id=? AND state IN ('RUNNING','QUEUED')").get(g.id)).sort((a, b) => a.lastScheduledAt - b.lastScheduledAt || a.createdAt-b.createdAt || a.id.localeCompare(b.id));
    if(continuation&&(!eligible.length||Number(continuation.last_scheduled_at)<=eligible[0]!.lastScheduledAt)){await this.work.tick(String(continuation.id));return;}
    if (!eligible.length) return;
    const goal = eligible[0]!;
    if (goal.spentTokens + goal.reservedTokens >= goal.maxTokens) { goals.state(goal.id, 'BLOCKED', 'OWNER_GOAL_TOKEN_LIMIT'); return; }
    // Reuse real role/behavior profiles; avoid a paid routing call when choosing between existing people.
    const people = this.manager.list().filter(w => w.status === 'ACTIVE' && !w.blockedReason && !w.runtimeFailure && !db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE world_id=? AND state IN ('RUNNING','QUEUED')").get(w.world_id));
    if (!people.length) {
      if (!this.manager.list().some(w => w.status === 'ACTIVE')) {
        const request=this.work.requestRecruit({role:'Goal coordinator / 目标协调',reason:`Goal / 目标: ${goal.title}. No active person is available / 暂无可用人物。`,instruction:goal.objective},'Owner goals / 经营目标',`goal-recruit:${goal.id}:${goal.specificationRevision}`);
        db.prepare('INSERT OR IGNORE INTO owner_goal_recruits VALUES(?,?,?)').run(request.id,goal.id,goal.specificationRevision);
        goals.state(goal.id,'WAITING_APPROVAL','OWNER_RECRUITMENT_REQUIRED');
      }
      return;
    }
    const score = (id: string) => { const p = this.gate.store.qianji.getProfile(id)!; const words = `${p.narrative.roleLabel ?? ''} ${p.narrative.behaviorProfile.join(' ')}`.match(/[a-z]{3,}|[\p{Script=Han}]{2}/giu) ?? []; return words.filter(w => `${goal.title} ${goal.objective}`.toLowerCase().includes(w.toLowerCase())).length; };
    const approved=db.prepare("SELECT q.person_id FROM owner_goal_recruits r JOIN owner_recruit_requests q ON q.id=r.request_id WHERE r.goal_id=? AND r.goal_revision=? AND q.state='APPROVED' ORDER BY q.created_at DESC LIMIT 1").get(goal.id,goal.specificationRevision)?.person_id;
    people.sort((a, b) => Number(b.qianji_id===approved)-Number(a.qianji_id===approved) || score(b.qianji_id) - score(a.qianji_id) || a.world_id.localeCompare(b.world_id));
    const world = people[0]!, id = `step_${randomUUID()}`;
    this.gate.store.transaction(() => {
      this.gate.assertOn();
      db.prepare("INSERT INTO owner_goal_steps VALUES(?,?,?,?,'QUEUED',0,?)").run(id, goal.id, goal.specificationRevision, id, Date.now());
      db.prepare("INSERT INTO owner_goal_dispatches VALUES(?,?,?,NULL,NULL,?,'QUEUED',NULL)").run(id, goal.id, goal.specificationRevision, world.world_id);
      db.prepare('UPDATE owner_goals SET last_scheduled_at=? WHERE id=?').run(Date.now(), goal.id);
    });
    await this.dispatch(goal, id, world.world_id);
  }
  private finish(id: string) {
    const d=this.gate.store.db.prepare('SELECT d.world_id,t.turn_id FROM owner_goal_dispatches d LEFT JOIN owner_work_tasks t ON t.id=d.task_id WHERE d.id=?').get(id);
    const runtime=d?this.manager.peek(String(d.world_id)):undefined;
    if(runtime&&!runtime.run.getStatus().running&&d?.turn_id)runtime.store.db.prepare("UPDATE messages SET status='ABANDONED' WHERE status IN ('QUEUED','WAITING_PIXEL_BUDGET','WAITING_RUN_BUDGET','WAITING_EXECUTION_BUDGET') AND message_id IN (SELECT message_id FROM world_chat_inbox WHERE turn_id=? UNION SELECT message_id FROM world_chat_continuations WHERE turn_id=?)").run(d.turn_id,d.turn_id);
    this.gate.store.db.prepare("UPDATE owner_goal_dispatches SET state='FINISHED' WHERE id=?").run(id); this.gate.store.db.prepare("UPDATE owner_goal_steps SET state='FINISHED' WHERE id=?").run(id);
  }
  private async dispatch(goal: OwnerGoal, id: string, worldId: string) {
    if (!['READY', 'RUNNING'].includes(goal.status)) return;
    const world = this.gate.store.world(worldId);
    const acceptance = goal.acceptance.kind === 'artifact' ? `Use save_artifact to produce ${goal.acceptance.filename}, at least ${goal.acceptance.minBytes} UTF-8 bytes. This accepts the existence and hash of a draft, not its business quality.` : `Acceptance requires human verification: ${goal.acceptance.kind==='manual'?goal.acceptance.description:'confirmed invoice receipts'}. Use save_artifact to retain a source-backed internal draft with source references, then report what needs human verification.`;
    const instruction = `Goal: ${goal.title}\nObjective: ${goal.objective}\n${acceptance}\nRead relevant existing Skills when useful. Only internal analysis and drafts are authorized. External publication, spending beyond limits, credentials, release rollback/deletion require separate Owner approval. Report actual evidence and blockers via OWNER_REPLY. Do not claim commercial success without source evidence.`;
    try {
      await this.work.dispatch([{ personId: world.qianji_id, instruction: instruction.slice(0, 2000) }], id, 1, { goalId: goal.id, specificationRevision: goal.specificationRevision, dispatchId: id });
      const current=this.gate.goals.get(goal.id);if(current.specificationRevision!==goal.specificationRevision||!['READY','RUNNING'].includes(current.status))return;
      this.gate.goals.state(goal.id, 'RUNNING');
      this.gate.store.db.prepare("UPDATE owner_goal_dispatches SET state='RUNNING' WHERE id=?").run(id);
      this.gate.goals.event(goal.id, 'dispatched', { dispatchId: id, worldId });
    } catch (e) { if (this.gate.isOn()) { this.gate.goals.state(goal.id, 'BLOCKED', (e as Error).message); this.finish(id); } }
  }
}
