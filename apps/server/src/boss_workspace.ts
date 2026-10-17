import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CurrentStore, LineageStore, WorldRegistryStore, readGenome, writeGenerationPointer } from '@emergentinc/persistence';
import { OwnerAutomationGate } from './services/owner_automation_gate.js';
import { PaymentService } from './services/payment_service.js';
import { PublicStore } from './services/public_store.js';

export interface BossWorkspaceFormat { product: 'BOSS-AFK'; format: 34; instanceId: string; initializedAt: string }
export function assertBossWorkspace(workspace: string, resetting = false): BossWorkspaceFormat | undefined {
  if (!resetting && fs.existsSync(workspace + '.v34-reset-in-progress')) throw new Error('V34_RESET_INCOMPLETE');
  if (!fs.existsSync(workspace)) return;
  if (fs.lstatSync(workspace).isSymbolicLink()) throw new Error('V34_WORKSPACE_LINK_FORBIDDEN');
  const file = path.join(workspace, 'workspace-format.json');
  if (!fs.existsSync(file)) {
    if (fs.readdirSync(workspace).length) throw new Error('V34_DESTRUCTIVE_RESET_REQUIRED');
    return;
  }
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('V34_WORKSPACE_LINK_FORBIDDEN');
  const format = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (format.product !== 'BOSS-AFK' || format.format !== 34 || typeof format.instanceId !== 'string' || !format.instanceId || typeof format.initializedAt !== 'string') throw new Error('V34_WORKSPACE_FORMAT_INVALID');
  for (const name of ['system', 'worlds', 'runtime', 'private', 'assets']) {
    const directory = path.join(workspace, name);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink()) throw new Error('V34_WORKSPACE_INITIALIZATION_INCOMPLETE');
  }
  return format;
}

/** Creates only a new empty instance; never migrates, repairs or clears existing data. */
export function initializeBossWorkspace(projectRoot: string, workspace: string, options: { resetInProgress?: boolean } = {}): BossWorkspaceFormat {
  const existing = assertBossWorkspace(workspace, options.resetInProgress === true);
  if (existing) return existing;
  fs.mkdirSync(workspace, { recursive: true });
  const { geneHash, manifest } = readGenome(projectRoot);
  const format: BossWorkspaceFormat = { product: 'BOSS-AFK', format: 34, instanceId: randomUUID(), initializedAt: new Date().toISOString() };
  for (const directory of ['system', 'worlds', 'runtime', 'private', 'assets']) fs.mkdirSync(path.join(workspace, directory));
  const system = path.join(workspace, 'system'), releaseId = 'local-initial-' + randomUUID();
  const lineage = new LineageStore(path.join(system, 'lineage/lineage.sqlite3'), { v23: true });
  try {
    const generation = lineage.createGeneration({ id: 'G0001', number: 1, geneHash, releaseId, state: 'ACTIVE' });
    const current = new CurrentStore(path.join(system, 'generations/G0001/current.sqlite3'));
    try { current.initialize(generation, manifest.body_interface_version); } finally { current.close(); }
    const control = new WorldRegistryStore(path.join(system, 'control/control.sqlite3'));
    try {
      new OwnerAutomationGate(control);
      const payments = new PaymentService(path.join(system, 'payment/payment.sqlite3'), control, lineage);
      try { new PublicStore(control, payments).close(); } finally { payments.close(); }
    } finally { control.close(); }
  } finally { lineage.close(); }
  fs.mkdirSync(path.join(system, 'generations/G0001/body/skills'), { recursive: true });
  writeGenerationPointer(system, 'G0001');
  // This describes the internal runtime layout, not permission to open an old instance.
  fs.writeFileSync(path.join(workspace, 'workspace-layout.json'), JSON.stringify({ schema: 1, version: 34 }), { flag: 'wx' });
  // Written last: partial initialization cannot be mistaken for a usable instance.
  fs.writeFileSync(path.join(workspace, 'workspace-format.json'), JSON.stringify(format, null, 2), { flag: 'wx' });
  return format;
}
