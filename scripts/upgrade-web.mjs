import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { registerOwnerAuth } from '../apps/server/dist/owner_auth.js';
import { ownerEnvironment } from './local-release.mjs';
import { upgradeConfig, ownerReleaseInput, ensureFastForwardable, fastForwardMain } from './version-upgrade.mjs';
import { readAppCodeReport } from './prepare-app-code.mjs';
import { LocalWorldRuntime } from '../supervisor/dist/local_world_runtime.js';
import { rollbackPlan, canDeleteRelease } from '../supervisor/dist/release_history.js';
import { pixelReleaseToken } from '../apps/server/dist/services/release_maintenance_client.js';
import { createHash, timingSafeEqual } from 'node:crypto';
import { checkPaymentRollback } from '../supervisor/dist/payment_compatibility.js';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const fastify = require('fastify');
export const projectRoot = path.resolve(import.meta.dirname, '..');
export const upgradeWebUrl = config => `http://127.0.0.1:${Number(new URL(config.appUrl).port) + 1}`;
function logTail(file) {
  if (!fs.existsSync(file)) return '';
  const fd = fs.openSync(file, 'r');
  try { const size = fs.fstatSync(fd).size, buffer = Buffer.alloc(Math.min(size, 8000));
    fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length)); return buffer.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function operatorBusy(config) {
  const file = path.join(config.stateDirectory, 'operator.lock');
  let lock;
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!Number.isSafeInteger(lock.pid) || lock.pid < 1) throw new Error('INVALID_EVOLUTION_LOCK');
  try { process.kill(lock.pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

export function readUpgradeStatus(root, config) {
  const readDb = (file, sql, params=[]) => {
    if (!fs.existsSync(file)) throw new Error('UPGRADE_DATABASE_UNAVAILABLE');
    // Query-only permits SQLite to repair its WAL bookkeeping after a Windows process stop.
    const db = new DatabaseSync(file);
    try { db.exec('PRAGMA query_only=ON'); return db.prepare(sql).all(...params); } finally { db.close(); }
  };
  const generations=readDb(path.join(config.workspace,'system/lineage/lineage.sqlite3'),'SELECT id,generation_no,parent_id,release_id,state FROM generations ORDER BY generation_no DESC');
  const active=generations.find(g=>g.state==='ACTIVE');
  const file = path.join(config.stateDirectory, 'evolution.sqlite3');
  if(active&&fs.existsSync(file)){
    const request=readDb(file,'SELECT request_json FROM candidates WHERE id=?',[active.release_id])[0];
    if(request)active.label=JSON.parse(request.request_json).owner_release?.label??JSON.parse(request.request_json).app_code_report?.title;
  }
  const restored=fs.existsSync(file)?readDb(file,"SELECT payload FROM events WHERE kind='generation_restored' ORDER BY sequence DESC LIMIT 1")[0]:null;
  const afterRollback=Boolean(active&&restored&&JSON.parse(restored.payload).previous===active.id);
  const records = fs.existsSync(file) ? readDb(file, 'SELECT id,state,phase,failure_reason,created_at,target_generation,request_hash,candidate_json,request_json FROM candidates ORDER BY created_at DESC')
    .map(row => ({ ...row, candidate: row.candidate_json ? JSON.parse(row.candidate_json) : null, request: JSON.parse(row.request_json) }))
    : [];
  const candidates=records.filter(row=>row.request.owner_release||row.request.app_code_report).map(({candidate_json,request_json,...row})=>{
    let versionNumber=generations.find(g=>g.id===row.target_generation)?.generation_no;
    if(versionNumber===undefined&&!['DELETED','DELETING'].includes(row.state)&&config.releases&&/^[a-zA-Z0-9_-]+$/.test(row.id)){
      const manifest=path.join(config.releases,row.id,'genome/manifest.json');if(fs.existsSync(manifest))versionNumber=JSON.parse(fs.readFileSync(manifest,'utf8')).generation;
    }
    return {...row,versionNumber,identity:row.candidate?.candidate_hash??row.request_hash,
      canDelete:Boolean(active&&canDeleteRelease(row.state,row.id,versionNumber,active,afterRollback)),
      validationLog:/^[a-zA-Z0-9_-]+$/.test(row.id)?logTail(path.join(config.stateDirectory,'validation-'+row.id+'.log')):''};
  });
  const versions=generations.map(g=>{
    const record=records.find(r=>r.id===g.release_id),directory=config.releases&&path.join(config.releases,g.release_id);
    const available=Boolean(directory&&/^[a-zA-Z0-9_-]+$/.test(g.release_id)&&fs.existsSync(directory)&&!fs.lstatSync(directory).isSymbolicLink());
    let canRollback=false,rollbackBlockedReason=null;
    if(active&&g.generation_no<active.generation_no&&available){try{rollbackPlan(generations,records,active.id,g.id);checkPaymentRollback(path.join(config.workspace,'system/payment/payment.sqlite3'),directory);canRollback=true;}catch(error){rollbackBlockedReason=error.message;}}
    return {...g,label:record?.request.owner_release?.label??record?.request.app_code_report?.title??g.release_id,available,canRollback,rollbackBlockedReason,
      identity:record?.candidate?.candidate_hash??record?.request_hash,canDelete:Boolean(active&&record&&canDeleteRelease(record.state,g.release_id,g.generation_no,active,afterRollback))};
  });
  const dirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim());
  return { active, candidates, versions, afterRollback, dirty, appUrl: config.appUrl };
}

const GIT_SHA_PATTERN=/^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
function gitText(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4*1024*1024 });
  } catch (error) { if (error.status === 128) return null; throw error; }
}
/** Bounded read-only Git DAG projection: refs plus the first `limit` commits across all branches. */
export function readGitGraph(root, limit=200) {
  const bound=Math.min(Math.max(Number(limit)||200,1),500);
  const refsRaw=gitText(root,['for-each-ref','--format=%(refname) %(objectname)','refs/heads','refs/remotes','refs/tags']);
  if(refsRaw===null)return {available:false};
  const refs=refsRaw.trim()?refsRaw.trim().split(/\r?\n/).map(line=>{const index=line.lastIndexOf(' ');return {ref:line.slice(0,index),sha:line.slice(index+1)};}):[];
  const log=gitText(root,['log','--branches','--remotes','--tags','--topo-order','--parents','-n',String(bound),
    '--pretty=format:%H%x1f%P%x1f%s%x1f%an%x1f%ct']);
  if(log===null)return {available:false};
  const commits=log.trim()?log.trim().split(/\r?\n/).map(line=>{
    const [sha,parents,subject,author,time]=line.split('\x1f');
    return {sha,parents:parents?parents.split(' ').filter(Boolean):[],subject:String(subject??''),author:String(author??''),time:Number(time??0)};
  }):[];
  let mainHead=null;try{mainHead=execFileSync('git',['rev-parse','main'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000}).trim();}catch{mainHead=null;}
  return {available:true,refs,commits,mainHead,limit:bound};
}
/** Read-only details for one commit: parents, files versus its parent, and fast-forward feasibility. */
export function readGitCommit(root, shaInput) {
  if(typeof shaInput!=='string'||!GIT_SHA_PATTERN.test(shaInput))throw Object.assign(new Error('GIT_COMMIT_INVALID'),{statusCode:400});
  const show=gitText(root,['show','-s','--pretty=format:%H%x1f%P%x1f%s%x1f%an%x1f%ct',shaInput]);
  if(show===null||!show.trim())throw Object.assign(new Error('GIT_COMMIT_NOT_FOUND'),{statusCode:404});
  const [sha,parents,subject,author,time]=show.trim().split('\x1f');
  let ahead=0,behind=0,fastForwardable=false,mainHead=null;
  try{mainHead=execFileSync('git',['rev-parse','main'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000}).trim();
    ensureFastForwardable(shaInput,root);fastForwardable=true;}catch{fastForwardable=false;}
  if(mainHead){
    const counts=gitText(root,['rev-list','--left-right','--count',`${mainHead}...${shaInput}`]);
    if(counts!==null){const parts=counts.trim().split(/\s+/);behind=Number(parts[0]);ahead=Number(parts[1]);}
  }
  const parentList=parents?parents.split(' ').filter(Boolean):[];
  const raw=gitText(root,parentList.length?['diff','--name-status',parentList[0],shaInput]:['diff-tree','--root','--no-commit-id','--name-status','-r',shaInput]);
  const included=fastForwardable?gitText(root,['log','--pretty=format:%H',`${mainHead}..${shaInput}`]):null;
  const files=raw!==null?raw.trim()?raw.trim().split(/\r?\n/).map(line=>{const status=line.slice(0,1);const name=line.slice(1).trim();return {status,name};}):[]:null;
  return {commit:{sha,parents:parents?parents.split(' ').filter(Boolean):[],subject:String(subject??''),author:String(author??''),time:Number(time??0)},
    mainHead,fastForwardable,ahead,behind,files,includedCommits:included!==null?included.trim()?included.trim().split(/\r?\n/):[]:[]};
}

export function runUpgradeCommand(root, args, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts/version-upgrade.mjs'), ...args],
      { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let diagnostic = '';
    for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', chunk => {
      if (stream === child.stderr) diagnostic = (diagnostic + chunk).slice(-8000);
      onOutput(chunk);
    }); }
    child.once('error', reject);
    child.once('exit', code => {
      const detail = diagnostic.split(/\r?\n/).find(line => ['SNAPSHOT_DATABASE_FAILED','GENE_HASH_MUST_CHANGE','CANDIDATE_BASE_CONFLICT','GENOME_GENERATION_NUMBER_CONFLICT','EVOLUTION_ALREADY_RUNNING','MAIN_SERVICE_UNAVAILABLE','MAIN_SERVICE_NOT_READY','LOCAL_CONTROL_PROCESS_IDENTITY_CONFLICT','ROLLBACK_TARGET_INVALID','ROLLBACK_TARGET_NOT_ANCESTOR','ROLLBACK_HISTORY_UNAVAILABLE','RELEASE_DELETE_DENIED','RELEASE_ACTIVE_CHANGED','RELEASE_IDENTITY_CHANGED','RELEASE_DELETE_PATH_DENIED','EVOLUTION_RECOVERY_REQUIRED','HISTORICAL_RELEASE_INTEGRITY_CONFLICT','ACTIVE_TRUSTED_RELEASE_CONFLICT','V23_ROLLBACK_DENIED_INSTANCE_PAYMENT_FACTS','PAYMENT_ROLLBACK_SCHEMA_UNSUPPORTED'].includes(line));
      const validationFailed = diagnostic.split(/\r?\n/).some(line => line.startsWith('LOCAL_VALIDATOR_COMMAND_FAILED:'));
      code === 0 ? resolve() : reject(new Error(detail ?? (validationFailed ? 'UPGRADE_VALIDATION_FAILED' : `UPGRADE_COMMAND_FAILED:${args[0]}`)));
    });
  });
}

// This Owner maintenance process stays outside the release being replaced.
export async function createUpgradeWeb({ root, config, secret, runCommand = runUpgradeCommand, status = readUpgradeStatus,
  checkRunning = generation => new LocalWorldRuntime({ ...config, ownerEnvironment: { EMERGENTINC_OWNER_SECRET: secret } }).checkRunning(generation) }) {
  const app = fastify({ logger: false, bodyLimit: 8192 });
  const jobFile = path.join(config.stateDirectory, 'upgrade-web-job.json');
  let job = fs.existsSync(jobFile) ? JSON.parse(fs.readFileSync(jobFile, 'utf8')) : null;
  if (job?.state === 'running') job = { ...job, state: 'interrupted', error: 'UPGRADE_INTERRUPTED_CHECK_RECOVERY' };
  let busy = false;
  const appReportSession = {};
  const delegatedToken=pixelReleaseToken(secret);
  app.addHook('onRequest', async (req, reply) => {
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` || req.headers['sec-fetch-site'] === 'cross-site')
      return reply.status(403).send({ detail: 'ORIGIN_FORBIDDEN' });
    if(req.url.split('?')[0].startsWith('/pixel/releases')){
      const supplied=req.headers.authorization?.replace(/^Bearer /,'')??'';
      if(!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(delegatedToken)))return reply.status(401).send({detail:'PIXEL_RELEASE_AUTH_REQUIRED'});
    }
  });
  registerOwnerAuth(app, { secret, secureCookies: false, cookieName: 'emergent_upgrade_owner' }, 'upgrade');
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  });
  app.get('/', async (_req, reply) => reply.type('text/html').send(fs.readFileSync(path.join(root, 'resources/upgrade-web.html'), 'utf8')));
  app.get('/health/live', async () => ({ alive: true, service: 'owner-upgrade', projectRoot: root,processId:process.pid,capabilities:['rollback','delete','pixel-release-maintenance-v1'] }));
  // Loopback read-only projection. Never expose private paths, logs, credentials or approval capabilities.
  app.get('/status', async () => {
    const current = status(root, config);
    return { service: 'owner-upgrade', active: current.active?.id ?? null, busy: busy || operatorBusy(config), startedAt: job?.startedAt ?? 0,
      candidates: current.candidates.map(row => ({ id: row.id, state: row.state, createdAt: Number(row.created_at ?? 0),
        sourceCommit: row.request?.owner_release?.source_commit ?? row.candidate?.source_commit ?? null,
        hash: row.candidate?.candidate_hash ?? null, baseGeneration: row.candidate?.base_generation ?? null })) };
  });
  app.get('/api/upgrades', async () => ({ ...status(root, config), job, busy: busy || operatorBusy(config) }));
  // Read-only Git DAG projections for the dual-tree view. Login required; never accepts paths.
  app.get('/api/git-graph', async (req,reply) => {
    try{const graph=readGitGraph(root,Number(req.query?.limit??200)||200);reply.send(graph);}catch(error){return reply.status(500).send({detail:error.message});}
  });
  app.get('/api/git-commit/:sha', async (req,reply) => {
    try{return await readGitCommit(root,String(req.params.sha));}catch(error){return reply.status(error.statusCode??500).send({detail:error.message});}
  });
  app.get('/api/code-reports/:id',async(req,reply)=>{
    try{return await readAppCodeReport(config,req.params.id,secret,fetch,appReportSession);}catch(error){return reply.status(409).send({detail:error.message});}
  });
  const handleAction=async (body,reply,actor=null) => {
    const requestHash=createHash('sha256').update(JSON.stringify({body,actor})).digest('hex');
    if(actor&&job?.operationKey===actor.operationKey){
      if(job.requestHash!==requestHash)return reply.status(409).send({detail:'IDEMPOTENCY_CONFLICT'});
      return reply.status(202).send({accepted:true,operationKey:actor.operationKey,state:job.state});
    }
    if (busy || operatorBusy(config)) return reply.status(409).send({ detail: 'UPGRADE_ALREADY_RUNNING' });
    const current = status(root, config);
    let commands,version;
    if (body.action === 'prepare') {
      let input;
      try{input=ownerReleaseInput(body.version,body.reason);}catch(error){return reply.status(400).send({detail:error.message});}
      let commitFlag='';
      if(body.sourceCommit!==undefined&&body.sourceCommit!==null&&body.sourceCommit!==''){
        if(typeof body.sourceCommit!=='string'||!GIT_SHA_PATTERN.test(body.sourceCommit))return reply.status(400).send({detail:'GIT_COMMIT_INVALID'});
        commitFlag=['--commit',body.sourceCommit];
        try{ensureFastForwardable(body.sourceCommit,root);}catch{return reply.status(409).send({detail:'GIT_COMMIT_NOT_FAST_FORWARDABLE'});}
      } else if (current.dirty) return reply.status(409).send({ detail: 'OWNER_RELEASE_REQUIRES_CLEAN_COMMITTED_CHECKOUT' });
      version=input.label;commands = [['prepare', version, input.reason, ...commitFlag]];
    } else if (body.action === 'prepare-code') {
      if(!/^code_[a-f0-9]{32}$/.test(body.id??'')||!/^[a-f0-9]{64}$/.test(body.hash??''))return reply.status(400).send({detail:'APP_CODE_REPORT_INVALID'});
      commands=[['prepare-code',body.id,body.hash]];
    } else if (body.action === 'validate') {
      const candidate = current.candidates.find(item => item.id === body.id);
      if (!candidate || candidate.state !== 'SUBMITTED' || candidate.request.base_generation !== current.active?.id ||
        body.expectedActive !== current.active?.id || typeof body.identity !== 'string' || body.identity !== candidate.identity)
        return reply.status(409).send({ detail: 'UPGRADE_CANDIDATE_CONFLICT' });
      commands = [['validate', body.id]];
    } else if (body.action === 'publish') {
      const candidate = current.candidates.find(item => item.id === body.id);
      if (!candidate || !['VALIDATED', 'APPROVED'].includes(candidate.state) || candidate.request.base_generation !== current.active?.id || candidate.candidate?.base_generation !== current.active?.id ||
        typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash) || body.hash !== candidate.candidate?.candidate_hash)
        return reply.status(409).send({ detail: 'UPGRADE_CANDIDATE_CONFLICT' });
      commands = [['approve', body.id, body.hash], ['apply', body.id]];
    } else if(body.action==='rollback'){
      const target=current.versions?.find(v=>v.id===body.targetGeneration);
      if(!target?.canRollback||body.expectedActive!==current.active?.id)return reply.status(409).send({detail:'ROLLBACK_TARGET_INVALID'});
      if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>800||body.reason.includes('\0')||body.deleteNewer!==undefined&&typeof body.deleteNewer!=='boolean')return reply.status(400).send({detail:'RELEASE_ACTION_INVALID'});
      const reason=actor?`Pixel ${actor.worldId}/${actor.pixelId}: ${body.reason}`:body.reason;
      commands=[['rollback-to',body.targetGeneration,body.expectedActive,reason]];
      if(body.deleteNewer===true)commands.push(['delete-newer',body.targetGeneration,reason]);
    } else if(body.action==='delete'){
      const release=current.candidates.find(c=>c.id===body.releaseId)??current.versions?.find(v=>v.release_id===body.releaseId);
      if(!release?.canDelete||body.expectedActive!==current.active?.id||typeof body.identity!=='string'||body.identity!==release.identity)return reply.status(409).send({detail:'RELEASE_DELETE_DENIED'});
      if(typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>800||body.reason.includes('\0'))return reply.status(400).send({detail:'RELEASE_ACTION_INVALID'});
      commands=[['delete-release',body.releaseId,body.expectedActive,body.identity,actor?`Pixel ${actor.worldId}/${actor.pixelId}: ${body.reason}`:body.reason]];
    } else if (body.action === 'recover') commands = [['recover']];
    else return reply.status(400).send({ detail: 'VERSION_UPGRADE_ACTION_INVALID' });
    busy = true;
    job = { action: body.action, id: body.id ?? body.releaseId??null, targetGeneration:body.targetGeneration??null,
      ...(actor?{requester:actor,operationKey:actor.operationKey,requestHash}:{}),...(version?{version}:{}), state: 'running', startedAt: Date.now(), log: '', error: null };
    const save = () => fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
    try { save(); } catch (error) { busy = false; throw error; }
    const execute = async () => {
      let gitSyncState = null;
      try {
        if (['publish','rollback'].includes(body.action)) await checkRunning(current.active.id);
        if (body.action === 'publish') {
          const candidate=current.candidates.find(item=>item.id===body.id);
          const gitTarget=candidate?.request?.owner_release?.git_sync_target;
          const expectedMainHead=candidate?.request?.owner_release?.main_head_at_prepare;
          if(gitTarget){
            // Pre-preflight: main must not have moved since prepare and must still fast-forward.
            try{
              if(expectedMainHead&&execFileSync('git',['rev-parse','main'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000}).trim()!==expectedMainHead)throw new Error('GIT_SYNC_MAIN_MOVED');
              ensureFastForwardable(gitTarget,root);
            }catch(error){job.error=`GIT_SYNC_BLOCKED:${error.message}`;job.state='failed';return;}
          }
        }
        for (const args of commands) await runCommand(root, args, chunk => { job.log = (job.log + chunk).slice(-8000); });
        if (body.action === 'publish') {
          const candidate=current.candidates.find(item=>item.id===body.id);
          const gitTarget=candidate?.request?.owner_release?.git_sync_target;
          const expectedMainHead=candidate?.request?.owner_release?.main_head_at_prepare;
          if(gitTarget){
            try{fastForwardMain(gitTarget,expectedMainHead,root);gitSyncState='synced';}
            catch(error){gitSyncState='needs_git_sync';job.log=(job.log+`\nGIT_SYNC_PENDING: ${error.message}\n`).slice(-8000);}
          }
        }
        job.state = 'succeeded';
        if (gitSyncState) job.gitSyncState = gitSyncState;
      } catch (error) { job.state = 'failed'; job.error = error.message; }
      finally { job.finishedAt = Date.now(); busy = false; save(); }
    };
    void execute();
    return reply.status(202).send({ accepted: true,...(actor?{operationKey:actor.operationKey}: {}) });
  };
  app.post('/api/upgrades',(req,reply)=>handleAction(req.body??{},reply));
  app.get('/pixel/releases',()=>{
    const current=status(root,config);
    return {active:current.active?.id??null,busy:busy||operatorBusy(config),afterRollback:current.afterRollback??false,
      versions:(current.versions??[]).map(v=>({generation:v.id,number:v.generation_no,releaseId:v.release_id,label:v.label,available:v.available,canRollback:v.canRollback,canDelete:v.canDelete,identity:v.identity})),
      candidates:current.candidates.map(c=>({releaseId:c.id,state:c.state,identity:c.identity,number:c.versionNumber,canDelete:c.canDelete??false})),
      job:job?{operationKey:job.operationKey??null,action:job.action,state:job.state,targetGeneration:job.targetGeneration,error:job.error}:null};
  });
  for(const action of ['rollback','delete'])app.post('/pixel/releases/'+action,(req,reply)=>{
    const b=req.body,keys=action==='rollback'?['targetGeneration','expectedActive','reason','deleteNewer']:['releaseId','expectedActive','identity','reason'];
    if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>![...keys,'worldId','pixelId','operationKey'].includes(k))||
      typeof b.worldId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.worldId)||typeof b.pixelId!=='string'||b.pixelId.length>80||!/^[-]?[0-9]+_[-]?[0-9]+_[-]?[0-9]+$/.test(b.pixelId)||typeof b.operationKey!=='string'||!b.operationKey||b.operationKey.length>240||/[\x00-\x1f]/.test(b.operationKey))return reply.status(400).send({detail:'RELEASE_ACTION_INVALID'});
    const {worldId,pixelId,operationKey,...input}=b;
    return handleAction({action,...input},reply,{worldId,pixelId,operationKey});
  });
  app.setErrorHandler((error, _req, reply) => reply.status(500).send({ detail: error.message }));
  await app.ready();
  return app;
}

export async function ensureUpgradeWeb(root = projectRoot) {
  const { config } = upgradeConfig(root), url = upgradeWebUrl(config);
  try {
    const response = await fetch(url + '/health/live', { signal: AbortSignal.timeout(2000) }), value = await response.json();
    if (response.ok && value.service === 'owner-upgrade' && value.projectRoot === root) return url;
    throw new Error('UPGRADE_WEB_PORT_CONFLICT');
  } catch (error) { if (error.message === 'UPGRADE_WEB_PORT_CONFLICT') throw error; }
  const log = fs.openSync(path.join(config.stateDirectory, 'upgrade-web.log'), 'a');
  try {
    const child = spawn(process.execPath, [path.join(root, 'scripts/upgrade-web.mjs')],
      { cwd: root, shell: false, windowsHide: true, detached: true, stdio: ['ignore', log, log] });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { fs.closeSync(log); }
  for (let attempt = 0; attempt < 30; attempt++) {
    try { const response = await fetch(url + '/health/live'); const value = await response.json();
      if (response.ok && value.service === 'owner-upgrade' && value.projectRoot === root) return url;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('UPGRADE_WEB_START_FAILED');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { config } = upgradeConfig(projectRoot), secret = ownerEnvironment(projectRoot).EMERGENTINC_OWNER_SECRET;
  const app = await createUpgradeWeb({ root: projectRoot, config, secret });
  await app.listen({ host: '127.0.0.1', port: Number(new URL(upgradeWebUrl(config)).port) });
  console.log('Owner upgrade page: ' + upgradeWebUrl(config));
}
