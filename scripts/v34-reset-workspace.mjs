import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as net from 'node:net';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ownerEnvironment } from './local-release.mjs';

const inside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = code => { throw new Error(code); };

/** No lexical aliases, junction ancestors, source roots or broad deletion targets. */
export function exactDirectory(input, projectRoot, allowMissing = false) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0') || input.split(/[\\/]/).some(p => p === '..' || p === '.')) fail('V34_RESET_PATH_INVALID');
  const absolute = path.resolve(input);
  for (let cursor = absolute; ; cursor = path.dirname(cursor)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) fail('V34_RESET_PATH_ALIAS');
    if (path.dirname(cursor) === cursor) break;
  }
  const exists=fs.existsSync(absolute);
  const canonical = exists?fs.realpathSync(absolute):allowMissing?path.join(fs.realpathSync(path.dirname(absolute)),path.basename(absolute)):fs.realpathSync(absolute), source = fs.realpathSync(projectRoot);
  if (absolute !== canonical) fail('V34_RESET_PATH_ALIAS');
  const forbidden = [path.parse(canonical).root, os.homedir(), source, process.env.SystemRoot, process.env.ProgramFiles].filter(Boolean).map(p => path.resolve(p));
  if (forbidden.some(root => canonical === root || inside(canonical, root))) fail('V34_RESET_PATH_FORBIDDEN');
  if(['.git','node_modules','apps','packages','frontend','genome','scripts','supervisor','deploy','resources','tests','docs'].some(name=>inside(path.join(source,name),canonical))||canonical===path.join(source,'owner_private'))fail('V34_RESET_PATH_FORBIDDEN');
  if([process.env.SystemRoot,process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean).some(root=>inside(path.resolve(root),canonical)))fail('V34_RESET_PATH_FORBIDDEN');
  if (exists&&!fs.statSync(canonical).isDirectory()) fail('V34_RESET_DIRECTORY_REQUIRED');
  return canonical;
}

export function resetInventory(projectRoot, input) {
  const env = ownerEnvironment(projectRoot);
  const configured = path.resolve(env.EMERGENTINC_WORKSPACE_ROOT || path.join(projectRoot, 'workspace'));
  const workspace = exactDirectory(input, projectRoot);
  if (workspace !== exactDirectory(configured, projectRoot)) fail('V34_RESET_INSTANCE_MISMATCH');
  if (fs.existsSync(path.join(workspace, 'workspace-format.json'))) fail('V34_RESET_NEW_INSTANCE_FORBIDDEN');
  let external, configFile;
  if (env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG) {
    configFile = path.resolve(projectRoot, env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG);
    const config = json(configFile);
    if (path.resolve(config.ownerProjectRoot, config.workspace) !== workspace || fs.realpathSync(config.ownerProjectRoot) !== fs.realpathSync(projectRoot)) fail('V34_RESET_CONFIG_CONFLICT');
    external = exactDirectory(path.resolve(config.ownerProjectRoot, config.stateDirectory), projectRoot);
    if (inside(workspace, external) || inside(external, workspace) || !inside(external, configFile)) fail('V34_RESET_EXTERNAL_PATH_CONFLICT');
    for (const key of ['releases', 'activeReleaseFile']) if (!inside(external, path.resolve(config.ownerProjectRoot, config[key]))) fail('V34_RESET_EXTERNAL_PATH_CONFLICT');
    if (fs.lstatSync(configFile).isSymbolicLink() || fs.realpathSync(configFile) !== configFile) fail('V34_RESET_PATH_ALIAS');
  }
  const targets = [workspace, ...(external ? fs.readdirSync(external).map(name => path.join(external, name)).filter(file => file !== configFile) : [])];
  const stats = { files: 0, directories: 0, links: 0, bytes: 0 }, databases = [];
  const walk = file => {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) {
      // Never follow a dependency junction. Even an internal link is unlinked only.
      if (!targets.some(root => inside(root, fs.realpathSync(file)))) fail('V34_RESET_EXTERNAL_LINK');
      stats.links++; return;
    }
    if (stat.isDirectory()) {
      if (fs.existsSync(path.join(file, '.git'))) fail('V34_RESET_GIT_SOURCE_FORBIDDEN');
      stats.directories++;
      for (const name of fs.readdirSync(file)) walk(path.join(file, name));
    } else if (stat.isFile()) {
      stats.files++; stats.bytes += stat.size;
      if (/\.(?:sqlite3?|db)(?:-wal|-shm)?$/i.test(file)) databases.push(file);
    } else fail('V34_RESET_SPECIAL_FILE');
  };
  targets.forEach(walk);
  return { workspace, external, configFile, targets, databases, ...stats,
    initializedDirectories: ['system', 'worlds', 'runtime', 'private', 'assets'],
    consequences: 'PERMANENT DELETE: all old orders, private links, receipts, budgets, chat, workers, goals, generated code and artifacts. No archive, backup, migration or recovery.' };
}

function relevantProcesses(projectRoot, workspace) {
  if (process.platform !== 'win32') {
    const lines = execFileSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8' }).split('\n');
    return lines.filter(line => [projectRoot, workspace].some(p => line.includes(p)) && /(?:main\.js|launch-approved|upgrade-web|version-upgrade|generation\.mjs)/.test(line) && Number(line.trim().split(/\s/)[0]) !== process.pid);
  }
  const rows = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress"], { encoding: 'utf8', windowsHide: true }) || '[]');
  return (Array.isArray(rows)?rows:[rows]).filter(row => row.ProcessId !== process.pid && [projectRoot, workspace].some(p => row.CommandLine?.includes(p)) && /(?:main\.js|launch-approved|upgrade-web|version-upgrade|generation\.mjs)/.test(row.CommandLine)).map(row => row.ProcessId);
}
async function listening(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(750);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', error => { socket.destroy(); error.code === 'ECONNREFUSED' ? resolve(false) : resolve(true); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
}
export async function assertResetOffline(projectRoot, inventory) {
  if (relevantProcesses(projectRoot, inventory.workspace).length) fail('V34_RESET_INSTANCE_RUNNING');
  for (const file of [path.join(inventory.workspace, 'runtime/instance.lock'), inventory.external && path.join(inventory.external, 'operator.lock')].filter(Boolean)) {
    if (!fs.existsSync(file)) continue;
    const pid = json(file).pid;
    if (!Number.isSafeInteger(pid) || pid < 1) fail('V34_RESET_LOCK_INVALID');
    try { process.kill(pid, 0); fail('V34_RESET_INSTANCE_RUNNING'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const port = Number(ownerEnvironment(projectRoot).PORT || 8765);
  if ((await Promise.all([listening(port), listening(port + 1)])).some(Boolean)) fail('V34_RESET_PORT_IN_USE');
  if (process.platform === 'win32' && inventory.databases.length) {
    // FileShare.None verifies that SQLite/WAL/SHM handles have actually closed.
    const program = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); $paths=([Console]::In.ReadToEnd() | ConvertFrom-Json); foreach($p in $paths){$f=[IO.File]::Open($p,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$f.Dispose()}";
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', program], { input: JSON.stringify(inventory.databases), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  }
}

export async function destroyOldInstance(projectRoot, inventory, confirmation, { offline = assertResetOffline, initialize, removeEntry } = {}) {
  if (confirmation !== `DELETE-BOSS-AFK-V34:${inventory.workspace}`) fail('V34_RESET_CONFIRMATION_REQUIRED');
  await offline(projectRoot, inventory);
  const current = resetInventory(projectRoot, inventory.workspace);
  if (JSON.stringify(current.targets) !== JSON.stringify(inventory.targets)) fail('V34_RESET_INVENTORY_CHANGED');
  const guard = inventory.workspace + '.v34-reset-in-progress';
  fs.writeFileSync(guard, JSON.stringify({ workspace: inventory.workspace, startedAt: new Date().toISOString() }), { flag: 'wx' });
  try {
    // lstat/unlink prevents following junctions; no rename, archive or snapshot.
    let removed=0;
    const remove = file => {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || stat.isFile()) {fs.unlinkSync(file);if(++removed%25000===0)console.log(`V34_DELETE_PROGRESS ${removed} files/links`);}
      else { for (const name of fs.readdirSync(file)) remove(path.join(file, name)); fs.rmdirSync(file); }
    };
    current.targets.forEach(removeEntry ?? remove);
    fs.writeFileSync(guard,JSON.stringify({workspace:inventory.workspace,phase:'DELETED',deletedAt:new Date().toISOString()}));
  } catch (error) { throw new Error(`V34_RESET_DELETE_FAILED: ${error.message}`); }
  try {
    if (!initialize) {
      const module = await import(pathToFileURL(path.join(projectRoot, 'apps/server/dist/boss_workspace.js')).href);
      initialize = module.initializeBossWorkspace;
    }
    await initialize(projectRoot, inventory.workspace, { resetInProgress: true });
  } catch (error) { throw new Error(`V34_NEW_INITIALIZATION_FAILED: ${error.message}`); }
  fs.unlinkSync(guard);
  return { workspace: inventory.workspace, format: 34, destroyed: true, initialized: true };
}

export async function initializeDeletedWorkspace(projectRoot,input,confirmation,initialize) {
  const workspace=exactDirectory(input,projectRoot,true),env=ownerEnvironment(projectRoot),guard=workspace+'.v34-reset-in-progress';
  if(workspace!==path.resolve(env.EMERGENTINC_WORKSPACE_ROOT||path.join(projectRoot,'workspace')))fail('V34_RESET_INSTANCE_MISMATCH');
  if(confirmation!==`DELETE-BOSS-AFK-V34:${workspace}`)fail('V34_RESET_CONFIRMATION_REQUIRED');
  const record=json(guard);
  if(record.workspace!==workspace||record.phase!=='DELETED')fail('V34_RESET_DELETE_NOT_COMPLETE');
  if(fs.existsSync(workspace)&&fs.readdirSync(workspace).length)fail('V34_EMPTY_INITIALIZATION_REQUIRED');
  if(!initialize)initialize=(await import(pathToFileURL(path.join(projectRoot,'apps/server/dist/boss_workspace.js')).href)).initializeBossWorkspace;
  await initialize(projectRoot,workspace,{resetInProgress:true});fs.unlinkSync(guard);
  return {workspace,format:34,initialized:true};
}

export async function resetCli(projectRoot, args) {
  const allowed = new Set(['--workspace', '--dry-run', '--destroy', '--confirm', '--initialize-empty']);
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || key in values) fail('V34_RESET_ARGUMENT_INVALID');
    values[key] = ['--workspace', '--confirm'].includes(key) ? args[++i] : true;
  }
  if(values['--initialize-empty']){
    if(values['--destroy']||values['--dry-run'])fail('V34_RESET_ARGUMENT_INVALID');
    const result=await initializeDeletedWorkspace(projectRoot,values['--workspace'],values['--confirm']);console.log(JSON.stringify(result));return result;
  }
  if (values['--dry-run'] && values['--destroy'] || values['--confirm'] && !values['--destroy']) fail('V34_RESET_ARGUMENT_INVALID');
  const inventory = resetInventory(projectRoot, values['--workspace']);
  console.log(JSON.stringify({ ...inventory, databases: undefined }, null, 2));
  if (!values['--destroy']) return inventory;
  const result = await destroyOldInstance(projectRoot, inventory, values['--confirm']);
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await resetCli(path.resolve(import.meta.dirname, '..'), process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
