import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { WorldRegistryStore } from '@emergentinc/persistence';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { goalFixture } from './fixtures/owner_goals.js';
import { createServer } from '../src/app.js';

const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn();});
describe('V29 durable Owner goal management',()=>{
  it('persists revisions, immutable snapshots and soft archives without touching previous task tables',async()=>{
    const f=goalFixture();cleanups.push(f.close);const goal=f.goal();expect(fs.existsSync(f.control.db.dbPath+'.pre-v29.bak')).toBe(false);
    const edit={title:'Revised',objective:'Inspect a real draft',acceptance:{kind:'artifact',filename:'revised.md',minBytes:12},maxTokens:999999,expectedRevision:goal.revision,idempotencyKey:crypto.randomUUID()};
    const changed=f.gate.goals.edit(goal.id,edit);expect(f.gate.goals.edit(goal.id,edit)).toEqual(changed);
    expect(()=>f.gate.goals.edit(goal.id,{...edit,idempotencyKey:crypto.randomUUID()})).toThrow('OWNER_REVISION_CONFLICT');
    expect(changed.specificationRevision).toBe(2);expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_goal_revisions').get()!.n).toBe(2);
    let current=changed;
    for(const action of ['pause','resume','stop','reopen','archive','restore'])current=f.gate.goals.action(goal.id,{action,expectedRevision:current.revision,idempotencyKey:crypto.randomUUID()});
    expect(current.status).toBe('PAUSED');expect(current.specificationRevision).toBe(2);expect(f.gate.goals.detail(goal.id).events).toHaveLength(8);
    const reopened=new WorldRegistryStore(f.control.db.dbPath),gate=new OwnerAutomationGate(reopened);expect(gate.goals.get(goal.id).title).toBe('Revised');expect(gate.view().desiredMode).toBe('OFF');reopened.close();
    expect(f.control.db.prepare('PRAGMA table_info(owner_work_tasks)').all()).toHaveLength(12);
  });
  it('uses only company quota, rejects extra command fields and preserves original goal content',async()=>{
    const f=goalFixture();cleanups.push(f.close);
    f.on(7,0);expect(f.gate.view()).toMatchObject({desiredMode:'ON',maxTokens:0,observedState:'IDLE'});expect(f.gate.isOn()).toBe(true);expect(()=>f.gate.goals.create({title:'Injected',objective:'x',acceptance:{kind:'manual',description:'x'},maxTokens:2,idempotencyKey:crypto.randomUUID(),handler:'shell'})).toThrow();
    const goal=f.goal();expect(()=>f.gate.goals.action(goal.id,{action:'completed',expectedRevision:1,idempotencyKey:crypto.randomUUID()})).toThrow();expect(f.gate.goals.get(goal.id).objective).toBe(goal.objective);expect(f.calls).toHaveLength(0);
  });
  it('protects goal/control APIs with Owner auth and enforces 409 CAS plus idempotent retries',async()=>{
    const f=goalFixture();cleanups.push(f.close);const app=await createServer({workspaceRoot:f.root,worlds:f.worlds,ownerAuth:{secret:'x'.repeat(40),secureCookies:false}});cleanups.push(()=>app.close());
    expect((await app.inject({url:'/api/owner/goals'})).statusCode).toBe(401);
    const approval={desiredMode:'OFF',expectedRevision:0,idempotencyKey:crypto.randomUUID()};
    expect((await app.inject({method:'POST',url:'/api/owner/automation',payload:approval})).statusCode).toBe(401);
    const login=await app.inject({method:'POST',url:'/api/login',payload:{secret:'x'.repeat(40)}}),cookie=String(login.headers['set-cookie']).split(';')[0]!;
    const quota=await app.inject({method:'POST',url:'/api/owner/automation',headers:{cookie},payload:approval});
    expect(quota.statusCode).toBe(200);expect(quota.json()).toMatchObject({maxTokens:0,desiredMode:'OFF',spentTokens:0});
    expect((await app.inject({method:'POST',url:'/api/owner/automation',headers:{cookie},payload:approval})).json()).toEqual(quota.json());
    const input={title:'HTTP draft',objective:'Inspect the current market',maxTokens:100000,acceptance:{kind:'artifact',filename:'result.md',minBytes:10},idempotencyKey:crypto.randomUUID()};
    const first=await app.inject({method:'POST',url:'/api/owner/goals',headers:{cookie},payload:input});expect(first.statusCode).toBe(200);
    expect((await app.inject({method:'POST',url:'/api/owner/goals',headers:{cookie},payload:input})).json()).toEqual(first.json());
    const id=first.json().id;expect((await app.inject({method:'PATCH',url:`/api/owner/goals/${id}`,headers:{cookie},payload:{...input,expectedRevision:0,idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:'/api/owner/automation',headers:{cookie,origin:'http://evil.test'},payload:{desiredMode:'OFF',expectedRevision:0,idempotencyKey:crypto.randomUUID()}})).statusCode).toBe(403);
    expect((await app.inject({url:'/api/boss/overview',headers:{cookie}})).json().goals).toHaveLength(1);
  });
});
