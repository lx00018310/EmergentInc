import * as fs from 'node:fs';
import * as path from 'node:path';
import { CurrentStore, LineageStore, WorldRegistryStore, readGenome } from '@emergentinc/persistence';
import { OpenAICompatibleProvider, UsageMeter, type ModelProvider } from '@emergentinc/model';
import { runtimeConfig } from './runtime_config.js';
import { assertBossWorkspace } from './boss_workspace.js';
import { createServer } from './app.js';
import { WorldRegistryService } from './services/world_registry_service.js';
import { WorldRuntimeManager } from './services/world_runtime_manager.js';
import { PaymentService } from './services/payment_service.js';
import { PaymentMonitor } from './services/payment_monitor.js';
import { registerWorldTools } from './services/world_tools.js';
import { OwnerWorkService } from './services/owner_work_service.js';
import { ReleaseMaintenanceClient } from './services/release_maintenance_client.js';
import { OwnerAutomationGate } from './services/owner_automation_gate.js';
import {prepareCompanyMigration,activateCompanyControl} from './services/company_migration_service.js';

/** V34 is a new instance format. Only the execution/publication kernel retains generation IDs. */
export async function bootstrapWorlds(projectRoot: string, config: ReturnType<typeof runtimeConfig>, unlock: () => void) {
  const workspace = config.workspaceRoot, format = assertBossWorkspace(workspace);
  if (!format) throw new Error('V34_WORKSPACE_INITIALIZATION_REQUIRED');
  const system = path.join(workspace, 'system'), candidate = process.env.EMERGENTINC_CANDIDATE_MODE === '1';
  const { manifest, geneHash } = readGenome(projectRoot);
  const lineage = new LineageStore(path.join(system, 'lineage/lineage.sqlite3'), { v23: true });
  const control = new WorldRegistryStore(path.join(system, 'control/control.sqlite3'));
  const registry = new WorldRegistryService(workspace, control, lineage, manifest.body_interface_version, candidate ? undefined : process.env.EMERGENTINC_ACTIVE_GENERATION_FILE), active = registry.effectiveGeneration();
  if (active.gene_hash !== geneHash || active.release_id !== (process.env.EMERGENTINC_RELEASE_ID ?? active.release_id)) throw new Error('ACTIVE_GENOME_MISMATCH');
  const current = new CurrentStore(path.join(system, 'generations', String(active.id), 'current.sqlite3'));
  if (current.meta().gene_hash !== geneHash || current.meta().generation_id !== active.id || current.meta().release_id !== active.release_id) throw new Error('GLOBAL_CURRENT_IDENTITY_CONFLICT');
  const modelName = process.env.MCL_DECISION_MODEL || process.env.MCL_MODEL || 'gpt-4o-mini';
  const modelConfigured = !candidate && Boolean(process.env.MCL_API_KEY && process.env.MCL_API_KEY !== 'mock-key' && !process.env.MCL_API_KEY.includes('CONFIGURE_ME'));
  const mock = !candidate && (process.argv.includes('--mock') || process.env.EMERGENT_MOCK_MODE === '1');
  const provider: ModelProvider = modelConfigured ? new OpenAICompatibleProvider({ baseUrl: process.env.MCL_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.MCL_API_KEY!, maxRetries: 0 }) : {
    async call() { if (!mock) throw new Error('MODEL_NOT_CONFIGURED'); return { rawText: JSON.stringify({ message_md: '[MOCK_SANDBOX] Worker ready', send_to: 'STOP' }), usage: { promptTokens: 50, completionTokens: 20 } }; },
  };
  const usageMeter = new UsageMeter(JSON.parse(fs.readFileSync(path.join(projectRoot, 'resources/config/model_pricing.json'), 'utf8')));
  const payments = new PaymentService(path.join(system, 'payment/payment.sqlite3'), control, lineage), monitor = new PaymentMonitor(payments);
  await prepareCompanyMigration(workspace);
  let paused = candidate || process.env.EMERGENTINC_START_PAUSED === '1' || active.state !== 'ACTIVE', switching = false, starting = true;
  let ownerWork: OwnerWorkService;
  const ownerUpgradeOrigin = !candidate && config.host === '127.0.0.1' && process.env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG ? `http://127.0.0.1:${Number(process.env.PORT || 8765) + 1}` : undefined;
  const manager: WorldRuntimeManager = new WorldRuntimeManager(registry, { ...manifest, generation: Number(active.generation_no) }, { provider, usageMeter, modelName, isModelConfigured: modelConfigured, isMockMode: mock,
    projectRoot, baseSystemPrompt: fs.readFileSync(path.join(projectRoot, 'resources/prompts/v9_system_prompt.md'), 'utf8'), configureTools: (id, tools) => { registerWorldTools(tools, id, manager, projectRoot, payments); ownerWork.registerTools(tools, id); } });
  manager.attachAutomation(new OwnerAutomationGate(control), () => paused || starting);
  ownerWork = new OwnerWorkService(manager, () => paused || starting, ownerUpgradeOrigin, ownerUpgradeOrigin ? new ReleaseMaintenanceClient(ownerUpgradeOrigin, config.ownerAuth.secret) : undefined);
  activateCompanyControl(ownerWork,{MCL_API_KEY:process.env.MCL_API_KEY,MCL_BASE_URL:process.env.MCL_BASE_URL||'https://api.openai.com/v1',MCL_TIMEOUT_MS:process.env.MCL_TIMEOUT_MS},payments);
  const maintenance = { generation: String(active.id), geneHash, quiesced: () => paused, switching: () => switching,
    quiesce: async () => { switching = true; paused = true; await ownerWork.worker!.quiesce(); await manager.quiesceAll(); await monitor.stop(); },
    resume: async () => { if (candidate || lineage.activeGeneration()?.id !== current.meta().generation_id) throw new Error('GENERATION_NOT_ACTIVE'); paused = false; switching = false; monitor.start(); } };
  const app = await createServer({ workspaceRoot: workspace, ownerAuth: config.ownerAuth, trustLoopbackProxy: config.trustLoopbackProxy, development: process.env.EMERGENT_DEV === '1', allowedOrigins: (process.env.EMERGENT_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean), maintenance,
    worlds: { manager, payments, monitor, modelName, ownerWork }, frontendDistDir: path.join(projectRoot, 'frontend/dist'), ownerUpgradeOrigin, instanceId: format.instanceId });
  app.addHook('onClose', async () => { paused = true; await ownerWork.close(); await monitor.stop(); await manager.closeAll(); payments.close(); control.close(); current.close(); lineage.close(); unlock(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close(); });
  await app.listen({ port: Number(process.env.PORT || 8765), host: config.host }); starting = false;
  if (!paused) monitor.start();
  console.log(`[BOSS:/AFK V34] ${format.instanceId}, http://${config.host}:${process.env.PORT || 8765}/BOSS`);
  return app;
}
