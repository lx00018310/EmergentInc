import { afterEach, describe, expect, it, vi } from 'vitest';
import { OutcomeUnknownError } from '@emergentinc/model';
import { OwnerAutomationGate } from '../src/services/owner_automation_gate.js';
import { OwnerOverviewService } from '../src/services/owner_overview_service.js';
import { goalFixture } from './fixtures/owner_goals.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

describe('company fault boundaries', () => {
  it('converges an ECONNRESET task and goal while unrelated work continues with the unknown charge held', async () => {
    const f = goalFixture(); cleanups.push(f.close);
    const failed = f.goal('Research connection failure', 'manual');
    f.on();
    f.respond(async () => { throw new OutcomeUnknownError('ECONNRESET after dispatch'); });
    await f.scheduler.tick();
    await vi.waitFor(() => expect(f.manager.list().some(w => w.running)).toBe(false));
    await f.work.tick(); await f.scheduler.tick();
    expect(f.gate.goals.get(failed.id)).toMatchObject({status: 'BLOCKED', reason: 'CALL_OUTCOME_UNKNOWN'});
    expect(f.work.view().tasks.find(t => t.goalId === failed.id)).toMatchObject({state: 'BLOCKED', reason: 'CALL_OUTCOME_UNKNOWN'});
    expect(f.gate.view()).toMatchObject({desiredMode: 'ON', reason: null});
    const held = f.gate.budget.view().reservedMicros;
    expect(held).toBeGreaterThan(0);
    const other = f.goal('Marketing independent draft', 'manual');
    f.respond(async () => ({rawText: JSON.stringify({owner_reply: 'Independent result', send_to: 'STOP'}), usage: {promptTokens: 20, completionTokens: 10, cachedTokens: 0}}));
    await f.scheduler.tick(); await f.finish();
    expect(f.gate.goals.get(other.id).status).toBe('WAITING_APPROVAL');
    expect(f.gate.budget.view().reservedMicros).toBe(held);
    expect(f.gate.budget.view().availableMicros).toBe(f.gate.budget.view().totalMicros - held - f.gate.budget.view().spentMicros);
    const view = await new OwnerOverviewService(f.worlds, f.work).bossOverview();
    expect(view.alerts.filter(a => a.goalId === failed.id)).toHaveLength(1);
    expect(view.alerts.some(a => a.id === 'automation:review')).toBe(false);
  });

  it('preserves manual intent across an unknown response, safe budget adjustment, and restart', async () => {
    const f = goalFixture(); cleanups.push(f.close); f.on();
    f.respond(async () => { throw new OutcomeUnknownError('Connection reset after dispatch'); });
    await expect(f.gate.provider(f.provider, f.meter).call({model: 'test', messages: [], promptHash: 'unknown', maxTokens: 200})).rejects.toThrow();
    const held = f.gate.budget.view().reservedMicros;
    f.off();
    f.gate.budget.configure({tokenMillions: 2, unitPrice: 100, priceCurrency: 'CNY', expectedRevision: f.gate.budget.view().revision});
    const restarted = new OwnerAutomationGate(f.control);
    expect(restarted.view().desiredMode).toBe('OFF');
    expect(restarted.budget.view().reservedMicros).toBe(held);
    expect(restarted.budget.view().availableMicros).toBe(200_000_000 - held);
  });

  it('does not rewrite ON when recovering a process that died with a sent call', () => {
    const f = goalFixture(); cleanups.push(f.close); f.on();
    f.control.db.prepare("INSERT INTO owner_model_permits VALUES('interrupted','initial',NULL,NULL,NULL,'SENT',200,NULL,NULL,?)").run(Date.now());
    f.gate.budget.reserve('interrupted', 516);
    const restarted = new OwnerAutomationGate(f.control);
    expect(restarted.view()).toMatchObject({desiredMode: 'ON', observedState: 'IDLE'});
    expect(restarted.modelCalls()[0].id).toBe('interrupted');
    expect(restarted.budget.view().reservedMicros).toBe(516);
  });
  it('keeps a separate operational safety hold without rewriting or auto-resuming manual intent',()=>{
    const f=goalFixture();cleanups.push(f.close);f.on();
    f.gate.halt('OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION');
    expect(f.gate.view()).toMatchObject({desiredMode:'ON',observedState:'BLOCKED',reason:'OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION'});
    expect(f.gate.isOn()).toBe(false);f.off();
    f.gate.budget.configure({tokenMillions:2,unitPrice:100,priceCurrency:'CNY',expectedRevision:f.gate.budget.view().revision});
    const restarted=new OwnerAutomationGate(f.control);expect(restarted.view().desiredMode).toBe('OFF');expect(restarted.isOn()).toBe(false);
    expect(()=>restarted.ensureRunning('owner',0,'resume')).toThrow('OWNER_PROVIDER_USAGE_EXCEEDED_RESERVATION');
  });
});
