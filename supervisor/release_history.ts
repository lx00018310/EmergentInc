export interface ReleaseGeneration { id:string; generation_no:number; parent_id:string|null; release_id:string; state:string }
export interface ReleaseRecord { id:string; state:string; target_generation:string|null; request:{base_generation:string; base_release:string} }

/** Follow the actual published ancestry, never sort free-text version labels. */
export function rollbackPlan(generations:ReleaseGeneration[], releases:ReleaseRecord[], activeId:string, targetId:string):ReleaseRecord[] {
  const byId=new Map(generations.map(g=>[g.id,g])),active=byId.get(activeId),target=byId.get(targetId);
  if(!active||!target||target.generation_no>=active.generation_no||target.state==='FAILED')throw new Error('ROLLBACK_TARGET_INVALID');
  const steps:ReleaseRecord[]=[],seen=new Set<string>();let current=active;
  while(current.id!==targetId){
    if(seen.has(current.id)||!current.parent_id)throw new Error('ROLLBACK_TARGET_NOT_ANCESTOR');seen.add(current.id);
    const previous=byId.get(current.parent_id),release=releases.find(r=>r.id===current.release_id&&r.target_generation===current.id);
    if(!previous||!release||release.state!=='BORN'||release.request.base_generation!==previous.id||release.request.base_release!==previous.release_id)
      throw new Error('ROLLBACK_HISTORY_UNAVAILABLE');
    steps.push(release);current=previous;
  }
  return steps;
}

export function canDeleteRelease(state:string,releaseId:string,versionNumber:number,active:ReleaseGeneration,afterRollback:boolean):boolean {
  return afterRollback&&releaseId!==active.release_id&&Number.isSafeInteger(versionNumber)&&versionNumber>active.generation_no&&
    ['SUBMITTED','VALIDATED','APPROVED','BORN','ROLLED_BACK','FAILED'].includes(state);
}
