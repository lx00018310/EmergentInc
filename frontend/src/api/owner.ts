import type { OwnerActionProposal, OwnerOverview } from '../../../packages/protocol/src/types/owner';
import { apiRequest, ApiError } from './client';
import type { OwnerChatAnswer, OwnerChatTurn } from './ownerChat';
import { language, t } from '../i18n';
export type { OwnerActionProposal, OwnerOverview, OwnerInboxItem, OwnerActivityItem, OwnerAlert, OwnerWork } from '../../../packages/protocol/src/types/owner';
export const fetchOwnerOverview=(signal?:AbortSignal)=>apiRequest<OwnerOverview>('owner/overview',{worldScoped:false,signal,timeoutMs:15000});
export type { OwnerGoal, OwnerGoalDetail, OwnerAutomation, OwnerRunReport } from '../../../packages/protocol/src/types/owner';
export const ownerGoalRequest=<T,>(path:string,method='GET',body?:unknown)=>apiRequest<T>(`owner/${path}`,{worldScoped:false,method, ...(body?{body:JSON.stringify(body)}:{})});
export const ownerTodoCount=(data:Pick<OwnerOverview,'inbox'|'alerts'>)=>data.inbox.length+(data.alerts?.length??0);
export interface ConfiguredProduct {productId:string;enabled:boolean;price:string;nameEn:string;nameZh:string;href:string;updatedAt:number;eventId:number;reason:string|null}
export const askMissionOwner=(question:string,history:OwnerChatTurn[],requestKey:string=crypto.randomUUID(),requestLanguage=language())=>apiRequest<OwnerChatAnswer&{proposals?:OwnerActionProposal[];createdGoal?:import('../../../packages/protocol/src/types/owner').OwnerGoal;configuredProduct?:ConfiguredProduct;companyProposal?:import('../../../packages/protocol/src/types/owner').CompanyProposal}>('owner/chat',{
  worldScoped:false,method:'POST',body:JSON.stringify({question,history,language:requestLanguage,requestKey}),timeoutMs:2*60*60*1000});
export function ownerError(error:unknown):string {
  if(error instanceof ApiError){
    if(error.status===401)return t('Your session expired. Sign in again to refresh the dashboard.');
    if(error.status===0)return t('Connection failed. Check the service and try again.');
    const labels:Record<string,string>={MODEL_NOT_CONFIGURED:'Configure a real model before asking project questions.',INVALID_OWNER_CHAT:'The question or chat history is invalid.',EVOLUTION_QUIESCED:'The instance is paused for upgrade. Try again after it resumes.',OWNER_ACTION_DENIED:'Unsupported action'};
    return labels[error.detail]?t(labels[error.detail]!):t(error.detail);
  }
  return t(error instanceof Error?error.message:String(error));
}

/** Execute only existing typed APIs. Retry keys survive partial delivery and reloads. */
export async function executeOwnerAction(proposal:OwnerActionProposal):Promise<{id:string;ok:boolean;error?:string}[]> {
  const a=proposal.action;
  const post=(path:string,body:unknown)=>apiRequest(path,{worldScoped:false,method:'POST',body:JSON.stringify(body)});
  if(a.type==='recruit_approve'||a.type==='recruit_reject')await post(`owner/requests/${encodeURIComponent(a.requestId)}/decision`,{decision:a.type==='recruit_approve'?'approve':'reject',hash:a.hash});
  else throw new Error('OWNER_ACTION_DENIED');
  return [{id:proposal.id,ok:true}];
}
