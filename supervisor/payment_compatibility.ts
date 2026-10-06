import * as fs from 'node:fs';
import * as path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {SqliteDatabase} from '@emergentinc/persistence';

const tables=['payment_invoices','payment_receipts','world_revenue_events'];
function legacy(directory:string){
  return !JSON.parse(fs.readFileSync(path.join(directory,'genome/manifest.json'),'utf8')).capability_contracts['instance_payment@1'];
}
/** Read-only preflight, before stopping the current service. Never discard payment facts. */
export function checkPaymentRollback(file:string,directory:string){
  if(!legacy(directory)||!fs.existsSync(file))return;
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const version=Number(db.prepare('PRAGMA user_version').get()!.user_version);
    if(version===2)return;
    if(version!==3)throw new Error('PAYMENT_ROLLBACK_SCHEMA_UNSUPPORTED');
    for(const table of tables){
      const columns=db.prepare(`PRAGMA table_info(${table})`).all().map(row=>String(row.name));
      const where=['world_id','qianji_id'].filter(column=>columns.includes(column)).map(column=>`${column} IS NULL`).join(' OR ');
      if(db.prepare(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`).get())throw new Error('V23_ROLLBACK_DENIED_INSTANCE_PAYMENT_FACTS');
    }
  }finally{db.close();}
}
/** Called only after quiesce + stop. Reverse the attribution migration, retaining every row. */
export function preparePaymentRollback(file:string,directory:string){
  checkPaymentRollback(file,directory);
  if(!legacy(directory)||!fs.existsSync(file))return;
  const db=new SqliteDatabase(file);
  try{
    if(Number(db.prepare('PRAGMA user_version').get()!.user_version)===2)return;
    db.exec('PRAGMA foreign_keys=OFF;');
    db.transaction(()=>{
      for(const table of tables){
        const sql=String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)!.sql);
        const temporary=table+'_v23';
        db.exec(sql.replace(new RegExp(`^CREATE TABLE\\s+"?${table}"?`,'i'),`CREATE TABLE ${temporary}`)
          .replace(/\b(world_id|qianji_id) TEXT(?! NOT NULL)/g,'$1 TEXT NOT NULL'));
        db.exec(`INSERT INTO ${temporary} SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${temporary} RENAME TO ${table};`);
      }
      db.exec("CREATE UNIQUE INDEX permanent_invoice_amount ON payment_invoices(chain,network,mint,recipient_address,amount_atomic) WHERE chain!='solana';");
      if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('PAYMENT_ROLLBACK_FOREIGN_KEY_CONFLICT');
      db.exec('PRAGMA user_version=2;');
    });
  }finally{db.exec('PRAGMA foreign_keys=ON;');db.close();}
}
