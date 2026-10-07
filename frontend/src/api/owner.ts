import type { OwnerActionProposal, OwnerOverview } from '../../../packages/protocol/src/types/owner';
import { apiRequest, ApiError } from './client';
import type { OwnerChatAnswer, OwnerChatTurn } from './ownerChat';
import { language, t } from '../i18n';
import { explanations } from '../features/business/business_api';
import { postQianjiChat } from './qianji';
export type { OwnerActionProposal, OwnerOverview, OwnerInboxItem, OwnerActivityItem } from '../../../packages/protocol/src/types/owner';
export const fetchOwnerOverview=()=>apiRequest<OwnerOverview>('owner/overview',{worldScoped:false});
export const askMissionOwner=(question:string,history:OwnerChatTurn[])=>apiRequest<OwnerChatAnswer&{proposals?:OwnerActionProposal[]}>('owner/chat',{
  worldScoped:false,method:'POST',body:JSON.stringify({question,history,language:language()}),timeoutMs:2*60*60*1000});
export function ownerError(error:unknown):string {
  if(error instanceof ApiError){
    const labels:Record<string,string>={MODEL_NOT_CONFIGURED:'Configure a real model before asking project questions.',INVALID_OWNER_CHAT:'The question or chat history is invalid.',EVOLUTION_QUIESCED:'The instance is paused for upgrade. Try again after it resumes.',OWNER_ACTION_DENIED:'Unsupported action'};
    return labels[error.detail]?t(labels[error.detail]!):explanations[error.detail] ?? t(error.detail);
  }
  return error instanceof Error?error.message:String(error);
}

/** Execute only existing typed APIs. Retry keys survive partial delivery and reloads. */
export async function executeOwnerAction(proposal:OwnerActionProposal):Promise<{id:string;ok:boolean;error?:string}[]> {
  const a=proposal.action;
  if(a.type==='qianji_chat'){
    const result:{id:string;ok:boolean;error?:string}[]=[], targets=[...a.targets];
    const worker=async()=>{let target;while((target=targets.shift())){
      const key=`emergentinc.owner.action:${proposal.id}:${target.id}`;
      const stored=localStorage.getItem(key),pending=stored?JSON.parse(stored) as {key:string;accepted:boolean}:{key:crypto.randomUUID(),accepted:false};
      if(pending.accepted){result.push({id:target.id,ok:true});continue;}
      localStorage.setItem(key,JSON.stringify(pending));
      try {await postQianjiChat(target.id,a.message,pending.key);localStorage.setItem(key,JSON.stringify({...pending,accepted:true}));result.push({id:target.id,ok:true});}
      catch(e){result.push({id:target.id,ok:false,error:ownerError(e)});}
    }};
    await Promise.all([worker(),worker()]);return result;
  }
  const post=(path:string,body:unknown)=>apiRequest(path,{worldScoped:false,method:'POST',body:JSON.stringify(body)});
  if(a.type==='business_plan_approve'||a.type==='business_plan_reject')await post(`business/plans/${encodeURIComponent(a.plan.id)}/${a.type==='business_plan_approve'?'approve':'revoke'}`,{revision:a.plan.revision,hash:a.plan.hash});
  else if(a.type==='resource_provided'||a.type==='resource_reject')await post(`business/requests/${encodeURIComponent(a.requestId)}/decision`,{decision:a.type==='resource_provided'?'provided':'reject',note:a.note,planId:a.planId,revision:a.revision});
  else throw new Error('OWNER_ACTION_DENIED');
  return [{id:proposal.id,ok:true}];
}
