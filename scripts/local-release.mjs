import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const sourceRoots = new Set(['apps', 'packages', 'frontend', 'genome', 'scripts', 'supervisor', 'deploy', 'resources', 'tests', 'docs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.base.json', 'vitest.config.ts', 'vitest.workspace.ts',
  'README.md', 'README_CN.md', 'AGENTS.md', 'LICENSE', 'EmergentInc_UI.bat', 'EmergentInc_UI.ps1', 'EmergentInc_UI.sh', 'EmergentInc_Upgrade.bat']);
const excluded = new Set(['.git', 'node_modules', 'workspace', 'owner_private', 'cache', '.codex', '.agents', '.aws']);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const jsonHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function bossWorkspaceFormat(workspace) {
  if(fs.existsSync(workspace+'.v34-reset-in-progress'))throw new Error('V34_RESET_INCOMPLETE');
  if(!fs.existsSync(workspace))return undefined;
  if(fs.lstatSync(workspace).isSymbolicLink())throw new Error('V34_WORKSPACE_LINK_FORBIDDEN');
  const file=path.join(workspace,'workspace-format.json');
  if(!fs.existsSync(file)){if(fs.readdirSync(workspace).length)throw new Error('V34_DESTRUCTIVE_RESET_REQUIRED');return undefined;}
  if(fs.lstatSync(file).isSymbolicLink())throw new Error('V34_WORKSPACE_LINK_FORBIDDEN');
  const format=read(file);
  if(format.product!=='BOSS-AFK'||format.format!==34||typeof format.instanceId!=='string'||!format.instanceId)throw new Error('V34_WORKSPACE_FORMAT_INVALID');
  return format;
}

/** Full release integrity includes compiled assets and installed dependencies, unlike the Gene identity. */
export function frozenReleaseHash(root) {
  const hash = createHash('sha256'), absoluteRoot = fs.realpathSync(root);
  const walk = relative => {
    const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(absolute), inside = path.relative(absoluteRoot, target);
      if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) throw new Error('LOCAL_RELEASE_EXTERNAL_SYMLINK');
      // pnpm Windows junctions contain absolute paths. Releases stay at their approved location.
      hash.update(relative).update('\0link\0').update(fs.readlinkSync(absolute)).update('\0');
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) walk(relative ? relative + '/' + name : name);
    } else if (stat.isFile()) hash.update(relative).update('\0file\0').update(fs.readFileSync(absolute)).update('\0');
    else throw new Error('LOCAL_RELEASE_SPECIAL_FILE');
  };
  walk(''); return hash.digest('hex');
}

export async function installReleaseDependencies(directory) {
  if (!fs.existsSync(path.join(directory, 'package.json')) || !fs.existsSync(path.join(directory, 'pnpm-lock.yaml')))
    throw new Error('LOCAL_RELEASE_LOCKFILE_REQUIRED');
  await new Promise((resolve, reject) => {
    // Constant command, cwd passed separately: no path or user text is interpolated into cmd.exe.
    const child = process.platform === 'win32'
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd install --offline --frozen-lockfile --ignore-scripts'],
          { cwd: directory, windowsHide: true, shell: false, env: { ...process.env, CI: '1' }, stdio: 'inherit' })
      : spawn('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], { cwd: directory, shell: false, stdio: 'inherit' });
    const timer = setTimeout(() => child.kill(), 120000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('LOCAL_RELEASE_OFFLINE_INSTALL_FAILED')); });
  });
}

export async function freezeLocalRelease(source, destination, install = installReleaseDependencies, prepare) {
  if (fs.existsSync(destination)) throw new Error('LOCAL_RELEASE_TARGET_EXISTS');
  const copy = relative => {
    const from = path.join(source, relative), to = path.join(destination, relative), stat = fs.lstatSync(from);
    if (stat.isSymbolicLink()) throw new Error('LOCAL_RELEASE_SOURCE_SYMLINK');
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        if (!relative && !sourceRoots.has(name)) continue;
        if (excluded.has(name) || name.includes('.tmp.') || name.startsWith('.env') || name.endsWith('.tsbuildinfo') || /\.(?:log|pem|key|sqlite3(?:-wal|-shm)?)$/.test(name)) continue;
        const child=relative ? relative + '/' + name : name;
        // tsc does not remove outputs whose source was deleted. Never ship those old modules.
        if (/^(?:apps|packages)\/[^/]+\/dist\//.test(child) && /\.(?:js|d\.ts)(?:\.map)?$/.test(child)) {
          const sourceFile=child.replace('/dist/','/src/').replace(/\.(?:js|d\.ts)(?:\.map)?$/,'.ts');
          if(!fs.existsSync(path.join(source,sourceFile)))continue;
        }
        if (/^supervisor\/dist\//.test(child) && /\.(?:js|d\.ts)(?:\.map)?$/.test(child) && !fs.existsSync(path.join(source,child.replace('/dist/','/').replace(/\.(?:js|d\.ts)(?:\.map)?$/,'.ts'))))continue;
        copy(relative ? relative + '/' + name : name);
      }
    } else if (stat.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
    else throw new Error('LOCAL_RELEASE_SPECIAL_FILE');
  };
  copy(''); if (prepare) await prepare(destination); await install(destination);
  return { directory: destination, hash: frozenReleaseHash(destination) };
}

export function verifyFrozenRelease(candidate, recordDirectory) {
  if (!candidate.release || candidate.release.directory !== path.join(recordDirectory, 'release')) throw new Error('LOCAL_RELEASE_UPGRADE_REQUIRED');
  const directory = candidate.release.directory;
  if (fs.lstatSync(directory).isSymbolicLink() || fs.realpathSync(directory) !== directory || frozenReleaseHash(directory) !== candidate.release.hash)
    throw new Error('LOCAL_RELEASE_INTEGRITY_FAILED');
  return directory;
}

export async function initializeLocalRelease(projectRoot, workspace, install) {
  bossWorkspaceFormat(workspace);
  const {initializeBossWorkspace}=await import(pathToFileURL(path.join(projectRoot,'apps/server/dist/boss_workspace.js')).href);
  initializeBossWorkspace(projectRoot,workspace);
  workspace=fs.realpathSync(workspace);
  const lineage=new DatabaseSync(path.join(workspace,'system/lineage/lineage.sqlite3'),{readOnly:true});let generation;
  try{generation=lineage.prepare("SELECT * FROM generations WHERE state='ACTIVE'").get();}finally{lineage.close();}
  if(generation?.id!=='G0001'||!/^local-initial-[a-f0-9-]+$/.test(generation.release_id))throw new Error('V34_INITIAL_RELEASE_REQUIRED');
  const id=generation.release_id,geneHash=generation.gene_hash,env=ownerEnvironment(projectRoot);
  let config;
  if(!env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG){
    const stateDirectory=path.join(projectRoot,'owner_private/approved-runtime'),file=path.join(stateDirectory,'owner-config.json');
    if(fs.existsSync(stateDirectory)&&fs.readdirSync(stateDirectory).length)throw new Error('V34_OWNER_CONFIG_REQUIRED_FOR_EXISTING_STATE');
    fs.mkdirSync(stateDirectory,{recursive:true});
    config={ownerProjectRoot:projectRoot,workspace,stateDirectory,releases:path.join(stateDirectory,'releases'),activeReleaseFile:path.join(stateDirectory,'active-release.json'),appUrl:`http://${env.HOST||'127.0.0.1'}:${Number(env.PORT||8765)}`};
    fs.writeFileSync(file,JSON.stringify(config,null,2),{flag:'wx',mode:0o600});
    fs.appendFileSync(path.join(projectRoot,'.env'),'\nEMERGENTINC_LOCAL_EVOLUTION_CONFIG=owner_private/approved-runtime/owner-config.json\n');
    env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG=file;
  }
  config=read(path.resolve(projectRoot,env.EMERGENTINC_LOCAL_EVOLUTION_CONFIG));for(const key of ['workspace','stateDirectory','releases','activeReleaseFile'])config[key]=path.resolve(config.ownerProjectRoot,config[key]);if(config.workspace!==workspace)throw new Error('V34_OWNER_CONFIG_WORKSPACE_CONFLICT');
  const recordDirectory=config?config.stateDirectory:path.join(workspace,'runtime/local-upgrades',id);
  fs.mkdirSync(recordDirectory,{recursive:true});
  const release=await freezeLocalRelease(projectRoot,config?path.join(config.releases,id):path.join(recordDirectory,'release'),install);
  const candidate = { id, scope: 'windows_owner_initialization', workspace, projectRoot,
    target: generation.id, geneHash, release };
  const candidateHash = jsonHash(candidate);
  fs.writeFileSync(path.join(recordDirectory,config?'initial-v34.json':'record.json'), JSON.stringify({ candidate, candidateHash, state: 'COMMITTED',
    ownerAuthorization: { channel: 'explicit_first_launch', candidateHash, reason: 'Owner first launch of a fresh V34 instance' } }, null, 2), { flag: 'wx', mode: 0o600 });
  if(config)fs.writeFileSync(config.activeReleaseFile,JSON.stringify({directory:release.directory}),{flag:'wx'});
  return { directory: release.directory, generation };
}

/** Select only the committed Owner receipt matching both physical databases and the active pointer. */
export function approvedLocalRelease(workspace) {
  if(!bossWorkspaceFormat(workspace))throw new Error('V34_WORKSPACE_INITIALIZATION_REQUIRED');
  if (fs.existsSync(path.join(workspace, 'runtime/local-upgrade-pending.json'))) throw new Error('LOCAL_UPGRADE_RECOVERY_REQUIRED');
  const layoutFile=path.join(workspace,'workspace-layout.json'),layout=fs.existsSync(layoutFile)?read(layoutFile):undefined;
  if(!layout||layout.schema!==1||layout.version!==34)throw new Error('V34_WORKSPACE_FORMAT_INVALID');
  const lifeRoot=layout?path.join(workspace,'system'):workspace;
  const id = read(path.join(lifeRoot, 'active-generation.json')).generation_id;
  if (!/^G\d{4,}$/.test(id)) throw new Error('LOCAL_RELEASE_INVALID_POINTER');
  const lineage = new DatabaseSync(path.join(lifeRoot, 'lineage/lineage.sqlite3'), { readOnly: true });
  let generation;
  try {
    const active = lineage.prepare("SELECT * FROM generations WHERE state='ACTIVE'").all();
    if (active.length !== 1 || active[0].id !== id) throw new Error('LOCAL_RELEASE_STORED_STATE_CONFLICT');
    generation = active[0];
  } finally { lineage.close(); }
  if (!/^local-[a-zA-Z0-9_-]{1,70}$/.test(generation.release_id)) throw new Error('LOCAL_RELEASE_UPGRADE_REQUIRED');
  const recordDirectory = path.join(workspace, 'runtime/local-upgrades', generation.release_id);
  const record = read(path.join(recordDirectory, 'record.json')), c = record.candidate;
  if (record.state !== 'COMMITTED' || record.candidateHash !== jsonHash(c) ||
      record.ownerAuthorization?.candidateHash !== record.candidateHash || !['windows_owner_maintenance', 'windows_owner_initialization','windows_owner_v23'].includes(c.scope) ||
      c.workspace !== workspace || c.id !== generation.release_id || c.target !== id || c.geneHash !== generation.gene_hash)
    throw new Error('LOCAL_RELEASE_RECEIPT_CONFLICT');
  const current = new DatabaseSync(path.join(lifeRoot, 'generations', id, 'current.sqlite3'), { readOnly: true });
  try {
    const meta = current.prepare('SELECT * FROM current_meta').get();
    if (!meta || meta.generation_id !== id || meta.gene_hash !== generation.gene_hash || meta.release_id !== generation.release_id)
      throw new Error('LOCAL_RELEASE_STORED_STATE_CONFLICT');
  } finally { current.close(); }
  if(layout){const control=new DatabaseSync(path.join(lifeRoot,'control/control.sqlite3'),{readOnly:true});
    try{for(const row of control.prepare("SELECT world_id,workspace_relpath FROM qianji_worlds WHERE status='ACTIVE' AND world_id NOT IN (SELECT world_id FROM world_recovery_blocks)").all()){
      if(row.workspace_relpath!==`worlds/${row.world_id}`||!/^[a-zA-Z0-9_-]+$/.test(row.world_id))throw new Error('WORLD_REGISTRY_PATH_INVALID');
      const db=new DatabaseSync(path.join(workspace,row.workspace_relpath,'generations',id,'current.sqlite3'),{readOnly:true});try{
        const meta=db.prepare('SELECT * FROM current_meta').get();if(meta?.generation_id!==id||meta.gene_hash!==generation.gene_hash||meta.release_id!==generation.release_id)throw new Error('WORLD_RELEASE_IDENTITY_CONFLICT');
      }finally{db.close();}
    }}finally{control.close();}}
  return { directory: verifyFrozenRelease(c, recordDirectory), generation };
}

export function ownerEnvironment(root) {
  const env = { ...process.env }, file = path.join(root, '.env');
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const item = line.trim(), at = item.indexOf('=');
    if (!item || item.startsWith('#') || at < 1) continue;
    const key = item.slice(0, at).trim(); if (!env[key]) env[key] = item.slice(at + 1).trim().replace(/^["'](.*)["']$/, '$1');
  }
  return env;
}
