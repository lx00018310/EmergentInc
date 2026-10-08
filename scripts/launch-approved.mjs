import {approvedWorldRelease} from './v23-approved-release.mjs';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { approvedLocalRelease, initializeLocalRelease, ownerEnvironment } from './local-release.mjs';

export function applicationUrl(env) {
  const port=Number(env.PORT||8765),host=env.HOST||'127.0.0.1';
  if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('LOCAL_LAUNCH_PORT_INVALID');
  const address=host==='0.0.0.0'?'127.0.0.1':host==='::'?'[::1]':host.includes(':')?`[${host}]`:host;
  const url=new URL(`http://${address}:${port}/`);
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||Number(url.port||80)!==port)throw new Error('LOCAL_LAUNCH_HOST_INVALID');
  return url.href;
}

export async function waitForWebReady(url, pid, generation, {signal,timeoutMs=120000}={}) {
  const deadline=Date.now()+timeoutMs;
  const get=async route=>{
    try{return await fetch(new URL(route,url),{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(1000)]):AbortSignal.timeout(1000)});}
    catch(error){if(signal?.aborted)throw signal.reason;if(error instanceof TypeError||error.name==='TimeoutError')return null;throw error;}
  };
  while(Date.now()<deadline){
    signal?.throwIfAborted();
    const live=await get('/health/live');
    if(live?.ok){
      const identity=await live.json();
      if(identity.alive!==true||identity.processId!==pid)throw new Error('LOCAL_LAUNCH_PROCESS_IDENTITY_CONFLICT');
      const ready=await get('/health/ready');
      if(ready?.ok){
        const state=await ready.json();
        if(state.ready===true){
          if(state.generation!==generation)throw new Error('LOCAL_LAUNCH_GENERATION_CONFLICT');
          const home=await get('/');
          if(home?.ok&&home.headers.get('content-type')?.includes('text/html')){await home.arrayBuffer();return;}
          await home?.body?.cancel();
        }
      } else await ready?.body?.cancel();
    } else await live?.body?.cancel();
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('LOCAL_LAUNCH_READY_TIMEOUT: 服务未就绪，未打开网页 / Service is not ready; the browser was not opened');
}

export function browserCommand(url, platform=process.platform, env=process.env) {
  if(platform==='win32')return [env.ComSpec||'cmd.exe',['/d','/s','/c',`start "" "${url}"`]];
  if(platform==='linux')return env.DISPLAY||env.WAYLAND_DISPLAY?['xdg-open',[url]]:null;
  throw new Error('LOCAL_LAUNCH_BROWSER_PLATFORM_UNSUPPORTED');
}

export async function openBrowser(url, env) {
  const command=browserCommand(url,process.platform,env);
  if(!command){console.log('无桌面会话，请手动访问 / No desktop session; open manually: '+url);return;}
  // The browser does not inherit the application's .env credentials.
  const browserEnv={...process.env};for(const key of Object.keys(browserEnv))if(/^(?:EMERGENTINC_|MCL_|GACHA_)/.test(key))delete browserEnv[key];
  await new Promise((resolve,reject)=>{
    const opener=spawn(command[0],command[1],{windowsHide:true,windowsVerbatimArguments:process.platform==='win32',shell:false,stdio:'ignore',env:browserEnv});
    opener.once('error',reject);opener.once('spawn',()=>{opener.unref();resolve();});
    opener.once('exit',code=>{if(code)console.error('浏览器打开失败 / Browser could not be opened: '+url);});
  });
}

export async function launchApproved(projectRoot, args = [], {openPage=openBrowser,startupTimeoutMs=120000}={}) {
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
  const openRequested=args.includes('--open-browser'),runtimeArgs=args.filter(arg=>arg!=='--open-browser');
  const url=openRequested?applicationUrl(env):undefined;
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
  const child = spawn(process.execPath, [path.join(directory, 'apps/server/dist/main.js'), ...runtimeArgs], {
    cwd: directory, windowsHide: true, shell: false, stdio: 'inherit', env: { ...env,
      EMERGENTINC_WORKSPACE_ROOT: workspace, EMERGENTINC_RELEASE_ID: approved.generation.release_id,
      EMERGENTINC_RUNTIME_MODE: 'business', EMERGENTINC_CANDIDATE_MODE: '0' },
  });
  const stop = () => child.kill(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const finished=new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => { process.off('SIGINT', stop); process.off('SIGTERM', stop); resolve(code ?? 1); });
  });
  const waiting=new AbortController();
  try{
    if(openRequested){
      console.log('等待服务及首页就绪 / Waiting for service and homepage readiness: '+url);
      await Promise.race([waitForWebReady(url,child.pid,approved.generation.id,{signal:waiting.signal,timeoutMs:startupTimeoutMs}),finished.then(code=>{throw new Error('LOCAL_LAUNCH_EXITED_BEFORE_READY: '+code);})]);
      waiting.abort();
      console.log('服务已就绪 / Service ready: '+url);
      try{await openPage(url,env);}catch(error){console.error('无法自动打开浏览器 / Cannot open browser: '+error.message+'; '+url);}
    }
    return await finished;
  }catch(error){stop();await finished.catch(()=>{});throw error;}
  finally{waiting.abort();process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await launchApproved(path.resolve(import.meta.dirname, '..'), process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
