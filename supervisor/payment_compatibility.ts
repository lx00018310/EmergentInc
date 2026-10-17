import * as fs from 'node:fs';
import * as path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

/** V34 rollback changes software only. Payment facts never undergo reverse migration. */
export function checkPaymentRollback(file:string,directory:string){
  const contract=JSON.parse(fs.readFileSync(path.join(directory,'resources/config/company_protocol.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'genome/manifest.json'),'utf8'));
  if(contract.workspace_format!==34||!manifest.capability_contracts['instance_payment@1'])throw new Error('V34_ROLLBACK_DENIED_PAYMENT_CONTRACT');
  if(!fs.existsSync(file))return;
  const db=new DatabaseSync(file,{readOnly:true});
  try{if(Number(db.prepare('PRAGMA user_version').get()!.user_version)!==34)throw new Error('PAYMENT_ROLLBACK_SCHEMA_UNSUPPORTED');}
  finally{db.close();}
}

export function preparePaymentRollback(file:string,directory:string){checkPaymentRollback(file,directory);}
