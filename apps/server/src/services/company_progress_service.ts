import {createHash} from 'node:crypto';
import type {CompanyNodeProgress,CompanyProgressGap,CompanyProgressScope,CompanyProgressView,CompanyTaskNode,CompanyTaskPlanView} from '@emergentinc/protocol';
import type {OwnerGoalService} from './owner_goal_service.js';
import {ownerConflict,ownerInput} from './owner_goal_service.js';

const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
interface Scope extends CompanyProgressScope {
  schema:1; operations:string[]; outcomes:Record<string,CompanyNodeProgress>; notes:Record<string,string>;
  windowMs?:number;
}
export const PROGRESS_LIMITS={modelCalls:60,toolCalls:120,windowMs:15*60_000,gapAttempts:3} as const;
const settled=new Set(['COMPLETED','PARTIAL','DEFERRED','SKIPPED']);

/** Only continuation facts and bounded allowances live here. Execution and money retain their existing owners. */
export class CompanyProgressService {
  constructor(readonly goals:OwnerGoalService){
    goals.store.db.exec(`CREATE TABLE IF NOT EXISTS company_progress_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
      INSERT OR IGNORE INTO company_progress_schema VALUES(1,1);
      CREATE TABLE IF NOT EXISTS company_progress_scopes(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,key TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,UNIQUE(goal_id,key));
      CREATE TABLE IF NOT EXISTS company_progress_gaps(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,fact_key TEXT NOT NULL,body TEXT NOT NULL,revision INTEGER NOT NULL,UNIQUE(goal_id,fact_key));`);
    if(goals.store.db.prepare('SELECT version FROM company_progress_schema WHERE id=1').get()!.version!==1)throw new Error('OWNER_PROGRESS_SCHEMA_UNSUPPORTED');
  }
  private scopes(goalId:string):Scope[]{return this.goals.store.db.prepare('SELECT body,revision FROM company_progress_scopes WHERE goal_id=? ORDER BY rowid').all(goalId).map(r=>{
    const body=JSON.parse(String(r.body));
    if(body.schema!==1||!Array.isArray(body.dispatchIds)||!Array.isArray(body.operations)||!body.outcomes||!body.notes||![body.modelCalls,body.toolCalls,body.maxModelCalls,body.maxToolCalls].every(v=>Number.isSafeInteger(v)&&v>=0))throw new Error('OWNER_PROGRESS_SCHEMA_UNSUPPORTED');
    return {...body,revision:Number(r.revision)};
  });}
  private save(scope:Scope){
    const changed=this.goals.store.db.prepare('UPDATE company_progress_scopes SET body=?,revision=revision+1 WHERE id=? AND revision=?').run(JSON.stringify(scope),scope.id,scope.revision);
    if(!changed.changes)ownerConflict('OWNER_PROGRESS_CHANGED');scope.revision++;
  }
  forDispatch(dispatchId:string):Scope|null {
    const row=this.goals.store.db.prepare('SELECT goal_id FROM owner_goal_dispatches WHERE id=?').get(dispatchId);
    return row?this.scopes(String(row.goal_id)).find(s=>s.dispatchIds.includes(dispatchId))??null:null;
  }
  outcome(dispatchId:string):CompanyNodeProgress|undefined{return this.forDispatch(dispatchId)?.outcomes[dispatchId];}
  latest(goalId:string,nodeKey:string):CompanyNodeProgress|undefined {
    const rows=this.goals.store.db.prepare('SELECT dispatch_id FROM owner_task_occurrences WHERE goal_id=? AND goal_revision=? AND node_key=? ORDER BY rowid DESC').all(goalId,this.goals.get(goalId).specificationRevision,nodeKey);
    for(const row of rows){const value=this.outcome(String(row.dispatch_id));if(value)return value;}return undefined;
  }
  view(goalId:string):CompanyProgressView {
    return {scopes:this.scopes(goalId).map(({schema,operations,outcomes,notes,...scope})=>scope),gaps:this.gaps(goalId)};
  }
  gaps(goalId:string):CompanyProgressGap[]{return this.goals.store.db.prepare('SELECT body FROM company_progress_gaps WHERE goal_id=? ORDER BY rowid').all(goalId).map(r=>JSON.parse(String(r.body)));}
  gap(goalId:string,factKey:string,description:string,nodeKey:string):CompanyProgressGap {
    const id='gap_'+digest([goalId,factKey]),db=this.goals.store.db;
    const old=db.prepare('SELECT body FROM company_progress_gaps WHERE id=?').get(id);
    if(old){const gap=JSON.parse(String(old.body)) as CompanyProgressGap;if(!gap.nodeKeys.includes(nodeKey)){gap.nodeKeys.push(nodeKey);this.saveGap(goalId,gap);}return gap;}
    ownerInput(factKey.length>0&&factKey.length<=512&&description.length>0&&description.length<=1200,'OWNER_PROGRESS_INVALID');
    const parts=factKey.split(':'),prefix=parts.slice(0,3).join(':')+':',suffix=':'+parts.slice(4).join(':');
    const predecessor=parts[0]==='requirement'?this.gaps(goalId).find(g=>g.superseded&&g.factKey.startsWith(prefix)&&g.factKey.endsWith(suffix)):undefined;
    const gap:CompanyProgressGap={id,factKey,description,nodeKeys:[nodeKey],status:'OPEN',limit:predecessor?.limit??PROGRESS_LIMITS.gapAttempts,attempts:predecessor?structuredClone(predecessor.attempts):[]};
    db.prepare('INSERT INTO company_progress_gaps VALUES(?,?,?,?,1)').run(id,goalId,factKey,JSON.stringify(gap));return gap;
  }
  private saveGap(goalId:string,gap:CompanyProgressGap){this.goals.store.db.prepare('UPDATE company_progress_gaps SET body=?,revision=revision+1 WHERE id=? AND goal_id=?').run(JSON.stringify(gap),gap.id,goalId);}
  attach(goalId:string,node:CompanyTaskNode,dispatchId:string,scheduledAt:number,plan:CompanyTaskPlanView){
    return this.goals.store.transaction(()=>{
      const existing=this.forDispatch(dispatchId);if(existing)return existing;
      // A retry gets its original scope even if its new occurrence has a later scheduled_at.
      const prior=this.goals.store.db.prepare('SELECT dispatch_id,state FROM owner_task_occurrences WHERE goal_id=? AND node_key=? AND dispatch_id!=? ORDER BY rowid DESC LIMIT 1').get(goalId,node.key,dispatchId);
      let scope=this.scopes(goalId).find(s=>s.notes[`resume:${node.key}`])??(prior&&!settled.has(String(prior.state))?this.forDispatch(String(prior.dispatch_id)):null);
      if(!scope&&node.trigger.kind==='once'){
        const inheritedScopes:Scope[]=[];
        for(const key of node.dependsOn){
          const origin=this.goals.store.db.prepare('SELECT dispatch_id FROM owner_task_occurrences WHERE goal_id=? AND node_key=? ORDER BY rowid DESC LIMIT 1').get(goalId,key);
          if(origin){const inherited=this.forDispatch(String(origin.dispatch_id));if(inherited)inheritedScopes.push(inherited);}
        }
        const scheduled=inheritedScopes.filter(s=>s.key!=='once');
        if(new Set(scheduled.map(s=>s.id)).size>1)ownerConflict('OWNER_PROGRESS_BATCH_AMBIGUOUS');
        scope=scheduled[0]??inheritedScopes[0]??null;
      }
      const key=node.trigger.kind==='once'?'once':`scheduled:${node.key}:${scheduledAt}`;
      scope??=this.scopes(goalId).find(s=>s.key===key)??null;
      if(!scope){
        scope={schema:1,id:'progress_'+digest([goalId,key]),goalId,key,revision:1,dispatchIds:[],operations:[],outcomes:{},notes:{},modelCalls:0,toolCalls:0,maxModelCalls:PROGRESS_LIMITS.modelCalls,maxToolCalls:PROGRESS_LIMITS.toolCalls,windowMs:PROGRESS_LIMITS.windowMs,startedAt:null,deadlineAt:null};
        this.goals.store.db.prepare('INSERT INTO company_progress_scopes VALUES(?,?,?,?,1)').run(scope.id,goalId,key,JSON.stringify(scope));
      }
      delete scope.notes[`resume:${node.key}`];scope.dispatchIds.push(dispatchId);this.save(scope);return scope;
    });
  }
  startWindow(dispatchId:string){
    return this.goals.store.transaction(()=>{
      const scope=this.forDispatch(dispatchId);if(!scope)return undefined;
      if(scope.startedAt===null){scope.startedAt=Date.now();scope.deadlineAt=scope.startedAt+(scope.windowMs??PROGRESS_LIMITS.windowMs);this.save(scope);}
      this.assertAvailable(scope);return {schema:1 as const,scopeId:scope.id,deadlineAt:scope.deadlineAt!};
    });
  }
  private assertAvailable(scope:Scope){
    if(scope.deadlineAt!==null&&Date.now()>=scope.deadlineAt)ownerConflict('OWNER_PROGRESS_TIME_LIMIT');
    if(scope.modelCalls>=scope.maxModelCalls||scope.toolCalls>=scope.maxToolCalls)ownerConflict('OWNER_PROGRESS_CALL_LIMIT');
  }
  available(dispatchId:string){const scope=this.forDispatch(dispatchId);if(scope)this.assertAvailable(scope);}
  consume(dispatchId:string,kind:'model'|'tool',key:string){
    const scope=this.forDispatch(dispatchId);if(!scope)return;
    if(scope.operations.includes(key))return;
    this.assertAvailable(scope);
    scope.operations.push(key);if(kind==='model')scope.modelCalls++;else scope.toolCalls++;
    this.save(scope);
  }
  attempt(goalId:string,gap:CompanyProgressGap,key:string,method:string,methodKey=method){
    const fresh=this.gaps(goalId).find(g=>g.id===gap.id)!;
    if(fresh.attempts.some(a=>a.key===key))return;
    if(fresh.attempts.length>=fresh.limit)ownerConflict('OWNER_PROGRESS_GAP_LIMIT');
    const last=fresh.attempts.filter(a=>(a.methodKey??a.method)===methodKey).slice(-2);
    if(last.length===2&&last[0]!.fingerprint&&last[0]!.fingerprint===last[1]!.fingerprint)ownerConflict('OWNER_PROGRESS_METHOD_EXHAUSTED');
    fresh.attempts.push({key,method:method.slice(0,1000),methodKey,createdAt:Date.now()});fresh.status='OPEN';this.saveGap(goalId,fresh);
  }
  beforeModel(dispatchId:string,attemptId:string,operationId:string,transportAttempt:number){
    return this.goals.store.transaction(()=>{
    const row=this.goals.store.db.prepare('SELECT goal_id,goal_revision,node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(dispatchId);
    const scope=this.forDispatch(dispatchId);
    if(row&&scope){
      ownerInput(Number.isSafeInteger(transportAttempt)&&transportAttempt>=1&&transportAttempt<=2,'OWNER_PROGRESS_INVALID');
      const plan=JSON.parse(String(this.goals.store.db.prepare('SELECT body FROM owner_task_plans WHERE goal_id=? AND goal_revision=?').get(row.goal_id,row.goal_revision)!.body));
      const title=plan.nodes.find((n:CompanyTaskNode)=>n.key===row.node_key)!.title;
      const gap=this.gap(String(row.goal_id),`output:${row.node_key}:${scope.key}`,title,String(row.node_key));
      this.attempt(String(row.goal_id),gap,attemptId,'Execute this step using the retained history',attemptId);
      this.consume(dispatchId,'model',`model:${operationId}:${transportAttempt}`);
    }
    });
  }
  beforeTool(dispatchId:string,operationId:string,metadata?:{gapId:string;method:string},methodKey?:string){
    return this.goals.store.transaction(()=>{
    this.consume(dispatchId,'tool',`tool:${operationId}`);
    if(metadata){
      const scope=this.forDispatch(dispatchId);if(!scope)ownerConflict('OWNER_PROGRESS_INVALID');
      const gap=this.gaps(scope.goalId).find(g=>g.id===metadata.gapId);
      ownerInput(Boolean(gap)&&typeof metadata.method==='string'&&metadata.method.trim().length>=8&&metadata.method.length<=1000,'OWNER_PROGRESS_INVALID');
      this.attempt(scope.goalId,gap!,operationId,metadata.method,methodKey);
    }
    });
  }
  recordTool(dispatchId:string,operationId:string,result:unknown){
    const scope=this.forDispatch(dispatchId);if(!scope)return;
    for(const gap of this.gaps(scope.goalId)){
      const attempt=gap.attempts.find(a=>a.key===operationId);if(!attempt)continue;
      const r=result as Record<string,unknown>;
      attempt.result=JSON.stringify(result).slice(0,1000);attempt.fingerprint=digest({status:r.status,output:r.output,error_code:r.error_code});this.saveGap(scope.goalId,gap);
    }
  }
  context(goalId:string,node:CompanyTaskNode,dispatchId?:string){
    const gaps=this.gaps(goalId).filter(g=>!g.superseded&&g.status!=='RESOLVED'&&(g.nodeKeys.includes(node.key)||node.dependsOn.some(k=>g.nodeKeys.includes(k))));
    const scope=dispatchId?this.forDispatch(dispatchId):null;
    return {gaps:gaps.slice(0,20).map(g=>({id:g.id,description:g.description.slice(0,120),status:g.status,used:g.attempts.length,limit:g.limit,methods:g.attempts.map(a=>a.method.slice(0,80)),lastResult:g.attempts.at(-1)?.result?.slice(0,120)})),totalGaps:gaps.length,previous:this.latest(goalId,node.key)??null,remaining:scope?{modelCalls:scope.maxModelCalls-scope.modelCalls,toolCalls:scope.maxToolCalls-scope.toolCalls,deadlineAt:scope.deadlineAt}:null};
  }
  evaluate(dispatchId:string,node:CompanyTaskNode,evidence:{id:string;sha256:string;text:string}[],reason:string|null):CompanyNodeProgress {
    const scope=this.forDispatch(dispatchId)!;
    const policy=node.progressPolicy,checked:string[]=[],missing:string[]=[],root=this.gap(scope.goalId,`output:${node.key}:${scope.key}`,node.title,node.key);
    for(const requirement of policy?.requirements??[]){
      const satisfied=evidence.some(e=>(requirement.contains===undefined||e.text.includes(requirement.contains))&&(requirement.minBytes===undefined||Buffer.byteLength(e.text)>=requirement.minBytes));
      const criterion=digest({contains:requirement.contains,minBytes:requirement.minBytes}).slice(0,12);
      const gap=this.gap(scope.goalId,`requirement:${node.key}:${requirement.id}:${criterion}:${scope.key}`,requirement.description,node.key);
      gap.superseded=false;if(satisfied){checked.push(requirement.id);gap.status='RESOLVED';}else {missing.push(gap.id);gap.status='OPEN';}
      this.saveGap(scope.goalId,gap);
    }
    let state='COMPLETED';
    if(!evidence.length||missing.length){
      const percent=policy?.requirements.length?100*checked.length/policy.requirements.length:0;
      if(evidence.length&&policy&&percent>=policy.passPercent)state='PARTIAL';
      else {
        const latest=this.gaps(scope.goalId).find(g=>g.id===root.id)!;
        state=latest.attempts.length<latest.limit?'RETRY':policy?'DEFERRED':'BLOCKED';
      }
    }
    root.status=state==='COMPLETED'?'RESOLVED':state==='DEFERRED'?'DEFERRED':'OPEN';
    const current=this.gaps(scope.goalId).find(g=>g.id===root.id)!;current.status=root.status;
    const attempt=current.attempts.at(-1);if(attempt){attempt.result=reason??state;attempt.fingerprint=digest(evidence.map(e=>e.sha256));}
    // Two identical empty results are enough for a new ordinary policy to stop this route.
    if(policy&&state==='RETRY'&&current.attempts.length>=2){const a=current.attempts.slice(-2);if(a.every(v=>v.fingerprint)&&a[0]!.fingerprint===a[1]!.fingerprint)state='DEFERRED';}
    if(!evidence.length&&!missing.includes(root.id))missing.push(root.id);
    if(state==='DEFERRED')current.status='DEFERRED';this.saveGap(scope.goalId,current);
    if(reason?.startsWith('OWNER_PROGRESS_')&&state==='RETRY')state=policy?'DEFERRED':'BLOCKED';
    const value:CompanyNodeProgress={state,checked,missing,evidenceIds:evidence.map(e=>e.id),reason,scopeId:scope.id};
    scope.outcomes[dispatchId]=value;this.save(scope);return value;
  }
  setOutcome(dispatchId:string,value:CompanyNodeProgress){const scope=this.forDispatch(dispatchId);if(!scope)ownerConflict('OWNER_PROGRESS_INVALID');scope.outcomes[dispatchId]=value;this.save(scope);}
  supplement(goalId:string,nodeKey:string,text:string){
    ownerInput(typeof text==='string'&&text.trim().length>=8&&text.length<=4000,'OWNER_PROGRESS_INVALID');
    this.goals.event(goalId,'progress_material',{nodeKey,text,source:'OWNER_SUPPLIED_UNVERIFIED'});
  }
  notes(goalId:string,nodeKey:string){return this.goals.store.db.prepare("SELECT payload FROM owner_goal_events WHERE goal_id=? AND kind='progress_material' AND json_extract(payload,'$.nodeKey')=? ORDER BY id DESC LIMIT 2").all(goalId,nodeKey).map(r=>JSON.parse(String(r.payload)).text);}
  /**
   * A spent automatic window or call allowance bounds one automatic attempt; it must not
   * become an owner dead end. Rework carries new instructions and its own fresh window, so
   * only a genuinely exhausted missing fact keeps blocking it. Every other consumer keeps
   * the original fully-enforced answer.
   */
  retryAllowed(dispatchId:string,forRework=false):string|null {
    if(forRework){
      const scope=this.forDispatch(dispatchId),occ=this.goals.store.db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(dispatchId);
      if(scope&&occ){const root=this.gaps(scope.goalId).find(g=>g.factKey===`output:${occ.node_key}:${scope.key}`);if(root&&root.attempts.length>=root.limit)return 'OWNER_PROGRESS_GAP_LIMIT';}
      return null;
    }
    try{this.available(dispatchId);}catch(e){return (e as Error).message;}
    const scope=this.forDispatch(dispatchId),occ=this.goals.store.db.prepare('SELECT node_key FROM owner_task_occurrences WHERE dispatch_id=?').get(dispatchId);
    if(scope&&occ){const root=this.gaps(scope.goalId).find(g=>g.factKey===`output:${occ.node_key}:${scope.key}`);if(root&&root.attempts.length>=root.limit)return 'OWNER_PROGRESS_GAP_LIMIT';}
    return null;
  }
  requestContinuation(dispatchId:string,nodeKey:string){const scope=this.forDispatch(dispatchId);if(scope){scope.notes[`resume:${nodeKey}`]=dispatchId;this.save(scope);}}
  /**
   * An owner-requested continuation is new automatic work. Return the reusable scope to a
   * full window and allowances so the next execution is not refused by limits that the
   * previous, already-finished attempt consumed.
   */
  resetWindow(dispatchId:string){
    const scope=this.forDispatch(dispatchId);if(!scope)return;
    scope.startedAt=null;scope.deadlineAt=null;scope.modelCalls=0;scope.toolCalls=0;scope.operations=[];
    scope.maxModelCalls=PROGRESS_LIMITS.modelCalls;scope.maxToolCalls=PROGRESS_LIMITS.toolCalls;scope.windowMs=PROGRESS_LIMITS.windowMs;
    this.save(scope);
  }
  supersedeRequirements(goalId:string,nodeKey:string,previous:CompanyTaskNode['progressPolicy'],next:CompanyTaskNode['progressPolicy']){
    for(const requirement of previous?.requirements??[]){
      const replacement=next?.requirements.find(r=>r.id===requirement.id);
      const criterion=digest({contains:requirement.contains,minBytes:requirement.minBytes}).slice(0,12);
      if(replacement&&criterion===digest({contains:replacement.contains,minBytes:replacement.minBytes}).slice(0,12))continue;
      for(const gap of this.gaps(goalId).filter(g=>g.factKey.startsWith(`requirement:${nodeKey}:${requirement.id}:${criterion}:`))){gap.superseded=true;this.saveGap(goalId,gap);}
    }
  }
  extend(dispatchId:string,input:{modelCalls?:number;toolCalls?:number;minutes?:number;gapId?:string;attempts?:number}){
    const scope=this.forDispatch(dispatchId);ownerInput(Boolean(scope),'OWNER_PROGRESS_INVALID');
    for(const key of ['modelCalls','toolCalls','minutes','attempts'] as const)if(input[key]!==undefined)ownerInput(Number.isSafeInteger(input[key])&&input[key]!>0&&input[key]!<=(key==='minutes'?60:key==='attempts'?10:120),'OWNER_PROGRESS_INVALID');
    ownerInput(Boolean(input.modelCalls||input.toolCalls||input.minutes||input.attempts),'OWNER_PROGRESS_INVALID');
    if(input.modelCalls)scope!.maxModelCalls+=input.modelCalls;if(input.toolCalls)scope!.maxToolCalls+=input.toolCalls;
    if(input.minutes){if(scope!.startedAt===null)scope!.windowMs=(scope!.windowMs??PROGRESS_LIMITS.windowMs)+input.minutes*60_000;else scope!.deadlineAt=Math.max(Date.now(),scope!.deadlineAt??0)+input.minutes*60_000;}
    if(input.attempts){const gap=this.gaps(scope!.goalId).find(g=>g.id===input.gapId);ownerInput(Boolean(gap),'OWNER_PROGRESS_INVALID');gap!.limit+=input.attempts;this.saveGap(scope!.goalId,gap!);}
    this.save(scope!);
  }
}
