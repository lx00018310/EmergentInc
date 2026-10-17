import type { OwnerAutomationGate } from './owner_automation_gate.js';
import type { OwnerWorkService } from './owner_work_service.js';
import type { CompanyWorkerAdapter } from './company_worker_adapter.js';
import { exactKeys, ownerConflict, ownerInput } from './owner_goal_service.js';

/**
 * Thin owner command router for one attention item. Every action re-derives its target from
 * authoritative tables and routes to the existing domain service; nothing here rewrites
 * business state directly beyond the converged task/dispatch/occurrence bookkeeping that
 * the company scheduler itself performs on the same facts.
 */
export class CompanyAttentionService {
  constructor(readonly gate: OwnerAutomationGate, readonly work: OwnerWorkService, readonly worker: CompanyWorkerAdapter) {}
  /** Current server-computed actions for one task. The UI may not grant itself anything. */
  actions(taskId: string) {
    const db = this.gate.store.db, task = db.prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(taskId);
    if (!task) ownerConflict('OWNER_TASK_NOT_FOUND');
    const attempt = this.work.execution.forTask(taskId);
    const dispatch = db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(taskId);
    const goal = dispatch ? this.gate.goals.get(String(dispatch.goal_id)) : null;
    const terminal = attempt ? ['COMPLETED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(attempt.state) : true;
    const alreadyStopped = String(task.state) === 'FAILED' && String(task.reason) === 'OWNER_TASK_STOPPED';
    const stoppable = !['COMPLETED'].includes(String(task.state)) && !alreadyStopped && !['STOPPED', 'ARCHIVED', 'COMPLETED'].includes(goal?.status ?? '');
    const actions: string[] = [];
    if (stoppable) actions.push('STOP_TASK');
    // A failed/blocked task with a terminal attempt may retry once the review obligations are met.
    if (attempt && terminal && ['FAILED', 'BLOCKED', 'NO_REPLY'].includes(String(task.state)) && String(task.reason) !== 'OWNER_TASK_STOPPED' && !['CALL_OUTCOME_UNKNOWN', 'TOOL_OUTCOME_UNKNOWN'].includes(attempt.reason ?? '')
      && goal && !['STOPPED', 'ARCHIVED', 'COMPLETED', 'PAUSED'].includes(goal.status)) actions.push('RETRY_TASK');
    return { taskId, attemptId: attempt?.id ?? null, attemptState: attempt?.state ?? null, goalId: goal?.id ?? null, goalStatus: goal?.status ?? null, actions };
  }
  /** Stop one task: converge its attempt, dispatch and occurrence; the goal keeps independent work. */
  stopTask(taskId: string, input: any) {
    exactKeys(input, ['expectedRevision', 'idempotencyKey', 'reason']);
    ownerInput(typeof input.reason === 'string' && input.reason.trim().length >= 8 && input.reason.length <= 1000, 'OWNER_ATTENTION_INVALID');
    const request = { stopTask: taskId, revision: input.expectedRevision }, db = this.gate.store.db;
    return this.gate.goals.request(input.idempotencyKey, request, () => {
      const facts = this.actions(taskId);
      const task = db.prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(taskId)!;
      if (facts.actions.includes('STOP_TASK') === false) ownerConflict('OWNER_TASK_TRANSITION_INVALID');
      const dispatch = db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(taskId);
      const goal = dispatch ? this.gate.goals.get(String(dispatch.goal_id)) : null;
      if (!goal || goal.revision !== input.expectedRevision) ownerConflict();
      if (['STOPPED', 'ARCHIVED', 'COMPLETED'].includes(goal.status)) ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
      // Stop running work only after the adapter proves the process exited or was disconnected.
      const attempt = this.work.execution.forTask(taskId);
      if (attempt && !['COMPLETED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(attempt.state)) {
        if (this.worker.isRunning(attempt.id)) this.worker.disconnect(attempt.id);
      }
      this.work.execution.observe(String(attempt?.runId ?? task.run_id), 'interrupted', 'OWNER_TASK_STOPPED');
      db.prepare("UPDATE owner_work_tasks SET state='FAILED',reply=CASE WHEN state='FAILED' THEN reply ELSE NULL END,reason='OWNER_TASK_STOPPED',updated_at=? WHERE id=? AND state NOT IN ('REPLIED')").run(Date.now(), taskId);
      if (dispatch) {
        db.prepare("UPDATE owner_goal_dispatches SET state='FINISHED',reason='OWNER_TASK_STOPPED' WHERE id=?").run(String(dispatch.id));
        db.prepare("UPDATE owner_goal_steps SET state='FINISHED' WHERE id=?").run(String(dispatch.id));
        const occ = db.prepare("SELECT * FROM owner_task_occurrences WHERE dispatch_id=? AND state='RUNNING'").get(String(dispatch.id));
        if (occ) {
          db.prepare("UPDATE owner_task_occurrences SET state='CANCELLED' WHERE id=?").run(String(occ.id));
          db.prepare("UPDATE owner_task_nodes SET state='BLOCKED',next_at=NULL WHERE goal_id=? AND goal_revision=? AND node_key=? AND state='RUNNING'").run(goal.id, goal.specificationRevision, String(occ.node_key));
        }
        const plan = this.gate.proposals.plans.get(goal.id);
        const independent = plan && plan.nodes.some(n => n.key !== occ?.node_key && !['BLOCKED', 'COMPLETED', 'WAITING_RESOURCE'].includes(n.state));
        this.gate.goals.state(goal.id, this.gate.goals.get(goal.id).status === 'PAUSED' ? 'PAUSED' : independent ? 'READY' : 'BLOCKED', 'OWNER_TASK_STOPPED');
        this.gate.goals.event(goal.id, 'task_stopped', { taskId, reason: input.reason });
      }
      db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_task_stopped', JSON.stringify({ taskId, goalId: goal.id, reason: input.reason }), Date.now());
      return { taskId, state: 'FAILED', reason: 'OWNER_TASK_STOPPED', goalId: goal.id, goalStatus: this.gate.goals.get(goal.id).status, reservationsRetained: true };
    });
  }
  /** Retry one failed task as a fresh fenced attempt; unknown outcomes and open reviews stay blocking. */
  retryTask(taskId: string, input: any) {
    exactKeys(input, ['expectedRevision', 'idempotencyKey', 'reason']);
    ownerInput(typeof input.reason === 'string' && input.reason.trim().length >= 8 && input.reason.length <= 1000, 'OWNER_ATTENTION_INVALID');
    const request = { retryTask: taskId, revision: input.expectedRevision }, db = this.gate.store.db;
    return this.gate.goals.request(input.idempotencyKey, request, () => {
      const facts = this.actions(taskId);
      if (!facts.actions.includes('RETRY_TASK')) ownerConflict('OWNER_TASK_RETRY_NOT_ALLOWED');
      const task = db.prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(taskId)!;
      const dispatch = db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(taskId);
      if (!dispatch) ownerConflict('OWNER_TASK_RETRY_NOT_ALLOWED');
      const goal = this.gate.goals.get(String(dispatch.goal_id));
      if (goal.revision !== input.expectedRevision) ownerConflict();
      if (goal.specificationRevision !== Number(dispatch.goal_revision)) ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
      if (this.gate.goals.hasPendingOutcome(goal.id)) ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      // Unknown external effects must never be replayed by a retry.
      const attempt = this.work.execution.forTask(taskId);
      if (attempt && ['CALL_OUTCOME_UNKNOWN', 'TOOL_OUTCOME_UNKNOWN'].includes(attempt.reason ?? '')) ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      db.prepare("UPDATE owner_work_tasks SET state='QUEUED',run_id=NULL,turn_id=NULL,reply=NULL,reason=NULL,updated_at=? WHERE id=? AND state IN ('FAILED','BLOCKED','NO_REPLY')").run(Date.now(), taskId);
      db.prepare("UPDATE owner_goal_dispatches SET state='QUEUED',reason=NULL WHERE id=?").run(String(dispatch.id));
      db.prepare("UPDATE owner_goal_steps SET state='QUEUED' WHERE id=?").run(String(dispatch.id));
      const occ = db.prepare("SELECT * FROM owner_task_occurrences WHERE dispatch_id=? AND state IN ('CANCELLED','BLOCKED','NO_PROGRESS')").get(String(dispatch.id));
      if (occ) db.prepare("UPDATE owner_task_occurrences SET state='RUNNING' WHERE id=?").run(String(occ.id));
      this.gate.goals.state(goal.id, 'READY');
      this.gate.goals.event(goal.id, 'task_retry_requested', { taskId, reason: input.reason });
      db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_task_retry_requested', JSON.stringify({ taskId, goalId: goal.id, reason: input.reason }), Date.now());
      return { taskId, state: 'QUEUED', goalId: goal.id, goalStatus: 'READY' };
    });
  }
}
