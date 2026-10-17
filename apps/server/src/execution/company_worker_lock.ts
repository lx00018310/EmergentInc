import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { containedPath } from '../services/safe_path.js';
import { DatabaseSync } from 'node:sqlite';

const execute=promisify(execFile);
function exists(pid:number){try{process.kill(pid,0);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return false;throw new Error('OWNER_WORKER_IDENTITY_UNVERIFIED');}}
/** PID plus OS birth identity: a recycled PID never proves the original worker is alive. */
export async function companyProcessBirth(pid:number):Promise<string|null>{
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('OWNER_WORKER_IDENTITY_CONFLICT');
  if(!exists(pid))return null;
  try{
    if(process.platform==='win32'){
      const result=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$taskProcess = Get-Process -Id ${pid} -ErrorAction Stop; $taskProcess.StartTime.ToUniversalTime().Ticks.ToString()`],{windowsHide:true,timeout:10000,maxBuffer:8192});
      const birth=result.stdout.trim();if(!/^\d+$/.test(birth))throw new Error();return 'windows:'+birth;
    }
    if(process.platform==='linux'){
      const stat=fs.readFileSync(`/proc/${pid}/stat`,'utf8'),birth=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
      if(!/^\d+$/.test(birth))throw new Error();return 'linux:'+fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+birth;
    }
    throw new Error();
  }catch{if(!exists(pid))return null;throw new Error('OWNER_WORKER_IDENTITY_UNVERIFIED');}
}
export async function acquireCompanyWorkerLock(directory:string,attemptId:string,fence:number){
  const birth=await companyProcessBirth(process.pid);if(!birth)throw new Error('OWNER_WORKER_IDENTITY_UNVERIFIED');
  const runtime=containedPath(directory,'runtime');fs.mkdirSync(runtime,{recursive:true});
  const file=containedPath(directory,'runtime','instance.lock'),nonce=randomUUID();
  // The OS-backed SQLite write lock spans execution. File-only stale-lock removal races.
  const mutex=new DatabaseSync(containedPath(directory,'runtime','process-lock.sqlite3'));let held=false;
  try{
  mutex.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');held=true;
  if(fs.existsSync(file)){
    const contents=fs.readFileSync(file,'utf8');let previous:any;try{previous=JSON.parse(contents);}catch{throw new Error('OWNER_WORKER_IDENTITY_CONFLICT');}
    if(previous.schema!==1||previous.attemptId!==attemptId||previous.fence!==fence||typeof previous.birth!=='string'||typeof previous.nonce!=='string')throw new Error('OWNER_WORKER_IDENTITY_CONFLICT');
    const actual=await companyProcessBirth(previous.pid);if(actual===previous.birth)throw new Error('WORKSPACE_ALREADY_RUNNING');
    if(fs.readFileSync(file,'utf8')!==contents)throw new Error('WORKSPACE_LOCK_CHANGED');fs.unlinkSync(file);
  }
  fs.writeFileSync(file,JSON.stringify({schema:1,pid:process.pid,birth,nonce,attemptId,fence}),{flag:'wx',mode:0o600});
  return {birth,nonce,release:()=>{try{if(fs.existsSync(file)&&JSON.parse(fs.readFileSync(file,'utf8')).nonce===nonce)fs.unlinkSync(file);}finally{mutex.exec('ROLLBACK');mutex.close();}}};
  }catch(e){if(held)mutex.exec('ROLLBACK');mutex.close();if(/database is (?:locked|busy)/i.test((e as Error).message))throw new Error('WORKSPACE_ALREADY_RUNNING');throw e;}
}
