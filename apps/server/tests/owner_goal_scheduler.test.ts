import { afterEach, describe, expect, it, vi } from 'vitest';
import { goalFixture } from './fixtures/owner_goals.js';
import { TRANSFER_TOPIC } from '../src/services/payment_assets.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
describe('V29 real World goal scheduler',()=>{
  it('uses approved money during unattended scheduling while preserving paid usage',async()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal();expect(goal.maxTokens).toBe(0);
    for(const world of f.manager.list()){
      const runtime=await f.manager.open(world.world_id),start=runtime.run.start.bind(runtime.run);
      runtime.store.db.prepare('UPDATE pixel_accounts SET energy=0').run();
      vi.spyOn(runtime.run,'start').mockImplementation(options=>start({...options,runBudgetTokens:1}));
    }
    let count=0;f.respond(async()=>({rawText:JSON.stringify(++count===1?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Actual retained draft after Owner quota increase.'}}],send_to:'STOP'}:{owner_reply:'Draft retained for inspection',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    f.on(null,1);await f.scheduler.tick();
    await f.finish();expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.gate.view().spentTokens).toBe(60);expect(f.calls).toHaveLength(2);
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:0});
    expect(f.control.db.prepare("SELECT COUNT(*) n FROM control_events WHERE kind='owner_auto_quota_granted'").get()!.n).toBe(0);
  });
  it('binds an agent recruitment request to its goal budget, preserves pause on approval and routes resumed work to the approved specialist',async()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Research draft');let worldCalls=0;
    f.respond(async request=>({rawText:JSON.stringify(request.messages[0].content.includes('人物设定编辑')?{displayName:'Specialist',shortBio:'Approved research specialist',appearanceSpec:'Neutral portrait'}:++worldCalls===1?{operations:[{tool:'REQUEST_RECRUIT',args:{role:'Research specialist',reason:'This goal requires specialist research capacity',instruction:'Produce the verifiable research draft'}}],send_to:'STOP'}:worldCalls===3?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Specialist research draft with retained actual sources.'}}],send_to:'STOP'}:{owner_reply:'Review the real work and resource decision',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    f.on(10);await f.scheduler.tick();await f.finish();expect(f.gate.goals.get(goal.id).reason).toBe('OWNER_RECRUITMENT_REQUIRED');const request=f.work.view().requests[0];
    f.gate.goals.action(goal.id,{action:'pause',expectedRevision:1,idempotencyKey:crypto.randomUUID()});await f.work.decide(request.id,request.hash,'approve');expect(f.gate.goals.get(goal.id)).toMatchObject({status:'PAUSED',spentTokens:60});
    const person=f.work.view().requests[0].personId!,world=f.control.worldForQianji(person);f.gate.goals.action(goal.id,{action:'resume',expectedRevision:2,idempotencyKey:crypto.randomUUID()});await f.scheduler.tick();await f.finish();
    expect(f.gate.goals.get(goal.id)).toMatchObject({status:'WAITING_APPROVAL',spentTokens:120});expect(f.gate.goals.detail(goal.id).dispatches[0].worldId).toBe(world.world_id);expect(f.gate.view().startedRounds).toBe(2);
  });
  it.each(['pause','stop','archive'] as const)('safely applies %s to an in-flight goal while another goal continues',async action=>{
    const f=goalFixture();cleanups.push(f.close);const a=f.goal('Research draft');await new Promise(r=>setTimeout(r,2));const b=f.goal('Marketing review','manual');let release!:(value:any)=>void;
    f.respond(()=>f.calls.length===1?new Promise(r=>{release=r;}):Promise.resolve({rawText:JSON.stringify({owner_reply:'Review this bounded result',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    f.on(10);await f.scheduler.tick();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));f.gate.goals.action(a.id,{action,expectedRevision:1,idempotencyKey:crypto.randomUUID()});await f.scheduler.tick();
    release({rawText:JSON.stringify({operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Retained paid response for the paused goal.'}}],send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});
    await vi.waitFor(()=>expect(f.manager.list().some(w=>w.running)).toBe(false));await f.scheduler.tick();await f.finish();
    expect(f.gate.goals.get(a.id).status).toBe(action==='pause'?'PAUSED':action==='stop'?'STOPPED':'ARCHIVED');expect(f.gate.goals.get(b.id).status).toBe('WAITING_APPROVAL');expect(f.gate.view().desiredMode).toBe('ON');expect(f.calls).toHaveLength(2);
    if(action==='pause'){
      const d=f.gate.goals.detail(a.id).dispatches[0],runtime=f.manager.peek(d.worldId)!,runId=runtime.run.getStatus().run_id;
      await expect(runtime.run.start({rounds:1,runBudgetTokens:100000})).rejects.toThrow('OWNER_AUTOMATION_BUSY');expect(runtime.store.runs.getCheckpoint(runId)?.resume_pending).toBe(1);
      const paused=f.gate.goals.get(a.id);f.gate.goals.action(a.id,{action:'resume',expectedRevision:paused.revision,idempotencyKey:crypto.randomUUID()});await f.scheduler.tick();await f.finish();expect(f.gate.goals.get(a.id).status).toBe('WAITING_APPROVAL');expect(f.gate.view().startedRounds).toBe(2);
    }
  });
  it('requires explicit Owner verification of real current-revision source evidence and never writes revenue from that decision',async()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal('Manual research review','manual');let count=0;
    f.respond(async()=>({rawText:JSON.stringify(++count===1?{operations:[{tool:'save_artifact',args:{filename:'sources.md',content:'Source-backed draft for the human reviewer.'}}],send_to:'STOP'}:{owner_reply:'Please review sources.md against the actual source.',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    f.on();await f.scheduler.tick();await f.finish();const detail=f.gate.goals.detail(goal.id);expect(detail.goal.status).toBe('WAITING_APPROVAL');
    expect(()=>f.gate.goals.action(goal.id,{action:'verify',expectedRevision:detail.goal.revision,idempotencyKey:crypto.randomUUID(),verification:{evidenceIds:detail.evidence.filter(e=>e.kind==='report').map(e=>e.id),reason:'A report alone is not acceptable evidence'}})).toThrow();
    const verified=f.gate.goals.action(goal.id,{action:'verify',expectedRevision:detail.goal.revision,idempotencyKey:crypto.randomUUID(),verification:{evidenceIds:detail.evidence.filter(e=>e.kind==='artifact').map(e=>e.id),reason:'Owner checked the retained draft against the real source'}});
    expect(verified.status).toBe('COMPLETED');expect(f.payments.db.prepare('SELECT COUNT(*) n FROM world_revenue_events').get()!.n).toBe(0);expect(f.gate.report().goals[0].spentTokens).toBe(60);
  });
  it('counts only exact finalized invoice receipts while OFF, without an AI call or an unrelated payment',async()=>{
    const f=goalFixture();cleanups.push(f.close);
    f.payments.configureRail({rail_id:'bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'},100);
    const invoice=f.payments.createInvoice({qianji_id:f.a.qianji_id,rail_id:'bsc',amount:'1',idempotency_key:'goal-payment-test'});
    const goal=f.gate.goals.create({title:'Verify this payment',objective:'Confirm the selected invoice',maxTokens:100000,acceptance:{kind:'confirmed_payments',invoiceIds:[invoice.invoice_id],targetCount:1},idempotencyKey:crypto.randomUUID()});
    await f.scheduler.tick();expect(f.gate.goals.get(goal.id)).toMatchObject({status:'WAITING_RESOURCE',verifiedCount:0});
    const signature='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
    const wire={chainId:56,receipt:{status:'0x1',transactionHash:signature,blockHash,blockNumber:'0x64',logs:[{address:invoice.mint,topics:[TRANSFER_TOPIC,'0x'+'0'.repeat(24)+'34'.repeat(20),'0x'+'0'.repeat(24)+invoice.recipient_address.slice(2)],data:'0x'+BigInt(invoice.amount_atomic).toString(16).padStart(64,'0'),logIndex:'0x0',transactionHash:signature,blockHash,blockNumber:'0x64',removed:false}]},block:{number:'0x64',hash:blockHash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)},finalizedHead:{number:'0x64'}};
    expect(f.payments.observe(invoice.invoice_id,signature,'confirmed',wire).status).toBe('OBSERVED');await f.scheduler.tick();expect(f.gate.goals.get(goal.id).verifiedCount).toBe(0);
    expect(f.payments.observe(invoice.invoice_id,signature,'finalized',wire).status).toBe('FINALIZED');await f.scheduler.tick();await f.scheduler.tick();
    expect(f.gate.goals.get(goal.id)).toMatchObject({status:'WAITING_APPROVAL',verifiedCount:1});expect(f.gate.goals.detail(goal.id).evidence).toHaveLength(1);expect(f.calls).toHaveLength(0);expect(f.gate.view().desiredMode).toBe('OFF');
  });
  it('requests a person in Inbox without creating one, then schedules the approved person through the goal budget',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.control.db.prepare("UPDATE qianji_worlds SET status='ARCHIVED'").run();const goal=f.goal();f.on();await f.scheduler.tick();await f.scheduler.tick();
    expect(f.registry.list()).toHaveLength(2);expect(f.work.view().requests).toHaveLength(1);expect(f.calls).toHaveLength(0);
    const request=f.work.view().requests[0];await f.work.decide(request.id,request.hash,'approve');expect(f.registry.list()).toHaveLength(3);await f.scheduler.tick();await f.finish();
    expect(f.gate.goals.get(goal.id).status).toBe('WAITING_APPROVAL');expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_run_permits').get()!.n).toBe(1);
  });
  it('fairly continues past the old shared round limit until each goal requires evidence review',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.goal('Research draft');await new Promise(r=>setTimeout(r,2));f.goal('Marketing draft');
    for(const world of f.manager.list()){
      const runtime=await f.manager.open(world.world_id),start=runtime.run.start.bind(runtime.run);
      vi.spyOn(runtime.run,'start').mockImplementation(options=>{runtime.store.db.prepare("UPDATE messages SET hop=20 WHERE status='QUEUED'").run();return start(options);});
    }
    const drafted=new Set<string>();
    f.respond(async()=>{const world=String(f.control.db.prepare("SELECT world_id FROM owner_run_permits WHERE state='ACTIVE'").get()!.world_id),first=!drafted.has(world);drafted.add(world);return {rawText:JSON.stringify({...first?{operations:[{tool:'save_artifact',args:{filename:'partial.md',content:`Actual partial evidence for ${world}`}}]}:{},message_md:'Continue the next small step',send_to:'SELF'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}};});
    f.on(7);await vi.waitFor(async()=>{await f.work.tick();await f.scheduler.tick();expect(f.gate.goals.list().every(g=>g.status==='BLOCKED'&&g.reason==='OWNER_NO_PROGRESS')).toBe(true);},{timeout:30000,interval:10});
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',startedRounds:8,completedRounds:8,reservedRounds:0,observedState:'IDLE'});
    const grouped=f.control.db.prepare('SELECT goal_id,COUNT(*) n FROM owner_run_permits GROUP BY goal_id').all();expect(grouped).toHaveLength(2);expect(grouped.every(r=>Number(r.n)>=3)).toBe(true);
    expect(f.control.db.prepare("SELECT COUNT(*) n FROM owner_round_permits").get()!.n).toBe(8);
  },40000);
  it('coordinates two existing people, verifies immutable draft bytes and never claims a report proves a sale',async()=>{
    const f=goalFixture();cleanups.push(f.close);const a=f.goal('Research draft');await new Promise(r=>setTimeout(r,2));const b=f.goal('Marketing real customers','manual');let count=0;
    f.respond(async r=>({rawText:JSON.stringify(++count===1?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'A real test research draft with verifiable bytes.'}}],send_to:'STOP'}:{owner_reply:'We have three customers (unverified model claim).',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));
    f.on(7);await f.scheduler.tick();await f.finish();
    expect(f.gate.goals.get(a.id).status).toBe('WAITING_APPROVAL');expect(f.gate.goals.get(b.id).status).toBe('WAITING_APPROVAL');
    expect(f.gate.goals.detail(a.id).evidence.some(e=>e.kind==='artifact'&&e.sha256.length===64)).toBe(true);
    expect(new Set(f.control.db.prepare('SELECT world_id FROM owner_goal_dispatches').all().map(r=>r.world_id)).size).toBe(2);
    expect(f.gate.view().startedRounds).toBeLessThanOrEqual(7);expect(f.manager.list()).toHaveLength(2);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_run_permits').get()!.n).toBe(2);
  });
  it('shows STOPPING during a real in-flight response, keeps its charge, and executes no returned tool after OFF',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.goal();let release!:(v:any)=>void;
    f.respond(()=>f.calls.length===1?new Promise(r=>{release=r;}):Promise.resolve({rawText:JSON.stringify({owner_reply:'Draft created',send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}}));f.on();await f.scheduler.tick();await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
    f.off();expect(f.gate.view().observedState).toBe('STOPPING');expect(()=>f.on()).toThrow('OWNER_AUTOMATION_STOPPING');
    release({rawText:JSON.stringify({operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Do not execute after OFF'}}],send_to:'STOP'}),usage:{promptTokens:20,completionTokens:10,cachedTokens:0}});
    await vi.waitFor(()=>expect(f.manager.list().some(w=>w.running)).toBe(false));expect(f.gate.view()).toMatchObject({observedState:'STOPPED',spentTokens:30,startedRounds:1});
    const runtime=f.manager.peek(f.a.world_id)??f.manager.peek(f.b.world_id)!;expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM tool_executions').get()!.n).toBe(0);expect(f.calls).toHaveLength(1);
    await f.manager.resumeInterrupted();expect(f.calls).toHaveLength(1);
    f.on();await f.manager.resumeInterrupted();await vi.waitFor(()=>expect(f.manager.list().some(w=>w.running)).toBe(false));await f.work.tick();await f.scheduler.tick();
    expect(f.calls).toHaveLength(2);expect(runtime.store.db.prepare('SELECT COUNT(*) n FROM tool_executions').get()!.n).toBe(1);
  });
});
