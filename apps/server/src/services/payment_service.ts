import {SqliteDatabase,LineageStore,WorldRegistryStore} from '@emergentinc/persistence';
import {createHash,randomUUID} from 'node:crypto';
import {lifeId} from '@emergentinc/protocol';
import {paymentReference,solanaPayUrl,PaymentInvoice,verifySolanaPayment} from './solana_payment.js';
import {USDT_CHAINS,PaymentChain,paymentChain,recipientAddress,chainAmount,quotedAmount,tokenAmount,paymentPayload} from './payment_assets.js';
import {verifyTokenPayment} from './token_payment.js';
const sha=(v:unknown)=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const only=(v:Record<string,any>,keys:string[])=>{if(!v||Object.keys(v).some(k=>!keys.includes(k)))throw Error('PAYMENT_UNEXPECTED_FIELD');};
export type Invoice=PaymentInvoice&Record<string,any>&{chain:PaymentChain;decimals:number;asset:'USDT';created_at:number};
export class PaymentService{
  readonly db:SqliteDatabase;
  constructor(file:string,readonly control:WorldRegistryStore,readonly lineage:LineageStore){
    if(!lineage.worldsEnabled)throw Error('V23_WORLD_LINEAGE_REQUIRED');this.db=new SqliteDatabase(file);
    const version=Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
    if(![0,1,2].includes(version)){this.db.close();throw Error('UNSUPPORTED_PAYMENT_SCHEMA');}
    if(version===0&&this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length){this.db.close();throw Error('PAYMENT_EXPLICIT_SCHEMA_MIGRATION_REQUIRED');}
    this.db.transaction(()=>{
      // Preserve the entire old USDC FK graph; it is never relabelled as USDT.
      if(version===1)for(const table of ['payment_rails','rail_events','payment_invoices','payment_observations','payment_receipts','world_revenue_events','payment_outbox','payment_scan_cursors','payment_unmatched'])this.db.exec(`ALTER TABLE ${table} RENAME TO legacy_usdc_${table}`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS payment_rails(rail_id TEXT PRIMARY KEY,chain TEXT NOT NULL CHECK(chain IN ('solana','bsc','polygon','tron')),network TEXT NOT NULL CHECK(network='mainnet'),
        asset TEXT NOT NULL CHECK(asset='USDT'),mint TEXT NOT NULL,decimals INTEGER NOT NULL CHECK(decimals IN (6,18)),recipient_address TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('ENABLED','DISABLED')),
        config_revision INTEGER NOT NULL,rpc_id TEXT NOT NULL,start_block INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS rail_events(id INTEGER PRIMARY KEY,rail_id TEXT NOT NULL,revision INTEGER NOT NULL,old_hash TEXT,new_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS payment_invoices(invoice_id TEXT PRIMARY KEY,world_id TEXT NOT NULL,qianji_id TEXT NOT NULL,order_id TEXT,
          rail_id TEXT NOT NULL REFERENCES payment_rails(rail_id),rail_revision INTEGER NOT NULL,chain TEXT NOT NULL,network TEXT NOT NULL,mint TEXT NOT NULL,recipient_address TEXT NOT NULL,
          asset TEXT NOT NULL CHECK(asset='USDT'),quoted_amount TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,reference TEXT NOT NULL UNIQUE,memo TEXT,
          qr_payload TEXT NOT NULL,wallet_url TEXT,status TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,paid_at INTEGER,cancelled_at INTEGER,
          start_block INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL);
        CREATE UNIQUE INDEX IF NOT EXISTS permanent_invoice_amount ON payment_invoices(chain,network,mint,recipient_address,amount_atomic) WHERE chain!='solana';
        CREATE TABLE IF NOT EXISTS payment_observations(chain TEXT NOT NULL,network TEXT NOT NULL,signature TEXT NOT NULL,invoice_id TEXT NOT NULL REFERENCES payment_invoices(invoice_id),slot INTEGER,
          commitment TEXT NOT NULL,status TEXT NOT NULL,raw_hash TEXT NOT NULL,reason TEXT,first_seen_at INTEGER NOT NULL,finalized_at INTEGER,PRIMARY KEY(chain,network,signature,invoice_id));
        CREATE TABLE IF NOT EXISTS payment_receipts(id TEXT PRIMARY KEY,chain TEXT NOT NULL,network TEXT NOT NULL,signature TEXT NOT NULL,transfer_index INTEGER NOT NULL,
          invoice_id TEXT NOT NULL UNIQUE REFERENCES payment_invoices(invoice_id),world_id TEXT NOT NULL,qianji_id TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,
          source TEXT NOT NULL CHECK(source='chain_finalized'),generation_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(chain,network,signature,transfer_index));
        CREATE TABLE IF NOT EXISTS world_revenue_events(receipt_id TEXT PRIMARY KEY REFERENCES payment_receipts(id),world_id TEXT NOT NULL,chain TEXT NOT NULL,network TEXT NOT NULL,asset TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS payment_outbox(receipt_id TEXT PRIMARY KEY REFERENCES payment_receipts(id),delivered INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS payment_scan_cursors(invoice_id TEXT PRIMARY KEY REFERENCES payment_invoices(invoice_id),last_seen_signature TEXT,backfill_before TEXT,target_head TEXT,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS payment_chain_cursors(scope_key TEXT PRIMARY KEY,next_block INTEGER,last_timestamp INTEGER,fingerprint TEXT,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS payment_unmatched(chain TEXT NOT NULL,network TEXT NOT NULL,signature TEXT NOT NULL,transfer_index INTEGER NOT NULL,rail_id TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,raw_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(chain,network,signature,transfer_index));PRAGMA user_version=2;`);
    });
  }
  close(){this.db.close();}
  rails(){return this.db.prepare('SELECT * FROM payment_rails ORDER BY created_at').all();}
  legacy(){return this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='legacy_usdc_payment_receipts'").get()?{asset:'USDC',archived:true,receipts:this.db.prepare('SELECT COUNT(*) n FROM legacy_usdc_payment_receipts').get()!.n}:null;}
  configureRail(input:Record<string,any>,startBlock=0){
    only(input,['rail_id','chain','network','recipient_address','status','expected_revision','rpc_id']);lifeId(input.rail_id);const chain=paymentChain(input.chain),token=USDT_CHAINS[chain];
    if(input.network!=='mainnet'||!['ENABLED','DISABLED'].includes(input.status)||input.rpc_id!==`${chain}-mainnet`||!Number.isSafeInteger(startBlock)||startBlock<0)throw Error('PAYMENT_RAIL_CONFIG_INVALID');
    const recipient=recipientAddress(chain,input.recipient_address),old=this.db.prepare('SELECT * FROM payment_rails WHERE rail_id=?').get(input.rail_id);
    if(old&&(old.chain!==chain||old.network!==input.network))throw Error('PAYMENT_RAIL_CHAIN_IMMUTABLE');
    if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision!==(old?.config_revision??0))throw Error('PAYMENT_RAIL_REVISION_CONFLICT');
    const revision=input.expected_revision+1,now=Date.now();this.db.transaction(()=>{
      this.db.prepare(`INSERT INTO payment_rails VALUES(?,?,?,'USDT',?,?,?,?,?,?,?,?,?) ON CONFLICT(rail_id) DO UPDATE SET recipient_address=excluded.recipient_address,
        status=excluded.status,config_revision=excluded.config_revision,start_block=excluded.start_block,updated_at=excluded.updated_at`)
        .run(input.rail_id,chain,input.network,token.contract,token.decimals,recipient,input.status,revision,input.rpc_id,startBlock,now,now);
      this.db.prepare('INSERT INTO rail_events(rail_id,revision,old_hash,new_hash,created_at) VALUES(?,?,?,?,?)').run(input.rail_id,revision,old?sha(String(old.recipient_address)):null,sha(recipient),now);
    });
    this.lineage.lifeEvent(String(this.lineage.activeGeneration()!.id),'payment_rail_owner_changed',{railId:input.rail_id,chain,revision,newAddressHash:sha(recipient)},`rail:${input.rail_id}:${revision}`);
    return this.db.prepare('SELECT * FROM payment_rails WHERE rail_id=?').get(input.rail_id)!;
  }
  invoice(id:string):Invoice{lifeId(id);const row=this.db.prepare('SELECT * FROM payment_invoices WHERE invoice_id=?').get(id);if(!row)throw Error('PAYMENT_INVOICE_NOT_FOUND');return row as Invoice;}
  createInvoice(input:Record<string,any>,fixedWorldId?:string){
    only(input,['qianji_id','rail_id','amount','expires_at','idempotency_key']);lifeId(input.idempotency_key);
    const world=this.control.worldForQianji(input.qianji_id);if(world.status!=='ACTIVE'||fixedWorldId&&world.world_id!==fixedWorldId)throw Error('INVOICE_WORLD_SCOPE_DENIED');
    const quote=quotedAmount(input.amount),expires=input.expires_at??Date.now()+86400000,requestKey=`${world.world_id}:${input.idempotency_key}`,requestHash=sha({worldId:world.world_id,railId:input.rail_id,amount:quote,expiresAt:input.expires_at??null});
    const old=this.db.prepare('SELECT invoice_id,request_hash FROM payment_invoices WHERE request_key=?').get(requestKey);if(old){if(old.request_hash!==requestHash)throw Error('INVOICE_IDEMPOTENCY_CONFLICT');return this.invoice(String(old.invoice_id));}
    const rail=this.db.prepare("SELECT * FROM payment_rails WHERE rail_id=? AND status='ENABLED'").get(input.rail_id);if(!rail)throw Error('PAYMENT_RAIL_NOT_ENABLED');
    if(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+30*86400000)throw Error('INVOICE_EXPIRY_INVALID');
    const chain=paymentChain(rail.chain),decimals=Number(rail.decimals),base=BigInt(chainAmount(quote,decimals));
    return this.db.transaction(()=>{
      let amount=base;if(chain!=='solana'){
        const unit=10n**BigInt(decimals-6);let found=false;
        for(let tail=1;tail<=9999;tail++){amount=base+BigInt(tail)*unit;if(!this.db.prepare('SELECT 1 FROM payment_invoices WHERE chain=? AND network=? AND mint=? AND recipient_address=? AND amount_atomic=?').get(chain,rail.network,rail.mint,rail.recipient_address,amount.toString())){found=true;break;}}
        if(!found)throw Error('PAYMENT_UNIQUE_AMOUNT_CAPACITY_REACHED');
      }
      const id=`invoice_${randomUUID()}`,reference=chain==='solana'?paymentReference():`amount_${randomUUID()}`;
      const payload=chain==='solana'?{qrPayload:solanaPayUrl(String(rail.recipient_address),String(rail.mint),reference,amount.toString(),id),walletUrl:solanaPayUrl(String(rail.recipient_address),String(rail.mint),reference,amount.toString(),id)}:paymentPayload(chain,String(rail.recipient_address),amount.toString());
      this.db.prepare(`INSERT INTO payment_invoices VALUES(?,?,?,NULL,?,?,?,?,?,?,'USDT',?,?,?,?,?,?,?,'WAITING',?,?,NULL,NULL,?,?,?)`)
        .run(id,world.world_id,world.qianji_id,rail.rail_id,rail.config_revision,chain,rail.network,rail.mint,rail.recipient_address,quote,amount.toString(),decimals,reference,chain==='solana'?id:null,payload.qrPayload,payload.walletUrl,expires,Date.now(),rail.start_block,requestKey,requestHash);
      return this.invoice(id);
    });
  }
  pending(){return this.db.prepare("SELECT * FROM payment_invoices WHERE status IN ('WAITING','OBSERVED','EXPIRED','REVIEW_REQUIRED','CANCELLED') ORDER BY created_at").all() as Invoice[];}
  observe(id:string,signature:string,commitment:'confirmed'|'finalized',transaction:any){
    if(!['confirmed','finalized'].includes(commitment))throw Error('PAYMENT_COMMITMENT_REQUIRED');const invoice=this.invoice(id);
    let verified:{slot:number;paidAt:number|null;transferIndex?:number}|undefined,reason:string|undefined;
    try{verified=invoice.chain==='solana'?verifySolanaPayment(invoice,signature,transaction,this.db.prepare("SELECT reference FROM payment_invoices WHERE chain='solana'").all().map(r=>String(r.reference))):verifyTokenPayment(invoice,signature,commitment,transaction);}
    catch(error){reason=error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'PAYMENT_WIRE_DATA_INVALID';}
    const raw=sha(transaction),now=Date.now();if(reason){this.db.prepare(`INSERT INTO payment_observations VALUES(?,?,?,?,NULL,?,'REJECTED',?,?,?,NULL) ON CONFLICT(chain,network,signature,invoice_id) DO UPDATE SET reason=excluded.reason,raw_hash=excluded.raw_hash`)
      .run(invoice.chain,invoice.network,signature,id,commitment,raw,reason,now);return {status:'REJECTED',reason};}
    const paidAt=verified!.paidAt,index=verified!.transferIndex??0;
    const review=Boolean(invoice.cancelled_at)||invoice.status==='CANCELLED'||paidAt===null||paidAt>invoice.expires_at||paidAt<invoice.created_at-1500;
    return this.db.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM payment_receipts WHERE chain=? AND network=? AND signature=? AND transfer_index=?').get(invoice.chain,invoice.network,signature,index);
      if(old){if(old.invoice_id!==id)throw Error('PAYMENT_SIGNATURE_ALREADY_ATTRIBUTED');return {status:'FINALIZED',receipt:old};}
      if(invoice.status==='FINALIZED')return {status:'DUPLICATE_PAYMENT_REVIEW_REQUIRED'};
      const status=review?'REVIEW_REQUIRED':commitment==='finalized'?'FINALIZED':'OBSERVED';
      this.db.prepare(`INSERT INTO payment_observations VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chain,network,signature,invoice_id) DO UPDATE SET commitment=excluded.commitment,status=excluded.status,raw_hash=excluded.raw_hash,finalized_at=excluded.finalized_at`)
        .run(invoice.chain,invoice.network,signature,id,verified!.slot,commitment,status,raw,review?'LATE_CANCELLED_OR_UNDATED':null,now,commitment==='finalized'?now:null);
      this.db.prepare('UPDATE payment_invoices SET status=? WHERE invoice_id=?').run(status,id);if(status!=='FINALIZED')return {status};
      const receiptId=`receipt_${sha(`${invoice.chain}:${invoice.network}:${signature}:${index}`).slice(0,32)}`;
      this.db.prepare("INSERT INTO payment_receipts VALUES(?,?,?,?,?,?,?,?,?,?,'chain_finalized',?,?)").run(receiptId,invoice.chain,invoice.network,signature,index,id,invoice.world_id,invoice.qianji_id,invoice.amount_atomic,invoice.decimals,String(this.lineage.activeGeneration()!.id),now);
      this.db.prepare("INSERT INTO world_revenue_events VALUES(?,?,?,?,'USDT',?,?,?)").run(receiptId,invoice.world_id,invoice.chain,invoice.network,invoice.amount_atomic,invoice.decimals,now);
      this.db.prepare('INSERT INTO payment_outbox VALUES(?,0)').run(receiptId);this.db.prepare('DELETE FROM payment_unmatched WHERE chain=? AND network=? AND signature=? AND transfer_index=?').run(invoice.chain,invoice.network,signature,index);
      this.db.prepare('UPDATE payment_invoices SET paid_at=? WHERE invoice_id=?').run(paidAt,id);return {status,receiptId};
    });
  }
  deliverMemories(){for(const row of this.db.prepare('SELECT r.* FROM payment_receipts r JOIN payment_outbox o ON o.receipt_id=r.id WHERE o.delivered=0').all()){
    const generation=String(row.generation_id);this.lineage.remember(generation,'business_outcome',{point:`${row.chain} 链上实际收款 ${tokenAmount(String(row.amount_atomic),Number(row.decimals))} USDT`,reason:`链上 finalized 验证通过：${row.signature}`,
      effect:`归属 World ${row.world_id}；收款事实与原代谱系保留`},`chain-payment-memory:${row.id}`,undefined,4,'chain_finalized',String(row.world_id));
    this.lineage.lifeEvent(generation,'chain_payment_finalized',{receiptId:row.id,worldId:row.world_id,chain:row.chain,network:row.network,asset:'USDT',amountAtomic:row.amount_atomic,decimals:row.decimals},`chain-payment:${row.id}`,undefined,String(row.world_id));
    this.db.prepare('UPDATE payment_outbox SET delivered=1 WHERE receipt_id=?').run(row.id);
  }}
  revenue(worldId:string){this.control.world(worldId);const rows=this.db.prepare('SELECT chain,network,amount_atomic,decimals FROM world_revenue_events WHERE world_id=?').all(worldId);
    return {worldId,asset:'USDT',decimals:6,mainnetAtomic:rows.reduce((n,r)=>n+BigInt(String(r.amount_atomic))/10n**BigInt(Number(r.decimals)-6),0n).toString(),
      byChain:Object.keys(USDT_CHAINS).map(chain=>({chain,decimals:USDT_CHAINS[chain as PaymentChain].decimals,amount_atomic:rows.filter(r=>r.chain===chain).reduce((n,r)=>n+BigInt(String(r.amount_atomic)),0n).toString()}))};}
}
