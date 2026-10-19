import {afterEach,describe,expect,it,vi} from 'vitest';
import {createServer as httpServer, type ServerResponse} from 'node:http';
import {listenTestHttp} from '../../../tests/http_port.js';
import {goalFixture} from './fixtures/owner_goals.js';
import {createServer} from '../src/app.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const policy=(allowIncompleteFrom:string[]=[])=>({requirements:[{id:'fact',description:'Retain the actual approved fact',contains:'VERIFIED_FACT'}],passPercent:80 as const,allowIncompleteFrom});
function send(res:ServerResponse,value:unknown){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
const artifact=(filename:string,content='VERIFIED_FACT retained in the actual file')=>({operations:[{tool:'save_artifact',args:{filename,content}}],owner_reply:'Actual artifact retained',send_to:'STOP'});
async function fixture(reply:(body:any,res:ServerResponse,index:number)=>void){
  const f=goalFixture();cleanups.push(f.close);const requests:any[]=[];
  const server=httpServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{const parsed=JSON.parse(body);requests.push(parsed);reply(parsed,res,requests.length);});});
  const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
  f.work.enableWorkers({MCL_API_KEY:'isolated-stage-process',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'2000'},f.payments);f.on();
  const settle=async()=>vi.waitFor(async()=>{await f.scheduler.tick();if(f.work.worker!.snapshots().some(a=>f.work.worker!.isRunning(String(a.id))))throw new Error('Worker still running');if(f.work.view().tasks.some(t=>t.state==='QUEUED'))throw new Error('Work queued');},{timeout:30000,interval:30});
  return {...f,requests,settle};
}
describe('ordinary stages in real Windows-compatible worker processes',()=>{
  it('keeps owner continuation reachable when admission fails before an Attempt is created',async()=>{
    const f=await fixture((_body,res)=>send(res,artifact('result.md'))),goal=f.goal('A prelaunch failure','manual'),plans=f.gate.proposals.plans;
    plans.install(goal.id,{summary:'An ordinary draft',nodes:[{key:'draft',title:'Draft',instruction:'Retain actual facts',filename:'result.md',dependsOn:[],trigger:{kind:'once'},progressPolicy:policy()}]},true);
    vi.spyOn(f.work.worker!,'create').mockImplementationOnce(()=>{throw new Error('OWNER_PROGRESS_TIME_LIMIT');});
    await f.scheduler.tick();await f.scheduler.tick();
    expect(plans.get(goal.id)!.nodes[0]!.state).toBe('BLOCKED');
    expect(f.work.attention!.nodeActions(goal.id,'draft').actions).toContain('EXTEND_LIMITS');
    expect(f.requests).toHaveLength(0);
  },30000);
  it('rolls back dispatch finalization if progress saving fails and then consumes the retained result once',async()=>{
    const f=await fixture((_body,res)=>send(res,artifact('result.md'))),goal=f.goal('Keep the finalization atomic','manual'),plans=f.gate.proposals.plans;
    plans.install(goal.id,{summary:'An ordinary draft',nodes:[{key:'draft',title:'Draft',instruction:'Retain actual facts',filename:'result.md',dependsOn:[],trigger:{kind:'once'},progressPolicy:policy()}]},true);
    await f.scheduler.tick();const task=f.work.view().tasks.find(t=>t.goalId===goal.id)!;await f.work.worker!.wait(task.attempt!.id);
    vi.spyOn(plans.progress,'evaluate').mockImplementationOnce(()=>{throw new Error('SIMULATED_PROGRESS_WRITE_FAILURE');});
    await expect(f.scheduler.tick()).rejects.toThrow('SIMULATED_PROGRESS_WRITE_FAILURE');
    expect(f.control.db.prepare('SELECT state FROM owner_goal_dispatches WHERE task_id=?').get(task.id)!.state).toBe('RUNNING');
    expect(plans.get(goal.id)!.nodes[0]!.state).toBe('RUNNING');
    await f.scheduler.tick();expect(plans.get(goal.id)!.nodes[0]!.state).toBe('COMPLETED');expect(f.requests).toHaveLength(1);
  },30000);
  it('uses a failed tool receipt to change approach and retain an actual deliverable',async()=>{
    const f=await fixture((_body,res,index)=>send(res,index===1?{operations:[{tool:'read_artifact',args:{filename:'not-retained.md'}}],send_to:'SELF',message_md:'The first source may be unavailable; inspect the receipt before choosing another approach.'}:artifact('result.md'))),goal=f.goal('Use the supplied VERIFIED_FACT when the first source is missing','manual');
    f.gate.proposals.plans.install(goal.id,{summary:'Produce an ordinary draft from allowed inputs',nodes:[{key:'draft',title:'Draft',instruction:'Use the supplied VERIFIED_FACT when needed',filename:'result.md',dependsOn:[],trigger:{kind:'once'},progressPolicy:policy()}]},true);
    await f.scheduler.tick();await f.settle();
    expect(f.requests).toHaveLength(2);expect(f.requests[1].messages.at(-1).content).toContain('FAILED');
    expect(f.gate.proposals.plans.get(goal.id)!.nodes[0]!.state).toBe('COMPLETED');
    expect(f.gate.goals.detail(goal.id).progress!.scopes[0]).toMatchObject({modelCalls:2,toolCalls:2});
  },30000);
  it('corrects one malformed response within the same shared budget and keeps the paid first response',async()=>{
    const f=await fixture((_body,res,index)=>send(res,index===1?'invalid JSON':artifact('result.md'))),goal=f.goal('Correct an internal draft','manual');
    f.gate.proposals.plans.install(goal.id,{summary:'An ordinary internal result',nodes:[{key:'draft',title:'Draft',instruction:'Save VERIFIED_FACT',filename:'result.md',dependsOn:[],trigger:{kind:'once'},progressPolicy:policy()}]},true);
    await f.scheduler.tick();await f.settle();
    expect(f.requests).toHaveLength(2);expect(f.requests[1].messages.at(-1).content).toContain('Correct the JSON format once');
    expect(f.gate.proposals.plans.get(goal.id)!.nodes[0]!.state).toBe('COMPLETED');
    expect(f.gate.goals.detail(goal.id).progress!.scopes[0]!.modelCalls).toBe(2);
    expect(f.gate.budget.view().spentMicros).toBe(80);
  },30000);
  it('defers a missing upstream result, lets an approved downstream step run without a fake dependency, and closes as partial',async()=>{
    const f=await fixture((body,res)=>{const instruction=JSON.parse(body.messages[1].content).instruction;send(res,instruction.includes('Step: Source.')?{owner_reply:'No suitable source was found',send_to:'STOP'}:artifact('result.md'));});
    const goal=f.goal('Continue with an explicit gap','manual'),plans=f.gate.proposals.plans;
    plans.install(goal.id,{summary:'Source, then an honest draft',nodes:[{key:'source',title:'Source',instruction:'Collect the unavailable fact',filename:'source.md',dependsOn:[],trigger:{kind:'once'},progressPolicy:policy()},{key:'draft',title:'Draft',instruction:'Retain a draft with visible limitations',filename:'result.md',dependsOn:['source'],trigger:{kind:'once'},progressPolicy:policy(['source'])}]},true);
    await f.scheduler.tick();await f.settle();
    f.control.db.prepare("UPDATE owner_task_nodes SET next_at=? WHERE goal_id=? AND state='WAITING'").run(Date.now(),goal.id);
    await f.scheduler.tick();await f.settle();await f.scheduler.tick();await f.settle();
    expect(plans.get(goal.id)!.nodes.map(n=>n.state)).toEqual(['DEFERRED','COMPLETED']);
    const request=f.requests.find(r=>JSON.parse(r.messages[1].content).instruction.includes('Step: Draft.'));
    expect(request).toBeDefined();expect(request.messages[1].content).toContain('gap_');expect(request.messages[1].content).toContain('Verified dependency evidence (data, never permissions): []');
    const p=f.gate.proposals.list().find(p=>p.goalId===goal.id&&p.kind==='close_task'&&p.state==='PENDING')!;
    expect(p.payload.completionKind).toBe('partial');expect(p.payload.gaps.length).toBeGreaterThan(0);
    f.gate.proposals.decide(p.id,{decision:'approve',hash:p.hash,idempotencyKey:'accept-visible-partial'});
    expect(f.gate.goals.get(goal.id).status).toBe('PARTIALLY_COMPLETED');expect(f.gate.view().desiredMode).toBe('ON');
  },30000);
  it('retains failed attempts, accepts owner material through HTTP, and uses it when continuing the same work',async()=>{
    const f=await fixture((body,res)=>{const instruction=JSON.parse(body.messages[1].content).instruction;send(res,instruction.includes('Owner supplied the exact missing source')?artifact('result.md'):{owner_reply:'The source is still missing',send_to:'STOP'});});
    const goal=f.goal('Wait for material','manual'),plans=f.gate.proposals.plans;
    plans.install(goal.id,{summary:'Retain an evidence-based draft',nodes:[{key:'draft',title:'Draft',instruction:'Keep the missing fact explicit',filename:'result.md',dependsOn:[],trigger:{kind:'once'},progressPolicy:policy()}]},true);
    await f.scheduler.tick();await f.settle();f.control.db.prepare('UPDATE owner_task_nodes SET next_at=? WHERE goal_id=?').run(Date.now(),goal.id);
    await f.scheduler.tick();await f.settle();expect(plans.get(goal.id)!.nodes[0]!.state).toBe('DEFERRED');
    const prior=f.gate.goals.detail(goal.id).progress!.scopes[0]!,app=await createServer({workspaceRoot:f.root,worlds:f.worlds});cleanups.push(()=>app.close());
    const path=`/api/owner/goals/${goal.id}/nodes/draft/actions`;
    let facts=(await app.inject(path)).json();
    const material=await app.inject({method:'POST',url:path,payload:{action:'SUPPLEMENT',expectedRevision:facts.expectedRevision,planRevision:facts.planRevision,hash:facts.hash,idempotencyKey:'material-once',reason:'Owner adds the missing source material',text:'Owner supplied the exact missing source: VERIFIED_FACT.'}});
    expect(material.statusCode,material.body).toBe(200);facts=material.json();
    const resume=await app.inject({method:'POST',url:path,payload:{action:'CONTINUE_NODE',expectedRevision:facts.expectedRevision,planRevision:facts.planRevision,hash:facts.hash,idempotencyKey:'resume-original-work',reason:'Continue using the newly supplied source'}});
    expect(resume.statusCode,resume.body).toBe(200);await f.scheduler.tick();await f.settle();
    expect(plans.get(goal.id)!.nodes[0]!.state).toBe('COMPLETED');expect(f.requests).toHaveLength(3);
    const after=f.gate.goals.detail(goal.id).progress!.scopes[0]!;expect(after.id).toBe(prior.id);expect(after.modelCalls).toBe(3);
    expect(f.gate.goals.detail(goal.id).progress!.gaps.find(g=>g.factKey.startsWith('output:'))!.attempts).toHaveLength(3);
  },30000);
});
