import type { WorldRegistryStore } from '@emergentinc/persistence';
import { ownerInput, ownerConflict } from './owner_goal_service.js';
import { COMPANY_BUDGET_USD_CNY, type CompanyBudget } from '@emergentinc/protocol';
import type { ModelPricing } from '@emergentinc/model';

// A copied World recovery receipt handles the outcome, but does not invent a known bill.
export const reviewedOutcomeSql = "EXISTS (SELECT 1 FROM control_events e WHERE e.kind='owner_model_outcome_reviewed' AND json_extract(e.payload,'$.permitId')=p.id)";

export function modelCostMicros(price:ModelPricing,input:number,output:number,cached=0):number {
  const rate=(n:number)=>{const m=/^(\d+)(?:\.(\d{1,6}))?$/.exec(String(n));if(!m)throw new Error('MODEL_PRICE_PRECISION_UNSUPPORTED');return BigInt(m[1])*1000000n+BigInt((m[2]??'').padEnd(6,'0'));};
  if(![input,output,cached].every(n=>Number.isSafeInteger(n)&&n>=0)||cached>input)throw new Error('USAGE_UNKNOWN');
  const amount=(BigInt(input-cached)*rate(price.input_cost_per_million)+BigInt(output)*rate(price.output_cost_per_million)+BigInt(cached)*rate(price.cached_cost_per_million??price.input_cost_per_million)+999999n)/1000000n;
  const result=Number(amount);if(!Number.isSafeInteger(result))throw new Error('OWNER_MONEY_INVALID');return result;
}

/** Integer money is the only company spending authorization. Old token grants remain historical data. */
export class OwnerCompanyBudget {
  constructor(readonly store: WorldRegistryStore) {
    const db=store.db;
    db.exec(`CREATE TABLE IF NOT EXISTS owner_company_budget(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,total_micros INTEGER NOT NULL,revision INTEGER NOT NULL,activated_at INTEGER,token_millions INTEGER,unit_price_cny_micros INTEGER,period_spent_micros INTEGER NOT NULL DEFAULT 0,refill_required INTEGER NOT NULL DEFAULT 0);
      INSERT OR IGNORE INTO owner_company_budget(id,schema_version,total_micros,revision,activated_at) VALUES(1,2,0,0,NULL);
      CREATE TABLE IF NOT EXISTS owner_money_reservations(permit_id TEXT PRIMARY KEY REFERENCES owner_model_permits(id),reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),settled_micros INTEGER);`);
    if(db.prepare('SELECT schema_version FROM owner_company_budget').get()!.schema_version!==2)throw new Error('OWNER_MONEY_SCHEMA_UNSUPPORTED');
  }
  view():CompanyBudget {
    const db=this.store.db,row=db.prepare('SELECT * FROM owner_company_budget WHERE id=1').get()!;
    const usage=db.prepare(`SELECT COALESCE(SUM(CASE WHEN p.state='SETTLED' THEN r.settled_micros ELSE 0 END),0) spent,
      COALESCE(SUM(CASE WHEN p.state IN ('SENT','UNKNOWN') THEN r.reserved_micros ELSE 0 END),0) reserved,
      SUM(p.state='UNKNOWN') unknown FROM owner_money_reservations r JOIN owner_model_permits p ON p.id=r.permit_id`).get()!;
    const baseline=Number(row.period_spent_micros),total=Number(row.total_micros)-baseline,spent=Number(usage.spent)-baseline,reserved=Number(usage.reserved);
    const historical=Number(db.prepare("SELECT COALESCE(ROUND(SUM(cost_cny)*1000000),0) micros FROM owner_model_permits WHERE state='SETTLED' AND id NOT IN (SELECT permit_id FROM owner_money_reservations)").get()!.micros);
    return {currency:'CNY',totalMicros:total,spentMicros:spent,reservedMicros:reserved,availableMicros:Math.max(0,total-spent-reserved),revision:Number(row.revision),activatedAt:row.activated_at===null?null:Number(row.activated_at),unknownCalls:Number(usage.unknown??0),historicalCostMicros:historical+baseline,needsRefill:Boolean(row.refill_required)||row.activated_at!==null&&total-spent<=0,configuration:row.token_millions===null?null:{tokenMillions:Number(row.token_millions),unitPriceCnyMicros:Number(row.unit_price_cny_micros)}};
  }
  configure(input:{tokenMillions:number;unitPrice:number;priceCurrency:'CNY'|'USD';expectedRevision:number}) {
    ownerInput(Number.isSafeInteger(input.tokenMillions)&&input.tokenMillions>=1&&input.tokenMillions<=10000&&Number.isFinite(input.unitPrice)&&input.unitPrice>0&&['CNY','USD'].includes(input.priceCurrency)&&Number.isSafeInteger(input.expectedRevision),'OWNER_MONEY_INVALID');
    const rate=Math.round(input.unitPrice*(input.priceCurrency==='USD'?COMPANY_BUDGET_USD_CNY:1)*1000000),amount=input.tokenMillions*rate;
    ownerInput(Number.isSafeInteger(rate)&&rate>0&&Number.isSafeInteger(amount),'OWNER_MONEY_INVALID');
    return this.store.transaction(()=>{
      const v=this.view();if(v.revision!==input.expectedRevision)ownerConflict();
      // Pending bills retain their reservations across a new authorization period.
      // Lowering the allowance cannot make already held money disappear.
      if(amount<v.reservedMicros)ownerConflict('OWNER_COMPANY_BUDGET_EXHAUSTED');
      if(v.needsRefill&&v.configuration?.tokenMillions===input.tokenMillions)ownerConflict('OWNER_BUDGET_TOKEN_CHANGE_REQUIRED');
      const spent=Number(this.store.db.prepare("SELECT COALESCE(SUM(r.settled_micros),0) spent FROM owner_money_reservations r JOIN owner_model_permits p ON p.id=r.permit_id WHERE p.state='SETTLED'").get()!.spent);
      ownerInput(Number.isSafeInteger(spent+amount),'OWNER_MONEY_INVALID');
      this.store.db.prepare('UPDATE owner_company_budget SET total_micros=?,period_spent_micros=?,token_millions=?,unit_price_cny_micros=?,refill_required=0,revision=revision+1,activated_at=COALESCE(activated_at,?) WHERE id=1').run(spent+amount,spent,input.tokenMillions,rate,Date.now());
      this.store.db.prepare("UPDATE owner_automation_control SET reason=NULL WHERE reason IN ('OWNER_TOKEN_LIMIT','OWNER_COMPANY_BUDGET_REQUIRED','OWNER_COMPANY_BUDGET_EXHAUSTED')").run();
      this.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_budget_configured',NULL,?,?)").run(JSON.stringify({...input,amountMicros:amount,unitPriceCnyMicros:rate,exchangeRate:COMPANY_BUDGET_USD_CNY}),Date.now());
      return this.view();
    });
  }
  markInsufficient(){this.store.db.prepare('UPDATE owner_company_budget SET refill_required=1,revision=revision+1 WHERE id=1 AND refill_required=0').run();}
  reserve(permitId:string,amount:number) {
    ownerInput(Number.isSafeInteger(amount)&&amount>=0,'OWNER_MONEY_INVALID');
    const v=this.view();if(v.activatedAt===null)ownerConflict('OWNER_COMPANY_BUDGET_REQUIRED');
    if(v.needsRefill||v.availableMicros<amount)ownerConflict('OWNER_COMPANY_BUDGET_EXHAUSTED');
    this.store.db.prepare('INSERT INTO owner_money_reservations VALUES(?,?,NULL)').run(permitId,amount);
  }
  settle(permitId:string,micros:number){ownerInput(Number.isSafeInteger(micros)&&micros>=0,'OWNER_MONEY_INVALID');this.store.db.prepare('UPDATE owner_money_reservations SET settled_micros=? WHERE permit_id=?').run(micros,permitId);}
}
