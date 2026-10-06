import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawn,ChildProcess} from 'node:child_process';
import {EvolutionRuntime} from './protocol.js';
import {DatabaseSync} from 'node:sqlite';
import {checkPaymentRollback,preparePaymentRollback} from './payment_compatibility.js';

export interface LocalWorldRuntimeConfig {workspace:string;releases:string;stateDirectory:string;activeReleaseFile:string;appUrl:string;ownerEnvironment:NodeJS.ProcessEnv}
/** Explicit Windows Owner maintenance. This is not an OS-isolated Linux trust root. */
export class LocalWorldRuntime implements EvolutionRuntime {
  private cookie?:string;
  private started?:ChildProcess;
  constructor(readonly config:LocalWorldRuntimeConfig){
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(config.appUrl)||String(config.ownerEnvironment.EMERGENTINC_OWNER_SECRET??'').length<32)throw new Error('LOCAL_WORLD_CONTROL_CONFIG_INVALID');
    const relative=path.relative(config.workspace,config.stateDirectory);if(!relative.startsWith('..')&&!path.isAbsolute(relative))throw new Error('SUPERVISOR_STATE_MUST_BE_OUTSIDE_WORKSPACE');
  }
  private cleanEnv(){return {PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,LOCALAPPDATA:process.env.LOCALAPPDATA,CI:'1',EMERGENTINC_CANDIDATE_MODE:'1'};}
  private execute(executable:string,args:string[],directory:string,env:NodeJS.ProcessEnv,timeout=300000){return new Promise<void>((resolve,reject)=>{
    const log=fs.openSync(path.join(this.config.stateDirectory,'validation-'+path.basename(directory)+'.log'),'a');
    const child=spawn(executable,args,{cwd:directory,env,windowsHide:true,shell:false,stdio:['ignore',log,log]}),timer=setTimeout(()=>child.kill(),timeout);
    child.once('error',()=>{clearTimeout(timer);fs.closeSync(log);reject(new Error('LOCAL_VALIDATOR_COMMAND_UNAVAILABLE'));});child.once('exit',code=>{clearTimeout(timer);fs.closeSync(log);code===0?resolve():reject(new Error('LOCAL_VALIDATOR_COMMAND_FAILED: '+args.join(' ')));});
  });}
  async validateRelease(directory:string){
    const shell=process.env.ComSpec||'cmd.exe';
    const install=process.platform==='win32'?()=>this.execute(shell,['/d','/s','/c','pnpm.cmd install --offline --frozen-lockfile --ignore-scripts'],directory,this.cleanEnv()):()=>this.execute('pnpm',['install','--offline','--frozen-lockfile','--ignore-scripts'],directory,this.cleanEnv());
    await install();
    for(const command of ['pnpm.cmd typecheck','pnpm.cmd test --maxWorkers=4','pnpm.cmd build','pnpm.cmd --dir frontend build']){
      if(process.platform==='win32')await this.execute(shell,['/d','/s','/c',command],directory,this.cleanEnv());
      else await this.execute('pnpm',command.replace('pnpm.cmd ','').split(' '),directory,this.cleanEnv());
    }
  }
  activeRelease(){return fs.realpathSync(JSON.parse(fs.readFileSync(this.config.activeReleaseFile,'utf8')).directory);}
  worlds(){const db=new DatabaseSync(path.join(this.config.workspace,'system/control/control.sqlite3'),{readOnly:true});try{
    return db.prepare("SELECT world_id,workspace_relpath FROM qianji_worlds WHERE status='ACTIVE' AND world_id NOT IN (SELECT world_id FROM world_recovery_blocks) ORDER BY world_id").all().map(row=>({id:String(row.world_id),directory:path.join(this.config.workspace,String(row.workspace_relpath))}));
  }finally{db.close();}}
  private async owner(action:string,body:unknown={}){
    if(!this.cookie){const response=await fetch(this.config.appUrl+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({secret:this.config.ownerEnvironment.EMERGENTINC_OWNER_SECRET}),redirect:'error',signal:AbortSignal.timeout(8000)});
      this.cookie=response.headers.get('set-cookie')?.split(';')[0];if(response.status!==200||!this.cookie)throw new Error('EVOLUTION_OWNER_AUTH_FAILED');}
    const response=await fetch(this.config.appUrl+'/api/evolution/'+action,{method:'POST',headers:{cookie:this.cookie,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(180000)});
    await response.arrayBuffer();if(!response.ok)throw new Error('EVOLUTION_OWNER_ACTION_FAILED: '+action);
  }
  async quiesce(){await this.owner('quiesce');}async finalDream(){await this.owner('final-dream');}async resume(){await this.owner('resume');}
  async postRollbackDream(input:unknown){await this.owner('post-rollback-dream',input);}
  async smoke(directory:string,workspace:string,generation:string){await this.execute(process.execPath,[path.join(directory,'supervisor/candidate_harness.mjs'),'smoke',directory,workspace,generation],directory,this.cleanEnv(),30000);}
  async stop(){
    // A failed start may never open HTTP or write its lock. Stop only the child we spawned.
    if(this.started){const child=this.started;if(child.exitCode===null&&child.signalCode===null){
      await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('WORLD_SERVER_STOP_TIMEOUT')),15000);
        child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill();});
    }this.started=undefined;this.cookie=undefined;return;}
    const file=path.join(this.config.workspace,'runtime/instance.lock');if(!fs.existsSync(file)){this.cookie=undefined;return;}
    const record=JSON.parse(fs.readFileSync(file,'utf8'));if(!Number.isSafeInteger(record.pid)||record.pid<1)throw new Error('WORKSPACE_LOCK_INVALID');
    const status=await fetch(this.config.appUrl+'/health/live',{headers:{Connection:'close'},signal:AbortSignal.timeout(3000)}),identity=await status.json() as any;if(!status.ok||identity.alive!==true||identity.processId!==record.pid)throw new Error('LOCAL_CONTROL_PROCESS_IDENTITY_CONFLICT');
    process.kill(record.pid);this.cookie=undefined;
    for(let i=0;i<150;i++){try{process.kill(record.pid,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')return;throw e;}await new Promise(r=>setTimeout(r,100));}throw new Error('WORLD_SERVER_STOP_TIMEOUT');
  }
  checkRollback(directory:string){checkPaymentRollback(path.join(this.config.workspace,'system/payment/payment.sqlite3'),directory);}
  async prepareRollback(directory:string){preparePaymentRollback(path.join(this.config.workspace,'system/payment/payment.sqlite3'),directory);}
  async switchRelease(directory:string){
    const relative=path.relative(this.config.releases,directory);if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||path.dirname(relative)!=='.')throw new Error('LOCAL_RELEASE_PATH_INVALID');
    const temporary=this.config.activeReleaseFile+'.next';fs.writeFileSync(temporary,JSON.stringify({directory:fs.realpathSync(directory)}));fs.renameSync(temporary,this.config.activeReleaseFile);
  }
  async start(){
    const directory=this.activeRelease(),port=new URL(this.config.appUrl).port,log=fs.openSync(path.join(this.config.stateDirectory,'server.log'),'a');
    try{const child=spawn(process.execPath,[path.join(directory,'apps/server/dist/main.js')],{cwd:directory,windowsHide:true,shell:false,detached:true,
      stdio:['ignore',log,log],env:{...this.config.ownerEnvironment,EMERGENTINC_WORKSPACE_ROOT:this.config.workspace,EMERGENTINC_RELEASE_ID:path.basename(directory),EMERGENTINC_START_PAUSED:'1',EMERGENTINC_CANDIDATE_MODE:'0',HOST:'127.0.0.1',PORT:port}});
      this.started=child;await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',error=>{this.started=undefined;reject(error);});});child.unref();
    }finally{fs.closeSync(log);}
  }
  async healthy(generation:string){for(let i=0;i<100;i++){try{const result=await fetch(this.config.appUrl+'/health/ready',{headers:{Connection:'close'},signal:AbortSignal.timeout(1000)});const value=await result.json() as any;if(result.ok&&value.ready&&value.generation===generation)return;}catch{}await new Promise(r=>setTimeout(r,150));}throw new Error('GENERATION_HEALTH_FAILED');}
}
