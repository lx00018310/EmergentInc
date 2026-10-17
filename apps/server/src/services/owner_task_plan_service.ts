import { createHash } from 'node:crypto';
import type { CompanyTaskPlan, CompanyTaskPlanView, CompanyTaskNode, TaskTrigger } from '@emergentinc/protocol';
import { nextBusinessOccurrence } from '@emergentinc/protocol';
import { OwnerGoalService, ownerInput, ownerConflict } from './owner_goal_service.js';

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
  }
  validate(value:unknown):CompanyTaskPlan {
    taskKeys(value,['summary','nodes'],'OWNER_TASK_PLAN_INVALID');ownerInput(typeof value.summary==='string'&&value.summary.length>0&&value.summary.length<=1200&&Array.isArray(value.nodes)&&value.nodes.length>0&&value.nodes.length<=20,'OWNER_TASK_PLAN_INVALID');
    const nodes=value.nodes as CompanyTaskNode[];ownerInput(nodes.every(n=>n&&typeof n==='object'&&!Array.isArray(n)),'OWNER_TASK_PLAN_INVALID');const keys=new Set(nodes.map(n=>n.key));ownerInput(keys.size===nodes.length,'OWNER_TASK_PLAN_INVALID');
    for(const n of nodes){
      taskKeys(n,['key','title','instruction','dependsOn','trigger','filename','personId'],'OWNER_TASK_PLAN_INVALID');
      ownerInput(typeof n.key==='string'&&/^[a-zA-Z][\w-]{0,63}$/.test(n.key)&&typeof n.title==='string'&&n.title.length>0&&n.title.length<=160&&typeof n.instruction==='string'&&n.instruction.length>0&&n.instruction.length<=1600&&Array.isArray(n.dependsOn)&&n.dependsOn.every(d=>typeof d==='string'&&keys.has(d)&&d!==n.key)&&new Set(n.dependsOn).size===n.dependsOn.length&&typeof n.filename==='string'&&/^[-\w]+\.(md|txt|json|csv)$/.test(n.filename)&&n.filename.length<=100&&(n.personId===undefined||typeof n.personId==='string'),'OWNER_TASK_PLAN_INVALID');
      const t=n.trigger;ownerInput(t&&['once','continuous','interval','daily','weekly'].includes(t.kind),'OWNER_TASK_SCHEDULE_INVALID');
      taskKeys(t,t.kind==='interval'?['kind','everyMinutes']:t.kind==='daily'?['kind','time','timezone']:t.kind==='weekly'?['kind','time','timezone','weekdays']:['kind'],'OWNER_TASK_SCHEDULE_INVALID');
      if(t.kind==='interval')ownerInput(Number.isSafeInteger(t.everyMinutes)&&t.everyMinutes>=5&&t.everyMinutes<=525600,'OWNER_TASK_SCHEDULE_INVALID');
      if(t.kind==='daily'||t.kind==='weekly'){ownerInput(/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)&&typeof t.timezone==='string','OWNER_TASK_SCHEDULE_INVALID');try{new Intl.DateTimeFormat('en',{timeZone:t.timezone});}catch{ownerInput(false,'OWNER_TASK_SCHEDULE_INVALID');}}
      if(t.kind==='weekly')ownerInput(Array.isArray(t.weekdays)&&t.weekdays.length>0&&t.weekdays.length<=7&&t.weekdays.every(d=>Number.isInteger(d)&&d>=0&&d<=6)&&new Set(t.weekdays).size===t.weekdays.length,'OWNER_TASK_SCHEDULE_INVALID');
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
    const body=JSON.parse(String(row.body));return {goalId,goalRevision:goal.specificationRevision,planRevision:Number(row.plan_revision),approved:Boolean(row.approved),summary:body.summary,nodes:body.nodes.map((n:CompanyTaskNode)=>{const r=db.prepare('SELECT * FROM owner_task_nodes WHERE goal_id=? AND goal_revision=? AND node_key=?').get(goalId,goal.specificationRevision,n.key)!;return {...n,state:String(r.state),nextAt:r.next_at===null?null:Number(r.next_at),latestEvidence:JSON.parse(String(r.latest_evidence)),occurrences:Number(r.occurrences)};})};
  }
  approve(goalId:string){const g=this.goals.get(goalId);this.goals.store.db.prepare('UPDATE owner_task_plans SET approved=1 WHERE goal_id=? AND goal_revision=?').run(goalId,g.specificationRevision);if(g.status!=='PAUSED')this.goals.state(goalId,'READY');}
  reviseInternal(goalId:string,value:unknown,dispatchId:string){
    const next=this.validate(value),old=this.get(goalId),db=this.goals.store.db;
    if(!old?.approved||!['READY','RUNNING'].includes(this.goals.get(goalId).status)||!db.prepare("SELECT 1 FROM owner_task_occurrences WHERE dispatch_id=? AND goal_id=? AND goal_revision=? AND state='RUNNING'").get(dispatchId,goalId,old.goalRevision))ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');
    for(const n of old.nodes){const changed=next.nodes.find(v=>v.key===n.key);if(n.state==='RUNNING'||n.occurrences){
      if(!changed||['key','title','instruction','dependsOn','trigger','filename','personId'].some(k=>JSON.stringify((n as any)[k])!==JSON.stringify((changed as any)[k])))ownerConflict('OWNER_TASK_COMPLETED_STEP_CHANGED');
    }else if(changed&&JSON.stringify(changed.trigger)!==JSON.stringify(n.trigger))ownerConflict('OWNER_EXTERNAL_APPROVAL_REQUIRED');}
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
    return plan.nodes.find(n=>n.state!=='RUNNING'&&n.state!=='BLOCKED'&&n.nextAt!==null&&n.nextAt<=now&&n.dependsOn.every(k=>plan.nodes.find(d=>d.key===k)!.occurrences>0))??null;
  }
  claim(goalId:string,nodeKey:string,dispatchId:string,now=Date.now()){
    return this.goals.store.transaction(()=>{
      const goal=this.goals.get(goalId),node=this.due(goalId,now);if(!node||node.key!==nodeKey)ownerConflict('OWNER_TASK_OCCURRENCE_CONFLICT');
      const revision=this.get(goalId)!.planRevision,id='occ_'+createHash('sha256').update(`${goalId}:${goal.specificationRevision}:${revision}:${nodeKey}:${node.nextAt}`).digest('hex');
      this.goals.store.db.prepare("INSERT INTO owner_task_occurrences VALUES(?,?,?,?,?,?,'RUNNING',?)").run(id,goalId,goal.specificationRevision,nodeKey,node.nextAt,dispatchId,revision);
      this.goals.store.db.prepare("UPDATE owner_task_nodes SET state='RUNNING' WHERE goal_id=? AND goal_revision=? AND node_key=?").run(goalId,goal.specificationRevision,nodeKey);return id;
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
}
