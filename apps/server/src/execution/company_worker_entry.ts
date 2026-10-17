import { randomUUID } from 'node:crypto';
import { OpenAICompatibleProvider } from '@emergentinc/model';
import { acquireCompanyWorkerLock } from './company_worker_lock.js';
import { executeCompanyWorker } from './company_worker_engine.js';
import type { CompanyWorkerBroker, CompanyWorkerSpec } from './company_worker_protocol.js';

const pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
let started=false;
function rpc(method: keyof CompanyWorkerBroker, args: unknown[]): Promise<any> {
  if(!process.connected)return Promise.reject(new Error('OWNER_CONTROLLER_DISCONNECTED'));
  return new Promise((resolve,reject)=>{
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('OWNER_CONTROLLER_DISCONNECTED'));},30_000);
    pending.set(id,{resolve,reject,timer});
    process.send!({kind:'rpc',id,method,args},error=>{if(error){const p=pending.get(id);if(p){clearTimeout(p.timer);pending.delete(id);p.reject(new Error('OWNER_CONTROLLER_DISCONNECTED'));}}});
  });
}
const broker:CompanyWorkerBroker={authorizeModel:(...args)=>rpc('authorizeModel',args),authorizeTool:(...args)=>rpc('authorizeTool',args),controllerTool:(...args)=>rpc('controllerTool',args),controllerToolReceipt:(...args)=>rpc('controllerToolReceipt',args),receipt:(...args)=>rpc('receipt',args)};
process.on('disconnect',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('OWNER_CONTROLLER_DISCONNECTED'));}pending.clear();});
process.on('message',async(message:any)=>{
  if(message?.kind==='rpc-result'){
    const p=pending.get(message.id);if(!p)return;clearTimeout(p.timer);pending.delete(message.id);if(message.error)p.reject(new Error(String(message.error)));else p.resolve(message.value);return;
  }
  if(message?.kind!=='start'||started)return;
  started=true;let unlock:(()=>void)|undefined;
  try {
    const spec=message.spec as CompanyWorkerSpec,directory=String(message.directory);
    const lock=await acquireCompanyWorkerLock(directory,spec.attemptId,spec.fence);unlock=lock.release;
    const apiKey=process.env.MCL_API_KEY,baseUrl=process.env.MCL_BASE_URL;
    if(!apiKey||!baseUrl)throw new Error('MODEL_NOT_CONFIGURED');
    const provider=new OpenAICompatibleProvider({apiKey,baseUrl,maxRetries:0,timeoutMs:Number(process.env.MCL_TIMEOUT_MS||120_000)});
    process.send?.({kind:'ready',pid:process.pid,identity:lock.nonce,birth:lock.birth,attemptId:spec.attemptId,fence:spec.fence});
    const result=await executeCompanyWorker(directory,spec,provider,broker);
    if(process.connected)process.send?.({kind:'finished',result});
    process.exitCode=0;
  } catch(e) {if(process.connected)process.send?.({kind:'failed',reason:e instanceof Error?e.message:'OWNER_WORKER_FAILED'});process.exitCode=1;}
  finally {unlock?.();if(process.connected)process.disconnect();}
});
