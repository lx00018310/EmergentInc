import {afterEach,describe,it,expect,vi} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {LineageStore,WorldRegistryStore,writeGenerationPointer} from '@emergentinc/persistence';
import {PaymentService} from '../src/services/payment_service.js';
import {PaymentMonitor,PaymentRpc} from '../src/services/payment_monitor.js';
import {MultiChainRpc} from '../src/services/payment_rpc.js';
import {PaymentChain,USDT_CHAINS,TRANSFER_TOPIC,TRON_GENESIS,tronAddress,tronHex,recipientAddress} from '../src/services/payment_assets.js';
const clean:(()=>void)[]=[];afterEach(()=>{vi.unstubAllGlobals();for(const fn of clean.splice(0).reverse())fn();});
function fixture(chain:PaymentChain='bsc'){
  const root=fs.mkdtempSync(join(tmpdir(),'usdt-four-')),lineage=new LineageStore(join(root,'system/lineage/lineage.sqlite3'),{v23:true});
  lineage.createGeneration({id:'G0001',number:1,geneHash:'1'.repeat(64),releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(root,'system'),'G0001');
  const control=new WorldRegistryStore(join(root,'system/control/control.sqlite3'));
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  // Payments depend on real control/Lineage relations, not a scheduler or two extra Core/Current databases.
  const make=(name:string)=>{const qianji_id='qj_'+name,world_id='world_'+name;control.qianji.createProfile({qianjiId:qianji_id,narrative:narrative(name),careerStatus:'active'});
    control.insertWorld({world_id,qianji_id,status:'ACTIVE',workspace_relpath:'worlds/'+world_id,gateway_pixel_id:null,created_at:Date.now(),archived_at:null});return control.world(world_id);};
  const a=make('A'),b=make('B'),file=join(root,'system/payment/payment.sqlite3');let service=new PaymentService(file,control,lineage);
  const address=chain==='tron'?tronAddress('12'.repeat(20)):'0x'+'12'.repeat(20);
  const configure=(which:PaymentChain,id:string=which)=>service.configureRail({rail_id:id,chain:which,network:'mainnet',recipient_address:which==='tron'?tronAddress('12'.repeat(20)):address,status:'ENABLED',expected_revision:0,rpc_id:which+'-mainnet'},100);
  configure(chain);
  const invoice=(key:string,world=a,which=chain)=>service.createInvoice({qianji_id:world.qianji_id,rail_id:which,amount:'10',idempotency_key:key});
  const ia=invoice('a'),ib=invoice('b',b);
  clean.push(()=>{service.close();control.close();lineage.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
  return {root,a,b,lineage,control,ia,ib,invoice,configure,service:()=>service,reopen:()=>{service.close();service=new PaymentService(file,control,lineage);return service;}};
}
function evidence(invoice:any,signature=(invoice.chain==='tron'?'':'0x')+'ab'.repeat(32)):any{
  const slot=100,stamp=Date.now(),blockHash='0x'+'cc'.repeat(32),recipient=invoice.chain==='tron'?tronHex(invoice.recipient_address):invoice.recipient_address.slice(2);
  const log={address:invoice.chain==='tron'?tronHex(invoice.mint):invoice.mint,topics:[invoice.chain==='tron'?TRANSFER_TOPIC.slice(2):TRANSFER_TOPIC,
    (invoice.chain==='tron'?'':'0x')+'0'.repeat(24)+'34'.repeat(20),(invoice.chain==='tron'?'':'0x')+'0'.repeat(24)+recipient],
    data:(invoice.chain==='tron'?'':'0x')+BigInt(invoice.amount_atomic).toString(16).padStart(64,'0'),logIndex:'0x0',transactionHash:signature,blockHash,blockNumber:'0x64',removed:false};
  if(invoice.chain==='tron')return {genesis:TRON_GENESIS,info:{id:signature,receipt:{result:'SUCCESS'},blockNumber:slot,blockTimeStamp:stamp,log:[log]},block:{block_header:{raw_data:{number:slot,timestamp:stamp}},transactions:[{txID:signature}]},solidHead:{block_header:{raw_data:{number:slot}}}};
  return {chainId:USDT_CHAINS[invoice.chain as PaymentChain].chainId,receipt:{status:'0x1',transactionHash:signature,blockHash,blockNumber:'0x64',logs:[log]},
    block:{number:'0x64',hash:blockHash,timestamp:'0x'+Math.floor(stamp/1000).toString(16)},finalizedHead:{number:'0x64'}};
}
describe('four-chain USDT without private keys or guessed invoice ownership',()=>{
  it.each(['bsc','polygon','tron'] as const)('reserves exact permanent tails on %s across cancellation, restarts, aliases and other Worlds',chain=>{
    const f=fixture(chain);expect(f.ia.amount_atomic).not.toBe(f.ib.amount_atomic);expect(f.ia.quoted_amount).toBe('10.000000');
    expect(f.ia.amount_atomic).toBe(chain==='bsc'?'10000001000000000000':'10000001');
    expect(f.ia.qr_payload).toContain(chain==='tron'?f.ia.recipient_address:'ethereum:');
    f.service().db.prepare("UPDATE payment_invoices SET status='CANCELLED',cancelled_at=? WHERE invoice_id=?").run(Date.now(),f.ia.invoice_id);f.reopen();
    expect(f.invoice('c').amount_atomic).not.toBe(f.ia.amount_atomic);f.configure(chain,'alias');
    const alias=f.service().createInvoice({qianji_id:f.b.qianji_id,rail_id:'alias',amount:'10',idempotency_key:'alias'});expect(alias.amount_atomic).not.toBe(f.ib.amount_atomic);
    const tx=evidence(f.ia),signature=chain==='tron'?tx.info!.id:tx.receipt!.transactionHash;
    expect(f.service().observe(f.ia.invoice_id,signature,'finalized',tx).status).toBe('REVIEW_REQUIRED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
  });
  it.each(['bsc','polygon','tron'] as const)('credits only exact %s transfer to its owning World once, and preserves originating generation',chain=>{
    const f=fixture(chain),tx=evidence(f.ia),signature=chain==='tron'?tx.info!.id:tx.receipt!.transactionHash;
    expect(f.service().observe(f.ib.invoice_id,signature,'finalized',tx).status).toBe('REJECTED');
    expect(f.service().observe(f.ia.invoice_id,signature,'finalized',tx).status).toBe('FINALIZED');f.service().deliverMemories();
    expect(f.reopen().observe(f.ia.invoice_id,signature,'finalized',tx).status).toBe('FINALIZED');
    expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('10000001');expect(f.service().revenue(f.b.world_id).mainnetAtomic).toBe('0');
    f.service().db.prepare('UPDATE payment_outbox SET delivered=0').run();f.lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();
    f.lineage.createGeneration({id:'G0002',number:2,parentId:'G0001',geneHash:'2'.repeat(64),releaseId:'r2',state:'ACTIVE'});f.service().deliverMemories();
    expect(f.lineage.relevantMemories({worldId:f.a.world_id,kind:'business_outcome'})).toHaveLength(1);expect(f.lineage.relevantMemories({worldId:f.a.world_id})[0]!.generation_id).toBe('G0001');
  });
  it.each(['wrongChain','wrongToken','wrongRecipient','wrongAmount','notFinalized','reorg','failed','selfTransfer','mint','ambiguous'] as const)('rejects EVM %s without recognizing income',kind=>{
    const f=fixture(),tx:any=evidence(f.ia),log=tx.receipt.logs[0];
    if(kind==='wrongChain')tx.chainId=137;if(kind==='wrongToken')log.address='0x'+'ff'.repeat(20);if(kind==='wrongRecipient')log.topics[2]='0x'+'0'.repeat(24)+'ef'.repeat(20);
    if(kind==='wrongAmount')log.data='0x'+'0'.repeat(63)+'1';if(kind==='notFinalized')tx.finalizedHead.number='0x63';if(kind==='reorg')tx.block.hash='0x'+'dd'.repeat(32);
    if(kind==='failed')tx.receipt.status='0x0';if(kind==='selfTransfer')log.topics[1]=log.topics[2];if(kind==='mint')log.topics[1]='0x'+'0'.repeat(64);if(kind==='ambiguous')tx.receipt.logs.push({...log,logIndex:'0x1'});
    expect(f.service().observe(f.ia.invoice_id,tx.receipt.transactionHash,'finalized',tx).status).toBe('REJECTED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
  });
  it('separates identical EVM transaction hashes by chain and normalizes BSC 18 decimals exactly',()=>{
    const f=fixture();f.configure('polygon');const poly=f.invoice('poly',f.a,'polygon'),bsc=evidence(f.ia),polygon=evidence(poly);
    expect(f.service().observe(f.ia.invoice_id,bsc.receipt!.transactionHash,'finalized',bsc).status).toBe('FINALIZED');
    expect(f.service().observe(poly.invoice_id,polygon.receipt!.transactionHash,'finalized',polygon).status).toBe('FINALIZED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('20000002');
  });
  it('backfills EVM finalized logs with a persistent bounded cursor and verifies receipts before credit',async()=>{
    const f=fixture(),tx=evidence(f.ia);let calls=0;
    const rpc:PaymentRpc={async call(_network,method,params){if(method==='eth_getBlockByNumber')return params[0]==='finalized'?tx.finalizedHead:tx.block;
      if(method==='eth_getLogs'){calls++;return tx.receipt!.logs;}if(method==='eth_getTransactionReceipt')return tx.receipt;throw Error('unexpected');}};
    await new PaymentMonitor(f.service(),rpc).scanInvoice(f.ia.invoice_id);expect(f.service().invoice(f.ia.invoice_id).status).toBe('FINALIZED');
    await new PaymentMonitor(f.reopen(),rpc).scanAll();expect(calls).toBe(1);expect(f.service().db.prepare('SELECT next_block FROM payment_chain_cursors').get()!.next_block).toBe(101);
    expect(f.lineage.relevantMemories({worldId:f.a.world_id,kind:'business_outcome'})).toHaveLength(1);
  });
  it('replays TRON history after restarts using actual solidity info and persists pagination',async()=>{
    const f=fixture('tron'),tx=evidence(f.ia);let page=0;
    const rpc:PaymentRpc={async call(_network,method){if(method==='tron_head')return tx.solidHead;if(method==='tron_info')return tx.info;if(method==='tron_block')return tx.block;
      if(method==='tron_transfers'){page++;return {success:true,data:page===1?[{transaction_id:tx.info!.id,to:f.ia.recipient_address,type:'Transfer',value:f.ia.amount_atomic,token_info:{address:f.ia.mint,decimals:6}}]:[],meta:page===1?{fingerprint:'next'}:{}};}throw Error('unexpected');}};
    await new PaymentMonitor(f.service(),rpc).scanInvoice(f.ia.invoice_id);await new PaymentMonitor(f.reopen(),rpc).scanAll();
    expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('10000001');expect(f.service().db.prepare('SELECT COUNT(*) n FROM payment_receipts').get()!.n).toBe(1);
  });
  it('rejects private material, incorrect network, contract recipient and invalid address checksums',()=>{
    const f=fixture();expect(()=>f.configure('solana')).toThrow();expect(()=>recipientAddress('bsc',USDT_CHAINS.bsc.contract)).toThrow('TOKEN_CONTRACT');
    expect(()=>recipientAddress('tron',tronAddress('12'.repeat(20)).slice(0,-1)+'0')).toThrow();expect(()=>recipientAddress('bsc','0x52908400098527886E0F7030069857D2E4169Ee7')).toThrow('CHECKSUM');
    expect(()=>f.service().configureRail({rail_id:'bad',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet',private_key:'never'})).toThrow('UNEXPECTED_FIELD');
    expect(()=>f.service().configureRail({rail_id:'bad',chain:'bsc',network:'devnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'})).toThrow('CONFIG_INVALID');
  });
  it('pins RPC chain identity and refuses another network before requesting transactions',async()=>{
    const methods:string[]=[];vi.stubGlobal('fetch',async(_url:any,init:any)=>{const req=JSON.parse(init.body);methods.push(req.method);return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x89'}));});
    await expect(new MultiChainRpc().call('mainnet','eth_getLogs',[],'bsc')).rejects.toThrow('NETWORK_MISMATCH');expect(methods).toEqual(['eth_chainId']);
  });
  it.each(['wrongGenesis','wrongContract','wrongRecipient','wrongAmount','notSolid','wrongBlock','failed','selfTransfer'] as const)('rejects TRON %s without credit',kind=>{
    const f=fixture('tron'),tx=evidence(f.ia),log=tx.info.log[0];if(kind==='wrongGenesis')tx.genesis='bad';if(kind==='wrongContract')log.address='ef'.repeat(20);
    if(kind==='wrongRecipient')log.topics[2]='0'.repeat(24)+'ef'.repeat(20);if(kind==='wrongAmount')log.data='0'.repeat(63)+'1';
    if(kind==='notSolid')tx.solidHead.block_header.raw_data.number=99;if(kind==='wrongBlock')tx.block.transactions=[];if(kind==='failed')tx.info.receipt.result='FAILED';if(kind==='selfTransfer')log.topics[1]=log.topics[2];
    expect(f.service().observe(f.ia.invoice_id,tx.info.id,'finalized',tx).status).toBe('REJECTED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
  });
  it('pins old invoice address after a rail change and holds partial or late payments out of revenue',()=>{
    const f=fixture();f.service().configureRail({rail_id:'bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'56'.repeat(20),status:'ENABLED',expected_revision:1,rpc_id:'bsc-mainnet'},200);
    expect(f.service().invoice(f.ia.invoice_id).recipient_address).toBe('0x'+'12'.repeat(20));const tx=evidence(f.ia);
    f.service().db.prepare('UPDATE payment_invoices SET expires_at=? WHERE invoice_id=?').run(Date.now()-1000,f.ia.invoice_id);
    expect(f.service().observe(f.ia.invoice_id,tx.receipt.transactionHash,'finalized',tx).status).toBe('REVIEW_REQUIRED');expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('0');
  });
  it('does not advance EVM cursor after RPC failure and catches up after restart',async()=>{
    const f=fixture(),tx=evidence(f.ia);let unavailable=true;
    const rpc:PaymentRpc={async call(_n,method,params){if(method==='eth_getBlockByNumber')return params[0]==='finalized'?tx.finalizedHead:tx.block;
      if(method==='eth_getLogs'){if(unavailable)throw Error('RPC_DOWN');return tx.receipt.logs;}if(method==='eth_getTransactionReceipt')return tx.receipt;throw Error('unexpected');}};
    await expect(new PaymentMonitor(f.service(),rpc).scanInvoice(f.ia.invoice_id)).rejects.toThrow('RPC_DOWN');expect(f.service().db.prepare('SELECT * FROM payment_chain_cursors').all()).toHaveLength(0);
    unavailable=false;await new PaymentMonitor(f.reopen(),rpc).scanInvoice(f.ia.invoice_id);expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('10000001');
  });
  it('rejects a self-transfer without starving the later valid invoice or advancing past missing receipts',async()=>{
    const f=fixture(),bad=evidence(f.ia,'0x'+'ef'.repeat(32)),good=evidence(f.ia);bad.receipt.logs[0].topics[1]=bad.receipt.logs[0].topics[2];
    const rpc:PaymentRpc={async call(_n,method,params){if(method==='eth_getBlockByNumber')return params[0]==='finalized'?good.finalizedHead:good.block;
      if(method==='eth_getLogs')return [bad.receipt.logs[0],good.receipt.logs[0]];if(method==='eth_getTransactionReceipt')return params[0]===bad.receipt.transactionHash?bad.receipt:good.receipt;throw Error('unexpected');}};
    await new PaymentMonitor(f.service(),rpc).scanInvoice(f.ia.invoice_id);expect(f.service().revenue(f.a.world_id).mainnetAtomic).toBe('10000001');expect(f.service().db.prepare('SELECT COUNT(*) n FROM payment_receipts').get()!.n).toBe(1);
  });
  it('archives a v1 USDC receipt FK graph without relabelling it or crediting USDT',()=>{
    const f=fixture(),file=join(f.root,'legacy-payment.sqlite3'),db=new DatabaseSync(file);
    db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE payment_rails(rail_id TEXT PRIMARY KEY,asset TEXT,mint TEXT);CREATE TABLE rail_events(id INTEGER PRIMARY KEY);
      CREATE TABLE payment_invoices(invoice_id TEXT PRIMARY KEY,rail_id TEXT REFERENCES payment_rails(rail_id),asset TEXT,amount_atomic TEXT,status TEXT);
      CREATE TABLE payment_observations(signature TEXT,invoice_id TEXT REFERENCES payment_invoices(invoice_id));
      CREATE TABLE payment_receipts(id TEXT PRIMARY KEY,invoice_id TEXT REFERENCES payment_invoices(invoice_id),world_id TEXT,amount_atomic TEXT);
      CREATE TABLE world_revenue_events(receipt_id TEXT REFERENCES payment_receipts(id),asset TEXT,amount_atomic TEXT);
      CREATE TABLE payment_outbox(receipt_id TEXT REFERENCES payment_receipts(id),delivered INTEGER);CREATE TABLE payment_scan_cursors(invoice_id TEXT REFERENCES payment_invoices(invoice_id));CREATE TABLE payment_unmatched(signature TEXT);
      INSERT INTO payment_rails VALUES('old','USDC','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');INSERT INTO payment_invoices VALUES('i','old','USDC','10000000','FINALIZED');
      INSERT INTO payment_receipts VALUES('r','i','old-world','10000000');INSERT INTO world_revenue_events VALUES('r','USDC','10000000');INSERT INTO payment_outbox VALUES('r',1);PRAGMA user_version=1;`);db.close();
    const migrated=new PaymentService(file,f.control,f.lineage);clean.push(()=>migrated.close());
    expect(migrated.legacy()).toEqual({asset:'USDC',archived:true,receipts:1});expect(migrated.rails()).toHaveLength(0);expect(migrated.revenue(f.a.world_id).mainnetAtomic).toBe('0');
    expect(migrated.db.prepare('SELECT asset,amount_atomic,status FROM legacy_usdc_payment_invoices').get()).toMatchObject({asset:'USDC',amount_atomic:'10000000',status:'FINALIZED'});
    expect(migrated.db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);expect(migrated.db.prepare('PRAGMA user_version').get()!.user_version).toBe(3);
  });
  it('drains manual scans on quiesce and flushes previously finalized receipts to Memory before Final Dream',async()=>{
    const f=fixture(),tx=evidence(f.ia);f.service().observe(f.ia.invoice_id,tx.receipt.transactionHash,'finalized',tx);
    let release!:(head:any)=>void,stopped=false;const rpc:PaymentRpc={async call(){return new Promise(r=>{release=r;});}},monitor=new PaymentMonitor(f.service(),rpc);
    const scan=monitor.scanInvoice(f.ib.invoice_id),stop=monitor.stop().then(()=>{stopped=true;});await Promise.resolve();expect(stopped).toBe(false);
    release(tx.finalizedHead);await stop;await scan;expect(monitor.status().state).toBe('STOPPED');
    await expect(monitor.scanInvoice(f.ib.invoice_id)).rejects.toThrow('MONITOR_STOPPED');await expect(monitor.scanAll()).rejects.toThrow('MONITOR_STOPPED');
    expect(f.service().db.prepare('SELECT * FROM payment_chain_cursors').all()).toHaveLength(0);
    expect(f.lineage.relevantMemories({worldId:f.a.world_id,kind:'business_outcome'})).toHaveLength(1);
  });
});
