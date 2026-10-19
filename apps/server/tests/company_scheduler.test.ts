import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { listenTestHttp } from '../../../tests/http_port.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { OwnerOverviewService } from '../src/services/owner_overview_service.js';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { CompanyExecutionService } from '../src/services/company_execution_service.js';
import { CompanyWorkerAdapter } from '../src/services/company_worker_adapter.js';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { PublicStore } from '../src/services/public_store.js';
import { OwnerProductService } from '../src/services/owner_product_service.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();vi.restoreAllMocks();});
async function fixture(reply?:(body:any,req:IncomingMessage,res:ServerResponse)=>unknown,setup?:(f:ReturnType<typeof goalFixture>)=>void){
  const f=goalFixture();cleanups.push(f.close);let calls=0;const requests:any[]=[];
  setup?.(f);
  const server=createServer((req,res)=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    const data=JSON.parse(body);calls++;requests.push(data);if(reply)return void reply(data,req,res);
    const instruction=JSON.parse(data.messages[1].content).instruction as string;
    const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)?.[1]??/Save ([\w.-]+)/.exec(instruction)?.[1]??'result.md';
    send(res,{operations:[{tool:'save_artifact',args:{filename,content:`Verified draft for ${instruction.slice(0,100)}`}}],owner_reply:'实际产物已保存 / Actual artifact retained',send_to:'STOP'});
  });});const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  f.work.enableWorkers({MCL_API_KEY:'explicit-fake-company-scheduler-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'2000'},f.payments);
  f.on();vi.spyOn(f.manager,'open').mockImplementation(()=>{throw new Error('LEGACY_CORE_MUST_NOT_OPEN');});
  const settle=async()=>{await vi.waitFor(async()=>{await f.scheduler.tick();if(f.work.worker!.snapshots().some(a=>f.work.worker!.isRunning(String(a.id))))throw new Error('Worker running');if(f.control.db.prepare("SELECT 1 FROM owner_goal_dispatches d JOIN owner_goals g ON g.id=d.goal_id WHERE d.state IN ('QUEUED','RUNNING') AND g.status IN ('READY','RUNNING')").get())throw new Error('Company advancing');},{timeout:30000,interval:20});};
  return {...f,calls:()=>calls,requests,settle};
}
function send(res:ServerResponse,value:unknown,knownUsage=true){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:typeof value==='string'?value:JSON.stringify(value)}}],...(knownUsage?{usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}:{})}));}

describe('company scheduler with real independent worker processes',()=>{
  it('blocks a dependent DAG instead of reporting ready when every remaining step depends on a failed node',async()=>{
    const f=await fixture((_body,_req,res)=>send(res,'invalid response')),goal=f.goal('Dependent research','manual');
    f.gate.proposals.plans.install(goal.id,{summary:'Dependent work',nodes:[{key:'source',title:'Source',instruction:'Retain the real source',filename:'source.md',dependsOn:[],trigger:{kind:'once'}},{key:'review',title:'Review',instruction:'Review the source',filename:'review.md',dependsOn:['source'],trigger:{kind:'once'}}]},true);
    await f.scheduler.tick();await f.settle();for(let n=0;n<3;n++)await f.scheduler.tick();
    expect(f.gate.goals.get(goal.id)).toMatchObject({status:'BLOCKED',reason:'MODEL_RESPONSE_INVALID'});expect(f.calls()).toBe(1);expect(f.gate.view().desiredMode).toBe('ON');
  },30000);
  it('continues an independent node while another waits for an approved specialist',async()=>{
    const f=await fixture((body,_req,res)=>{const {agent,instruction}=JSON.parse(body.messages[1].content);if(instruction.includes('Request specialist')&&agent.role!=='Specialist')send(res,{operations:[{tool:'REQUEST_RECRUIT',args:{role:'Specialist',reason:'The task needs specialist capacity',instruction:'Produce the retained specialist result'}}],owner_reply:'Specialist approval required',send_to:'STOP'});else {const filename=/Save the actual result as ([\w.-]+)/.exec(instruction)![1];send(res,{operations:[{tool:'save_artifact',args:{filename,content:'Actual independent or specialist result with retained evidence.'}}],owner_reply:'Actual result retained',send_to:'STOP'});}});
    const goal=f.goal('Research and marketing','manual');f.gate.proposals.plans.install(goal.id,{summary:'Independent roles',nodes:[{key:'specialist',title:'Specialist',instruction:'Request specialist if the current role cannot do this work',filename:'specialist.md',dependsOn:[],trigger:{kind:'once'},personId:f.a.qianji_id},{key:'independent',title:'Independent',instruction:'Produce the independent marketing result',filename:'independent.md',dependsOn:[],trigger:{kind:'once'},personId:f.b.qianji_id}]},true);
    await f.scheduler.tick();await f.settle();let plan=f.gate.proposals.plans.get(goal.id)!;expect(plan.nodes.map(n=>n.state)).toEqual(['WAITING_RESOURCE','COMPLETED']);expect(f.calls()).toBe(2);
    const request=f.work.view().requests[0];await f.work.decide(request.id,request.hash,'approve');await f.scheduler.tick();await f.settle();plan=f.gate.proposals.plans.get(goal.id)!;expect(plan.nodes.map(n=>n.state)).toEqual(['COMPLETED','COMPLETED']);expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.calls()).toBe(3);expect(f.control.worlds()).toHaveLength(2);
  },40000);
  it('waits for sufficient money without repeating launch attempts and continues its committed dispatch after funding',async()=>{
    const f=await fixture(),goal=f.goal();f.gate.budget.configure({tokenMillions:1,unitPrice:0.000001,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});
    const create=vi.spyOn(f.work.worker!,'create');await f.scheduler.tick();for(let n=0;n<4;n++)await f.scheduler.tick();expect(create).toHaveBeenCalledTimes(1);expect(f.calls()).toBe(0);expect(f.gate.goals.get(goal.id).status).toBe('BLOCKED');expect(f.gate.view().desiredMode).toBe('ON');
    f.gate.budget.configure({tokenMillions:1,unitPrice:1,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});await f.scheduler.tick();await f.settle();expect(f.calls()).toBe(1);expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.gate.budget.view().spentMicros).toBe(40);
  },30000);
  it('recovers a controller tool receipt lost after its commit without paying for or executing the first step twice',async()=>{
    const f=await fixture((body,_req,res)=>send(res,body.messages.length===2?{operations:[{tool:'REQUEST_RECRUIT',args:{role:'Specialist',reason:'The approved task needs a specialist review',instruction:'Retain actual review evidence'}}],send_to:'SELF'}:{owner_reply:'Actual resource request is retained for Owner approval',send_to:'STOP'}));
    const original=f.work.companyTools!.execute.bind(f.work.companyTools),execute=vi.spyOn(f.work.companyTools!,'execute');let interrupted=false;execute.mockImplementation(async(...args)=>{const value=await original(...args);if(!interrupted){interrupted=true;f.off();}return value;});
    await f.work.dispatch([{personId:f.a.qianji_id,instruction:'Request an actual specialist resource and report the result'}],'lost-controller-receipt',4);const task=f.work.view().tasks[0];await f.work.worker!.wait(task.attempt!.id);expect(f.work.execution.get(task.attempt!.id).state).toBe('SUSPENDED');expect(f.calls()).toBe(1);expect(f.work.view().requests).toHaveLength(1);
    f.on();await f.work.tick();await f.work.worker!.wait(task.attempt!.id);expect(f.work.execution.get(task.attempt!.id).state).toBe('COMPLETED');expect(execute).toHaveBeenCalledTimes(1);expect(f.work.view().requests).toHaveLength(1);expect(f.calls()).toBe(2);expect(f.gate.budget.view().spentMicros).toBe(80);expect(f.manager.open).not.toHaveBeenCalled();
  },30000);
  it('runs one overdue interval occurrence and schedules the next period without a catch-up burst',async()=>{
    const f=await fixture(),goal=f.goal('Periodic evidence review','manual');f.gate.proposals.plans.install(goal.id,{summary:'Periodic review',nodes:[{key:'review',title:'Review',instruction:'Inspect the actual evidence',filename:'review.md',dependsOn:[],trigger:{kind:'interval',everyMinutes:5}}]},true);
    await f.scheduler.tick();await f.settle();let node=f.gate.proposals.plans.get(goal.id)!.nodes[0];expect(node.occurrences).toBe(1);expect(f.calls()).toBe(1);
    const advanced=node.nextAt!+5*300000;vi.spyOn(Date,'now').mockReturnValue(advanced);await f.scheduler.tick();await f.settle();for(let n=0;n<3;n++)await f.scheduler.tick();node=f.gate.proposals.plans.get(goal.id)!.nodes[0];expect(node).toMatchObject({occurrences:2,nextAt:advanced+300000,state:'WAITING'});expect(f.calls()).toBe(2);
  },30000);
  it('blocks a node after three executions without evidence instead of running indefinitely',async()=>{
    const f=await fixture((_body,_req,res)=>send(res,{owner_reply:'A report without a retained artifact',send_to:'STOP'})),goal=f.goal('Retain evidence','manual');f.gate.proposals.plans.install(goal.id,{summary:'Require actual evidence',nodes:[{key:'deliver',title:'Deliver',instruction:'Save the actual result',filename:'result.md',dependsOn:[],trigger:{kind:'once'}}]},true);
    let now=Date.now();vi.spyOn(Date,'now').mockImplementation(()=>now);
    for(let n=0;n<3;n++){await f.scheduler.tick();await f.settle();now+=6000;}
    await f.scheduler.tick();expect(f.calls()).toBe(3);expect(f.gate.goals.get(goal.id)).toMatchObject({status:'BLOCKED',reason:'OWNER_NO_PROGRESS'});expect(f.gate.proposals.plans.get(goal.id)!.nodes[0].state).toBe('BLOCKED');
  },40000);
  it('creates an approved company agent and completes its real work without creating or opening a World',async()=>{
    const f=await fixture(),before=f.control.worlds().length;
    const request=f.work.requestRecruit({role:'Editor',reason:'An editor is required',instruction:'Produce an actual internal draft'},'Owner','company-hire');
    await f.work.decide(request.id,request.hash,'approve');await f.settle();
    const person=f.work.view().requests[0].personId!;
    expect(f.work.agents!.get(person)).toMatchObject({name:'Editor',legacyWorldId:null,status:'ACTIVE'});
    expect(f.control.worlds()).toHaveLength(before);expect(f.manager.open).not.toHaveBeenCalled();
    expect(f.work.view().tasks.find(t=>t.personId===person)).toMatchObject({state:'REPLIED',attempt:{state:'COMPLETED',accountingState:'SETTLED'}});
    expect(f.work.artifacts.forAgent(person,'result.md').content).toContain('Verified draft');
    const overview=await new OwnerOverviewService(f.worlds,f.work).overview();expect(overview.people.find(p=>p.id===person)).toMatchObject({name:'Editor',worldId:person,running:false});
    f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('new-agent-failed','failed-projection',?,'Editor','Inspect failure','FAILED',NULL,NULL,NULL,'MODEL_RESPONSE_INVALID',?,?)").run(person,Date.now()+1,Date.now()+1);
    expect((await new OwnerOverviewService(f.worlds,f.work).bossOverview()).alerts).toEqual(expect.arrayContaining([expect.objectContaining({id:'assignment:new-agent-failed',taskId:'new-agent-failed',reasonKey:'MODEL_RESPONSE_INVALID'})]));
    expect(f.calls()).toBe(1);
  },30000);
  it.each([false,true])('publishes an authorized product only with actual current-dispatch source receipts (forged=%s)',async forged=>{
    const f=await fixture((body,_req,res)=>{
      if(body.messages.length===2)send(res,{operations:[{tool:'READ_WORLD_ASSET',args:{filename:'source.md'}}],send_to:'SELF'});
      else {const receipt=JSON.parse(body.messages.at(-1).content).toolReceipts[0];expect(receipt.status).toBe('SUCCESS');send(res,{operations:[{tool:'save_artifact',args:{filename:'product.json',content:JSON.stringify({nameEn:'Document editing',nameZh:'文档编辑',descEn:'Review a supplied document and return an edited draft.',descZh:'审阅提供的文档并返回编辑草稿。',priceUsdt:'1',enabled:true,sourceOperationIds:[forged?'invented-or-other-dispatch-source':receipt.operation_id],requiresHumanReview:false})}}],owner_reply:'Actual product draft retained for authorized publication',send_to:'STOP'});}
    },base=>{const dir=join(base.registry.directory(base.a.world_id),'live/artifacts/0_0_0');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(join(dir,'source.md'),'Actual retained editing-service scope and limits.');});
    f.payments.configureRail({rail_id:'company-bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'},100);
    const store=new PublicStore(f.control,f.payments);cleanups.push(async()=>store.close());f.work.products=new OwnerProductService(store,f.gate,f.manager);
    const goal=f.goal('Research editing service and publish product','manual');f.work.products.bind(goal,'company-publish','先研究一个新服务，然后上架一个新商品，价格 1 USDT',{createNew:true},'product.json');
    await f.scheduler.tick();await f.settle();
    expect(f.control.db.prepare('SELECT state,reason FROM owner_product_intents WHERE goal_id=?').get(goal.id)).toMatchObject(forged?{state:'BLOCKED',reason:'OWNER_PRODUCT_SOURCE_REQUIRED'}:{state:'PUBLISHED',reason:null});
    expect(store.products().items.some(p=>p.product_enabled&&p.product_name_zh==='文档编辑')).toBe(!forged);expect(f.calls()).toBe(2);expect(f.manager.open).not.toHaveBeenCalled();expect(f.gate.view().desiredMode).toBe('ON');
    if(forged){const overview=new OwnerOverviewService(f.worlds,f.work);expect((await overview.bossOverview()).alerts.find(a=>a.id===`product-intent:${goal.id}`)?.goalId).toBe(goal.id);f.gate.goals.action(goal.id,{action:'stop',expectedRevision:f.gate.goals.get(goal.id).revision,idempotencyKey:'stop-forged-product'});expect((await overview.bossOverview()).alerts.some(a=>a.id===`product-intent:${goal.id}`)).toBe(false);}
  },30000);
  it('executes approved DAG steps using actual immutable dependency bytes and requires Owner closure',async()=>{
    const source='Full verified dependency '.repeat(100)+'DEPENDENCY END';
    const f=await fixture((body,_req,res)=>{
      const input=JSON.parse(body.messages[1].content);
      if(input.agent.id!=='company-editor')return send(res,{operations:[{tool:'save_artifact',args:{filename:'sources.md',content:source}}],owner_reply:'Actual source retained',send_to:'STOP'});
      if(body.messages.length===2){const evidenceId=/"evidenceId":"([^"]+)"/.exec(input.instruction)![1];return send(res,{operations:[{tool:'READ_TASK_DEPENDENCY',args:{evidenceId}}],send_to:'SELF'});}
      const receipt=JSON.parse(body.messages.at(-1).content).toolReceipts[0];expect(receipt.output.content).toBe(source);
      send(res,{operations:[{tool:'save_artifact',args:{filename:'edited.md',content:'Reviewed: '+receipt.output.content}}],owner_reply:'Actual dependency reviewed',send_to:'STOP'});
    }),goal=f.goal('Research actual sources','manual');
    f.work.agents!.create({id:'company-editor',name:'Editor',role:'editor',instruction:'Review actual sources'});
    f.gate.proposals.plans.install(goal.id,{summary:'Two actual deliverables',nodes:[{key:'research',title:'Research',instruction:'Retain source evidence',filename:'sources.md',dependsOn:[],trigger:{kind:'once'},personId:f.a.qianji_id},{key:'edit',title:'Edit',instruction:'Use the verified research',filename:'edited.md',dependsOn:['research'],trigger:{kind:'once'},personId:'company-editor'}]},true);
    await f.scheduler.tick();await f.settle();
    expect(f.gate.proposals.plans.get(goal.id)!.nodes.map(n=>n.state)).toEqual(['COMPLETED','COMPLETED']);
    const detail=f.gate.goals.detail(goal.id);expect(detail.goal.status).toBe('WAITING_APPROVAL');expect(detail.evidence.filter(e=>e.kind==='artifact')).toHaveLength(2);
    expect(f.requests[1].messages[1].content).toContain('Full verified dependency');expect(f.requests[1].messages[1].content).toContain('sha256');
    expect(f.work.artifacts.forAgent('company-editor','edited.md').content).toBe('Reviewed: '+source);
    expect(f.manager.open).not.toHaveBeenCalled();expect(f.calls()).toBe(3);expect(f.gate.view().desiredMode).toBe('ON');
  },30000);
  it('lets the Owner close verified delivery while its known response still has an unresolved bill',async()=>{
    const f=await fixture((_body,_req,res)=>send(res,{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual result retained although provider usage is missing.'}}],owner_reply:'Actual result ready for inspection',send_to:'STOP'},false));
    const goal=f.goal('Review actual delivery','manual');f.gate.proposals.plans.install(goal.id,{summary:'One verified deliverable',nodes:[{key:'deliver',title:'Deliver',instruction:'Save the real result',filename:'result.md',dependsOn:[],trigger:{kind:'once'}}]},true);
    await f.scheduler.tick();await f.settle();const held=f.gate.budget.view().reservedMicros;expect(held).toBeGreaterThan(0);expect(f.work.view().tasks[0].attempt).toMatchObject({state:'COMPLETED',accountingState:'PENDING'});
    const proposal=f.gate.proposals.list().find(p=>p.kind==='close_task'&&p.goalId===goal.id)!;f.off();expect(f.gate.proposals.decide(proposal.id,{decision:'approve',hash:proposal.hash,idempotencyKey:'close-with-pending-bill'}).state).toBe('EXECUTED');
    expect(f.gate.goals.get(goal.id).status).toBe('COMPLETED');expect(f.gate.budget.view()).toMatchObject({reservedMicros:held,spentMicros:0});expect(f.gate.view().desiredMode).toBe('OFF');expect(f.calls()).toBe(1);
  },30000);
  it('reopens a failed internal node only on an explicit Owner action and preserves prior costs',async()=>{
    let calls=0;const f=await fixture((_body,_req,res)=>send(res,++calls===1?'invalid response':{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual result from the explicitly reopened task.'}}],owner_reply:'Actual reopened result',send_to:'STOP'}));
    const goal=f.goal('Research real evidence','manual');f.gate.proposals.plans.install(goal.id,{summary:'One actual result',nodes:[{key:'deliver',title:'Deliver',instruction:'Retain actual evidence',filename:'result.md',dependsOn:[],trigger:{kind:'once'}}]},true);
    await f.scheduler.tick();await f.settle();expect(f.gate.proposals.plans.get(goal.id)!.nodes[0].state).toBe('BLOCKED');await f.scheduler.tick();expect(calls).toBe(1);
    const blocked=f.gate.goals.get(goal.id);f.gate.goals.action(goal.id,{action:'reopen',expectedRevision:blocked.revision,idempotencyKey:'explicit-reopen'});await f.scheduler.tick();await f.settle();
    expect(f.gate.proposals.plans.get(goal.id)!.nodes[0].state).toBe('COMPLETED');expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(calls).toBe(2);expect(f.gate.budget.view().spentMicros).toBe(80);
  },30000);
  it('starts independent goals concurrently and isolates a malformed response to one goal',async()=>{
    let release!:()=>void;
    const f=await fixture((body,_req,res)=>{const instruction=JSON.parse(body.messages[1].content).instruction;if(instruction.includes('Research invalid'))release=()=>send(res,'this is not JSON');else send(res,{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Independent actual artifact while another HTTP request waits.'}}],owner_reply:'Independent result',send_to:'STOP'});});
    const bad=f.goal('Research invalid'),good=f.goal('Marketing independent');await f.scheduler.tick();
    await vi.waitFor(()=>expect(f.calls()).toBe(2),{timeout:20000});
    expect(f.work.worker!.snapshots().some(a=>a.goal_id===bad.id&&f.work.worker!.isRunning(String(a.id)))).toBe(true);
    await vi.waitFor(async()=>{await f.scheduler.tick();expect(f.gate.goals.get(good.id).status).toBe('WAITING_APPROVAL');},{timeout:20000});
    release();await f.settle();expect(f.gate.goals.get(bad.id)).toMatchObject({status:'BLOCKED',reason:'MODEL_RESPONSE_INVALID'});
    expect(f.gate.goals.get(good.id).status).toBe('WAITING_APPROVAL');expect(f.gate.view().desiredMode).toBe('ON');expect(f.manager.open).not.toHaveBeenCalled();
  },30000);
  it('pauses an in-flight goal, retains its paid response, and resumes the same Attempt without a second call',async()=>{
    let release!:()=>void;const f=await fixture((_body,_req,res)=>{release=()=>send(res,{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Paid response retained across explicit Goal pause.'}}],owner_reply:'Actual retained result',send_to:'STOP'});});
    const goal=f.goal();await f.scheduler.tick();await vi.waitFor(()=>expect(release).toBeTypeOf('function'),{timeout:20000});
    const before=f.work.view().tasks.find(t=>t.goalId===goal.id)!.attempt!;
    f.gate.goals.action(goal.id,{action:'pause',expectedRevision:goal.revision,idempotencyKey:crypto.randomUUID()});await f.scheduler.tick();release();
    await vi.waitFor(async()=>{await f.work.tick();expect(f.work.execution.get(before.id).state).toBe('SUSPENDED');},{timeout:20000});
    expect(f.gate.goals.get(goal.id).status).toBe('PAUSED');expect(f.calls()).toBe(1);expect(f.gate.budget.view().spentMicros).toBe(40);
    const paused=f.gate.goals.get(goal.id);f.gate.goals.action(goal.id,{action:'resume',expectedRevision:paused.revision,idempotencyKey:crypto.randomUUID()});await f.settle();
    expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.work.view().tasks.find(t=>t.goalId===goal.id)!.attempt!.id).toBe(before.id);expect(f.calls()).toBe(1);
  },30000);
  it('restores a committed prelaunch intent under a fresh controller without losing or repeating money admission',async()=>{
    const f=await fixture();const actor=f.work.agents!.get(f.a.qianji_id);
    f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('prelaunch-task','prelaunch',?,?,'Produce an actual draft','QUEUED',NULL,NULL,NULL,NULL,?,?)").run(actor.id,actor.name,Date.now(),Date.now());
    const command=f.work.worker!.create('prelaunch-task',f.work.agents!.scopeId(actor.id),1),before=f.gate.budget.view().reservedMicros;
    const gate=new OwnerAutomationGate(f.control),execution=new CompanyExecutionService(gate),adapter=new CompanyWorkerAdapter(execution,f.work.worker!.options);cleanups.push(()=>adapter.close());
    await adapter.start(command.attemptId);await adapter.wait(command.attemptId);
    expect(execution.get(command.attemptId).state,JSON.stringify(f.control.db.prepare('SELECT payload_json FROM company_worker_receipts WHERE attempt_id=?').all(command.attemptId))).toBe('COMPLETED');expect(f.calls()).toBe(1);expect(before).toBeGreaterThan(0);expect(gate.budget.view()).toMatchObject({spentMicros:40,reservedMicros:0});
  },30000);
});
