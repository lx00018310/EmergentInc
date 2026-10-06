import {approvedWorldRelease} from './v23-approved-release.mjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { approvedLocalRelease, initializeLocalRelease, ownerEnvironment } from './local-release.mjs';

export async function launchApproved(projectRoot, args = []) {
  const env = ownerEnvironment(projectRoot);
  if (env.EMERGENTINC_ACTIVE_GENERATION_FILE || env.EMERGENTINC_CANDIDATE_MODE === '1' || env.EMERGENTINC_LOCAL_UPGRADE_TOKEN)
    throw new Error('LOCAL_LAUNCH_CONFIGURATION_CONFLICT');
  const workspace = path.resolve(env.EMERGENTINC_WORKSPACE_ROOT || path.join(projectRoot, 'workspace'));
  if(fs.existsSync(workspace+'.v23-upgrade-pending.json'))throw new Error('V23_UPGRADE_RECOVERY_REQUIRED');
  const existing = fs.existsSync(path.join(workspace, 'lineage/lineage.sqlite3')) || fs.existsSync(path.join(workspace, 'active-generation.json')) || fs.existsSync(path.join(workspace,'workspace-layout.json'));
  // Fresh installations are explicit; existing lineage never falls back to an unapproved checkout.
  let approved = existing ? (env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG?approvedWorldRelease(fs.realpathSync(workspace),env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG):approvedLocalRelease(fs.realpathSync(workspace))) : undefined;
  if (args[0] === '--check') {
    if (approved) console.log(`APPROVED_RELEASE ${approved.generation.id} ${approved.generation.release_id}`);
    else console.log('INITIAL_WORKSPACE_BUILD_REQUIRED');
    return approved ? 0 : 2;
  }
  if (!approved) approved = await initializeLocalRelease(projectRoot, workspace);
  if (env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG) {
    const { ensureUpgradeWeb } = await import('./upgrade-web.mjs');
    console.log('发布升级 / Publish upgrade: ' + await ensureUpgradeWeb(projectRoot));
  }
  const directory = approved.directory;
  if (approved) {
    const { readGenome } = await import(pathToFileURL(path.join(directory, 'packages/persistence/dist/index.js')).href);
    if (readGenome(directory).geneHash !== approved.generation.gene_hash) throw new Error('LOCAL_RELEASE_GENOME_MISMATCH');
    console.log(`启动已批准版本：${approved.generation.id} / ${approved.generation.release_id}`);
  }
  const child = spawn(process.execPath, [path.join(directory, 'apps/server/dist/main.js'), ...args], {
    cwd: directory, windowsHide: true, shell: false, stdio: 'inherit', env: { ...env,
      EMERGENTINC_WORKSPACE_ROOT: workspace, EMERGENTINC_RELEASE_ID: approved.generation.release_id,
      EMERGENTINC_RUNTIME_MODE: 'business', EMERGENTINC_CANDIDATE_MODE: '0' },
  });
  const stop = () => child.kill(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve(code ?? 1); });
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await launchApproved(path.resolve(import.meta.dirname, '..'), process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
