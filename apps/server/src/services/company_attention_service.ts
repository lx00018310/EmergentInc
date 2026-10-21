import type { OwnerAutomationGate } from './owner_automation_gate.js';
import type { OwnerWorkService } from './owner_work_service.js';
import type { CompanyWorkerAdapter } from './company_worker_adapter.js';
import { exactKeys, ownerConflict, ownerInput } from './owner_goal_service.js';
import {companyFactHash as companyPlanHash} from './company_fact_hash.js';

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
    const stoppable = !['REPLIED'].includes(String(task.state)) && !alreadyStopped && Boolean(goal) && !['STOPPED', 'ARCHIVED', 'COMPLETED', 'PARTIALLY_COMPLETED'].includes(goal?.status ?? '');
    const actions: string[] = [];
    if (stoppable) actions.push('STOP_TASK');
    const unknown=attempt&&['CALL_OUTCOME_UNKNOWN','TOOL_OUTCOME_UNKNOWN'].includes(attempt.reason??'');
    const reviewed=attempt&&db.prepare("SELECT 1 FROM company_execution_reviews WHERE attempt_id=? AND decision='ABANDONED'").get(attempt.id);
    const launch=attempt?db.prepare('SELECT state FROM company_worker_launches WHERE attempt_id=?').get(attempt.id):undefined;
    const exited=!attempt||!this.worker.isRunning(attempt.id)&&(!launch||['READY','EXITED'].includes(String(launch.state)));
    // A stopped task is a deliberate owner decision, not an unknown outcome: it stays
    // recoverable because the goal it belongs to must not become a dead end. A spent
    // automatic window or call allowance also only ends that automatic attempt: rework
    // carries new instructions and a fresh window, so it must stay available.
    if (attempt && terminal && exited && ['FAILED', 'BLOCKED', 'NO_REPLY'].includes(String(task.state))
      && (!unknown||reviewed)
      && goal && goal.specificationRevision===Number(dispatch?.goal_revision) && !this.gate.goals.hasPendingOutcome(goal.id,true) && !['STOPPED', 'ARCHIVED', 'COMPLETED', 'PARTIALLY_COMPLETED', 'PAUSED'].includes(goal.status)) {
      const retryBlocked=Boolean(this.gate.proposals.plans.progress.retryAllowed(String(dispatch!.id)));
      const reworkBlocked=Boolean(this.gate.proposals.plans.progress.retryAllowed(String(dispatch!.id),true));
      if(!unknown&&!alreadyStopped&&!retryBlocked)actions.push('RETRY_TASK');
      if(!reworkBlocked)actions.push('REWORK_TASK');
    }
    const hash=companyPlanHash({taskId,state:task.state,runId:task.run_id,instruction:task.instruction,attempt:attempt??null,goalRevision:goal?.revision,goalStatus:goal?.status,dispatchState:dispatch?.state});
    return { taskId, attemptId: attempt?.id ?? null, attemptState: attempt?.state ?? null, goalId: goal?.id ?? null, goalStatus: goal?.status ?? null, expectedRevision:goal?.revision??null, hash, actions };
  }
  /** Stop one task: converge its attempt, dispatch and occurrence; the goal keeps independent work. */
  stopTask(taskId: string, input: any) {
    exactKeys(input, ['expectedRevision', 'idempotencyKey', 'reason','hash']);
    ownerInput(typeof input.reason === 'string' && input.reason.trim().length >= 8 && input.reason.length <= 1000, 'OWNER_ATTENTION_INVALID');
    const request = { stopTask: taskId, input }, db = this.gate.store.db;
    return this.gate.goals.request(input.idempotencyKey, request, () => {
      const facts = this.actions(taskId);
      if(input.hash!==undefined&&input.hash!==facts.hash)ownerConflict('OWNER_PROGRESS_CHANGED');
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
        const independent = plan && this.gate.proposals.plans.hasProgress(plan,occ?String(occ.node_key):undefined);
        this.gate.goals.state(goal.id, this.gate.goals.get(goal.id).status === 'PAUSED' ? 'PAUSED' : independent ? 'READY' : 'BLOCKED', 'OWNER_TASK_STOPPED');
        this.gate.goals.event(goal.id, 'task_stopped', { taskId, reason: input.reason });
      }
      db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_task_stopped', JSON.stringify({ taskId, goalId: goal.id, reason: input.reason }), Date.now());
      return { taskId, state: 'FAILED', reason: 'OWNER_TASK_STOPPED', goalId: goal.id, goalStatus: this.gate.goals.get(goal.id).status, reservationsRetained: true };
    });
  }
  /** Retry one failed task as a fresh fenced attempt; unknown outcomes and open reviews stay blocking. */
  retryTask(taskId: string, input: any) {
    exactKeys(input, ['expectedRevision', 'idempotencyKey', 'reason','hash']);
    return this.queueRetry(taskId,input,false);
  }
  reworkTask(taskId:string,input:any) {
    exactKeys(input,['expectedRevision','idempotencyKey','reason','instructions','hash']);
    // Instructions are optional: an empty rework is still an explicit owner decision to restart
    // the task, so it must not be gated on free-form text. Normalize a missing field so the
    // idempotent request body stays identical across retries.
    if(input.instructions===undefined)input.instructions='';
    ownerInput(typeof input.instructions==='string'&&input.instructions.length<=1000,'OWNER_ATTENTION_INVALID');
    return this.queueRetry(taskId,input,true);
  }
  private queueRetry(taskId:string,input:any,rework:boolean) {
    ownerInput(typeof input.reason === 'string' && input.reason.trim().length >= 8 && input.reason.length <= 1000, 'OWNER_ATTENTION_INVALID');
    const request = { retryTask: taskId, input }, db = this.gate.store.db;
    return this.gate.goals.request(input.idempotencyKey, request, () => {
      const facts = this.actions(taskId);
      if(input.hash!==undefined&&input.hash!==facts.hash)ownerConflict('OWNER_PROGRESS_CHANGED');
      if (!facts.actions.includes(rework?'REWORK_TASK':'RETRY_TASK')) ownerConflict('OWNER_TASK_RETRY_NOT_ALLOWED');
      const task = db.prepare('SELECT * FROM owner_work_tasks WHERE id=?').get(taskId)!;
      const dispatch = db.prepare('SELECT * FROM owner_goal_dispatches WHERE task_id=?').get(taskId);
      if (!dispatch) ownerConflict('OWNER_TASK_RETRY_NOT_ALLOWED');
      const goal = this.gate.goals.get(String(dispatch.goal_id));
      if (goal.revision !== input.expectedRevision) ownerConflict();
      if (goal.specificationRevision !== Number(dispatch.goal_revision)) ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
      if (this.gate.goals.hasPendingOutcome(goal.id)) ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      // Unknown external effects must never be replayed by a retry. Rework is only offered once
      // that outcome was explicitly reviewed, so the review itself is the owner's authorization.
      const attempt = this.work.execution.forTask(taskId);
      if (!rework && attempt && ['CALL_OUTCOME_UNKNOWN', 'TOOL_OUTCOME_UNKNOWN'].includes(attempt.reason ?? '')) ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
      db.prepare("UPDATE owner_work_tasks SET state='QUEUED',run_id=NULL,turn_id=NULL,reply=NULL,reason=NULL,updated_at=? WHERE id=? AND state IN ('FAILED','BLOCKED','NO_REPLY')").run(Date.now(), taskId);
      if(input.instructions?.trim()){
        const instruction=String(task.instruction)+'\nOwner rework instructions (within the original approved scope): '+input.instructions.trim();
        ownerInput(instruction.length<=16384,'OWNER_ATTENTION_INVALID');
        db.prepare('UPDATE owner_work_tasks SET instruction=? WHERE id=?').run(instruction,taskId);
      }
      db.prepare("UPDATE owner_goal_dispatches SET state='QUEUED',reason=NULL WHERE id=?").run(String(dispatch.id));
      db.prepare("UPDATE owner_goal_steps SET state='QUEUED' WHERE id=?").run(String(dispatch.id));
      const occ = db.prepare("SELECT * FROM owner_task_occurrences WHERE dispatch_id=? AND state IN ('CANCELLED','BLOCKED','NO_PROGRESS')").get(String(dispatch.id));
      if (occ) {
        db.prepare("UPDATE owner_task_occurrences SET state='RUNNING' WHERE id=?").run(String(occ.id));
        // A stopped task left its node BLOCKED. Reset it to a schedulable WAITING state rather
        // than RUNNING: if this retry never starts, a RUNNING node would block every stage
        // action again and recreate the same dead end.
        db.prepare("UPDATE owner_task_nodes SET state='WAITING',next_at=? WHERE goal_id=? AND goal_revision=? AND node_key=?").run(Date.now(), occ.goal_id, occ.goal_revision, occ.node_key);
      }
      // The continuation inherits this exact scope; give it a full window and allowances.
      this.gate.proposals.plans.progress.resetWindow(String(dispatch.id));
      this.gate.goals.state(goal.id, 'READY');
      this.gate.goals.event(goal.id, 'task_retry_requested', { taskId, reason: input.reason });
      db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,NULL,?,?)').run('owner_task_retry_requested', JSON.stringify({ taskId, goalId: goal.id, reason: input.reason }), Date.now());
      return { taskId, state: 'QUEUED', goalId: goal.id, goalStatus: 'READY' };
    });
  }
  nodeActions(goalId:string,nodeKey:string){
    const goals=this.gate.goals,plans=this.gate.proposals.plans,goal=goals.get(goalId),plan=plans.get(goalId),node=plan?.nodes.find(n=>n.key===nodeKey);
    ownerInput(Boolean(node),'OWNER_TASK_PLAN_INVALID');
    const latest=this.gate.store.db.prepare('SELECT o.*,d.task_id FROM owner_task_occurrences o JOIN owner_goal_dispatches d ON d.id=o.dispatch_id WHERE o.goal_id=? AND o.goal_revision=? AND o.node_key=? ORDER BY o.rowid DESC LIMIT 1').get(goalId,goal.specificationRevision,nodeKey);
    const task=latest?.task_id?this.work.execution.forTask(String(latest.task_id)):undefined;
    const launch=task?this.gate.store.db.prepare('SELECT state FROM company_worker_launches WHERE attempt_id=?').get(task.id):undefined;
    const active=node!.state==='RUNNING'||Boolean(task&&(['RUNNING','DISPATCH_PENDING','SUSPENDED'].includes(task.state)||this.worker.isRunning(task.id)||launch&&!['READY','EXITED'].includes(String(launch.state))));
    const allowed=!['COMPLETED','PARTIALLY_COMPLETED','STOPPED','ARCHIVED'].includes(goal.status)&&plan!.approved;
    const actions:string[]=[];
    if(allowed&&!active){
      actions.push('SUPPLEMENT','ADJUST_REQUIREMENTS');
      if(latest&&plans.progress.forDispatch(String(latest.dispatch_id)))actions.push('EXTEND_LIMITS');
      if(node!.progressPolicy&&!['COMPLETED','SKIPPED'].includes(node!.state)&&!goals.hasPendingOutcome(goalId,true))actions.push('SKIP_NODE');
      if(['BLOCKED','DEFERRED','PARTIAL','SKIPPED'].includes(node!.state)&&!goals.hasPendingOutcome(goalId,true)&&(!latest||!plans.progress.retryAllowed(String(latest.dispatch_id))))actions.push('CONTINUE_NODE');
    }
    const view=plans.progress.view(goalId);
    const facts={goalId,nodeKey,expectedRevision:goal.revision,planRevision:plan!.planRevision,node,actions,dependencies:node!.dependsOn.map(key=>({key,title:plan!.nodes.find(n=>n.key===key)!.title})),scope:latest?view.scopes.find(s=>s.dispatchIds.includes(String(latest.dispatch_id)))??null:null,gaps:view.gaps.filter(g=>g.nodeKeys.includes(nodeKey)||node!.dependsOn.some(k=>g.nodeKeys.includes(k))),dispatchId:latest?String(latest.dispatch_id):null};
    return {...facts,hash:companyPlanHash(facts)};
  }
  nodeAction(goalId:string,nodeKey:string,input:any){
    exactKeys(input,['action','expectedRevision','planRevision','idempotencyKey','reason','hash','text','progressPolicy','limits']);
    ownerInput(typeof input.reason==='string'&&input.reason.trim().length>=8&&input.reason.length<=1000,'OWNER_PROGRESS_INVALID');
    return this.gate.goals.request(input.idempotencyKey,{nodeAction:{goalId,nodeKey,input}},()=>{
      const facts=this.nodeActions(goalId,nodeKey),plans=this.gate.proposals.plans,db=this.gate.store.db,goal=this.gate.goals.get(goalId);
      if(facts.expectedRevision!==input.expectedRevision||facts.planRevision!==input.planRevision||facts.hash!==input.hash)ownerConflict('OWNER_PROGRESS_CHANGED');
      if(!facts.actions.includes(input.action))ownerConflict('OWNER_PROGRESS_ACTION_DENIED');
      if(input.action==='SUPPLEMENT')plans.progress.supplement(goalId,nodeKey,input.text);
      else if(input.action==='EXTEND_LIMITS'){
        exactKeys(input.limits,['modelCalls','toolCalls','minutes','gapId','attempts']);
        plans.progress.extend(facts.dispatchId!,input.limits);
      }else if(input.action==='ADJUST_REQUIREMENTS'){
        const revised=plans.adjustPolicy(goalId,nodeKey,input.progressPolicy);
        if(revised.approvalRequired)this.gate.proposals.propose('task_plan',{title:goal.title,plan:revised.body,planHash:companyPlanHash(revised.view)},`policy-reapproval:${goalId}:${revised.view.planRevision}`,goalId);
      }else if(input.action==='CONTINUE_NODE'){
        if(facts.dispatchId){
          plans.progress.requestContinuation(facts.dispatchId,nodeKey);
          db.prepare("UPDATE owner_goal_dispatches SET state='FINISHED' WHERE id=?").run(facts.dispatchId);
          db.prepare("UPDATE owner_goal_steps SET state='FINISHED' WHERE id=?").run(facts.dispatchId);
        }
        db.prepare("UPDATE owner_task_nodes SET state='WAITING',next_at=? WHERE goal_id=? AND goal_revision=? AND node_key=?").run(Date.now(),goalId,goal.specificationRevision,nodeKey);
        if(goal.status!=='PAUSED')this.gate.goals.state(goalId,'READY');
        db.prepare("UPDATE owner_company_proposals SET state='EXPIRED' WHERE goal_id=? AND kind='close_task' AND state='PENDING'").run(goalId);
      }else if(input.action==='SKIP_NODE'){
        db.prepare("UPDATE owner_task_nodes SET state='SKIPPED',next_at=NULL WHERE goal_id=? AND goal_revision=? AND node_key=?").run(goalId,goal.specificationRevision,nodeKey);
        if(facts.dispatchId){
          db.prepare("UPDATE owner_goal_dispatches SET state='FINISHED' WHERE id=?").run(facts.dispatchId);
          db.prepare("UPDATE owner_goal_steps SET state='FINISHED' WHERE id=?").run(facts.dispatchId);
        }
        const plan=plans.get(goalId)!;
        if(goal.status!=='PAUSED'){
          this.gate.goals.state(goalId,plans.hasProgress(plan)?'READY':'WAITING_APPROVAL','OWNER_PROGRESS_SKIPPED');
          if(!plans.hasProgress(plan))this.gate.proposals.closeProposal(goalId);
        }
      }
      db.prepare('UPDATE owner_goals SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(),goalId);
      this.gate.goals.event(goalId,'progress_owner_action',{nodeKey,...input});
      return this.nodeActions(goalId,nodeKey);
    });
  }
}
