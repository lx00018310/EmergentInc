import { createHmac } from 'node:crypto';

// This delegated credential is accepted only by the rollback/delete endpoints, never Owner login or publication.
export const pixelReleaseToken=(secret:string)=>createHmac('sha256',secret).update('emergentinc:pixel-release-maintenance:v1').digest('hex');
export interface ReleaseActor { worldId:string; pixelId:string; operationKey:string }
export interface ReleaseRollbackInput { targetGeneration:string; expectedActive:string; reason:string; deleteNewer?:boolean }
export interface ReleaseDeleteInput { releaseId:string; expectedActive:string; identity:string; reason:string }
export class ReleaseMaintenanceClient {
  private token:string;
  constructor(private origin:string,secret:string,private fetcher:typeof fetch=fetch) {
    if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)||secret.length<32)throw new Error('RELEASE_MAINTENANCE_CONFIG_INVALID');
    this.token=pixelReleaseToken(secret);
  }
  private async request(route:string,body?:unknown) {
    const response=await this.fetcher(`${this.origin}/pixel/releases${route}`,{
      method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.token}`,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});
    const value=await response.json() as {detail?:unknown};if(!response.ok)throw new Error(typeof value?.detail==='string'?value.detail:'RELEASE_MAINTENANCE_UNAVAILABLE');return value;
  }
  list(){return this.request('');}
  rollback(input:ReleaseRollbackInput,actor:ReleaseActor){return this.request('/rollback',{...input,...actor});}
  delete(input:ReleaseDeleteInput,actor:ReleaseActor){return this.request('/delete',{...input,...actor});}
}
