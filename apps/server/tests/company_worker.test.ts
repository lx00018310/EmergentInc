import { afterEach, describe, expect, it } from 'vitest';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { BUILTIN_DEFINITIONS } from '@emergentinc/tools';
import { listenTestHttp } from '../../../tests/http_port.js';
import { CompanyWorkerJournal } from '../src/execution/company_worker_journal.js';
import { executeCompanyWorker } from '../src/execution/company_worker_engine.js';
import { InfrastructureFailureError, OutcomeUnknownError } from '@emergentinc/model';
import type { CompanyWorkerEvent, CompanyWorkerSpec } from '../src/execution/company_worker_protocol.js';

const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
const spec=():CompanyWorkerSpec=>({schema:1,attemptId:'attempt_worker_fixture',taskId:'task-fixture',runId:'run-fixture',fence:1,agent:{id:'agent-fixture',name:'Research',role:'research'},instruction:'Save result.md with an actual internal draft, then report it.',model:'test',maxSteps:4,maxOutputTokens:512,notSentRetries:1,tools:BUILTIN_DEFINITIONS.filter(t=>['save_artifact','read_artifact','list_artifacts'].includes(t.name))});
async function fixture(respond?:(call:number,res:import('node:http').ServerResponse)=>void) {
  const root=fs.mkdtempSync(join(tmpdir(),'company-worker-'));cleanups.push(async()=>fs.rmSync(root,{recursive:true,force:true}));
  let calls=0,firstRequest!:()=>void;const requested=new Promise<void>(r=>firstRequest=r);
  const server=createServer((req,res)=>{req.resume();req.on('end',()=>{
    calls++;firstRequest();if(respond){respond(calls,res);return;}
    const value=calls===1?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual draft from an isolated worker process.'}}],send_to:'STOP'}:{owner_reply:'The actual internal draft is retained.',send_to:'STOP'};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));
  });});
  const port=await listenTestHttp(server);cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  const received=new Map<string,CompanyWorkerEvent>(),authorizations:string[]=[],tools:string[]=[];
  function worker(onEvent?:(event:CompanyWorkerEvent,child:ChildProcess)=>boolean,workerSpec=spec(),directory=root) {
    const child=fork(resolve('apps/server/src/execution/company_worker_entry.ts'),[],{cwd:resolve('.'),execArgv:['--import','tsx'],env:{...process.env,MCL_API_KEY:'explicit-fake-worker-key',MCL_BASE_URL:`http://127.0.0.1:${port}/v1`,MCL_TIMEOUT_MS:'10000'},windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    let errors='',finished:any;child.stderr!.on('data',data=>errors+=String(data));const exited=once(child,'exit');
    const done=exited.then(([code])=>({code,errors,finished}));
    cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
    child.on('message',(message:any)=>{
      if(message.kind==='finished'||message.kind==='failed'){finished=message;return;}
      if(message.kind!=='rpc')return;
      let value:any;
      if(message.method==='authorizeModel'){authorizations.push(message.args[0]);value={permitId:'permit-'+authorizations.length};}
      else if(message.method==='authorizeTool')tools.push(message.args[0]);
      else if(message.method==='controllerTool'){child.send({kind:'rpc-result',id:message.id,error:'Unexpected controller command'});return;}
      else if(message.method==='receipt'){
        const event=message.args[0] as CompanyWorkerEvent,old=received.get(event.id);
        if(old&&JSON.stringify(old)!==JSON.stringify(event)){child.send({kind:'rpc-result',id:message.id,error:'Conflicting receipt'});return;}
        received.set(event.id,event);if(onEvent?.(event,child))return;
      }
      if(child.connected)child.send({kind:'rpc-result',id:message.id,value});
    });
    child.send({kind:'start',spec:workerSpec,directory});return {child,done};
  }
  return {root,worker,received,authorizations,tools,requested,calls:()=>calls};
}

describe('independent company worker on the current OS',()=>{
  it('accepts one JSON transport fence and continues a SELF progress reply until the actual final result',async()=>{
    const f=await fixture(),events:CompanyWorkerEvent[]=[];let calls=0;
    const result=await executeCompanyWorker(f.root,spec(),{async call(){calls++;return {rawText:calls===1?'```json\n'+JSON.stringify({operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual retained content before the final report.'}}],owner_reply:'Progress only; inspect the actual receipt next',send_to:'SELF'})+'\n```':JSON.stringify({owner_reply:'Final actual result retained',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}};}},{async authorizeModel(){return {permitId:'permit-'+calls};},async authorizeTool(){},async controllerTool(){throw new Error('Unexpected command');},async controllerToolReceipt(){return null;},async receipt(e){events.push(e);}});
    expect(result).toMatchObject({kind:'completed',reply:'Final actual result retained'});expect(calls).toBe(2);expect(events.filter(e=>e.kind==='tool')).toHaveLength(1);expect(events.filter(e=>e.kind==='completed')).toHaveLength(1);
  });
  it('rejects prose outside a JSON fence rather than extracting an embedded command',async()=>{
    const f=await fixture();const result=await executeCompanyWorker(f.root,spec(),{async call(){return {rawText:'Unapproved surrounding text\n```json\n{"owner_reply":"Pretend success","send_to":"STOP"}\n```',usage:{promptTokens:20,completionTokens:10}};}},{async authorizeModel(){return {permitId:'permit-prose'};},async authorizeTool(){throw new Error('No tool should run');},async controllerTool(){throw new Error('No tool should run');},async controllerToolReceipt(){return null;},async receipt(){}});
    expect(result).toMatchObject({kind:'failed',reason:'MODEL_RESPONSE_INVALID'});
  });
  it('treats null optional report text as absent while continuing actual work',async()=>{
    const f=await fixture();let calls=0;
    const result=await executeCompanyWorker(f.root,spec(),{async call(){return {rawText:JSON.stringify(++calls===1?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual content with an absent optional reply.'}}],owner_reply:null,message_md:null,send_to:'SELF'}:{owner_reply:'Final verified draft',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}};}},{async authorizeModel(){return {permitId:'permit-null-'+calls};},async authorizeTool(){},async controllerTool(){throw new Error('Unexpected command');},async controllerToolReceipt(){return null;},async receipt(){}});
    expect(result).toMatchObject({kind:'completed',reply:'Final verified draft'});expect(calls).toBe(2);
  });
  it('executes the model and artifact tool in a child and emits durable company receipts',async()=>{
    const f=await fixture(),w=f.worker(),done=await w.done;expect(done.errors).not.toContain('Error:');expect(done.code).toBe(0);expect(done.finished.result.kind).toBe('completed');
    expect(f.calls()).toBe(2);expect(f.authorizations).toHaveLength(2);expect(f.tools).toHaveLength(1);
    const tool=[...f.received.values()].find(e=>e.kind==='tool')!.payload.result;
    expect(fs.readFileSync(join(f.root,tool.output.snapshot_relative_path),'utf8')).toBe('Actual draft from an isolated worker process.');
    const journal=new CompanyWorkerJournal(f.root,spec());try{
      expect(journal.checkpoint().terminal?.kind).toBe('completed');expect(journal.pending()).toHaveLength(0);
      expect(journal.db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_work_tasks'").get()).toBeUndefined();
    }finally{journal.close();}
  },15000);
  it('reuses a response persisted before controller disconnection instead of paying for it again',async()=>{
    const f=await fixture();let disconnected=false;
    const first=f.worker((event,child)=>{if(event.kind==='model'&&!disconnected){disconnected=true;child.disconnect();return true;}return false;});
    await first.done;expect(f.calls()).toBe(1);expect(f.tools).toHaveLength(0);
    const journal=new CompanyWorkerJournal(f.root,spec());try{expect(journal.checkpoint().terminal).toBeNull();expect(journal.pending().some(e=>e.kind==='model')).toBe(true);}finally{journal.close();}
    const resumed=await f.worker().done;expect(resumed.code,resumed.errors).toBe(0);expect(resumed.finished.result.kind).toBe('completed');
    expect(f.calls()).toBe(2);expect(f.authorizations).toHaveLength(2);expect(f.tools).toHaveLength(1);
    expect([...f.received.values()].filter(e=>e.kind==='model')).toHaveLength(2);
  },15000);
  it('does not resend a paid request killed after dispatch',async()=>{
    const f=await fixture(()=>{}),first=f.worker();await f.requested;first.child.kill('SIGKILL');await first.done;
    const resumed=await f.worker().done;expect(resumed.code,resumed.errors).toBe(0);expect(resumed.finished.result).toMatchObject({kind:'blocked',reason:'CALL_OUTCOME_UNKNOWN'});
    expect(f.calls()).toBe(1);expect(f.authorizations).toHaveLength(1);expect(f.tools).toHaveLength(0);
    const usage=[...f.received.values()].find(e=>e.kind==='model')!;expect(usage.payload.notSent).toBe(false);expect(usage.payload.permitId).toBe('permit-1');
  },15000);
  it('refuses a concurrent process for the same private journal until the prior process has exited',async()=>{
    const f=await fixture(()=>{}),first=f.worker();await f.requested;
    const second=await f.worker().done;expect(second.code).toBe(1);expect(second.finished).toMatchObject({kind:'failed',reason:'WORKSPACE_ALREADY_RUNNING'});expect(f.calls()).toBe(1);
    first.child.kill('SIGKILL');await first.done;
  },15000);
  it.each([false,true])('retries only a proven not-sent request within its exact policy, unknown=%s',async unknown=>{
    const f=await fixture(),events:CompanyWorkerEvent[]=[];let calls=0,permits=0;
    const result=await executeCompanyWorker(f.root,spec(),{async call(){calls++;if(calls===1)throw unknown?new OutcomeUnknownError('Ambiguous dispatch'):new InfrastructureFailureError('Proven not sent');return {rawText:JSON.stringify({owner_reply:'Actual response after a safe retry',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10}};}},{async authorizeModel(){return {permitId:`permit-${++permits}`};},async authorizeTool(){},async controllerTool(){throw new Error('Unexpected command');},async controllerToolReceipt(){return null;},async receipt(e){events.push(e);}});
    expect(result?.kind).toBe(unknown?'blocked':'completed');expect(calls).toBe(unknown?1:2);expect(permits).toBe(calls);
    expect(events.filter(e=>e.kind==='model')).toHaveLength(calls);expect(events.find(e=>e.kind==='model')!.payload.notSent).toBe(!unknown);
  });
});
