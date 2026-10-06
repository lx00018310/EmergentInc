import { afterEach, beforeEach, expect, it } from 'vitest';
import { CoreStore, BudgetExceededError, SpendBlockedError } from '../src/index.js';

let store: CoreStore;
beforeEach(() => {
  store = new CoreStore(':memory:');
  for (const pixelId of ['gateway', 'neighbor']) store.pixels.upsertPixelAccount({ pixelId, energy: 322, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
  store.runs.createRun({ run_id: 'r', start_round: 1, run_limit: 1000000, run_spent: 0, run_reserved: 0, genesis_revision: 1, status: 'RUNNING', created_at: 1 });
});
afterEach(() => store.close());
const reserve = (callId: string, pixelId = 'gateway') => store.budgets.reserve({ callId, runId: 'r', pixelId, estimatedTokens: 500 });

it('keeps the policy off by default and replenishes only the authorized gateway', () => {
  expect(() => reserve('off')).toThrow(BudgetExceededError);
  store.setUnlimitedEnergyPolicy(pixelId => pixelId === 'gateway');
  reserve('on');
  expect(store.pixels.getPixelAccount('gateway')?.energy).toBe(100000);
  expect(() => reserve('neighbor', 'neighbor')).toThrow(BudgetExceededError);
  expect(store.pixels.getPixelAccount('neighbor')?.energy).toBe(322);
  const reward = store.ledger.listEntriesByPixel('gateway').find(entry => entry.entry_type === 'external_reward')!;
  expect(JSON.parse(reward.details!).source).toBe('owner_infinite_energy');
});

it('records actual spend and keeps the gateway alive when usage exceeds its reserved amount', () => {
  store.setUnlimitedEnergyPolicy(pixelId => pixelId === 'gateway');
  reserve('on');
  store.budgets.settle({ callId: 'on', actualTokens: 150000, costCny: null });
  expect(store.pixels.getPixelAccount('gateway')).toMatchObject({ energy: 1, active: true });
  expect(store.budgets.getGlobalBudget()?.totalSpent).toBe(150000);
  expect(store.runs.getRun('r')?.run_spent).toBe(150000);
  store.budgets.settle({ callId: 'on', actualTokens: 150000, costCny: null });
  expect(store.budgets.getGlobalBudget()?.totalSpent).toBe(150000);
});

it('retains Run budget and refund-deficit gates and rolls back rejected funding', () => {
  store.setUnlimitedEnergyPolicy(() => true);
  store.db.prepare("UPDATE runs SET run_limit=100 WHERE run_id='r'").run();
  expect(() => reserve('budget')).toThrow(BudgetExceededError);
  expect(store.pixels.getPixelAccount('gateway')?.energy).toBe(322);
  expect(store.ledger.listEntriesByPixel('gateway')).toHaveLength(0);
  store.db.prepare("UPDATE pixel_accounts SET refund_deficit_tokens=1 WHERE pixel_id='gateway'").run();
  expect(() => reserve('deficit')).toThrow(SpendBlockedError);
  store.ensureUnlimitedEnergy('gateway', 500, 'deficit');
  expect(store.pixels.getPixelAccount('gateway')?.energy).toBe(322);
});

it('does not resurrect inactive carriers or duplicate an automatic reward on replay', () => {
  store.setUnlimitedEnergyPolicy(() => true);
  store.pixels.setActive('neighbor', false);
  store.ensureUnlimitedEnergy('neighbor', 1000, 'inactive');
  expect(store.pixels.getPixelAccount('neighbor')).toMatchObject({ active: false, energy: 322 });
  store.ensureUnlimitedEnergy('gateway', 1000, 'once');
  store.db.prepare("UPDATE pixel_accounts SET energy=10 WHERE pixel_id='gateway'").run();
  store.ensureUnlimitedEnergy('gateway', 1000, 'once');
  expect(store.pixels.getPixelAccount('gateway')?.energy).toBe(10);
  expect(store.ledger.listEntriesByPixel('gateway')).toHaveLength(1);
});
