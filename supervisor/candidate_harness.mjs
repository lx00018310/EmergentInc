import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import * as fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const [action, directory, workspace, generation] = process.argv.slice(2);
function command(executable, args, env, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: directory, env, stdio: 'ignore', shell: false });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('RELEASE_CHECK_FAILED')); });
  });
}
const cleanEnv = { PATH: process.platform==='win32'?process.env.PATH:'/usr/local/bin:/usr/bin:/bin', SystemRoot:process.env.SystemRoot, LANG: 'C.UTF-8',
  CI: '1', EMERGENTINC_CANDIDATE_MODE: '1' };
if (action === 'build') {
  const pnpm = process.env.EMERGENTINC_PNPM_PATH;
  if (!pnpm?.startsWith('/')) throw new Error('PNPM_ABSOLUTE_PATH_REQUIRED');
  await command(pnpm, ['install','--offline','--frozen-lockfile','--ignore-scripts','--store-dir', join(directory, '.build-store')], cleanEnv, 300000);
  for (const args of [['run','typecheck'],['test','--maxWorkers=4'],['build'],['--dir','frontend','build']]) await command(pnpm, args, cleanEnv, 300000);
} else if (action === 'smoke') {
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve));
  const secret = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [join(directory, 'apps/server/dist/main.js')], { cwd: directory, shell: false,
    env: { ...cleanEnv, EMERGENTINC_WORKSPACE_ROOT: workspace, EMERGENTINC_RUNTIME_MODE: 'business',
      EMERGENTINC_OWNER_SECRET: secret, EMERGENTINC_SECURE_COOKIES: '0', HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  let error, diagnostics = ''; child.on('error', e => { error = e; });
  child.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
  const base = `http://127.0.0.1:${port}`;
  const get = async (url, cookie) => {
    const response = await fetch(base + url, { headers: cookie ? { cookie } : {}, redirect: 'error', signal: AbortSignal.timeout(2000) });
    if (response.status !== 200) throw new Error('CANDIDATE_SMOKE_HTTP_FAILED'); return response.json();
  };
  try {
    let live = false;
    for (let i = 0; i < 100; i++) {
      if (error || child.exitCode !== null) throw new Error('CANDIDATE_SERVER_START_FAILED: ' + diagnostics);
      try { live = (await get('/health/live')).alive === true; if (live) break; } catch { }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!live) throw new Error('CANDIDATE_LIVE_FAILED');
    const ready = await get('/health/ready'); if (ready.ready !== true || ready.generation !== generation) throw new Error('CANDIDATE_READY_FAILED');
    if ((await fetch(base + '/api/evolution/overview')).status !== 401) throw new Error('CANDIDATE_OWNER_AUTH_FAILED');
    const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }), signal: AbortSignal.timeout(2000) });
    const cookie = login.headers.get('set-cookie')?.split(';')[0]; if (login.status !== 200 || !cookie) throw new Error('CANDIDATE_OWNER_AUTH_FAILED');
    const business = await get('/api/business/overview', cookie), evolution = await get('/api/evolution/overview', cookie);
    const session=await get('/api/session',cookie);
    const people = await get('/api/qianji', cookie), world = await get('/api/world', cookie), run = session.worldsEnabled?{running:false}:await get('/api/run/status', cookie);
    if(session.worldsEnabled){
      const site=await get('/api/public/site'),products=await get('/api/public/products');
      if(typeof site.headline_en!=='string'||!Array.isArray(products.items))throw new Error('CANDIDATE_PUBLIC_STORE_FAILED');
      if((await fetch(base+'/api/public-site')).status!==401)throw new Error('CANDIDATE_PUBLIC_OWNER_BOUNDARY_FAILED');
      const storefront=await get('/api/public-site',cookie);
      if(storefront.revenue.scope!=='INSTANCE'||!Array.isArray(storefront.orders))throw new Error('CANDIDATE_PUBLIC_PERSISTENCE_FAILED');
      const worlds=(await get('/api/worlds',cookie)).items;
      for(const item of worlds.filter(w=>w.status==='ACTIVE'&&!w.blockedReason)){const scoped=await get('/api/worlds/'+item.world_id, cookie);if(scoped.current.generation_id!==generation)throw new Error('CANDIDATE_WORLD_GENERATION_FAILED');}
      const {readGeneCatalog,executeGeneSkill}=await import(pathToFileURL(join(directory,'apps/server/dist/services/gene_promotion_service.js')).href);
      const catalog=readGeneCatalog(directory);
      if(catalog.assets.length){
        const {LineageStore,WorldRegistryStore,readGenome}=await import(pathToFileURL(join(directory,'packages/persistence/dist/index.js')).href);
        const {WorldRegistryService}=await import(pathToFileURL(join(directory,'apps/server/dist/services/world_registry_service.js')).href);
        const lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true}),control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3'));
        try{const registry=new WorldRegistryService(workspace,control,lineage,'1'),fresh=registry.create({displayName:'Candidate inheritance smoke',traits:{},behaviorProfile:[]});
          if((await get('/api/worlds/'+fresh.world_id,cookie)).current.generation_id!==generation)throw new Error('FRESH_WORLD_BOOT_FAILED');
          if(fs.readdirSync(join(registry.directory(fresh.world_id),'generations',generation,'body/skills')).length)throw new Error('FRESH_WORLD_MUST_NOT_COPY_PRIVATE_BODY');
          for(const asset of catalog.assets){const content=JSON.parse(fs.readFileSync(join(directory,'genome',asset.file),'utf8'));if(['skill','code'].includes(asset.kind))for(const test of content.tests){const result=executeGeneSkill(directory,asset.id,test.input,readGenome(directory).geneHash);if(JSON.stringify(result.result)!==JSON.stringify(test.expected))throw new Error('GENE_INHERITANCE_SMOKE_FAILED');}}
        }finally{control.close();lineage.close();}
      }
    }
    if (!Array.isArray(people.items) || !Array.isArray(world.pixels) || typeof run.running !== 'boolean') throw new Error('CANDIDATE_BODY_API_FAILED');
    if (!Array.isArray(business.plans) || business.modelConfigured !== false || evolution.current.generation_id !== generation ||
        !Array.isArray(evolution.skills) || !Array.isArray(evolution.memories) || !Array.isArray(evolution.proposals)) throw new Error('CANDIDATE_LIFE_SCHEMA_FAILED');
    if ((await fetch(base + '/api/business/intents', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status !== 409)
      throw new Error('CANDIDATE_SIDE_EFFECT_GATE_FAILED');
    if ((await fetch(base + '/api/run/start', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status !== 409)
      throw new Error('CANDIDATE_BODY_SIDE_EFFECT_GATE_FAILED');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) { child.kill('SIGTERM'); const timeout = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timeout); }
  }
} else throw new Error('CANDIDATE_HARNESS_ACTION_INVALID');
