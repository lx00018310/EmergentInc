import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CoreStore } from '@emergentinc/persistence';
import { InfrastructureFailureError, PromptBuilder, UsageMeter } from '@emergentinc/model';
import { ToolRegistry, ToolRuntime } from '@emergentinc/tools';
import { AgentStepRunner, RoundScheduler, DecisionCompiler, EffectRuntime } from '@emergentinc/runtime';
import { RunService } from '../src/services/run_service.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const response = (decision: unknown = { send_to: 'STOP' }) => ({ rawText: JSON.stringify(decision), usage: { promptTokens: 10, completionTokens: 5 } });
function directory() {
  const root = fs.mkdtempSync(join(tmpdir(), 'run-recovery-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function open(root: string, call = vi.fn(async () => response())) {
  fs.mkdirSync(join(root, 'live'), { recursive: true });
  const store = new CoreStore(join(root, 'ledger/v9_core.sqlite3'));
  const tools = new ToolRegistry(), runner = new AgentStepRunner({ workspaceRoot: root, store, provider: { call },
    toolRuntime: new ToolRuntime(tools), promptBuilder: new PromptBuilder(), usageMeter: new UsageMeter({ models: {} }) });
  const run = new RunService({ workspaceRoot: root, store,
    scheduler: new RoundScheduler({ workspaceRoot: root, store, stepRunner: runner, naturalWakeThreshold: 100 }), isMockMode: true });
  let closed = false;
  const close = () => { if (!closed) { store.close(); closed = true; } };
  cleanups.push(close);
  return { store, run, call, tools, close };
}
function seed(f: ReturnType<typeof open>, id = 'interrupted', rounds = 3) {
  f.store.pixels.upsertPixelAccount({ pixelId: '0_0_0', energy: 100000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
  f.store.runs.createRun({ run_id: id, start_round: 1, end_round: rounds, run_limit: 10000, run_spent: 0, run_reserved: 0,
    genesis_revision: 1, status: 'RUNNING', created_at: 1 });
  f.store.runs.createCheckpoint(id, 1);
  return f.store.messages.enqueueMessage({ runId: id, roundNum: 1, sender: 'human', recipient: '0_0_0', content: 'Continue work' });
}
const finished = async (f: ReturnType<typeof open>) => vi.waitFor(() => expect(f.run.getStatus().running).toBe(false));

async function crash(mode: string) {
  const root = directory(), child = spawn(process.execPath, ['--import', 'tsx', resolve('apps/server/tests/fixtures/run_recovery_child.ts'), root, mode],
    { cwd: resolve('.'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(child, 'exit');
  cleanups.push(async () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; });
  await vi.waitFor(() => {
    if (child.exitCode !== null) throw new Error(errors);
    expect(fs.existsSync(join(root, 'ready.json'))).toBe(true);
  }, { timeout: 10000 });
  child.kill('SIGKILL'); await exited;
  return { root, ...JSON.parse(fs.readFileSync(join(root, 'ready.json'), 'utf8')) };
}

describe('Run persistence and restart recovery', () => {
  it('survives a killed process, reuses paid responses and tool receipts, and keeps the original Run budget', async () => {
    const { root, runId, messageId } = await crash('receipts'), f = open(root);
    expect(f.store.runs.getCheckpoint(runId)).toMatchObject({ next_round: 2, completed_rounds: 1, round_started: 1 });
    expect(f.store.messages.getMessage(messageId)?.status).toBe('COMMITTED');
    const spent = f.store.runs.getRun(runId)!.run_spent;
    expect(fs.readFileSync(join(root, 'external-output.txt'), 'utf8')).toBe('written\n');
    // The database checkpoint remains authoritative even if the JSON projection was torn.
    fs.writeFileSync(join(root, 'live/world_state.json'), '{');
    expect(f.run.getWorldRound()).toBe(1);
    expect(await f.run.resumeInterrupted()).toBe(true);
    await finished(f);
    expect(f.store.runs.getLatestRun()).toMatchObject({ run_id: runId, run_limit: 10000, run_reserved: 0 });
    expect(f.store.runs.getLatestRun()!.run_spent).toBe(spent + 15);
    expect(f.call).toHaveBeenCalledTimes(1); // Only the saved tool feedback needs a new response.
    expect(fs.readFileSync(join(root, 'live/pixels/0_0_0/tips.md'), 'utf8')).toBe('Keep existing tips');
    expect(fs.readFileSync(join(root, 'external-output.txt'), 'utf8')).toBe('written\n');
    expect(f.store.db.prepare("SELECT COUNT(*) n FROM messages WHERE message_id LIKE 'feedback_tools_%'").get()!.n).toBe(1);
    expect(f.run.getStatus()).toMatchObject({ completed_rounds: 2, messages_processed: 3, result_status: 'STOPPED' });
    expect(await f.run.resumeInterrupted()).toBe(false);
  }, 15000);

  it('does not replay a model request killed after dispatch or refund its reservation', async () => {
    const { root, runId } = await crash('unknown'), f = open(root);
    const reserved = f.store.runs.getRun(runId)!.run_reserved;
    expect(reserved).toBeGreaterThan(0);
    expect(await f.run.resumeInterrupted()).toBe(false);
    expect(f.call).not.toHaveBeenCalled();
    expect(f.store.runs.getRun(runId)!.run_reserved).toBe(reserved);
    expect(f.run.getStatus().result_status).toBe('PAUSED_RECOVERY_REQUIRED');
  }, 15000);

  it('replays the frozen decision after a file write was interrupted', async () => {
    const { root } = await crash('mind'), f = open(root);
    expect(fs.readFileSync(join(root, 'live/pixels/0_0_0/pixel.md'), 'utf8')).toBe('partial');
    expect(await f.run.resumeInterrupted()).toBe(true); await finished(f);
    expect(fs.readFileSync(join(root, 'live/pixels/0_0_0/pixel.md'), 'utf8')).toBe('Durable mind');
    expect(f.call).not.toHaveBeenCalled();
  }, 15000);

  it('keeps a manual stop after the process is killed before its Run loop finalizes', async () => {
    const { root, runId } = await crash('manual'), f = open(root);
    expect(f.store.runs.getRun(runId)).toMatchObject({ status: 'RUNNING', stop_reason: 'USER_STOPPED' });
    expect(await f.run.resumeInterrupted()).toBe(false);
    expect(f.call).not.toHaveBeenCalled();
  }, 15000);

  it.each(['PROCESSING', 'RESERVED'] as const)('safely recovers a %s message before dispatch', async status => {
    const root = directory(), first = open(root), message = seed(first);
    if (status === 'RESERVED') first.store.budgets.reserve({ callId: 'not-sent', runId: 'interrupted', pixelId: '0_0_0', estimatedTokens: 100, messageId: message.messageId });
    first.store.messages.updateStatus(message.messageId, status); first.close();
    const f = open(root); expect(await f.run.resumeInterrupted()).toBe(true); await finished(f);
    expect(f.store.messages.getMessage(message.messageId)?.status).toBe('COMMITTED');
    expect(f.store.runs.getLatestRun()).toMatchObject({ run_id: 'interrupted', run_reserved: 0, run_spent: 15 });
  });

  it('resumes a known connection failure on next startup', async () => {
    const root = directory(), first = open(root, vi.fn(async () => { throw new InfrastructureFailureError('DNS failed'); }));
    seed(first); first.store.runs.updateRunStatus('interrupted', 'STOPPED', 'USER_STOPPED'); first.store.runs.setResumePending('interrupted', false);
    await first.run.start({ rounds: 2, runBudgetTokens: 10000 }); await finished(first);
    const id = first.store.runs.getLatestRun()!.run_id; expect(first.store.runs.getLatestRun()!.status).toBe('FAILED'); first.close();
    const f = open(root); expect(await f.run.resumeInterrupted()).toBe(true); await finished(f);
    expect(f.store.runs.getLatestRun()!.run_id).toBe(id); expect(f.call).toHaveBeenCalledTimes(1);
  });

  it('finishes the current step when suspending and resumes without another natural wake', async () => {
    const root = directory(); let release!: (value: ReturnType<typeof response>) => void;
    const first = open(root, vi.fn(() => new Promise<ReturnType<typeof response>>(r => { release = r; })));
    seed(first); first.store.runs.updateRunStatus('interrupted', 'STOPPED', 'USER_STOPPED'); first.store.runs.setResumePending('interrupted', false);
    await first.run.start({ rounds: 3, runBudgetTokens: 10000 });
    first.run.requestSuspend(); release(response({ message_md: 'Continue', send_to: 'SELF' })); await finished(first);
    const id = first.store.runs.getLatestRun()!.run_id;
    expect(first.store.runs.getLatestRun()!.stop_reason).toBe('SERVICE_SHUTDOWN'); first.close();
    const f = open(root); expect(await f.run.resumeInterrupted()).toBe(true); await finished(f);
    expect(f.store.runs.getLatestRun()!.run_id).toBe(id); expect(f.call).toHaveBeenCalledTimes(1);
  });

  it('persists a manual stop before a hard exit and never automatically resumes it', async () => {
    const root = directory(); let release!: (value: ReturnType<typeof response>) => void;
    const first = open(root, vi.fn(() => new Promise<ReturnType<typeof response>>(r => { release = r; })));
    seed(first); first.store.runs.updateRunStatus('interrupted', 'STOPPED', 'USER_STOPPED'); first.store.runs.setResumePending('interrupted', false);
    await first.run.start({ rounds: 3, runBudgetTokens: 10000 }); first.run.requestStop();
    expect(first.store.runs.getCheckpoint(first.store.runs.getLatestRun()!.run_id)?.resume_pending).toBe(0);
    release(response({ message_md: 'Pending', send_to: 'SELF' })); await finished(first); first.close();
    const f = open(root); expect(await f.run.resumeInterrupted()).toBe(false); expect(f.call).not.toHaveBeenCalled();
  });

  it.each(['RUN_BUDGET_EXHAUSTED', 'EXECUTION_BUDGET_EXHAUSTED', 'ROUND_LIMIT_REACHED', 'READ_LOOP_THRESHOLD_REACHED'] as const)('keeps %s stopped', async reason => {
    const f = open(directory()); seed(f); f.store.runs.updateRunStatus('interrupted', 'STOPPED', reason);
    expect(await f.run.resumeInterrupted()).toBe(false); expect(f.call).not.toHaveBeenCalled();
  });

  it('blocks uncertain tool outcomes and unfinished filesystem effects', async () => {
    const f = open(directory()), message = seed(f);
    f.store.messages.updateStatus(message.messageId, 'RESPONSE_STORED');
    f.store.toolExecutions.recordStarted({ operation_id: 'external-write', message_id: message.messageId, pixel_id: '0_0_0', op_index: 0, tool: 'write', args_hash: 'hash', started_at: 1 });
    expect(await f.run.resumeInterrupted()).toBe(false); expect(f.call).not.toHaveBeenCalled();
    f.store.db.prepare("DELETE FROM tool_executions").run();
    f.store.messages.updateStatus(message.messageId, 'PROCESSING');
    f.store.effects.recordEffect({ effect_id: 'body', message_id: message.messageId, effect_type: 'REPRODUCE', effect_index: 0, payload_hash: 'hash', status: 'PENDING', created_at: 1 });
    expect(await f.run.resumeInterrupted()).toBe(false); expect(f.call).not.toHaveBeenCalled();
  });

  it('commits internal effects and their receipt atomically', async () => {
    const f = open(directory()), message = seed(f);
    f.store.pixels.upsertPixelAccount({ pixelId: '1_0_0', energy: 100, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const effects = DecisionCompiler.compile({ decision: { energy_transfer: [{ target: '1_0_0', amount: 10 }] }, pixelId: '0_0_0', messageId: message.messageId, currentHop: 1 });
    const runtime = new EffectRuntime({ workspaceRoot: directory(), store: f.store, toolRuntime: new ToolRuntime(f.tools), runId: 'interrupted', round: 1 });
    const record = vi.spyOn(f.store.effects, 'recordEffect').mockImplementationOnce(() => { throw new Error('Interrupted receipt'); });
    await expect(runtime.applyEffects(effects)).rejects.toThrow('Interrupted receipt');
    expect(f.store.pixels.getPixelAccount('1_0_0')!.energy).toBe(100);
    record.mockRestore(); await runtime.applyEffects(effects); await runtime.applyEffects(effects);
    expect(f.store.pixels.getPixelAccount('1_0_0')!.energy).toBe(110);
  });

  it('enforces the original remaining token budget after restart', async () => {
    const f = open(directory()); seed(f);
    f.store.db.prepare("UPDATE runs SET run_spent=9999 WHERE run_id='interrupted'").run();
    expect(await f.run.resumeInterrupted()).toBe(true); await finished(f);
    expect(f.call).not.toHaveBeenCalled();
    expect(f.store.runs.getLatestRun()).toMatchObject({ run_limit: 10000, run_spent: 9999, stop_reason: 'RUN_BUDGET_EXHAUSTED' });
    expect(await f.run.resumeInterrupted()).toBe(false);
  });

  it('does not count an interrupted execution round twice or consume the ordinary World queue', async () => {
    const f = open(directory()); seed(f, 'old');
    f.store.runs.updateRunStatus('old', 'STOPPED', 'USER_STOPPED');
    const person = f.store.qianji.createProfile({ careerStatus: 'active' });
    const binding = f.store.qianji.createBinding({ qianjiId: person.qianjiId, pixelId: '0_0_0', incarnation: 1 });
    const execution = f.store.executions.create({ kind: 'mission', subjectId: 'mission', budgetTokens: 10000, roundsLimit: 2,
      inputSnapshot: {}, toolsSnapshot: [], bindingIds: [binding.bindingId] });
    f.store.executions.transition(execution.executionId, 'ready', 'running');
    f.store.runs.createRun({ run_id: 'scoped', execution_id: execution.executionId, start_round: 1, end_round: 2, run_limit: 10000,
      run_spent: 0, run_reserved: 0, genesis_revision: 1, status: 'RUNNING', created_at: 2 });
    f.store.runs.createCheckpoint('scoped', 1);
    f.store.executions.beginScopeRound(execution.executionId, 'scoped', 1);
    f.store.db.prepare("UPDATE run_checkpoints SET round_started=1 WHERE run_id='scoped'").run();
    f.store.messages.enqueueMessage({ executionId: execution.executionId, roundNum: 1, sender: 'human', recipient: '0_0_0', content: 'Scoped work' });
    expect(await f.run.resumeInterrupted()).toBe(true); await finished(f);
    expect(f.store.executions.get(execution.executionId)).toMatchObject({ roundsUsed: 1, status: 'awaiting_review', spentTokens: 15 });
    expect(f.store.messages.listRecentMessages().find(m => !m.executionId)!.status).toBe('QUEUED');
    expect(f.run.getWorldRound()).toBe(0);
    f.store.runs.setResumePending('scoped', true);
    f.store.runs.updateRunStatus('scoped', 'FAILED', 'INFRASTRUCTURE_FAILURE');
    expect(await f.run.resumeInterrupted()).toBe(false);
  });

  it('leaves pre-upgrade Runs without a checkpoint for manual recovery', async () => {
    const f = open(directory()); seed(f);
    f.store.db.prepare("DELETE FROM run_checkpoints").run();
    expect(await f.run.resumeInterrupted()).toBe(false);
    expect(f.run.getStatus().result_status).toBe('PAUSED_RECOVERY_REQUIRED');
  });
});
