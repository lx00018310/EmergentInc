import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { listenTestHttp } from '../../../tests/http_port.js';
import { goalFixture } from './fixtures/owner_goals.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});

async function workerFixture(reply?:(body:any,req:IncomingMessage,res:ServerResponse)=>unknown){
  const f=goalFixture();cleanups.push(f.close);const requests:any[]=[];
  const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const data=JSON.parse(body);requests.push(data);if(reply)return void reply(data,req,res);
    const instruction=JSON.parse(data.messages[1].content).instruction as string;
    const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({operations:[{tool:'save_artifact',args:{filename,content:'Verified draft for the owner review.'}}],owner_reply:'done',send_to:'STOP'})}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));
  });});
  const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  f.work.enableWorkers({MCL_API_KEY:'v35-rework-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'2000'},f.payments);
  f.on();vi.spyOn(f.manager,'open').mockImplementation(()=>{throw new Error('LEGACY_CORE_MUST_NOT_OPEN');});
  const settle=async()=>{await vi.waitFor(async()=>{await f.scheduler.tick();if(f.work.worker!.snapshots().some(a=>f.work.worker!.isRunning(String(a.id))))throw new Error('Worker running');if(f.work.view().tasks.some(t=>t.state==='QUEUED'&&t.runId===null))throw new Error('Dispatch pending');},{timeout:12000,interval:20});};
  return {...f,requests,settle};
}

describe('V35 three-decision proposals (approve / reject / rework)',()=>{
  it('reworks a close_task proposal: note recorded, proposal closes, goal keeps working for a fresh submission',async()=>{
    const f=await workerFixture();
    const goal=f.goal('Rework close research','manual');
    f.gate.proposals.plans.install(goal.id,{summary:'One verified deliverable',nodes:[{key:'deliver',title:'Deliver',instruction:'Save the real result',filename:'result.md',dependsOn:[],trigger:{kind:'once'}}]},true);
    await f.scheduler.tick();await f.settle();
    expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');
    const proposal=f.gate.proposals.list().find(p=>p.kind==='close_task'&&p.goalId===goal.id)!;
    expect(proposal.state).toBe('PENDING');
    // Rework without a real note is rejected at the input boundary.
    expect(()=>f.gate.proposals.decide(proposal.id,{decision:'rework',hash:proposal.hash,idempotencyKey:crypto.randomUUID(),reworkNote:'short'})).toThrow('OWNER_PROPOSAL_INVALID');
    const decided=f.gate.proposals.decide(proposal.id,{decision:'rework',hash:proposal.hash,idempotencyKey:crypto.randomUUID(),reworkNote:'Keep the structure but replace the second section with verified pricing sources'});
    expect(decided.state).toBe('REJECTED');
    expect((decided.result as any)).toMatchObject({rework:true});
    const event=f.control.db.prepare("SELECT payload FROM owner_goal_events WHERE goal_id=? AND kind='owner_rework' ORDER BY id DESC LIMIT 1").get(goal.id)!;
    expect(JSON.parse(String(event.payload))).toMatchObject({proposalId:proposal.id,note:'Keep the structure but replace the second section with verified pricing sources'});
    // The goal stays alive for a fresh close submission instead of being locked.
    expect(['RUNNING','READY','WAITING_APPROVAL']).toContain(f.gate.goals.get(goal.id).status);
    // The decided proposal can never flip back to PENDING through its original key.
    expect(f.gate.proposals.closeProposal(goal.id)?.state).toBe('REJECTED');
  },20000);

  it('rejects a task_plan so the goal finds another way; rework records instructions and keeps the goal open',async()=>{
    const f=goalFixture();cleanups.push(f.close);
    const goal=f.goal('Plan reject research','manual');
    const plan={summary:'Rejected plan path',nodes:[{key:'work',title:'Work',instruction:'Produce the retained result',dependsOn:[],trigger:{kind:'once'},filename:'result.md'}]};
    f.gate.proposals.plans.install(goal.id,plan,false);
    const view=f.gate.proposals.plans.get(goal.id)!;
    const proposal=f.gate.proposals.propose('task_plan',{title:goal.title,planHash:JSON.stringify(view),plan},`v35-test-plan:${goal.id}`,goal.id);
    expect(proposal.state).toBe('PENDING');
    const rejected=f.gate.proposals.decide(proposal.id,{decision:'reject',hash:proposal.hash,idempotencyKey:crypto.randomUUID()});
    expect(rejected.state).toBe('REJECTED');
    // One proposal can be decided exactly once: rework on a decided proposal conflicts.
    expect(()=>f.gate.proposals.decide(proposal.id,{decision:'rework',hash:proposal.hash,idempotencyKey:crypto.randomUUID(),reworkNote:'Narrow the plan to one verified deliverable first'})).toThrow('OWNER_PROPOSAL_ALREADY_DECIDED');
  });

  it('reworks a pending task_plan by recording the instructions without executing the plan',async()=>{
    const f=goalFixture();cleanups.push(f.close);
    const goal=f.goal('Plan rework research','manual');
    const plan={summary:'Rework plan path',nodes:[{key:'work',title:'Work',instruction:'Produce the retained result',dependsOn:[],trigger:{kind:'once'},filename:'result.md'}]};
    f.gate.proposals.plans.install(goal.id,plan,false);
    const view=f.gate.proposals.plans.get(goal.id)!;
    const proposal=f.gate.proposals.propose('task_plan',{title:goal.title,planHash:JSON.stringify(view),plan},`v35-test-rework:${goal.id}`,goal.id);
    const reworked=f.gate.proposals.decide(proposal.id,{decision:'rework',hash:proposal.hash,idempotencyKey:crypto.randomUUID(),reworkNote:'Narrow the plan to one verified deliverable first'});
    expect(reworked.state).toBe('REJECTED');
    expect((reworked.result as any)).toMatchObject({rework:true,note:'Narrow the plan to one verified deliverable first'});
    const event=f.control.db.prepare("SELECT payload FROM owner_goal_events WHERE goal_id=? AND kind='owner_rework' ORDER BY id DESC LIMIT 1").get(goal.id)!;
    expect(JSON.parse(String(event.payload))).toMatchObject({note:'Narrow the plan to one verified deliverable first'});
    // The plan stays unapproved: the agent must submit a fresh proposal.
    expect(f.gate.proposals.plans.get(goal.id)!.approved).toBe(false);
  });
});
