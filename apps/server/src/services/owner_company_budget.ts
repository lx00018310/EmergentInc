import type { WorldRegistryStore } from '@emergentinc/persistence';
import { ownerInput, ownerConflict } from './owner_goal_service.js';
import type { CompanyBudget } from '@emergentinc/protocol';
import type { ModelPricing } from '@emergentinc/model';

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
    db.exec(`CREATE TABLE IF NOT EXISTS owner_company_budget(id INTEGER PRIMARY KEY CHECK(id=1),schema_version INTEGER NOT NULL,total_micros INTEGER NOT NULL,revision INTEGER NOT NULL,activated_at INTEGER);
      INSERT OR IGNORE INTO owner_company_budget VALUES(1,1,0,0,NULL);
      CREATE TABLE IF NOT EXISTS owner_money_reservations(permit_id TEXT PRIMARY KEY REFERENCES owner_model_permits(id),reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),settled_micros INTEGER);`);
    if(db.prepare('SELECT schema_version FROM owner_company_budget').get()!.schema_version!==1)throw new Error('OWNER_MONEY_SCHEMA_UNSUPPORTED');
  }
  view():CompanyBudget {
    const db=this.store.db,row=db.prepare('SELECT * FROM owner_company_budget WHERE id=1').get()!;
    const usage=db.prepare(`SELECT COALESCE(SUM(CASE WHEN p.state='SETTLED' THEN r.settled_micros ELSE 0 END),0) spent,
      COALESCE(SUM(CASE WHEN p.state IN ('SENT','UNKNOWN') THEN r.reserved_micros ELSE 0 END),0) reserved,
      SUM(p.state='UNKNOWN') unknown FROM owner_money_reservations r JOIN owner_model_permits p ON p.id=r.permit_id`).get()!;
    const total=Number(row.total_micros),spent=Number(usage.spent),reserved=Number(usage.reserved);
    const historical=Number(db.prepare("SELECT COALESCE(ROUND(SUM(cost_cny)*1000000),0) micros FROM owner_model_permits WHERE state='SETTLED' AND id NOT IN (SELECT permit_id FROM owner_money_reservations)").get()!.micros);
    return {currency:'CNY',totalMicros:total,spentMicros:spent,reservedMicros:reserved,availableMicros:Math.max(0,total-spent-reserved),revision:Number(row.revision),activatedAt:row.activated_at===null?null:Number(row.activated_at),unknownCalls:Number(usage.unknown??0),historicalCostMicros:historical};
  }
  authorize(totalMicros:number) {
    ownerInput(Number.isSafeInteger(totalMicros)&&totalMicros>0,'OWNER_MONEY_INVALID');
    const v=this.view();if(totalMicros<v.totalMicros||totalMicros<v.spentMicros+v.reservedMicros)ownerConflict('OWNER_BUDGET_BELOW_SPENT');
    // Earlier unknown obligations must be resolved first; no conversion of historical token grants.
    if(this.store.db.prepare("SELECT 1 FROM owner_model_permits WHERE state IN ('SENT','UNKNOWN')").get())ownerConflict('OWNER_OUTCOME_REVIEW_REQUIRED');
    this.store.db.prepare('UPDATE owner_company_budget SET total_micros=?,revision=revision+1,activated_at=COALESCE(activated_at,?) WHERE id=1').run(totalMicros,Date.now());
    this.store.db.prepare("UPDATE owner_automation_control SET reason=NULL WHERE reason='OWNER_TOKEN_LIMIT'").run();
    return this.view();
  }
  reserve(permitId:string,amount:number) {
    ownerInput(Number.isSafeInteger(amount)&&amount>=0,'OWNER_MONEY_INVALID');
    const v=this.view();if(v.activatedAt===null)ownerConflict('OWNER_COMPANY_BUDGET_REQUIRED');
    if(v.availableMicros<amount)ownerConflict('OWNER_COMPANY_BUDGET_EXHAUSTED');
    this.store.db.prepare('INSERT INTO owner_money_reservations VALUES(?,?,NULL)').run(permitId,amount);
  }
  settle(permitId:string,micros:number){ownerInput(Number.isSafeInteger(micros)&&micros>=0,'OWNER_MONEY_INVALID');this.store.db.prepare('UPDATE owner_money_reservations SET settled_micros=? WHERE permit_id=?').run(micros,permitId);}
}
