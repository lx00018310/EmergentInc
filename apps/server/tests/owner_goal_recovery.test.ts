import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { OwnerGoalScheduler } from '../src/services/owner_goal_scheduler.js';
import { goalFixture } from './fixtures/owner_goals.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
async function crash(mode:string){
  const f=goalFixture();cleanups.push(f.close);const goal=f.goal();
  const child=spawn(process.execPath,['--import','tsx',resolve('apps/server/tests/fixtures/owner_goal_recovery_child.ts'),f.root,mode],{cwd:resolve('.'),windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';child.stderr.on('data',data=>errors+=data);const exited=once(child,'exit');
  cleanups.push(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;});
  await vi.waitFor(()=>{if(child.exitCode!==null)throw new Error(errors);expect(fs.existsSync(join(f.root,'recovery-ready.json'))).toBe(true);},{timeout:10000});child.kill('SIGKILL');await exited;
  const ready=JSON.parse(fs.readFileSync(join(f.root,'recovery-ready.json'),'utf8')),gate=new OwnerAutomationGate(f.control);f.manager.attachAutomation(gate);const runtime=await f.manager.open(ready.worldId),scheduler=new OwnerGoalScheduler(f.manager,f.work,gate);cleanups.push(()=>scheduler.close());
  return {...f,goal,gate,runtime,scheduler,ready};
}
describe('V29 actual process crash recovery',()=>{
  it('keeps OFF after a hard kill, retains evidence and never resumes its old checkpoint',async()=>{
    const f=await crash('off');expect(f.gate.view()).toMatchObject({desiredMode:'OFF',startedRounds:1,spentTokens:30});
    await f.manager.resumeInterrupted();await f.scheduler.tick();expect(f.calls).toHaveLength(0);expect(f.runtime.run.getStatus().running).toBe(false);
    expect(f.runtime.store.db.prepare("SELECT COUNT(*) n FROM tool_executions WHERE status='SUCCESS'").get()!.n).toBe(1);
    expect(f.gate.goals.get(f.goal.id).verifiedCount).toBe(1);
  },15000);
  it('resumes ON using its paid response and tool receipt once, without another started-round charge',async()=>{
    const f=await crash('on'),before=f.runtime.store.db.prepare("SELECT result FROM tool_executions WHERE tool='save_artifact'").get()!.result;
    await f.manager.resumeInterrupted();await vi.waitFor(()=>expect(f.runtime.run.getStatus().running).toBe(false));await f.work.tick();await f.scheduler.tick();
    expect(f.gate.view()).toMatchObject({startedRounds:1,completedRounds:1,spentTokens:60});expect(f.calls).toHaveLength(1);
    expect(f.runtime.store.db.prepare("SELECT result FROM tool_executions WHERE tool='save_artifact'").all()).toEqual([{result:before}]);expect(f.gate.goals.get(f.goal.id).status).toBe('COMPLETED');
  },15000);
  it('does not resend a request killed after dispatch or release its unknown token reservation',async()=>{
    const f=await crash('unknown'),reserved=f.gate.view().reservedTokens;expect(reserved).toBeGreaterThan(0);
    await f.manager.resumeInterrupted();await f.scheduler.tick();expect(f.calls).toHaveLength(0);expect(f.gate.view()).toMatchObject({observedState:'BLOCKED',reservedTokens:reserved});
    expect(()=>f.gate.control({desiredMode:'ON',runMode:'BOUNDED',requestedRounds:7,maxTokens:1000000,expectedRevision:f.gate.view().revision,idempotencyKey:crypto.randomUUID()})).toThrow('OWNER_OUTCOME_REVIEW_REQUIRED');
  },15000);
});
