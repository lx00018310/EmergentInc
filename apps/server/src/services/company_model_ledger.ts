import { randomUUID } from 'node:crypto';
import type { WorldRegistryStore } from '@emergentinc/persistence';
import { InfrastructureFailureError, UsageMeter, type ModelPricing } from '@emergentinc/model';
import type { PreparedModelRequest, RawModelResponse } from '@emergentinc/protocol';
import type { GoalRunBinding } from './owner_automation_gate.js';
import { OwnerCompanyBudget, modelCostMicros } from './owner_company_budget.js';
import { ownerConflict } from './owner_goal_service.js';
import { companyFactHash } from './company_fact_hash.js';
import {COMPANY_WORKER_MAX_OUTPUT_TOKENS} from '../execution/company_worker_protocol.js';

export interface CompanyModelContext {worldId?: string;runId?: string;attemptId?: string;sourceKind: string;binding?: GoalRunBinding;scope?: 'worker'}
export interface PreparedCompanyCall {permitId: string;request: PreparedModelRequest;response?: RawModelResponse}
interface LedgerControl {
  admit(context: CompanyModelContext): void;
  batchId(): string;
  bind(permitId: string, context: CompanyModelContext): void;
  changed(permitId: string): void;
  exceeded(permitId: string): void;
}
const digest=companyFactHash;

/** Monetary authorization and receipts are independent of execution lifecycle. */
export class CompanyModelLedger {
  constructor(readonly store: WorldRegistryStore, readonly budget: OwnerCompanyBudget, private control: LedgerControl) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_model_dispatches(
      permit_id TEXT PRIMARY KEY REFERENCES owner_model_permits(id),request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,pricing_json TEXT NOT NULL,response_json TEXT);`);
  }
  prepare(request: PreparedModelRequest, meter: UsageMeter, context: CompanyModelContext): PreparedCompanyCall {
    const price=meter.getPricingForModel(request.model);
    if(!price||price.currency&&(typeof price.currency!=='string'||price.currency.toUpperCase()!=='CNY')||![price.input_cost_per_million,price.output_cost_per_million,price.cached_cost_per_million??price.input_cost_per_million].every(v=>Number.isFinite(v)&&v>=0))throw new InfrastructureFailureError('MODEL_PRICE_REQUIRED');
    const output=Math.min(request.maxTokens??0,context.binding?COMPANY_WORKER_MAX_OUTPUT_TOKENS:Infinity);
    if(!Number.isSafeInteger(output)||output<=0)throw new InfrastructureFailureError('OWNER_MODEL_OUTPUT_LIMIT_REQUIRED');
    const effective={...request,maxTokens:output},requestHash=digest(effective),overhead=Buffer.byteLength(JSON.stringify(request.messages),'utf8')+1024,reservedTokens=overhead+output;
    let reservedMicros:number;try{reservedMicros=modelCostMicros({...price,input_cost_per_million:Math.max(price.input_cost_per_million,price.cached_cost_per_million??price.input_cost_per_million)},overhead,output);}catch(e){throw new InfrastructureFailureError((e as Error).message);}
    try{return this.store.transaction(()=>{
      this.control.admit(context);
      if(request.auditCallId){
        const old=this.store.db.prepare(`SELECT p.id,p.state,d.request_hash,d.response_json FROM owner_model_sources s JOIN owner_model_permits p ON p.id=s.permit_id LEFT JOIN company_model_dispatches d ON d.permit_id=p.id WHERE s.source_id=? AND s.source_kind=? AND p.world_id IS ? AND p.state!='NOT_SENT' ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1`).get(request.auditCallId,context.sourceKind,context.worldId??null);
        if(old){
          if(old.request_hash&&old.request_hash!==requestHash)ownerConflict('IDEMPOTENCY_CONFLICT');
          if(old.response_json)return {permitId:String(old.id),request:effective,response:JSON.parse(String(old.response_json))};
          ownerConflict(old.state==='SENT'?'OWNER_CALL_IN_FLIGHT':old.state==='UNKNOWN'?'OWNER_OUTCOME_REVIEW_REQUIRED':'OWNER_CALL_RECEIPT_REQUIRED');
        }
      }
      const id=`model_${randomUUID()}`;
      this.store.db.prepare("INSERT INTO owner_model_permits VALUES(?,?,?,?,?,'SENT',?,NULL,NULL,?)").run(id,this.control.batchId(),context.worldId??null,context.binding?.goalId??null,context.binding?.specificationRevision??null,reservedTokens,Date.now());
      this.budget.reserve(id,reservedMicros);
      this.store.db.prepare('INSERT INTO company_model_dispatches VALUES(?,?,?,?,NULL)').run(id,requestHash,JSON.stringify(effective),JSON.stringify(price));
      if(request.auditCallId)this.store.db.prepare('INSERT INTO owner_model_sources VALUES(?,?,?)').run(id,request.auditCallId,context.sourceKind);
      this.control.bind(id,context);
      return {permitId:id,request:effective};
    });}catch(e){
      let reason=(e as Error).message;
      if(reason==='OWNER_COMPANY_BUDGET_EXHAUSTED'){
        const v=this.budget.view();
        if(!v.needsRefill&&v.reservedMicros>0&&v.totalMicros-v.spentMicros>=reservedMicros)reason='OWNER_COMPANY_BUDGET_BUSY';
      }
      throw Object.assign(new InfrastructureFailureError(reason),{statusCode:(e as any).statusCode??409,...(/^OWNER_COMPANY_BUDGET_(EXHAUSTED|BUSY)$/.test(reason)?{requiredMicros:reservedMicros}:{})});
    }
  }
  response(permitId: string, response: RawModelResponse) {
    this.store.transaction(()=>{
      const row=this.store.db.prepare('SELECT p.*,d.pricing_json,d.request_json,d.response_json,r.reserved_micros FROM owner_model_permits p JOIN company_model_dispatches d ON d.permit_id=p.id JOIN owner_money_reservations r ON r.permit_id=p.id WHERE p.id=?').get(permitId);
      if(!row)ownerConflict('OWNER_CALL_RECEIPT_REQUIRED');
      if(row.response_json){if(digest(JSON.parse(String(row.response_json)))!==digest(response))ownerConflict('OWNER_BILLING_RECEIPT_CONFLICT');return;}
      if(row.state==='NOT_SENT')ownerConflict('OWNER_BILLING_RECEIPT_CONFLICT');
      const price=JSON.parse(String(row.pricing_json)) as ModelPricing,request=JSON.parse(String(row.request_json)) as PreparedModelRequest;
      const usage=new UsageMeter({models:{[request.model]:price}}).calculateUsage({...response.usage,model:request.model});
      const known=usage.promptTokens!==null&&usage.completionTokens!==null&&usage.actualTokens!==null&&usage.costCny!==null;
      const actual=known?modelCostMicros(price,usage.promptTokens!,usage.completionTokens!,usage.cachedTokens??0):null;
      if(row.state==='SETTLED'&&(actual===null||row.actual_tokens!==usage.actualTokens||row.cost_cny!==actual/1_000_000))ownerConflict('OWNER_BILLING_RECEIPT_CONFLICT');
      if(actual!==null)this.budget.settle(permitId,actual);
      this.store.db.prepare('UPDATE owner_model_permits SET state=?,actual_tokens=?,cost_cny=? WHERE id=?').run(known?'SETTLED':'UNKNOWN',usage.actualTokens,actual===null?null:actual/1_000_000,permitId);
      this.store.db.prepare('UPDATE company_model_dispatches SET response_json=? WHERE permit_id=?').run(JSON.stringify(response),permitId);
      if(known&&(usage.actualTokens!>Number(row.reserved_tokens)||actual!>Number(row.reserved_micros)))this.control.exceeded(permitId);
    });
    this.control.changed(permitId);
  }
  failure(permitId: string, notSent: boolean) {
    this.store.db.prepare("UPDATE owner_model_permits SET state=?,actual_tokens=?,cost_cny=? WHERE id=? AND state IN ('SENT','UNKNOWN') AND id NOT IN (SELECT permit_id FROM company_model_dispatches WHERE response_json IS NOT NULL)").run(notSent?'NOT_SENT':'UNKNOWN',notSent?0:null,notSent?0:null,permitId);
    this.control.changed(permitId);
  }
  storedResponse(permitId: string): RawModelResponse | null {
    const r=this.store.db.prepare('SELECT response_json FROM company_model_dispatches WHERE permit_id=?').get(permitId);return r?.response_json?JSON.parse(String(r.response_json)):null;
  }
}
