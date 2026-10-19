import {afterEach, describe, expect, it} from 'vitest';
import {createHash} from 'node:crypto';
import {createServer} from '../src/app.js';
import {goalFixture} from './fixtures/owner_goals.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plan = {summary:'Retain an internal draft', nodes:[{key:'draft', title:'Draft', instruction:'Keep the actual facts', dependsOn:[], trigger:{kind:'once'}, filename:'result.md'}]};

function fixture() {
  const f = goalFixture(); cleanups.push(f.close);
  f.work.enableWorkers({MCL_API_KEY:'isolated-fixture', MCL_BASE_URL:'http://127.0.0.1:1/v1'}, f.payments);
  f.on(); return f;
}
function failedTask(f: ReturnType<typeof fixture>) {
  const goal=f.goal('Internal draft','manual'), id=crypto.randomUUID(), taskId=crypto.randomUUID(), db=f.control.db;
  f.gate.proposals.plans.install(goal.id,plan,true);
  f.gate.proposals.plans.claim(goal.id,'draft',id);
  db.prepare("INSERT INTO owner_goal_steps VALUES(?,?,?,?,'RUNNING',0,?)").run(id,goal.id,goal.specificationRevision,id,Date.now());
  db.prepare("INSERT INTO owner_work_tasks VALUES(?,?,?,?,?,'QUEUED',NULL,NULL,NULL,NULL,?,?)").run(taskId,id,f.a.qianji_id,'Research','Original approved instruction',Date.now(),Date.now());
  db.prepare("INSERT INTO owner_goal_dispatches VALUES(?,?,?, ?,NULL,?,'RUNNING',NULL)").run(id,goal.id,goal.specificationRevision,taskId,f.work.agents!.scopeId(f.a.qianji_id));
  const command=f.work.execution.claim(taskId,f.work.agents!.scopeId(f.a.qianji_id),1,1,{goalId:goal.id,specificationRevision:1,dispatchId:id},{prepare:()=>{}});
  f.work.execution.observe(command.runId,'failed','MODEL_RESPONSE_INVALID');
  db.prepare("UPDATE owner_task_occurrences SET state='BLOCKED' WHERE dispatch_id=?").run(id);
  db.prepare("UPDATE owner_task_nodes SET state='BLOCKED',next_at=NULL WHERE goal_id=?").run(goal.id);
  f.gate.goals.state(goal.id,'BLOCKED','MODEL_RESPONSE_INVALID');
  return {goal:f.gate.goals.get(goal.id),taskId,command};
}

describe('stage recovery through real owner routes',()=>{
  it('requires review for an unlaunched historical attempt and gives its explicitly resumed work a bounded scope',async()=>{
    const f=fixture(),{goal,taskId,command}=failedTask(f),db=f.control.db,plans=f.gate.proposals.plans;
    db.exec('DELETE FROM company_progress_gaps; DELETE FROM company_progress_scopes;');
    // Match a migrated snapshot: the old Core run has ended, while its outcome remains unknown.
    db.prepare("UPDATE owner_run_permits SET state='FINISHED' WHERE run_id=?").run(command.runId);
    db.prepare("UPDATE owner_round_permits SET state='RELEASED' WHERE run_id=? AND state='RESERVED'").run(command.runId);
    db.prepare("UPDATE company_execution_attempts SET state='BLOCKED',reason='CALL_OUTCOME_UNKNOWN' WHERE id=?").run(command.attemptId);
    db.prepare("UPDATE owner_work_tasks SET state='BLOCKED',reason='CALL_OUTCOME_UNKNOWN' WHERE id=?").run(taskId);
    f.gate.goals.state(goal.id,'BLOCKED','CALL_OUTCOME_UNKNOWN');f.off();
    const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
    const facts=(await app.inject(`/api/owner/goals/${goal.id}/nodes/draft/actions`)).json();
    expect(facts.scope).toBeNull();expect(facts.actions).not.toContain('CONTINUE_NODE');expect(facts.actions).not.toContain('EXTEND_LIMITS');
    expect(()=>f.gate.goals.action(goal.id,{action:'reopen',expectedRevision:goal.revision,idempotencyKey:'unreviewed-history-reopen'})).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');
    const review=f.work.recovery!.view().attempts.find(a=>a.id===command.attemptId)!;
    const response=await app.inject({method:'POST',url:`/api/owner/execution-recovery/${review.id}/abandon`,payload:{hash:review.hash,reason:'Owner reviewed and releases only this historical unknown execution',idempotencyKey:'review-historical-once'}});
    expect(response.statusCode,response.body).toBe(200);expect(f.gate.view().desiredMode).toBe('OFF');
    expect(plans.get(goal.id)!.nodes[0]).toMatchObject({state:'RUNNING',occurrences:0});
    const dispatch=db.prepare('SELECT id FROM owner_goal_dispatches WHERE task_id=?').get(taskId)!;
    f.on();const fresh=f.work.worker!.create(taskId,f.work.agents!.scopeId(f.a.qianji_id),1,{goalId:goal.id,specificationRevision:1,dispatchId:String(dispatch.id)});
    const spec=JSON.parse(String(db.prepare('SELECT spec_json FROM company_worker_launches WHERE attempt_id=?').get(fresh.attemptId)!.spec_json));
    expect(spec.progress).toMatchObject({schema:1});expect(plans.progress.forDispatch(String(dispatch.id))).toMatchObject({maxModelCalls:60,maxToolCalls:120,modelCalls:0});
    expect(f.work.execution.get(command.attemptId).state).toBe('BLOCKED');expect(f.calls).toHaveLength(0);
  });
  it('routes retry and stop without accepting unrelated request fields',async()=>{
    const f=fixture(), first=failedTask(f), app=await createServer({workspaceRoot:f.root,worlds:f.worlds}); cleanups.push(()=>app.close());
    const body={action:'RETRY_TASK',expectedRevision:first.goal.revision,idempotencyKey:crypto.randomUUID(),reason:'The owner requests another bounded attempt'};
    const invalid=await app.inject({method:'POST',url:`/api/owner/tasks/${first.taskId}/actions`,payload:{...body,unsafe:true}});
    expect(invalid.statusCode).toBe(400);
    const response=await app.inject({method:'POST',url:`/api/owner/tasks/${first.taskId}/actions`,payload:body});
    expect(response.statusCode,response.body).toBe(200);
    expect((await app.inject({method:'POST',url:`/api/owner/tasks/${first.taskId}/actions`,payload:body})).json()).toEqual(response.json());
    const stopped=await app.inject({method:'POST',url:`/api/owner/tasks/${first.taskId}/actions`,payload:{action:'STOP_TASK',expectedRevision:f.gate.goals.get(first.goal.id).revision,idempotencyKey:crypto.randomUUID(),reason:'The owner stops only this task'}});
    expect(stopped.statusCode,stopped.body).toBe(200);
    expect(f.gate.view().desiredMode).toBe('ON'); expect(f.calls).toHaveLength(0);
  });
  it('makes rework instructions part of the next execution and binds the complete idempotent request',async()=>{
    const f=fixture(), {goal,taskId,command}=failedTask(f), app=await createServer({workspaceRoot:f.root,worlds:f.worlds}); cleanups.push(()=>app.close());
    const body={action:'REWORK_TASK',expectedRevision:goal.revision,idempotencyKey:crypto.randomUUID(),reason:'Owner requests a corrected draft',instructions:'Use the revised source and retain the missing limitations.'};
    const response=await app.inject({method:'POST',url:`/api/owner/tasks/${taskId}/actions`,payload:body});
    expect(response.statusCode,response.body).toBe(200);
    expect(f.work.view().tasks.find(t=>t.id===taskId)!.instruction).toContain(body.instructions);
    expect(JSON.parse(String(f.control.db.prepare('SELECT command_json FROM company_dispatch_outbox WHERE attempt_id=?').get(command.attemptId)!.command_json)).instruction).toBe('Original approved instruction');
    const changed=await app.inject({method:'POST',url:`/api/owner/tasks/${taskId}/actions`,payload:{...body,instructions:'Different instructions must not reuse the previous key.'}});
    expect(changed.statusCode).toBe(409);
  });
  it('creates a reviewable revised plan after plan rework without starting a worker',async()=>{
    const f=fixture(), goal=f.goal('A draft requiring clearer scope','manual'), plans=f.gate.proposals.plans;
    const view=plans.install(goal.id,plan,false), p=f.gate.proposals.propose('task_plan',{title:goal.title,plan,planHash:hash(view)},'original-proposal',goal.id);
    f.gate.proposals.decide(p.id,{decision:'rework',hash:p.hash,idempotencyKey:'rework-plan-once',reworkNote:'Include the missing limitations in the internal draft.'});
    const next=f.gate.proposals.list().find(v=>v.id!==p.id&&v.kind==='task_plan');
    expect(next?.state).toBe('PENDING'); expect(next?.payload.plan.ownerInstructions).toContain('missing limitations');
    expect(plans.get(goal.id)?.approved).toBe(false); expect(f.work.view().tasks).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  });
  it('versions ordinary requirements, keeps the original task, and adds a finite allowance only once while OFF',async()=>{
    const f=fixture(),{goal}=failedTask(f),app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());f.off();
    const path=`/api/owner/goals/${goal.id}/nodes/draft/actions`,original=f.gate.proposals.plans.get(goal.id)!;
    let facts=(await app.inject(path)).json();
    const change=await app.inject({method:'POST',url:path,payload:{action:'ADJUST_REQUIREMENTS',expectedRevision:facts.expectedRevision,planRevision:facts.planRevision,hash:facts.hash,idempotencyKey:'ordinary-policy-version',reason:'The owner changes only the draft checklist',progressPolicy:{requirements:[{id:'fact',description:'Actual text',contains:'ACTUAL_FACT'}],passPercent:80,allowIncompleteFrom:[]}}});
    expect(change.statusCode,change.body).toBe(200);facts=change.json();
    expect(f.gate.goals.get(goal.id).specificationRevision).toBe(1);expect(facts.planRevision).toBe(original.planRevision+1);
    const body={action:'EXTEND_LIMITS',expectedRevision:facts.expectedRevision,planRevision:facts.planRevision,hash:facts.hash,idempotencyKey:'finite-allowance-once',reason:'The owner adds a bounded extra opportunity',limits:{modelCalls:2,minutes:1}};
    const first=await app.inject({method:'POST',url:path,payload:body}),again=await app.inject({method:'POST',url:path,payload:body});
    expect(first.statusCode,first.body).toBe(200);expect(again.json()).toEqual(first.json());
    expect(first.json().scope.maxModelCalls).toBe(62);
    expect((await app.inject({method:'POST',url:path,payload:{...body,limits:{modelCalls:3}}})).statusCode).toBe(409);
    expect(f.gate.view().desiredMode).toBe('OFF');expect(f.calls).toHaveLength(0);
  });
  it('records an ordinary skip without completing its failed attempt or creating evidence',async()=>{
    const f=fixture(),{goal,command}=failedTask(f),plans=f.gate.proposals.plans;
    plans.adjustPolicy(goal.id,'draft',{requirements:[{id:'fact',description:'Actual text',contains:'ACTUAL_FACT'}],passPercent:80,allowIncompleteFrom:[]});
    const facts=f.work.attention!.nodeActions(goal.id,'draft');
    f.work.attention!.nodeAction(goal.id,'draft',{action:'SKIP_NODE',expectedRevision:facts.expectedRevision,planRevision:facts.planRevision,hash:facts.hash,idempotencyKey:'skip-ordinary-once',reason:'The owner explicitly skips this ordinary draft'});
    expect(plans.get(goal.id)!.nodes[0]!.state).toBe('SKIPPED');expect(plans.get(goal.id)!.nodes[0]!.occurrences).toBe(0);
    expect(f.work.execution.get(command.attemptId).state).toBe('FAILED');expect(f.gate.goals.detail(goal.id).evidence).toHaveLength(0);
    const close=f.gate.proposals.list().find(p=>p.kind==='close_task'&&p.state==='PENDING')!;
    expect(close.payload.completionKind).toBe('partial');
    f.gate.proposals.decide(close.id,{decision:'approve',hash:close.hash,idempotencyKey:'accept-skipped-partial'});
    expect(f.gate.goals.get(goal.id)).toMatchObject({status:'PARTIALLY_COMPLETED',verifiedCount:0});
  });
});
