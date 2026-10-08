import * as fs from 'node:fs';
import * as path from 'node:path';
import {LineageStore} from '../packages/persistence/dist/index.js';
import {GenerationSupervisor} from '../supervisor/dist/generation_supervisor.js';
import {LocalWorldRuntime} from '../supervisor/dist/local_world_runtime.js';
import {ownerEnvironment} from './local-release.mjs';

// Explicit local Owner CLI. No Body/HTTP caller can approve an exact candidate through this interface.
const [configFile,action,value,exactHash,...extra]=process.argv.slice(2);let supervisor,lineage,lock;
try{
  if(!['submit','submit-owner-release','validate','approve','birth','rollback','rollback-to','delete-release','delete-newer','recover','show','list','post-rollback-dream'].includes(action))throw new Error('Usage: v23-generation <owner-config.json> submit <request.json> | validate/show/birth <id> | approve <id> <exact-hash> | rollback <id> <reason> | rollback-to <generation> <expected-active> <reason> | delete-release <id> <expected-active> <identity> <reason> | delete-newer <expected-active> <reason> | recover | list');
  const config=JSON.parse(fs.readFileSync(path.resolve(configFile),'utf8'));
  if(!config.ownerProjectRoot)throw new Error('OWNER_PROJECT_ROOT_REQUIRED');
  for(const key of ['workspace','releases','stateDirectory','activeReleaseFile'])config[key]=path.resolve(config.ownerProjectRoot,config[key]);
  config.ownerEnvironment=ownerEnvironment(config.ownerProjectRoot);fs.mkdirSync(config.stateDirectory,{recursive:true});
  lock=path.join(config.stateDirectory,'operator.lock');if(fs.existsSync(lock)){const raw=fs.readFileSync(lock,'utf8'),previous=JSON.parse(raw);if(!Number.isSafeInteger(previous.pid)||previous.pid<1)throw new Error('INVALID_EVOLUTION_LOCK');
    try{process.kill(previous.pid,0);throw new Error('EVOLUTION_ALREADY_RUNNING');}catch(error){if(error.code!=='ESRCH')throw error;}if(fs.readFileSync(lock,'utf8')!==raw)throw new Error('EVOLUTION_LOCK_CHANGED');fs.unlinkSync(lock);}
  fs.writeFileSync(lock,JSON.stringify({pid:process.pid}),{flag:'wx'});
  const runtime=new LocalWorldRuntime(config);lineage=new LineageStore(path.join(config.workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  supervisor=new GenerationSupervisor(config.stateDirectory,path.join(config.workspace,'system'),config.releases,lineage,runtime,true);
  let result;if(action==='submit')result=supervisor.submit(JSON.parse(fs.readFileSync(path.resolve(value),'utf8')));
  else if(action==='submit-owner-release')result=supervisor.submitOwnerRelease(JSON.parse(fs.readFileSync(path.resolve(value),'utf8')));
  else if(action==='list')result=supervisor.list();else if(action==='show')result=supervisor.get(value);
  else if(action==='approve')result=supervisor.approve(value,exactHash);else if(action==='rollback')result=await supervisor.rollback(value,exactHash);
  else if(action==='rollback-to')result=await supervisor.rollbackTo(value,exactHash,extra[0]);
  else if(action==='delete-release')result=supervisor.deleteRelease(value,exactHash,extra[0],extra[1]);
  else if(action==='delete-newer')result=supervisor.deleteNewerReleases(value,exactHash);
  else if(action==='recover')result=await supervisor.recover();else if(action==='post-rollback-dream')result=await supervisor.postRollbackDream(value);
  else result=await supervisor[action](value);console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);console.error(error.stack);if(error.cause)console.error(error.cause);process.exitCode=1;}
finally{supervisor?.close();lineage?.close();if(lock&&fs.existsSync(lock)&&JSON.parse(fs.readFileSync(lock,'utf8')).pid===process.pid)fs.unlinkSync(lock);}
