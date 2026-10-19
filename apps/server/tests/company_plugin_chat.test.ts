import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { CompanyAgentService } from '../src/services/company_agent_service.js';
import { CompanyToolService } from '../src/services/company_tool_service.js';
import { CompanyPluginService } from '../src/services/company_plugin_service.js';
import { goalFixture } from './fixtures/owner_goals.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
const CARD_HTML = '<!doctype html><html><body><p>Summary</p></body></html>';
const DETAIL_HTML = '<!doctype html><html><body><p>Detail</p></body></html>';
const SUBMIT_FIELDS = { pluginId: 'marketing', version: '1.0.0', title: 'Marketing summary', titleZh: '营销摘要', viewKey: 'marketing-summary', cardTitle: 'Marketing summary', cardTitleZh: '营销摘要', activate: true };

function fixture(options: { bound?: boolean; approved?: boolean; intent?: boolean } = {}) {
  const f = goalFixture(); cleanups.push(f.close); f.on();
  const plugins = new CompanyPluginService(f.control, f.root);
  const agents = new CompanyAgentService(f.control, f.root);
  const actor = agents.create({ id: 'worker_plugin_dev', name: 'Builder', role: 'Builder', instruction: 'Build verified card pages only' });
  const tools = new CompanyToolService({ gate: f.gate, agents, artifacts: f.work.artifacts, recruit: f.work.requestRecruit.bind(f.work), contracts: {}, plugins });
  if (options.bound) {
    const goal = f.goal('Build the marketing summary card', 'manual');
    const plan = { summary: 'Build and submit a read-only card', nodes: [{ key: 'build', title: 'Build', instruction: 'Save card pages and submit them', dependsOn: [], trigger: { kind: 'once' as const }, filename: 'card.md' }] };
    f.gate.proposals.plans.install(goal.id, plan, Boolean(options.approved));
    // An unapproved plan must not dispatch; the goal itself stays schedulable so the attempt exists for the tool check.
    if (!options.approved) f.gate.goals.state(goal.id, 'READY');
    if (options.approved) f.gate.proposals.plans.claim(goal.id, 'build', 'plugin-dispatch');
    f.control.db.prepare("INSERT INTO owner_goal_steps VALUES('plugin-dispatch',?,1,'plugin-dispatch','QUEUED',0,?)").run(goal.id, Date.now());
    f.control.db.prepare("INSERT INTO owner_goal_dispatches VALUES('plugin-dispatch',?,1,'plugin-task',NULL,?,'QUEUED',NULL)").run(goal.id, actor.id);
    if (options.intent) f.gate.goals.event(goal.id, 'plugin_build_intent', { requestKey: 'owner-request', visibilityIntent: true });
  }
  f.control.db.prepare("INSERT INTO owner_work_tasks VALUES('plugin-task','plugin-request',?,'Builder','Build the authorized card','QUEUED',NULL,NULL,NULL,NULL,?,?)").run(actor.id, Date.now(), Date.now());
  const binding = options.bound ? { goalId: String(f.control.db.prepare("SELECT goal_id FROM owner_goal_dispatches WHERE id='plugin-dispatch'").get()!.goal_id), specificationRevision: 1, dispatchId: 'plugin-dispatch' } : undefined;
  const command = f.work.execution.claim('plugin-task', actor.id, 1, 4, binding, { prepare: () => {} });
  f.work.execution.receipt({ schema: 1, eventId: `evt_${command.attemptId}`, attemptId: command.attemptId, fence: command.fence, sequence: 1, kind: 'started' });
  const attemptId = command.attemptId;
  let sequence = 2;
  const saveArtifact = (name: string, content: string) => {
    const operationId = `${attemptId}:tool:${sequence}:${name}`;
    const flat = operationId.replaceAll(':', '_');
    const directory = join(f.root, 'system/executions', attemptId, 'evidence', attemptId, 'snapshots', flat, '0_0_0');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(join(directory, name), content);
    f.work.artifacts.record(attemptId, flat, { operation_id: flat, tool: 'save_artifact', status: 'SUCCESS',
      output: { pixel_id: '0_0_0', filename: name, size_bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
        snapshot_relative_path: `evidence/${attemptId}/snapshots/${flat}/0_0_0/${name}` }, duration_ms: 0, truncated: false, costCny: 0 } as any, join(f.root, 'system/executions', attemptId));
    sequence++;
    return name;
  };
  const execute = (name: string, args: any) => tools.execute(attemptId, `${attemptId}:tool:${sequence++}:0`, name, args);
  return { ...f, plugins, tools, actor, attemptId, saveArtifact, execute };
}

describe('owner chat to plugin closed loop', () => {
  it('activates a displayed card only for a goal carrying the exact owner plugin-build intent', async () => {
    const f = fixture({ bound: true, approved: true, intent: true });
    const card = f.saveArtifact('card.html', CARD_HTML), detail = f.saveArtifact('detail.html', DETAIL_HTML);
    const result = await f.execute('SUBMIT_PLUGIN_CANDIDATE', { ...SUBMIT_FIELDS, files: [{ name: 'cards/marketing-summary/card.html', artifact: card }, { name: 'cards/marketing-summary/detail.html', artifact: detail }], expectedRevision: 0 });
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toMatchObject({ pluginId: 'marketing', candidate: false, authorized: true, displayed: true });
    const cards = f.plugins.cards();
    expect(cards.map(c => c.id)).toEqual(['001']);
    expect(cards[0]!.visible).toBe(true);
    expect(f.plugins.asset('marketing', String(result.output.hash), 'cards/marketing-summary/card.html').bytes.toString()).toBe(CARD_HTML);
  });

  it('stores an approved-goal submission without the owner intent only as a hidden candidate', async () => {
    const f = fixture({ bound: true, approved: true, intent: false });
    const card = f.saveArtifact('card.html', CARD_HTML), detail = f.saveArtifact('detail.html', DETAIL_HTML);
    const result = await f.execute('SUBMIT_PLUGIN_CANDIDATE', { ...SUBMIT_FIELDS, files: [{ name: 'cards/marketing-summary/card.html', artifact: card }, { name: 'cards/marketing-summary/detail.html', artifact: detail }], expectedRevision: 0 });
    expect(result.status).toBe('SUCCESS');
    expect(result.output).toMatchObject({ candidate: true, candidateOnly: true });
    expect(f.plugins.cards()).toEqual([]);
  });

  it('rejects submissions from unapproved goals and without the plugin host', async () => {
    const f = fixture({ bound: true, approved: false, intent: true });
    const card = f.saveArtifact('card.html', CARD_HTML), detail = f.saveArtifact('detail.html', DETAIL_HTML);
    expect(await f.execute('SUBMIT_PLUGIN_CANDIDATE', { ...SUBMIT_FIELDS, files: [{ name: 'cards/marketing-summary/card.html', artifact: card }, { name: 'cards/marketing-summary/detail.html', artifact: detail }], expectedRevision: 0 }))
      .toMatchObject({ status: 'FAILED', error_code: 'PLUGIN_BUILD_NOT_AUTHORIZED' });
    expect(f.plugins.cards()).toEqual([]);
    const g = fixture({ bound: false });
    const artifact = g.saveArtifact('card.html', CARD_HTML);
    expect(await g.execute('SUBMIT_PLUGIN_CANDIDATE', { ...SUBMIT_FIELDS, files: [{ name: 'cards/x/card.html', artifact }] }))
      .toMatchObject({ status: 'FAILED', error_code: 'PLUGIN_BUILD_NOT_AUTHORIZED' });
  });

  it('refuses agent-reported local paths: every file must be a verified artifact of this attempt', async () => {
    const f = fixture({ bound: true, approved: true, intent: true });
    expect(await f.execute('SUBMIT_PLUGIN_CANDIDATE', { ...SUBMIT_FIELDS, files: [{ name: 'cards/marketing-summary/card.html', artifact: 'card.html' }, { name: 'cards/marketing-summary/detail.html', artifact: 'detail.html' }] }))
      .toMatchObject({ status: 'FAILED', error_code: 'ARTIFACT_NOT_FOUND' });
    expect(fs.existsSync(join(f.root, 'assets', 'plugins')) ? fs.readdirSync(join(f.root, 'assets', 'plugins')) : []).toEqual([]);
  });

  it('handles deterministic chat card commands without the model and rejects unknown or stale ids', async () => {
    const f = fixture({ bound: true, approved: true, intent: true });
    const card = f.saveArtifact('card.html', CARD_HTML), detail = f.saveArtifact('detail.html', DETAIL_HTML);
    await f.execute('SUBMIT_PLUGIN_CANDIDATE', { ...SUBMIT_FIELDS, files: [{ name: 'cards/marketing-summary/card.html', artifact: card }, { name: 'cards/marketing-summary/detail.html', artifact: detail }], expectedRevision: 0 });
    const app = await (await import('../src/app.js')).createServer({ workspaceRoot: f.root, worlds: f.worlds });
    cleanups.push(() => app.close());
    const chat = (question: string, key: string) => app.inject({ method: 'POST', url: '/api/owner/chat', payload: { question, history: [], language: 'zh-CN', requestKey: key } });
    const hide = await chat('移除 001 卡片', 'chat-hide-001-key');
    expect(hide.statusCode, hide.body).toBe(200);
    expect(hide.json().answer).toContain('001');
    expect(f.plugins.cards(true)).toEqual([]);
    const show = await chat('显示 001', 'chat-show-001-key');
    expect(show.json().answer).toContain('001');
    expect(f.plugins.cards(true).map(c => c.id)).toEqual(['001']);
    const missing = await chat('移除 009 卡片', 'chat-hide-009-key');
    expect(missing.json().answer).toContain('009');
    expect(() => f.plugins.action('001', { action: 'hide', expectedRevision: 999, idempotencyKey: 'stale-chat-hide-001' })).toThrow('PLUGIN_REVISION_CONFLICT');
    // A repeated identical request is idempotent: no model call, no duplicate change.
    const again = await chat('移除 001 卡片', 'chat-hide-001-key');
    expect(again.json().answer).toBe(hide.json().answer);
    expect(f.calls).toHaveLength(0);
  });
});
