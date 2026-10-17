import {afterEach,describe,expect,it} from 'vitest';
import * as fs from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {CompanyAgentService} from '../src/services/company_agent_service.js';
import {CompanyToolService} from '../src/services/company_tool_service.js';
import {CompanyWorkerAdapter} from '../src/services/company_worker_adapter.js';
import {AppCodeService} from '../src/services/app_code_service.js';
import {appCodePath} from '../src/services/app_code_policy.js';
import {classifyChange} from '../../../supervisor/protocol.js';
import {goalFixture} from './fixtures/owner_goals.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
function fixture(bound=false) {
  const f=goalFixture();cleanups.push(f.close);f.on();const agents=new CompanyAgentService(f.control,f.root);
  const actor=agents.create({id:'worker_company_tools',name:'Research',role:'Research',instruction:'Retain actual evidence'}),other=agents.create({id:'worker_other_tools',name:'Editor',role:'Editor',instruction:'Inspect actual evidence'});
  const project=join(f.root,'project');fs.mkdirSync(join(project,'frontend/src'),{recursive:true});fs.writeFileSync(join(project,'frontend/src/probe.ts'),'export const before = 1;');
  const code=new AppCodeService(f.manager,project,agents),contracts=JSON.parse(fs.readFileSync(resolve('genome/manifest.json'),'utf8')).capability_contracts;
  const tools=new CompanyToolService({gate:f.gate,agents,artifacts:f.work.artifacts,recruit:f.work.requestRecruit.bind(f.work),code,payments:f.payments,contracts,release:{list:async()=>{throw new Error('CONTROL_SERVICE_UNAVAILABLE');}} as any});
  const goal=bound?f.goal('Company command plan','manual'):undefined;
  const plan={summary:'Deliver a result, then inspect it',nodes:[{key:'deliver',title:'Deliver',instruction:'Save actual evidence',dependsOn:[],trigger:{kind:'once'},filename:'result.md'},{key:'inspect',title:'Inspect',instruction:'Inspect actual evidence',dependsOn:['deliver'],trigger:{kind:'once'},filename:'inspection.md'}]};
  if(goal){f.gate.proposals.plans.install(goal.id,plan,true);f.gate.proposals.plans.claim(goal.id,'deliver','tool-dispatch');f.control.db.prepare("INSERT INTO owner_goal_steps VALUES('tool-dispatch',?,1,'tool-dispatch','QUEUED',0,?)").run(goal.id,Date.now());f.control.db.prepare("INSERT INTO owner_goal_dispatches VALUES('tool-dispatch',?,1,'tool-task',NULL,?,'QUEUED',NULL)").run(goal.id,actor.id);}
  f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('tool-task','tool-request',?,'Research','Execute the authorized internal task','QUEUED',NULL,NULL,NULL,NULL,?,?)").run(actor.id,Date.now(),Date.now());
  const adapter=new CompanyWorkerAdapter(f.work.execution,{workspace:f.root,meter:f.meter,environment:{},spec:c=>({schema:1,attemptId:c.attemptId,taskId:c.taskId,runId:c.runId,fence:c.fence,agent:{id:actor.id,name:actor.name,role:actor.role},instruction:c.instruction,model:'test',maxSteps:4,maxOutputTokens:512,notSentRetries:1,tools:tools.catalog()})});
  const command=adapter.create('tool-task',actor.id,4,goal?{goalId:goal.id,specificationRevision:1,dispatchId:'tool-dispatch'}:undefined);let sequence=0;
  const execute=(name:string,args:any={},key=`${command.attemptId}:tool:0:${sequence++}`)=>tools.execute(command.attemptId,key,name,args);
  return {...f,agents,actor,other,code,tools,project,command,execute,goal,plan};
}
describe('typed company tools',()=>{
  it('reads the complete approved dependency across agents and rejects unrelated or changed evidence',async()=>{
    const f=fixture(true),db=f.control.db,content='Verified source '.repeat(120)+'END OF VERIFIED SOURCE',reference='evidence/dependency/source.md';
    const file=join(f.registry.directory(f.a.world_id),reference);fs.mkdirSync(join(file,'..'),{recursive:true});fs.writeFileSync(file,content);
    const sha256=createHash('sha256').update(content).digest('hex');
    db.prepare("INSERT INTO owner_goal_evidence VALUES('dependency-source',?,1,'source-run',?,'artifact',?,?,?,?)").run(f.goal!.id,f.a.world_id,reference,sha256,Buffer.byteLength(content),Date.now());
    db.prepare("UPDATE owner_task_occurrences SET node_key='inspect' WHERE dispatch_id='tool-dispatch'").run();
    db.prepare("UPDATE owner_task_nodes SET latest_evidence='[\"dependency-source\"]',state='COMPLETED',occurrences=1 WHERE goal_id=? AND node_key='deliver'").run(f.goal!.id);
    expect((await f.execute('READ_TASK_DEPENDENCY',{evidenceId:'dependency-source'})).output).toMatchObject({content,sha256,readOnly:true});
    expect(await f.execute('READ_TASK_DEPENDENCY',{evidenceId:'unrelated-private-file'})).toMatchObject({status:'FAILED',error_code:'OWNER_EVIDENCE_NOT_AUTHORIZED'});
    fs.writeFileSync(file,content.replace('END','BAD'));
    expect(await f.execute('READ_TASK_DEPENDENCY',{evidenceId:'dependency-source'})).toMatchObject({status:'FAILED',error_code:'OWNER_EVIDENCE_CHANGED'});
    expect(f.manager.list().every(a=>!a.opened)).toBe(true);
  });
  it('deduplicates an exact recruitment command without creating a World or employee',async()=>{
    const f=fixture(),key=`${f.command.attemptId}:tool:0:0`,input={role:'Specialist',reason:'The authorized task needs a specialist',instruction:'Produce a retained source-backed draft'};
    const result=await f.execute('REQUEST_RECRUIT',input,key);expect(result.status).toBe('SUCCESS');expect(await f.execute('REQUEST_RECRUIT',{instruction:input.instruction,reason:input.reason,role:input.role},key)).toEqual(result);
    expect(f.work.view().requests).toHaveLength(1);expect(f.agents.list()).toHaveLength(2);expect(f.registry.list()).toHaveLength(2);expect(f.manager.list().every(a=>!a.opened)).toBe(true);
    await expect(f.execute('REQUEST_RECRUIT',{...input,role:'Changed'},key)).rejects.toThrow('IDEMPOTENCY_CONFLICT');expect(f.calls).toHaveLength(0);
  });
  it('replans only unstarted internal nodes and queues closure without self-approving',async()=>{
    const f=fixture(true),next={...f.plan,nodes:[f.plan.nodes[0],{...f.plan.nodes[1],instruction:'Verify the exact retained source'}]};
    expect((await f.execute('REPLAN_TASK',{plan:next})).status).toBe('SUCCESS');expect(f.gate.proposals.plans.get(f.goal!.id)!.planRevision).toBe(2);
    const denied=await f.execute('REPLAN_TASK',{plan:{...next,nodes:[{...next.nodes[0],instruction:'Replace executing work'},next.nodes[1]]}});expect(denied).toMatchObject({status:'FAILED',error_code:'OWNER_TASK_COMPLETED_STEP_CHANGED'});
    expect((await f.execute('REQUEST_TASK_CLOSE',{reason:'Actual result is ready for Owner inspection'})).output).toMatchObject({requiresOwnerApproval:true});expect(f.gate.goals.get(f.goal!.id).status).not.toBe('COMPLETED');
  });
  it('runs approved pure programs and exposes methods while rejecting host access',async()=>{
    const f=fixture(),manifest={schema:1,id:'row-count',version:'1.0.0',engine:'pure-ast-json@1',requiredContracts:['pure_skill@1'],dataSchemaVersion:1,source:'export default input=>({count:input.rows.length})',tests:[{input:{rows:[]},expected:{count:0}},{input:{rows:[1]},expected:{count:1}}]};
    const saved=await f.execute('SUBMIT_EXTENSION',{manifest,expectedRevision:0,expectedHash:null});expect(saved.status).toBe('SUCCESS');expect(saved.output.enabled).toBe(true);
    expect((await f.execute('RUN_EXTENSION',{id:'row-count',input:{rows:[1,2]}})).output.result).toEqual({count:2});expect((await f.execute('LIST_EXTENSIONS')).output).toHaveLength(1);
    expect((await f.execute('SUBMIT_EXTENSION',{manifest:{...manifest,source:'export default x=>process.env'},expectedRevision:1,expectedHash:saved.output.hash})).status).toBe('FAILED');
    expect((await f.execute('SET_EXTENSION_STATE',{id:'row-count',action:'disable',expectedRevision:1,expectedHash:saved.output.hash})).output.enabled).toBe(false);
    expect((await f.execute('LIST_SKILLS')).output.skills).toEqual([]);expect(f.manager.list().every(a=>!a.opened)).toBe(true);
  });
  it('retains owned legacy files and methods by hash, shares them explicitly, and isolates a malformed method',async()=>{
    const f=fixture(),directory=join(f.agents.directory(f.actor.id),'live/artifacts/0_0_0');fs.mkdirSync(directory,{recursive:true});
    fs.writeFileSync(join(directory,'source.md'),'Retained actual source.');fs.writeFileSync(join(directory,'good.skill.md'),'---\nname: Review sources\ndescription: Inspect retained evidence\n---\nRead the real source.');fs.writeFileSync(join(directory,'broken.skill.md'),'invalid method frontmatter');
    expect(f.work.artifacts.importLegacy(f.actor.id,f.actor.directoryRel)).toMatchObject({imported:3,skipped:0});
    expect((await f.execute('READ_WORLD_ASSET',{filename:'source.md'})).output.content).toBe('Retained actual source.');
    const methods=(await f.execute('LIST_SKILLS')).output;expect(methods.skills).toEqual(expect.arrayContaining([expect.objectContaining({ref:'body:good'})]));expect(methods.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ref:'body:broken',reason:'SKILL_FRONTMATTER_REQUIRED'})]));
    expect((await f.execute('READ_SKILL',{ref:'body:good'})).output.content).toContain('Read the real source.');
    expect(await f.execute('transfer_artifact',{filename:'source.md',targetAgentId:f.other.id})).toMatchObject({status:'SUCCESS'});expect(f.work.artifacts.forAgent(f.other.id,'source.md').content).toBe('Retained actual source.');
    fs.writeFileSync(join(directory,'source.md'),'Tampered retained source.');expect(await f.execute('READ_WORLD_ASSET',{filename:'source.md'})).toMatchObject({status:'FAILED',error_code:'OWNER_EVIDENCE_CHANGED'});expect(()=>f.work.artifacts.forAgent(f.other.id,'source.md')).toThrow('OWNER_EVIDENCE_CHANGED');
  });
  it('submits a stable source candidate without a private Core, and protects the new control modules',async()=>{
    const f=fixture(),read=(await f.execute('READ_APP_SOURCE',{path:'frontend/src/probe.ts'})).output,key=`${f.command.attemptId}:tool:1:0`,input={title:'Improve actual UI',summary:'A separately reviewable source candidate',files:[{path:read.path,content:'export const after = 2;',baseHash:read.baseHash}]};
    const result=await f.execute('SUBMIT_APP_CODE',input,key);expect(result.status).toBe('SUCCESS');expect(await f.execute('SUBMIT_APP_CODE',input,key)).toEqual(result);expect(f.code.reports()).toHaveLength(1);
    expect(fs.readFileSync(join(f.project,'frontend/src/probe.ts'),'utf8')).toBe('export const before = 1;');expect(f.manager.list().every(a=>!a.opened)).toBe(true);
    for(const file of ['apps/server/src/services/company_model_ledger.ts','apps/server/src/services/Company_agent_service.ts','apps/server/src/execution/company_worker_entry.ts']){expect(()=>appCodePath(file)).toThrow('APP_CODE_PATH_DENIED');expect(classifyChange([file])).toBe('ROOT');}
  });
  it('isolates release-read failure and never grants autonomous rollback or deletion',async()=>{
    const f=fixture();expect(await f.execute('LIST_RELEASE_VERSIONS')).toMatchObject({status:'FAILED',error_code:'CONTROL_SERVICE_UNAVAILABLE'});
    expect(await f.execute('ROLLBACK_RELEASE')).toMatchObject({status:'FAILED',error_code:'OWNER_MAINTENANCE_APPROVAL_REQUIRED'});expect(await f.execute('DELETE_RELEASE')).toMatchObject({status:'FAILED',error_code:'OWNER_MAINTENANCE_APPROVAL_REQUIRED'});
    expect(await f.execute('LIST_PAYMENT_RAILS')).toMatchObject({status:'SUCCESS',output:[]});expect(f.gate.view().desiredMode).toBe('ON');
    f.off();await expect(f.execute('LIST_SKILLS')).rejects.toThrow('OWNER_AUTOMATION_OFF');expect(f.tools.receipt(`${f.command.attemptId}:tool:0:0`,f.command.attemptId)?.status).toBe('FAILED');
  });
});
