import {afterEach,describe,expect,it} from 'vitest';
import {CompanyAgentService} from '../src/services/company_agent_service.js';
import {goalFixture} from './fixtures/owner_goals.js';
import * as fs from 'node:fs';
import {join} from 'node:path';
const close:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of close.splice(0).reverse())await f();});
describe('company identity registry',()=>{
  it('creates and deduplicates an approved role without a World, Core, Current or paid request',()=>{
    const f=goalFixture();close.push(f.close);const agents=new CompanyAgentService(f.control,f.root),before=f.registry.list().length;
    const input={id:'worker_approved_role',name:'Research',role:'Research',instruction:'Retain a verifiable source-backed draft'};
    expect(agents.create(input)).toMatchObject({id:input.id,legacyWorldId:null,status:'ACTIVE'});expect(agents.create(input).id).toBe(input.id);
    expect(f.registry.list()).toHaveLength(before);expect(fs.existsSync(join(agents.directory(input.id),'ledger'))).toBe(false);expect(fs.existsSync(join(agents.directory(input.id),'generations'))).toBe(false);expect(f.calls).toHaveLength(0);
    expect(()=>agents.create({...input,role:'Changed role'})).toThrow('OWNER_REQUEST_CHANGED');
  });
  it('imports old identities and asset directories once without importing their run state as availability',()=>{
    const f=goalFixture();close.push(f.close);const agents=new CompanyAgentService(f.control,f.root);
    f.control.db.prepare("INSERT INTO world_recovery_blocks VALUES(?,'G0001',?,?)").run(f.a.world_id,'Uncertain historical execution',Date.now());
    expect(agents.importLegacy()).toBe(2);expect(agents.importLegacy()).toBe(0);
    expect(agents.get(f.a.qianji_id)).toMatchObject({status:'ACTIVE',legacyWorldId:f.a.world_id});expect(agents.directory(f.a.qianji_id)).toBe(f.registry.directory(f.a.world_id));expect(f.calls).toHaveLength(0);
  });
});
