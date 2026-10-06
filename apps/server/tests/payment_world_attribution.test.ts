import {afterEach,describe,it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Keypair,PublicKey} from '@solana/web3.js';
import {getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID} from '@solana/spl-token';
import {LineageStore,WorldRegistryStore,writeGenerationPointer} from '@emergentinc/persistence';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {PaymentService} from '../src/services/payment_service.js';
import {PaymentMonitor,PaymentRpc} from '../src/services/payment_monitor.js';
import {amountAtomic,base58Encode,SOLANA_USDT} from '../src/services/solana_payment.js';
const cleanup:(()=>void)[]=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn();});
function fixture(){const root=fs.mkdtempSync(join(tmpdir(),'payment-v23-')),lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
  lineage.createGeneration({id:'G0001',number:1,geneHash:'1'.repeat(64),releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(root,'system'),'G0001');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3')),registry=new WorldRegistryService(root,control,lineage,'1');
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B')),file=join(root,'system/payment/payment.sqlite3');let service=new PaymentService(file,control,lineage);
  const recipient=Keypair.generate().publicKey.toBase58();service.configureRail({rail_id:'rail',chain:'solana',network:'mainnet',recipient_address:recipient,status:'ENABLED',expected_revision:0,rpc_id:'solana-mainnet'});
  const ia=service.createInvoice({qianji_id:a.qianji_id,rail_id:'rail',amount:'10',idempotency_key:'a'}),ib=service.createInvoice({qianji_id:b.qianji_id,rail_id:'rail',amount:'10',idempotency_key:'b'});
  cleanup.push(()=>{service.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,control,lineage,a,b,ia,ib,recipient,service:()=>service,reopen:()=>{service.close();service=new PaymentService(file,control,lineage);return service;}};
}
function transaction(invoice:any){const payer=Keypair.generate().publicKey.toBase58(),source=Keypair.generate().publicKey.toBase58(),signature=base58Encode(Buffer.alloc(64,42));
  const destination=getAssociatedTokenAddressSync(new PublicKey(invoice.mint),new PublicKey(invoice.recipient_address),true).toBase58();
  const data=Buffer.alloc(10);data[0]=12;data.writeBigUInt64LE(BigInt(invoice.amount_atomic),1);data[9]=6;
  const balance=(index:number,owner:string,amount:string)=>({accountIndex:index,owner,mint:invoice.mint,uiTokenAmount:{amount,decimals:6}});
  return {slot:123,blockTime:Math.floor(Date.now()/1000),transaction:{signatures:[signature],message:{header:{numRequiredSignatures:1,numReadonlySignedAccounts:0,numReadonlyUnsignedAccounts:4},
    accountKeys:[payer,source,destination,invoice.mint,TOKEN_PROGRAM_ID.toBase58(),'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',invoice.reference],
    instructions:[{programIdIndex:5,accounts:[],data:base58Encode(Buffer.from(invoice.memo))},{programIdIndex:4,accounts:[1,3,2,0,6],data:base58Encode(data)}]}},
    meta:{err:null,preTokenBalances:[balance(1,payer,'500000000'),balance(2,invoice.recipient_address,'1000000')],postTokenBalances:[balance(1,payer,(500000000n-BigInt(invoice.amount_atomic)).toString()),balance(2,invoice.recipient_address,(1000000n+BigInt(invoice.amount_atomic)).toString())]}};
}
describe('Solana transfer attribution and financial boundaries',()=>{
  it('keeps cancelled and late transfers in review across rechecks and never recognizes revenue',()=>{
    const f=fixture(),tx=transaction(f.ia),sig=tx.transaction.signatures[0]!;
    f.service().db.prepare("UPDATE payment_invoices SET status='CANCELLED',cancelled_at=? WHERE invoice_id=?").run(Date.now(),f.ia.invoice_id);
    expect(f.service().observe(f.ia.invoice_id,sig,'confirmed',tx).status).toBe('REVIEW_REQUIRED');
    expect(f.reopen().observe(f.ia.invoice_id,sig,'finalized',tx).status).toBe('REVIEW_REQUIRED');
    expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
    const late=transaction(f.ib);f.service().db.prepare('UPDATE payment_invoices SET expires_at=? WHERE invoice_id=?').run(Date.now()-3000,f.ib.invoice_id);
    expect(f.service().observe(f.ib.invoice_id,late.transaction.signatures[0]!,'finalized',late).status).toBe('REVIEW_REQUIRED');
    expect(f.service().revenue(f.b.world_id).mainnetAtomic).toBe('0');
  });
  it('replays a lost outbox acknowledgement after a generation change with original receipt provenance',()=>{
    const f=fixture(),tx=transaction(f.ia),sig=tx.transaction.signatures[0]!;f.service().observe(f.ia.invoice_id,sig,'finalized',tx);f.service().deliverMemories();
    f.service().db.prepare('UPDATE payment_outbox SET delivered=0').run();
    f.lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();f.lineage.createGeneration({id:'G0002',number:2,parentId:'G0001',geneHash:'2'.repeat(64),releaseId:'r2',state:'ACTIVE'});
    f.reopen().deliverMemories();expect(f.lineage.relevantMemories({worldId:f.a.world_id,kind:'business_outcome'})).toHaveLength(1);
    expect(f.lineage.db.prepare("SELECT generation_id FROM memories WHERE source='chain_finalized'").get()!.generation_id).toBe('G0001');
  });
  it('persists a paginated backfill beyond 500 signatures and resumes without skipping the valid transfer',async()=>{
    const f=fixture(),tx=transaction(f.ia),sig=tx.transaction.signatures[0]!;
    const rows=Array.from({length:600},(_,index)=>{const bytes=Buffer.alloc(64);bytes.writeUInt32LE(index+1);return {signature:index===599?sig:base58Encode(bytes),err:index===599?null:{failed:true}};});
    const rpc:PaymentRpc={async call(_network,method,params:any[]){
      if(method==='getSignaturesForAddress'){const offset=params[1].before?rows.findIndex(r=>r.signature===params[1].before)+1:0;return rows.slice(offset,offset+params[1].limit);}
      if(method==='getSignatureStatuses')return {value:[{confirmationStatus:'finalized',err:null}]};if(method==='getTransaction')return tx;throw new Error('unexpected');}};
    await new PaymentMonitor(f.service(),rpc).scanInvoice(f.ia.invoice_id);expect(f.service().invoice(f.ia.invoice_id).status).toBe('WAITING');
    expect(f.service().db.prepare('SELECT backfill_before FROM payment_scan_cursors WHERE invoice_id=?').get(f.ia.invoice_id)!.backfill_before).toBe(rows[499]!.signature);
    await new PaymentMonitor(f.reopen(),rpc).scanInvoice(f.ia.invoice_id);expect(f.service().invoice(f.ia.invoice_id).status).toBe('FINALIZED');
    expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('10000000');
  });
  it('uses unique reference for same-amount invoices and credits only one World after finalized, once across restarts',()=>{
    const f=fixture(),tx=transaction(f.ia),sig=tx.transaction.signatures[0]!;
    expect(f.ia.reference).not.toBe(f.ib.reference);expect(f.ia.qr_payload).toContain('spl-token='+SOLANA_USDT.mainnet);
    expect(f.service().observe(f.ia.invoice_id,sig,'confirmed',tx).status).toBe('OBSERVED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
    expect(f.service().observe(f.ib.invoice_id,sig,'finalized',tx).status).toBe('REJECTED');
    expect(f.service().observe(f.ia.invoice_id,sig,'finalized',tx).status).toBe('FINALIZED');f.service().deliverMemories();
    const restarted=f.reopen();restarted.observe(f.ia.invoice_id,sig,'finalized',tx);restarted.deliverMemories();
    expect(restarted.revenue(f.a.world_id)).toMatchObject({asset:'USDT',mainnetAtomic:'10000000'});expect(restarted.revenue(f.b.world_id).mainnetAtomic).toBe('0');
    expect(restarted.db.prepare('SELECT COUNT(*) n FROM payment_receipts').get()!.n).toBe(1);
    expect(f.lineage.relevantMemories({worldId:f.a.world_id,kind:'business_outcome'})).toHaveLength(1);expect(f.lineage.relevantMemories({worldId:f.b.world_id,kind:'business_outcome'})).toHaveLength(0);
  });
  it.each(['wrongMint','wrongRecipient','wrongAmount','wrongReference','ambiguousReference','failed','selfTransfer','missingMemo'])('rejects %s without claiming income',kind=>{
    const f=fixture(),tx:any=transaction(f.ia),sig=tx.transaction.signatures[0];
    if(kind==='wrongMint')tx.meta.postTokenBalances[1].mint=f.recipient;
    if(kind==='wrongRecipient')tx.transaction.message.accountKeys[2]=f.recipient;
    if(kind==='wrongAmount')tx.meta.postTokenBalances[1].uiTokenAmount.amount='1';
    if(kind==='wrongReference')tx.transaction.message.accountKeys[6]=f.ib.reference;
    if(kind==='ambiguousReference'){tx.transaction.message.accountKeys.push(f.ib.reference);tx.transaction.message.header.numReadonlyUnsignedAccounts++;}
    if(kind==='failed')tx.meta.err={InstructionError:[0,'failure']};if(kind==='selfTransfer')tx.meta.preTokenBalances[0].owner=f.recipient;
    if(kind==='missingMemo')tx.transaction.message.instructions[0].data=base58Encode(Buffer.from('different'));
    expect(f.service().observe(f.ia.invoice_id,sig,'finalized',tx).status).toBe('REJECTED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
  });
  it('pins invoice wallet/mint revision, rejects secrets and forged scope, and keeps exact atomic decimal amounts',()=>{
    const f=fixture();expect(amountAtomic('123.456789')).toBe('123456789');expect(()=>amountAtomic('1e2')).toThrow();expect(()=>amountAtomic(10)).toThrow();
    expect(()=>f.service().configureRail({rail_id:'bad',chain:'solana',network:'mainnet',recipient_address:f.recipient,status:'ENABLED',expected_revision:0,rpc_id:'solana-mainnet',private_key:'must-never-store'})).toThrow('UNEXPECTED_FIELD');
    f.service().configureRail({rail_id:'rail',chain:'solana',network:'mainnet',recipient_address:Keypair.generate().publicKey.toBase58(),status:'DISABLED',expected_revision:1,rpc_id:'solana-mainnet'});
    expect(f.service().invoice(f.ia.invoice_id).recipient_address).toBe(f.recipient);
    expect(f.service().createInvoice({qianji_id:f.a.qianji_id,rail_id:'rail',amount:'10',idempotency_key:'a'}).invoice_id).toBe(f.ia.invoice_id);
    expect(()=>f.service().createInvoice({qianji_id:f.b.qianji_id,rail_id:'rail',amount:'10',idempotency_key:'x'},f.a.world_id)).toThrow('WORLD_SCOPE');
  });
  it('backfills confirmed observations after Monitor restart and waits for finalized without duplicate credit',async()=>{
    const f=fixture(),tx=transaction(f.ia),sig=tx.transaction.signatures[0]!;let final=false;
    const rpc:PaymentRpc={async call(_network,method,params:any[]){
      if(method==='getSignaturesForAddress')return params[0]===f.ia.reference&&!params[1].until?[{signature:sig,err:null}]:[];
      if(method==='getSignatureStatuses')return {value:[{confirmationStatus:final?'finalized':'confirmed',err:null}]};
      if(method==='getTransaction')return tx;throw new Error('unexpected method');
    }};
    await new PaymentMonitor(f.service(),rpc).scanAll();expect(f.service().invoice(f.ia.invoice_id).status).toBe('OBSERVED');
    final=true;await new PaymentMonitor(f.reopen(),rpc).scanAll();expect(f.service().invoice(f.ia.invoice_id).status).toBe('FINALIZED');
    await new PaymentMonitor(f.service(),rpc).scanAll();expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('10000000');
  });
});
