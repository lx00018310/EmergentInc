import { afterEach, describe, expect, it } from 'vitest';
import { UsageMeter } from '@emergentinc/model';
import { goalFixture } from './fixtures/owner_goals.js';

const close:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of close.splice(0).reverse())await f();});
const request={model:'test',messages:[{role:'user' as const,content:'Retain an actual draft'}],maxTokens:200,promptHash:'frozen',auditCallId:'stable-operation'};
const response={rawText:'Actual response',usage:{promptTokens:20,completionTokens:10,cachedTokens:0}};
describe('company monetary receipts',()=>{
  it('settles a late response at the reserved price while OFF and applies the receipt once',()=>{
    const f=goalFixture();close.push(f.close);f.on();
    const config={models:{test:{input_cost_per_million:1,output_cost_per_million:2,cached_cost_per_million:1,currency:'CNY'}}},meter=new UsageMeter(config);
    const call=f.gate.models.prepare(request,meter,{sourceKind:'owner_chat'});f.gate.models.failure(call.permitId,false);
    config.models.test.input_cost_per_million=100;config.models.test.output_cost_per_million=200;f.off();
    f.gate.models.response(call.permitId,response);const settled=f.gate.budget.view();
    expect(settled).toMatchObject({spentMicros:40,reservedMicros:0});expect(f.gate.view().desiredMode).toBe('OFF');
    f.gate.models.response(call.permitId,response);expect(f.gate.budget.view()).toEqual(settled);
    expect(()=>f.gate.models.response(call.permitId,{...response,rawText:'Conflicting response'})).toThrow('OWNER_BILLING_RECEIPT_CONFLICT');
    expect(f.gate.models.storedResponse(call.permitId)).toEqual(response);
  });
  it('returns a persisted response for the same paid operation without reserving or calling twice',async()=>{
    const f=goalFixture();close.push(f.close);f.on();f.respond(async()=>response);
    const provider=f.gate.provider(f.provider,f.meter);await expect(provider.call(request)).resolves.toEqual(response);
    const before=f.gate.budget.view();await expect(provider.call(request)).resolves.toEqual(response);
    expect(f.calls).toHaveLength(1);expect(f.gate.budget.view()).toEqual(before);
    await expect(provider.call({...request,promptHash:'different'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');expect(f.calls).toHaveLength(1);
  });
  it('retains unknown fees even when text is stored and rejects a conflicting late manual bill',()=>{
    const f=goalFixture();close.push(f.close);f.on();
    const call=f.gate.models.prepare(request,f.meter,{sourceKind:'owner_chat'});f.gate.models.response(call.permitId,{rawText:'Stored text without usage'});
    expect(f.gate.budget.view().reservedMicros).toBeGreaterThan(0);expect(f.gate.models.storedResponse(call.permitId)?.rawText).toBe('Stored text without usage');
    expect(f.gate.view().desiredMode).toBe('ON');expect(f.gate.budget.view().unknownCalls).toBe(1);
  });
  it('rolls back every money row when admission is denied',()=>{
    const f=goalFixture();close.push(f.close);
    expect(()=>f.gate.models.prepare(request,f.meter,{sourceKind:'owner_chat'})).toThrow('OWNER_AUTOMATION_OFF');
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM owner_model_permits').get()!.n).toBe(0);
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM company_model_dispatches').get()!.n).toBe(0);
  });
});
