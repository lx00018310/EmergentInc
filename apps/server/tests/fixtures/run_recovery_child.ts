import * as fs from 'node:fs';
import { join } from 'node:path';
import { CoreStore } from '@emergentinc/persistence';
import { PromptBuilder, UsageMeter } from '@emergentinc/model';
import { ToolRegistry, ToolRuntime } from '@emergentinc/tools';
import { AgentStepRunner, RoundScheduler } from '@emergentinc/runtime';
import { RunService } from '../../src/services/run_service.js';

const [root, mode] = process.argv.slice(2);
const store = new CoreStore(join(root, 'ledger/v9_core.sqlite3'));
fs.mkdirSync(join(root, 'live/pixels/0_0_0'), { recursive: true });
fs.writeFileSync(join(root, 'live/pixels/0_0_0/state.json'), JSON.stringify({ last_active_round: 0 }));
fs.writeFileSync(join(root, 'live/pixels/0_0_0/tips.md'), 'Keep existing tips');
fs.writeFileSync(join(root, 'live/pixels/0_0_0/pixel.md'), 'Durable mind');
store.pixels.upsertPixelAccount({ pixelId: '0_0_0', energy: 100000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
const message = store.messages.enqueueMessage({ roundNum: 1, hop: 20, sender: 'human', recipient: '0_0_0', content: 'Complete two steps' });
const halt = () => {
  fs.writeFileSync(join(root, 'ready.json'), JSON.stringify({ runId: store.runs.getLatestRun()!.run_id, messageId: message.messageId }));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const tools = new ToolRegistry();
tools.register({ name: 'write_once', description: 'Persist test output', enabled: true, effect: 'write', timeout_seconds: 1,
  input_schema: { type: 'object', properties: {}, required: [] } }, async (_args, ctx) => {
  fs.appendFileSync(join(root, 'external-output.txt'), 'written\n');
  return { operation_id: ctx.operationId, tool: 'write_once', status: 'SUCCESS', output: 'saved', duration_ms: 0, truncated: false, costCny: 0 };
});
let calls = 0;
const record = store.effects.recordEffect.bind(store.effects);
store.effects.recordEffect = effect => {
  if (mode === 'mind' && effect.effect_type === 'UPDATE_MIND') {
    fs.writeFileSync(join(root, 'live/pixels/0_0_0/pixel.md'), 'partial');
    halt();
  }
  record(effect);
};
const runner = new AgentStepRunner({ workspaceRoot: root, store, toolRuntime: new ToolRuntime(tools), promptBuilder: new PromptBuilder(),
  usageMeter: new UsageMeter({ models: {} }), provider: { async call() {
    if (mode === 'unknown') halt();
    if (mode === 'manual') { run.requestStop(); halt(); }
    return { rawText: JSON.stringify(mode === 'mind' ? { send_to: 'STOP' } : ++calls === 1 ? { message_md: 'Next step', send_to: 'SELF' }
      : { operations: [{ tool: 'write_once', args: {} }], send_to: 'STOP' }), usage: { promptTokens: 10, completionTokens: 5 } };
  } } });
const commit = store.messages.commitMessage.bind(store.messages);
store.messages.commitMessage = (id, runId) => {
  if (calls === 2) halt();
  commit(id, runId);
};
const run = new RunService({ workspaceRoot: root, store,
  scheduler: new RoundScheduler({ workspaceRoot: root, store, stepRunner: runner, naturalWakeThreshold: 100 }), isMockMode: true });
await run.start({ rounds: 3, runBudgetTokens: 10000 });
