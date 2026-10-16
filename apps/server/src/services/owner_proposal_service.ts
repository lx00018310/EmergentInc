import { createHash,randomUUID } from 'node:crypto';
import type { CompanyProposal,OwnerGoalEvidence } from '@emergentinc/protocol';
import type { OwnerAutomationGate } from './owner_automation_gate.js';
import { ownerConflict,ownerInput,exactKeys } from './owner_goal_service.js';
import { OwnerTaskPlanService } from './owner_task_plan_service.js';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export class OwnerProposalService {
  readonly plans:OwnerTaskPlanService;
  verifyEvidence?:(e:OwnerGoalEvidence)=>void;
  constructor(readonly gate:OwnerAutomationGate){
    this.plans=new OwnerTaskPlanService(gate.goals);
    gate.store.db.exec(`CREATE TABLE IF NOT EXISTS owner_company_proposals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,goal_id TEXT,goal_revision INTEGER,payload TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT,created_at INTEGER NOT NULL,operation_key TEXT NOT NULL UNIQUE);`);
  }
  list():CompanyProposal[]{return this.gate.store.db.prepare('SELECT * FROM owner_company_proposals ORDER BY created_at,id').all().map(r=>({id:String(r.id),kind:r.kind as CompanyProposal['kind'],goalId:r.goal_id as string|null,goalRevision:r.goal_revision as number|null,payload:JSON.parse(String(r.payload)),hash:String(r.hash),state:r.state as CompanyProposal['state'],result:r.result?JSON.parse(String(r.result)):null,createdAt:Number(r.created_at)}));}
  propose(kind:CompanyProposal['kind'],payload:unknown,key:string,goalId?:string){
    if(kind==='budget')ownerConflict('OWNER_USE_COMPANY_BUDGET_SETTINGS');
    const goal=goalId?this.gate.goals.get(goalId):undefined,body={kind,payload,goalId:goalId??null,goalRevision:goal?.specificationRevision??null},hash=digest(body);
    return this.gate.store.transaction(()=>{
      const old=this.gate.store.db.prepare('SELECT id,hash FROM owner_company_proposals WHERE operation_key=?').get(key);if(old){if(old.hash!==hash)ownerConflict('IDEMPOTENCY_CONFLICT');return this.list().find(p=>p.id===old.id)!;}
      const id='proposal_'+randomUUID();this.gate.store.db.prepare("INSERT INTO owner_company_proposals VALUES(?,?,?,?,?,?,'PENDING',NULL,?,?)").run(id,kind,goalId??null,goal?.specificationRevision??null,JSON.stringify(payload),hash,Date.now(),key);return this.list().find(p=>p.id===id)!;
    });
  }
  closeProposal(goalId:string,reason?:string){
    const goal=this.gate.goals.get(goalId),evidence=this.gate.goals.detail(goalId).evidence.filter(e=>e.specificationRevision===goal.specificationRevision);
    if(!evidence.some(e=>e.kind!=='report'))return null;
    const snapshot=evidence.map(e=>({id:e.id,sha256:e.sha256})).sort((a,b)=>a.id.localeCompare(b.id));
    const previous=this.list().find(p=>p.kind==='close_task'&&p.goalId===goalId&&p.goalRevision===goal.specificationRevision&&digest(p.payload.evidence)===digest(snapshot));if(previous)return previous;
    return this.propose('close_task',{evidence:snapshot,title:goal.title,...(reason?{reason}:{})},'close:'+goalId+':'+goal.specificationRevision+':'+digest(snapshot),goalId);
  }
  decide(id:string,input:any){
    exactKeys(input,['decision','hash','idempotencyKey']);ownerInput(['approve','reject'].includes(input.decision),'OWNER_PROPOSAL_INVALID');
    return this.gate.goals.request(input.idempotencyKey,{proposal:id,input},()=>{
      const p=this.list().find(p=>p.id===id);if(!p||p.hash!==input.hash)ownerConflict('OWNER_PROPOSAL_CHANGED');
      if(p.state==='EXECUTED'&&input.decision==='approve'||p.state==='REJECTED'&&input.decision==='reject')return p;
      if(p.state!=='PENDING')ownerConflict('OWNER_PROPOSAL_ALREADY_DECIDED');
      if(p.goalId){const goal=this.gate.goals.get(p.goalId);if(goal.specificationRevision!==p.goalRevision||['STOPPED','ARCHIVED','COMPLETED'].includes(goal.status))ownerConflict('OWNER_GOAL_PERMISSION_CHANGED');}
      let result:unknown=null;
      if(input.decision==='approve'){
        if(p.kind==='budget')ownerConflict('OWNER_USE_COMPANY_BUDGET_SETTINGS');
        else if(p.kind==='task_plan'){const plan=this.plans.get(p.goalId!);if(!plan||digest(plan)!==p.payload.planHash)ownerConflict('OWNER_PROPOSAL_CHANGED');this.plans.approve(p.goalId!);result=this.gate.goals.get(p.goalId!);}
        else {
          const detail=this.gate.goals.detail(p.goalId!);if(detail.goal.status!=='WAITING_APPROVAL')ownerConflict('OWNER_PROPOSAL_CHANGED');if(!p.payload.evidence.every((s:any)=>detail.evidence.some(e=>e.id===s.id&&e.sha256===s.sha256&&e.specificationRevision===p.goalRevision)))ownerConflict('OWNER_EVIDENCE_CHANGED');
          const latest=detail.evidence.filter(e=>e.specificationRevision===p.goalRevision).map(e=>({id:e.id,sha256:e.sha256})).sort((a,b)=>a.id.localeCompare(b.id));if(digest(latest)!==digest(p.payload.evidence))ownerConflict('OWNER_PROPOSAL_CHANGED');
          const active=this.gate.store.db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE goal_id=? AND state IN ('QUEUED','RUNNING')").get(p.goalId);if(active)ownerConflict('OWNER_TASK_STILL_RUNNING');
          if(this.gate.store.db.prepare("SELECT 1 FROM owner_model_permits WHERE goal_id=? AND state IN ('SENT','UNKNOWN')").get(p.goalId))ownerConflict('OWNER_TASK_STILL_RUNNING');
          if(!this.verifyEvidence)ownerConflict('OWNER_EVIDENCE_CHANGED');for(const s of p.payload.evidence)this.verifyEvidence(detail.evidence.find(e=>e.id===s.id)!);
          this.gate.store.db.prepare('UPDATE owner_goals SET revision=revision+1 WHERE id=?').run(p.goalId);this.gate.goals.state(p.goalId!,'COMPLETED','OWNER_RESULT_VERIFIED');this.gate.goals.event(p.goalId!,'owner_verified',{proposalId:p.id,evidence:p.payload.evidence,basis:'EXPLICIT_OWNER_ACCEPTANCE_NOT_PAYMENT_PROOF'});result=this.gate.goals.get(p.goalId!);
        }
      }
      this.gate.store.db.prepare('UPDATE owner_company_proposals SET state=?,result=? WHERE id=?').run(input.decision==='approve'?'EXECUTED':'REJECTED',JSON.stringify(result),id);
      this.gate.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_company_proposal_decided',NULL,?,?)").run(JSON.stringify({proposalId:p.id,goalId:p.goalId,goalRevision:p.goalRevision,decision:input.decision,hash:p.hash}),Date.now());
      return this.list().find(p=>p.id===id)!;
    });
  }
}
