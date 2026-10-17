import {afterEach,describe,expect,it} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {OutcomeUnknownError} from '@emergentinc/model';
import {SqliteDatabase} from '@emergentinc/persistence';
import {goalFixture} from './fixtures/owner_goals.js';
import {prepareCompanyMigration,activateCompanyControl} from '../src/services/company_migration_service.js';
import {PublicStore} from '../src/services/public_store.js';
import {OwnerAutomationGate} from '../src/services/owner_automation_gate.js';
const cleanups:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(manualOff=false){
  const f=goalFixture();cleanups.push(f.close);f.on();const goal=f.goal('Retained legacy business objective');f.respond(async()=>{throw new OutcomeUnknownError('Explicitly synthetic disconnected provider');});await f.scheduler.tick();await f.finish();await f.manager.closeAll();
  const permit=f.gate.modelCalls()[0];f.control.db.prepare('UPDATE owner_money_reservations SET reserved_micros=516 WHERE permit_id=?').run(permit.id);
  if(manualOff)f.off();f.control.db.prepare("UPDATE owner_automation_control SET desired_mode='OFF',reason='OWNER_OUTCOME_REVIEW_REQUIRED'").run();
  const proposal=f.gate.proposals.propose('task_plan',{title:'Retained exact approval',planHash:'immutable-plan-hash'},'retained-migration-approval',goal.id);
  f.payments.configureRail({rail_id:'migration-synthetic-bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'},100);
  const store=new PublicStore(f.control,f.payments);cleanups.push(async()=>store.close());store.configureProduct('custom-service',{product_enabled:true,product_name_en:'Migration fixture',product_name_zh:'迁移测试商品',product_description_en:'Synthetic test order only',product_description_zh:'仅隔离测试订单',product_price:'1',product_currency:'USDT'});
  const order=store.createOrder({product_id:'custom-service',customer_name:'Synthetic customer',customer_contact:'migration@example.test',customer_requirement:'Retain the exact private order token',rail_id:'migration-synthetic-bsc',idempotency_key:'isolated-migration-order-0000000000001',language:'en'});
  return {...f,goal,permit,proposal,order,store};
}
describe('non-destructive company control migration',()=>{
  it('migrates a new instance before its Owner control row exists and starts with explicit OFF',async()=>{
    const f=goalFixture();cleanups.push(f.close);f.control.db.exec('DROP TABLE owner_automation_control');
    await prepareCompanyMigration(f.root);const gate=new OwnerAutomationGate(f.control);f.manager.attachAutomation(gate);activateCompanyControl(f.work,{},f.payments);
    expect(gate.view().desiredMode).toBe('OFF');expect(gate.budget.view().activatedAt).toBeNull();expect(f.calls).toHaveLength(0);expect(f.control.db.prepare('SELECT state FROM company_control_migrations').get()!.state).toBe('COMPLETE');
  });
  it.each([false,true])('snapshots WAL data and preserves approvals, order tokens, invoices and the 516-micro reservation (manual OFF=%s)',async manualOff=>{
    const f=await fixture(manualOff),beforeOrder=f.control.db.prepare('SELECT * FROM orders WHERE order_id=?').get(f.order.order_id),beforeInvoice=f.payments.db.prepare('SELECT * FROM payment_invoices').all();
    await prepareCompanyMigration(f.root);const root=join(f.root,'system/migrations/company-control-v1');expect(fs.existsSync(join(root,'before.json'))).toBe(true);
    const copy=new SqliteDatabase(join(root,'system/control/control.sqlite3'),{readOnly:true});try{expect(copy.prepare('SELECT * FROM orders WHERE order_id=?').get(f.order.order_id)).toEqual(beforeOrder);}finally{copy.close();}
    activateCompanyControl(f.work,{MCL_API_KEY:'explicit-fake-migration-key',MCL_BASE_URL:'http://127.0.0.1:1/v1'},f.payments);
    expect(f.control.db.prepare('SELECT * FROM orders WHERE order_id=?').get(f.order.order_id)).toEqual(beforeOrder);expect(f.payments.db.prepare('SELECT * FROM payment_invoices').all()).toEqual(beforeInvoice);expect(f.gate.proposals.list().find(p=>p.id===f.proposal.id)).toEqual(f.proposal);
    expect(f.gate.modelCalls(true).find(p=>p.id===f.permit.id)).toMatchObject({state:'UNKNOWN',actual_tokens:null,cost_cny:null});expect(f.gate.budget.view().reservedMicros).toBe(516);expect(f.gate.view().desiredMode).toBe(manualOff?'OFF':'ON');expect(f.gate.goals.get(f.goal.id).status).toBe('BLOCKED');
    expect(f.control.db.prepare('SELECT state FROM company_control_migrations WHERE version=1').get()!.state).toBe('COMPLETE');const before=fs.readFileSync(join(root,'before.json'),'utf8');await prepareCompanyMigration(f.root);expect(fs.readFileSync(join(root,'before.json'),'utf8')).toBe(before);expect(f.calls).toHaveLength(1);
  });
  it('refuses a changed snapshot before creating agents, claims or migration status',async()=>{
    const f=await fixture(true);await prepareCompanyMigration(f.root);fs.appendFileSync(join(f.root,'system/migrations/company-control-v1/before.json'),' ');
    expect(()=>activateCompanyControl(f.work,{},f.payments)).toThrow('COMPANY_MIGRATION_SNAPSHOT_CHANGED');expect(f.work.worker).toBeUndefined();expect(f.gate.budget.view().reservedMicros).toBe(516);expect(f.gate.view().desiredMode).toBe('OFF');
  });
  it('never snapshots a legacy Core whose process lock still belongs to a live process',async()=>{
    const f=goalFixture();cleanups.push(f.close);await f.manager.open(f.a.world_id);await expect(prepareCompanyMigration(f.root)).rejects.toThrow('OWNER_PREVIOUS_WORKER_STILL_ALIVE');expect(fs.existsSync(join(f.root,'system/migrations/company-control-v1'))).toBe(false);
  });
});
