import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtimeConfig, acquireWorkspaceLock } from './runtime_config.js';
import { initializeBossWorkspace } from './boss_workspace.js';
import { bootstrapWorlds } from './world_bootstrap.js';

async function bootstrap() {
  const projectRoot = path.resolve(import.meta.dirname, '../../..');
  if (process.env.EMERGENTINC_CANDIDATE_MODE !== '1') {
    const file = path.join(projectRoot, '.env');
    if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const item = line.trim(), at = item.indexOf('=');
      if (!item || item.startsWith('#') || at < 1) continue;
      const key = item.slice(0, at).trim();
      if (!process.env[key]) process.env[key] = item.slice(at + 1).trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
  const config = runtimeConfig(projectRoot);
  initializeBossWorkspace(projectRoot, config.workspaceRoot);
  const unlock = acquireWorkspaceLock(config.workspaceRoot, process.env.EMERGENTINC_LOCAL_UPGRADE_TOKEN);
  process.once('exit', unlock);
  try { await bootstrapWorlds(projectRoot, config, unlock); } catch (error) { unlock(); throw error; }
}
bootstrap().catch(error => { console.error(error); process.exitCode = 1; });
