import { createHash } from 'node:crypto';
import type { CompanyTaskPlan, CompanyTaskPlanView, CompanyTaskNode, TaskTrigger } from '@emergentinc/protocol';
import { nextBusinessOccurrence } from '@emergentinc/protocol';
import { OwnerGoalService, ownerInput, ownerConflict } from './owner_goal_service.js';
import {CompanyProgressService} from './company_progress_service.js';
import type {CompanyNodeProgress,CompanyTaskNodeView} from '@emergentinc/protocol';

function taskKeys(input: unknown, keys: string[], code: string): asserts input is Record<string, any> {
  ownerInput(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(k => keys.includes(k)), code);
}

export function nextTaskOccurrence(trigger:TaskTrigger,after:number):number|null {
  if(trigger.kind==='once')return null;
  if(trigger.kind==='continuous')return after+5*60000;
  if(trigger.kind==='interval')return after+trigger.everyMinutes*60000;
  let next=nextBusinessOccurrence({kind:'daily',time:trigger.time,timezone:trigger.timezone,maxOccurrences:1},after);
  if(trigger.kind==='weekly'){
    const format=new Intl.DateTimeFormat('en-US',{timeZone:trigger.timezone,weekday:'short'}),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for(let i=0;i<8;i++){if(trigger.weekdays!.includes(days.indexOf(format.format(next))))return next;next=nextBusinessOccurrence({kind:'daily',time:trigger.time,timezone:trigger.timezone,maxOccurrences:1},next);}
    throw new Error('OWNER_TASK_SCHEDULE_INVALID');
  }return next;
}
export class OwnerTaskPlanService {
  readonly progress:CompanyProgressService;
  constructor(readonly goals:OwnerGoalService){
    const db=goals.store.db;
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_task_plans'").get()&&!db.prepare("SELECT 1 FROM sqlite_master WHERE name='owner_task_schema'").get())throw new Error('OWNER_TASK_SCHEMA_UNSUPPORTED');
    db.exec('CREATE TABLE IF NOT EXISTS owner_task_schema(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);INSERT OR IGNORE INTO owner_task_schema VALUES(1,1);');
    if(db.prepare('SELECT version FROM owner_task_schema WHERE id=1').get()!.version!==1)throw new Error('OWNER_TASK_SCHEMA_UNSUPPORTED');
    goals.store.db.exec(`CREATE TABLE IF NOT EXISTS owner_task_plans(goal_id TEXT NOT NULL REFERENCES owner_goals(id),goal_revision INTEGER NOT NULL,plan_revision INTEGER NOT NULL,approved INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(goal_id,goal_revision));
      CREATE TABLE IF NOT EXISTS owner_task_nodes(goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,node_key TEXT NOT NULL,state TEXT NOT NULL,next_at INTEGER,latest_evidence TEXT NOT NULL DEFAULT '[]',occurrences INTEGER NOT NULL DEFAULT 0,no_progress INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(goal_id,goal_revision,node_key));
      CREATE TABLE IF NOT EXISTS owner_task_occurrences(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,node_key TEXT NOT NULL,scheduled_at INTEGER NOT NULL,dispatch_id TEXT UNIQUE,state TEXT NOT NULL,plan_revision INTEGER NOT NULL,UNIQUE(goal_id,goal_revision,node_key,scheduled_at));`);
    goals.store.db.exec(`CREATE TABLE IF NOT EXISTS owner_task_plan_versions(goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,plan_revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(goal_id,goal_revision,plan_revision));`);
    goals.store.db.exec(`CREATE TABLE IF NOT EXISTS owner_task_resource_waits(request_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,node_key TEXT NOT NULL);`);
    goals.store.db.exec(`CREATE TABLE IF NOT EXISTS owner_task_close_intents(dispatch_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,goal_revision INTEGER NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL);`);
    this.progress=new CompanyProgressService(goals);goals.progress=this.progress;
  }
  validate(value:unknown):CompanyTaskPlan {
    taskKeys(value,['summary','nodes','ownerInstructions'],'OWNER_TASK_PLAN_INVALID');ownerInput(typeof value.summary==='string'&&value.summary.length>0&&value.summary.length<=1200&&Array.isArray(value.nodes)&&value.nodes.length>0&&value.nodes.length<=20&&(value.ownerInstructions===undefined||typeof value.ownerInstructions==='string'&&value.ownerInstructions.length<=1000),'OWNER_TASK_PLAN_INVALID');
    const nodes=value.nodes as CompanyTaskNode[];ownerInput(nodes.every(n=>n&&typeof n==='object'&&!Array.isArray(n)),'OWNER_TASK_PLAN_INVALID');const keys=new Set(nodes.map(n=>n.key));ownerInput(keys.size===nodes.length,'OWNER_TASK_PLAN_INVALID');
    for(const n of nodes){
      taskKeys(n,['key','title','instruction','dependsOn','trigger','filename','personId','progressPolicy'],'OWNER_TASK_PLAN_INVALID');
      ownerInput(typeof n.key==='string'&&/^[a-zA-Z][\w-]{0,63}$/.test(n.key)&&typeof n.title==='string'&&n.title.length>0&&n.title.length<=160&&typeof n.instruction==='string'&&n.instruction.length>0&&n.instruction.length<=1600&&Array.isArray(n.dependsOn)&&n.dependsOn.every(d=>typeof d==='string'&&keys.has(d)&&d!==n.key)&&new Set(n.dependsOn).size===n.dependsOn.length&&typeof n.filename==='string'&&/^[-\w]+\.(md|txt|json|csv)$/.test(n.filename)&&n.filename.length<=100&&(n.personId===undefined||typeof n.personId==='string'),'OWNER_TASK_PLAN_INVALID');
      const t=n.trigger;ownerInput(t&&['once','continuous','interval','daily','weekly'].includes(t.kind),'OWNER_TASK_SCHEDULE_INVALID');
      taskKeys(t,t.kind==='interval'?['kind','everyMinutes']:t.kind==='daily'?['kind','time','timezone']:t.kind==='weekly'?['kind','time','timezone','weekdays']:['kind'],'OWNER_TASK_SCHEDULE_INVALID');
      if(t.kind==='interval')ownerInput(Number.isSafeInteger(t.everyMinutes)&&t.everyMinutes>=5&&t.everyMinutes<=525600,'OWNER_TASK_SCHEDULE_INVALID');
      if(t.kind==='daily'||t.kind==='weekly'){ownerInput(/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)&&typeof t.timezone==='string','OWNER_TASK_SCHEDULE_INVALID');try{new Intl.DateTimeFormat('en',{timeZone:t.timezone});}catch{ownerInput(false,'OWNER_TASK_SCHEDULE_INVALID');}}
      if(t.kind==='weekly')ownerInput(Array.isArray(t.weekdays)&&t.weekdays.length>0&&t.weekdays.length<=7&&t.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6)&&new Set(t.weekdays).size===t.weekdays.length,'OWNER_TASK_SCHEDULE_INVALID');
      if(n.progressPolicy!==undefined){
        const p=n.progressPolicy;taskKeys(p,['requirements','passPercent','allowIncompleteFrom'],'OWNER_PROGRESS_INVALID');
        ownerInput([70,80,100].includes(p.passPercent)&&Array.isArray(p.requirements)&&p.requirements.length>0&&p.requirements.length<=20&&Array.isArray(p.allowIncompleteFrom)&&p.allowIncompleteFrom.every(k=>n.dependsOn.includes(k))&&new Set(p.allowIncompleteFrom).size===p.allowIncompleteFrom.length,'OWNER_PROGRESS_INVALID');
        for(const r of p.requirements){taskKeys(r,['id','description','contains','minBytes'],'OWNER_PROGRESS_INVALID');ownerInput(typeof r.id==='string'&&/^[\w-]{1,64}$/.test(r.id)&&typeof r.description==='string'&&r.description.trim().length>0&&r.description.length<=300&&(r.contains===undefined||typeof r.contains==='string'&&r.contains.trim().length>0&&r.contains.length<=500)&&(r.minBytes===undefined||Number.isSafeInteger(r.minBytes)&&r.minBytes>0&&r.minBytes<=1000000)&&(r.contains!==undefined||r.minBytes!==undefined),'OWNER_PROGRESS_INVALID');}
        ownerInput(new Set(p.requirements.map(r=>r.id)).size===p.requirements.length,'OWNER_PROGRESS_INVALID');
      }
    }
    const visited=new Set<string>(),visiting=new Set<string>();const walk=(key:string)=>{if(visiting.has(key))ownerInput(false,'OWNER_TASK_PLAN_CYCLE');if(visited.has(key))return;visiting.add(key);for(const d of nodes.find(n=>n.key===key)!.dependsOn)walk(d);visiting.delete(key);visited.add(key);};nodes.forEach(n=>walk(n.key));
    return JSON.parse(JSON.stringify(value));
  }
  install(goalId:string,value:unknown,approved=false){
    const plan=this.validate(value),goal=this.goals.get(goalId),db=this.goals.store.db;
    this.goals.store.transaction(()=>{
      if(db.prepare('SELECT 1 FROM owner_task_plans WHERE goal_id=? AND goal_revision=?').get(goalId,goal.specificationRevision))ownerConflict('OWNER_TASK_PLAN_EXISTS');
      db.prepare('INSERT INTO owner_task_plans VALUES(?,?,1,?,?)').run(goalId,goal.specificationRevision,Number(approved),JSON.stringify(plan));
      db.prepare('INSERT INTO owner_task_plan_versions VALUES(?,?,1,?)').run(goalId,goal.specificationRevision,JSON.stringify(plan));
      for(const n of plan.nodes){const due=n.trigger.kind==='daily'||n.trigger.kind==='weekly'?nextTaskOccurrence(n.trigger,Date.now()):Date.now();db.prepare("INSERT INTO owner_task_nodes(goal_id,goal_revision,node_key,state,next_at) VALUES(?,?,?,'WAITING',?)").run(goalId,goal.specificationRevision,n.key,due);}
      this.goals.state(goalId,approved?'READY':'DRAFT');
    });return this.get(goalId)!;
  }
  get(goalId:string):CompanyTaskPlanView|null {
    const goal=this.goals.get(goalId),db=this.goals.store.db,row=db.prepare('SELECT * FROM owner_task_plans WHERE goal_id=? AND goal_revision=?').get(goalId,goal.specificationRevision);if(!row)return null;
    const body=JSON.parse(String(row.body));return {goalId,goalRevision:goal.specificationRevision,planRevision:Number(row.plan_revision),approved:Boolean(row.approved),summary:body.summary,...(body.ownerInstructions?{ownerInstructions:body.ownerInstructions}:{}),nodes:body.nodes.map((n:CompanyTaskNode)=>{const r=db.prepare('SELECT * FROM owner_task_nodes WHERE goal_id=? AND goal_revision=? AND node_key=?').get(goalId,goal.specificationRevision,n.key)!,progress=this.progress.latest(goalId,n.key);return {...n,state:String(r.state),nextAt:r.next_at===null?null:Number(r.next_at),latestEvidence:JSON.parse(String(r.latest_evidence)),occurrences:Number(r.occurrences),...(progress?{progress}:{})};})};
  }
  dependenciesReady(plan:CompanyTaskPlanView,node:CompanyTaskNode):boolean {
    return node.dependsOn.every(key=>{
      const prior=plan.nodes.find(n=>n.key===key)!;
      const state=prior.state==='SKIPPED'?'SKIPPED':prior.progress?.state??prior.state;
      if(node.progressPolicy?.allowIncompleteFrom.includes(key))return ['COMPLETED','PARTIAL','DEFERRED','SKIPPED'].includes(state)||prior.occurrences>0&&!['BLOCKED','WAITING_RESOURCE','PARTIAL','DEFERRED','SKIPPED'].includes(state);
      return prior.occurrences>0&&!['BLOCKED','WAITING_RESOURCE','PARTIAL','DEFERRED','SKIPPED'].includes(state);
    });
  }
  hasProgress(plan:CompanyTaskPlanView,exclude?:string):boolean {
    const unavailable=['BLOCKED','WAITING_RESOURCE','PARTIAL','DEFERRED','SKIPPED','COMPLETED'];
    const accessible=(n:CompanyTaskNodeView):boolean=>!unavailable.includes(n.state)&&n.dependsOn.every(key=>{
      const prior=plan.nodes.find(v=>v.key===key)!;
      return this.dependenciesReady(plan,{...n,dependsOn:[key]})||accessible(prior);
    });
    return plan.nodes.some(n=>n.key!==exclude&&accessible(n));
  }
  rework(goalId:string,instructions:string,nodeKey?:string){
    const plan=this.get(goalId);ownerInput(Boolean(plan),'OWNER_TASK_PLAN_INVALID');
    const db=this.goals.store.db,body=JSON.parse(String(db.prepare('SELECT body FROM owner_task_plans WHERE goal_id=? AND goal_revision=?').get(goalId,plan!.goalRevision)!.body));
    const next=this.validate({...body,ownerInstructions:instructions}),revision=plan!.planRevision+1;
    if(plan!.approved){
      const node=nodeKey?plan!.nodes.find(n=>n.key===nodeKey):plan!.nodes.length===1?plan!.nodes[0]:undefined;
      ownerInput(Boolean(node),'OWNER_REWORK_NODE_REQUIRED');
      if(db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE goal_id=? AND state IN ('QUEUED','RUNNING')").get(goalId)||this.goals.hasPendingOutcome(goalId,true))ownerConflict('OWNER_TASK_STILL_RUNNING');
      const origin=db.prepare('SELECT dispatch_id FROM owner_task_occurrences WHERE goal_id=? AND node_key=? ORDER BY rowid DESC LIMIT 1').get(goalId,node!.key);
      if(origin){const reason=this.progress.retryAllowed(String(origin.dispatch_id));if(reason)ownerConflict(reason);this.progress.requestContinuation(String(origin.dispatch_id),node!.key);}
      db.prepare("UPDATE owner_task_nodes SET state='WAITING',next_at=? WHERE goal_id=? AND goal_revision=? AND node_key=?").run(Date.now(),goalId,plan!.goalRevision,node!.key);
    }
    db.prepare('UPDATE owner_task_plans SET plan_revision=?,body=? WHERE goal_id=? AND goal_revision=?').run(revision,JSON.stringify(next),goalId,plan!.goalRevision);
    db.prepare('INSERT INTO owner_task_plan_versions VALUES(?,?,?,?)').run(goalId,plan!.goalRevision,revision,JSON.stringify(next));
    this.goals.state(goalId,plan!.approved?'READY':'DRAFT');
    return {body:next,view:this.get(goalId)!};
  }
  adjustPolicy(goalId:string,nodeKey:string,policy:unknown){
    const plan=this.get(goalId);ownerInput(Boolean(plan),'OWNER_TASK_PLAN_INVALID');
    const db=this.goals.store.db,body=JSON.parse(String(db.prepare('SELECT body FROM owner_task_plans WHERE goal_id=? AND goal_revision=?').get(goalId,plan!.goalRevision)!.body));
    const previous=body.nodes.find((n:CompanyTaskNode)=>n.key===nodeKey);ownerInput(Boolean(previous),'OWNER_TASK_PLAN_INVALID');
    const next=this.validate({...body,nodes:body.nodes.map((n:CompanyTaskNode)=>n.key===nodeKey?{...n,progressPolicy:policy}:n)});
    this.progress.supersedeRequirements(goalId,nodeKey,previous.progressPolicy,next.nodes.find(n=>n.key===nodeKey)!.progressPolicy);
    const approvalRequired=JSON.stringify(previous.progressPolicy?.allowIncompleteFrom??[])!==JSON.stringify((policy as any).allowIncompleteFrom);
    const revision=plan!.planRevision+1;
    db.prepare('UPDATE owner_task_plans SET body=?,plan_revision=?,approved=? WHERE goal_id=? AND goal_revision=?').run(JSON.stringify(next),revision,Number(plan!.approved&&!approvalRequired),goalId,plan!.goalRevision);
    db.prepare('INSERT INTO owner_task_plan_versions VALUES(?,?,?,?)').run(goalId,plan!.goalRevision,revision,JSON.stringify(next));
    if(approvalRequired)this.goals.state(goalId,'DRAFT','OWNER_PROGRESS_APPROVAL_REQUIRED');
    return {body:next,view:this.get(goalId)!,approvalRequired};
  }
  approve(goalId:string){const g=this.goals.get(goalId);this.goals.store.db.prepare('UPDATE owner_task_plans SET approved=1 WHERE goal_id=? AND goal_revision=?').run(goalId,g.specificationRevision);if(g.status!=='PAUSED')this.goals.state(goalId,'READY');}
  reviseInternal(goalId:string,value:unknown,dispatchId:string){
    const next=this.validate(value),old=this.get(goalId),db=this.goals.store.db;
    if(!old?.approved||!['READY','RUNNING'].includes(this.goals.get(goalId).status)||!db.prepare("SELECT 1 FROM owner_task_occurrences WHERE dispatch_id=? AND goal_id=? AND goal_revision=? AND state='RUNNING'").get(dispatchId,goalId,old.goalRevision))ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
    for(const n of old.nodes){const changed=next.nodes.find(v=>v.key===n.key);if(n.state==='RUNNING'||n.occurrences){
      if(!changed||['key','title','instruction','dependsOn','trigger','filename','personId','progressPolicy'].some(k=>JSON.stringify((n as any)[k])!==JSON.stringify((changed as any)[k])))ownerConflict('OWNER_TASK_COMPLETED_STEP_CHANGED');
    }else if(changed&&JSON.stringify(changed.trigger)!==JSON.stringify(n.trigger))ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');}
    if(JSON.stringify(next.ownerInstructions)!==JSON.stringify(old.ownerInstructions)||next.nodes.some(n=>JSON.stringify(n.progressPolicy)!==JSON.stringify(old.nodes.find(v=>v.key===n.key)?.progressPolicy)))ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
    for(const n of next.nodes)if(!old.nodes.some(v=>v.key===n.key)&&n.trigger.kind!=='once')ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');
    return this.goals.store.transaction(()=>{
      const fresh=this.get(goalId);if(fresh?.planRevision!==old.planRevision)ownerConflict('OWNER_REVISION_CONFLICT');
      db.prepare('UPDATE owner_task_plans SET plan_revision=plan_revision+1,body=? WHERE goal_id=? AND goal_revision=?').run(JSON.stringify(next),goalId,old.goalRevision);
      db.prepare('INSERT INTO owner_task_plan_versions VALUES(?,?,?,?)').run(goalId,old.goalRevision,old.planRevision+1,JSON.stringify(next));
      for(const n of next.nodes)db.prepare("INSERT OR IGNORE INTO owner_task_nodes(goal_id,goal_revision,node_key,state,next_at) VALUES(?,?,?,'WAITING',?)").run(goalId,old.goalRevision,n.key,Date.now());
      this.goals.event(goalId,'task_replanned',{planRevision:old.planRevision+1,dispatchId});return this.get(goalId)!;
    });
  }
  due(goalId:string,now=Date.now()){
    const plan=this.get(goalId);if(!plan?.approved||!['READY','RUNNING'].includes(this.goals.get(goalId).status))return null;
    return plan.nodes.find(n=>!['RUNNING','BLOCKED','PARTIAL','DEFERRED','SKIPPED','WAITING_RESOURCE','COMPLETED'].includes(n.state)&&n.nextAt!==null&&n.nextAt<=now&&this.dependenciesReady(plan,n))??null;
  }
  claim(goalId:string,nodeKey:string,dispatchId:string,now=Date.now()){
    return this.goals.store.transaction(()=>{
      const goal=this.goals.get(goalId),node=this.due(goalId,now);if(!node||node.key!==nodeKey)ownerConflict('OWNER_TASK_OCCURRENCE_CONFLICT');
      const revision=this.get(goalId)!.planRevision,id='occ_'+createHash('sha256').update(`${goalId}:${goal.specificationRevision}:${revision}:${nodeKey}:${node.nextAt}`).digest('hex');
      this.goals.store.db.prepare("INSERT INTO owner_task_occurrences VALUES(?,?,?,?,?,?,'RUNNING',?)").run(id,goalId,goal.specificationRevision,nodeKey,node.nextAt,dispatchId,revision);
      this.goals.store.db.prepare("UPDATE owner_task_nodes SET state='RUNNING' WHERE goal_id=? AND goal_revision=? AND node_key=?").run(goalId,goal.specificationRevision,nodeKey);
      this.progress.attach(goalId,node,dispatchId,node.nextAt!,this.get(goalId)!);return id;
    });
  }
  complete(dispatchId:string,evidenceIds:string[],now=Date.now()){
    const db=this.goals.store.db,occ=db.prepare("SELECT * FROM owner_task_occurrences WHERE dispatch_id=? AND state='RUNNING'").get(dispatchId);if(!occ)return false;
    const plan=this.get(String(occ.goal_id));if(!plan||plan.goalRevision!==occ.goal_revision)return false;
    const node=plan.nodes.find(n=>n.key===occ.node_key)!;
    return this.goals.store.transaction(()=>{
      if(!db.prepare("UPDATE owner_task_occurrences SET state='COMPLETED' WHERE id=? AND state='RUNNING'").run(occ.id).changes)return false;
      db.prepare("UPDATE owner_task_nodes SET state=?,latest_evidence=?,occurrences=occurrences+1,no_progress=0,next_at=? WHERE goal_id=? AND goal_revision=? AND node_key=?").run(node.trigger.kind==='once'?'COMPLETED':'WAITING',JSON.stringify(evidenceIds),nextTaskOccurrence(node.trigger,now),occ.goal_id,occ.goal_revision,occ.node_key);
      this.goals.event(String(occ.goal_id),'task_step_completed',{nodeKey:node.key,occurrence:occ.id,evidenceIds,scheduledAt:Number(occ.scheduled_at),completedAt:now});
      return true;
    });
  }
  finish(dispatchId:string,value:CompanyNodeProgress,now=Date.now()){
    const db=this.goals.store.db,occ=db.prepare("SELECT * FROM owner_task_occurrences WHERE dispatch_id=? AND state='RUNNING'").get(dispatchId);if(!occ)return false;
    const plan=this.get(String(occ.goal_id));if(!plan||plan.goalRevision!==occ.goal_revision)return false;
    const node=plan.nodes.find(n=>n.key===occ.node_key)!;
    return this.goals.store.transaction(()=>{
      if(!db.prepare("UPDATE owner_task_occurrences SET state=? WHERE id=? AND state='RUNNING'").run(value.state==='RETRY'?'NO_PROGRESS':value.state,occ.id).changes)return false;
      this.progress.setOutcome(dispatchId,value);
      const recurring=node.trigger.kind!=='once',retry=value.state==='RETRY';
      const state=retry?'WAITING':recurring&&['COMPLETED','PARTIAL','DEFERRED','SKIPPED'].includes(value.state)?'WAITING':value.state;
      const nextAt=retry?now+5000:recurring&&state==='WAITING'?nextTaskOccurrence(node.trigger,now):null;
      db.prepare('UPDATE owner_task_nodes SET state=?,latest_evidence=?,occurrences=occurrences+?,no_progress=CASE WHEN ? THEN 0 ELSE no_progress+1 END,next_at=? WHERE goal_id=? AND goal_revision=? AND node_key=?').run(state,JSON.stringify(value.evidenceIds),Number(value.state==='COMPLETED'),Number(value.state==='COMPLETED'),nextAt,occ.goal_id,occ.goal_revision,occ.node_key);
      this.goals.event(String(occ.goal_id),'task_step_progress',{nodeKey:node.key,occurrence:occ.id,...value});return true;
    });
  }
}
