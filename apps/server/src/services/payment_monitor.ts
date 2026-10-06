import {PaymentService,Invoice} from './payment_service.js';
import {PaymentNetwork} from './solana_payment.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {PublicKey} from '@solana/web3.js';
import {createHash} from 'node:crypto';
import {PaymentChain,USDT_CHAINS,TRANSFER_TOPIC,TRON_GENESIS,recipientAddress,tronHex} from './payment_assets.js';
import {verifyTokenPayment,rpcInteger,rpcHex} from './token_payment.js';
import {PaymentRpc,MultiChainRpc} from './payment_rpc.js';
export {PaymentRpc,MultiChainRpc as SolanaRpc} from './payment_rpc.js';
type Scope={chain:PaymentChain;network:'mainnet';mint:string;decimals:number;recipient_address:string;start_block:number;created_at:number;rail_id:string};
/** Reference subscriptions are a hint; paginated RPC backfill and finalized reads remain authoritative. */
export class PaymentMonitor {
  private timer?:ReturnType<typeof setInterval>;
  private flight?:Promise<void>;
  private sockets:WebSocket[]=[];
  private subscriptions=new Set<string>();
  private state='STOPPED';private error:string|null=null;
  private stopping=false;
  private activeScans=new Set<Promise<void>>();
  constructor(readonly service:PaymentService,readonly rpc:PaymentRpc=new MultiChainRpc()){}
  status(){return {state:this.state,error:this.error,subscriptions:this.subscriptions.size};}
  async validateRecipient(chain:PaymentChain,address:string){
    address=recipientAddress(chain,address);const token=USDT_CHAINS[chain];
    if(chain==='solana'){
      const account=await this.rpc.call('mainnet','getAccountInfo',[address,{encoding:'base64',commitment:'finalized'}]);
      if([TOKEN_PROGRAM_ID.toBase58(),TOKEN_2022_PROGRAM_ID.toBase58()].includes(account?.value?.owner))throw Error('RECIPIENT_MUST_BE_NATIVE_PUBLIC_ADDRESS');
      const mint=await this.rpc.call('mainnet','getAccountInfo',[token.contract,{encoding:'jsonParsed',commitment:'finalized'}]);
      if(mint?.value?.owner!==TOKEN_PROGRAM_ID.toBase58()||mint.value.data?.parsed?.type!=='mint'||mint.value.data.parsed.info.decimals!==6)throw Error('USDT_TOKEN_METADATA_MISMATCH');return 0;
    }
    if(chain==='tron'){
      const metadata=await this.rpc.call('mainnet','tron_decimals',[address],chain);
      if(metadata.result?.result!==true||!Array.isArray(metadata.constant_result)||BigInt('0x'+metadata.constant_result[0])!==6n)throw Error('USDT_TOKEN_METADATA_MISMATCH');
      const head=await this.rpc.call('mainnet','tron_head',[],chain);const n=head?.block_header?.raw_data?.number;if(!Number.isSafeInteger(n)||n<0)throw Error('PAYMENT_TRON_HEAD_INVALID');return n;
    }
    const decimals=await this.rpc.call('mainnet','eth_call',[{to:token.contract,data:'0x313ce567'},'finalized'],chain);
    if(rpcInteger(decimals)!==token.decimals)throw Error('USDT_TOKEN_METADATA_MISMATCH');return rpcInteger((await this.rpc.call('mainnet','eth_getBlockByNumber',['finalized',false],chain))?.number);
  }
  private track(operation:()=>Promise<void>){const pending=operation();this.activeScans.add(pending);void pending.then(()=>this.activeScans.delete(pending),()=>this.activeScans.delete(pending));return pending;}
  scanInvoice(id:string):Promise<void>{if(this.stopping)return Promise.reject(Error('PAYMENT_MONITOR_STOPPED'));return this.track(()=>this.scanInvoiceInternal(id));}
  private async scanInvoiceInternal(id:string):Promise<void>{
    const invoice=this.service.invoice(id);if(invoice.status==='FINALIZED')return;if(invoice.chain!=='solana'){const scope=this.scopes().get(this.scopeKey(invoice));if(!scope)throw Error('PAYMENT_SCOPE_NOT_PENDING');await this.scanTokenScope(scope);this.service.deliverMemories();return;}
    const cursor=this.service.db.prepare('SELECT * FROM payment_scan_cursors WHERE invoice_id=?').get(id);
    let before:string|undefined=cursor?.backfill_before?String(cursor.backfill_before):undefined,head:string|undefined=cursor?.target_head?String(cursor.target_head):undefined;let complete=false;
    for(let page=0;page<5;page++){
      if(this.stopping)return;
      const signatures=await this.rpc.call(invoice.network,'getSignaturesForAddress',[invoice.reference,{limit:100,before,until:cursor?.last_seen_signature??undefined,commitment:'confirmed'}]);
      if(!Array.isArray(signatures))throw new Error('SOLANA_SIGNATURE_RESPONSE_INVALID');
      head??=signatures[0]?.signature;
      for(const row of signatures){if(this.stopping)return;if(row.err!==null)continue;
        const status=await this.rpc.call(invoice.network,'getSignatureStatuses',[[row.signature],{searchTransactionHistory:true}]);
        const current=status?.value?.[0];if(!current||current.err!==null)continue;
        const commitment=current.confirmationStatus==='finalized'?'finalized':current.confirmationStatus==='confirmed'?'confirmed':null;if(!commitment)continue;
        const transaction=await this.rpc.call(invoice.network,'getTransaction',[row.signature,{commitment,encoding:'json',maxSupportedTransactionVersion:0}]);
        if(transaction)this.service.observe(id,row.signature,commitment,transaction);
      }
      if(signatures.length<100){complete=true;break;}before=signatures.at(-1).signature;
    }
    this.service.db.prepare('INSERT INTO payment_scan_cursors VALUES(?,?,?,?,?) ON CONFLICT(invoice_id) DO UPDATE SET last_seen_signature=excluded.last_seen_signature,backfill_before=excluded.backfill_before,target_head=excluded.target_head,updated_at=excluded.updated_at')
      .run(id,complete?(head??cursor?.last_seen_signature??null):(cursor?.last_seen_signature??null),complete?null:(before??null),complete?null:(head??null),Date.now());
    const observations=this.service.db.prepare("SELECT signature FROM payment_observations WHERE invoice_id=? AND status IN ('OBSERVED','REVIEW_REQUIRED')").all(id);
    for(const observation of observations){if(this.stopping)return;const result=await this.rpc.call(invoice.network,'getSignatureStatuses',[[observation.signature],{searchTransactionHistory:true}]);
      if(result?.value?.[0]===null){this.service.db.prepare("UPDATE payment_observations SET status='DROPPED' WHERE invoice_id=? AND signature=? AND status='OBSERVED'").run(id,observation.signature);
        this.service.db.prepare("UPDATE payment_invoices SET status='WAITING' WHERE invoice_id=? AND status='OBSERVED'").run(id);}
      else if(result?.value?.[0]?.confirmationStatus==='finalized'&&result.value[0].err===null){const transaction=await this.rpc.call(invoice.network,'getTransaction',[observation.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]);if(transaction)this.service.observe(id,String(observation.signature),'finalized',transaction);}}
    this.service.db.prepare("UPDATE payment_invoices SET status='EXPIRED' WHERE invoice_id=? AND status='WAITING' AND expires_at<?").run(id,Date.now());
    this.service.deliverMemories();
  }
  scanAll():Promise<void>{if(this.stopping)return Promise.reject(Error('PAYMENT_MONITOR_STOPPED'));return this.track(()=>this.scanAllInternal());}
  private async scanAllInternal(){this.state='BACKFILLING';try{for(const invoice of this.service.pending().filter(i=>i.chain==='solana')){if(this.stopping)return;await this.scanInvoice(invoice.invoice_id);}for(const scope of this.scopes().values()){if(this.stopping)return;await this.scanTokenScope(scope);}await this.scanUnmatched();this.service.deliverMemories();this.state='WATCHING';this.error=null;}
    catch(error){this.state='ERROR';this.error=error instanceof Error?error.message:'PAYMENT_MONITOR_FAILED';throw error;}}
  start(){if(this.timer)return;this.stopping=false;this.timer=setInterval(()=>{if(this.flight)return;this.flight=this.scanAll().catch(()=>{}).then(()=>{if(!this.stopping)this.refreshSubscriptions();}).finally(()=>{this.flight=undefined;});},10000);this.timer.unref();this.refreshSubscriptions();}
  private refreshSubscriptions(){if(!(this.rpc instanceof MultiChainRpc))return;
    const pending=this.service.pending().filter(i=>i.chain==='solana');
    const newInvoices=pending.filter(i=>!this.subscriptions.has(i.reference));
    for(const network of ['mainnet'] as const){const invoices=newInvoices.filter(i=>i.network===network);if(!invoices.length)continue;
      let ws:WebSocket;try{ws=new WebSocket(this.rpc.websocket());}catch{this.state='ERROR';this.error='SOLANA_WS_CONFIGURATION_INVALID';continue;}this.sockets.push(ws);
      for(const invoice of invoices)this.subscriptions.add(invoice.reference);
      ws.onopen=()=>{invoices.forEach((invoice,index)=>{this.subscriptions.add(invoice.reference);ws.send(JSON.stringify({jsonrpc:'2.0',id:index+1,method:'logsSubscribe',params:[{mentions:[invoice.reference]},{commitment:'confirmed'}]}));});};
      ws.onmessage=()=>{if(!this.stopping&&!this.flight)this.flight=this.scanAll().catch(()=>{}).finally(()=>{this.flight=undefined;});};
      ws.onerror=()=>{if(!this.stopping){this.state='ERROR';this.error='SOLANA_WS_UNAVAILABLE';}};
      ws.onclose=()=>{for(const invoice of invoices)this.subscriptions.delete(invoice.reference);};
    }
  }
  private async scanUnmatched(){
    for(const rail of this.service.rails().filter(r=>r.status==='ENABLED'&&r.chain==='solana')){
      if(this.stopping)return;const network=rail.network as PaymentNetwork;
      const ata=getAssociatedTokenAddressSync(new PublicKey(String(rail.mint)),new PublicKey(String(rail.recipient_address)),true).toBase58();
      const signatures=await this.rpc.call(network,'getSignaturesForAddress',[ata,{limit:100,commitment:'finalized'}]);
      for(const row of signatures){if(this.stopping)return;if(row.err!==null||this.service.db.prepare("SELECT 1 FROM payment_receipts WHERE chain='solana' AND network=? AND signature=?").get(network,row.signature))continue;
        const tx=await this.rpc.call(network,'getTransaction',[row.signature,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]);if(!tx?.meta||tx.meta.err!==null)continue;
        const keys=[...(tx.transaction?.message?.accountKeys??[]),...(tx.meta.loadedAddresses?.writable??[]),...(tx.meta.loadedAddresses?.readonly??[])],index=keys.indexOf(ata);
        const post=tx.meta.postTokenBalances?.find((b:any)=>b.accountIndex===index&&b.owner===rail.recipient_address&&b.mint===rail.mint),pre=tx.meta.preTokenBalances?.find((b:any)=>b.accountIndex===index);
        if(!post||post.uiTokenAmount.decimals!==6)continue;const delta=BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount??'0');if(delta<=0n)continue;
        this.service.db.prepare("INSERT OR IGNORE INTO payment_unmatched VALUES('solana',?,?,0,?,?,6,?,?)").run(network,row.signature,rail.rail_id,delta.toString(),createHash('sha256').update(JSON.stringify(tx)).digest('hex'),Date.now());
      }
    }
  }
  private scopeKey(row:{chain:string;network:string;recipient_address:string;mint:string}){return `${row.chain}:${row.network}:${row.recipient_address}:${row.mint}`;}
  private scopes(){const scopes=new Map<string,Scope>();for(const row of [...this.service.rails().filter(r=>r.status==='ENABLED'),...this.service.pending()]){
    if(row.chain==='solana')continue;const key=this.scopeKey(row as Scope),old=scopes.get(key);const scope=row as Scope;
    scopes.set(key,old?{...old,start_block:Math.min(old.start_block,scope.start_block),created_at:Math.min(old.created_at,scope.created_at)}:scope);
  }return scopes;}
  private transfer(scope:Scope,signature:string,amount:string,evidence:any){
    const invoice=this.service.db.prepare('SELECT invoice_id FROM payment_invoices WHERE chain=? AND network=? AND mint=? AND recipient_address=? AND amount_atomic=?').get(scope.chain,scope.network,scope.mint,scope.recipient_address,amount);
    let verified;try{verified=verifyTokenPayment({...scope,amount_atomic:amount},signature,'finalized',evidence);}catch(error){
      // Known non-payments must not block later genuine receipts. RPC/chain-integrity errors still stop the cursor.
      if(error instanceof Error&&['PAYMENT_TREASURY_SELF_TRANSFER','PAYMENT_TOKEN_MINT_NOT_CUSTOMER_TRANSFER','PAYMENT_EXACT_TRANSFER_MISSING_OR_AMBIGUOUS'].includes(error.message)){
        if(invoice)this.service.observe(String(invoice.invoice_id),signature,'finalized',evidence);return;
      }throw error;
    }
    if(invoice){const result=this.service.observe(String(invoice.invoice_id),signature,'finalized',evidence);if(result.status!=='DUPLICATE_PAYMENT_REVIEW_REQUIRED')return;}
    this.service.db.prepare('INSERT OR IGNORE INTO payment_unmatched VALUES(?,?,?,?,?,?,?,?,?)').run(scope.chain,scope.network,signature,verified.transferIndex,scope.rail_id,amount,scope.decimals,createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),Date.now());
  }
  private async scanTokenScope(scope:Scope){
    const key=this.scopeKey(scope),cursor=this.service.db.prepare('SELECT * FROM payment_chain_cursors WHERE scope_key=?').get(key);
    if(scope.chain==='tron'){
      const head=await this.rpc.call('mainnet','tron_head',[],'tron');let fingerprint=cursor?.fingerprint?String(cursor.fingerprint):undefined;
      // Keep the paging query fixed. Replay complete history from rail creation, so an indexer's late record is never skipped.
      const minTimestamp=Number(cursor?.last_timestamp??Math.max(0,scope.created_at-1500));
      for(let page=0;page<5;page++){
        if(this.stopping)return;const result=await this.rpc.call('mainnet','tron_transfers',[{address:scope.recipient_address,minTimestamp,fingerprint}],'tron');
        if(result?.success!==true||!Array.isArray(result.data))throw Error('PAYMENT_TRON_HISTORY_INVALID');
        for(const row of result.data){if(this.stopping)return;if(row.to!==scope.recipient_address||row.token_info?.address!==scope.mint||row.token_info?.decimals!==6||row.type!=='Transfer')continue;
          if(typeof row.transaction_id!=='string'||!/^[a-f0-9]{64}$/i.test(row.transaction_id)||typeof row.value!=='string'||!/^\d+$/.test(row.value)||row.value==='0')throw Error('PAYMENT_TRON_HISTORY_INVALID');
          const info=await this.rpc.call('mainnet','tron_info',[row.transaction_id],'tron');if(!info?.id)throw Error('PAYMENT_TRON_SOLIDITY_NOT_AVAILABLE');
          const block=await this.rpc.call('mainnet','tron_block',[info.blockNumber],'tron');this.transfer(scope,row.transaction_id,row.value,{genesis:TRON_GENESIS,info,block,solidHead:head});
        }
        const next=result.meta?.fingerprint;if(next!==undefined&&(typeof next!=='string'||next.length>2048||next===fingerprint))throw Error('PAYMENT_TRON_CURSOR_INVALID');
        fingerprint=next;this.service.db.prepare('INSERT INTO payment_chain_cursors VALUES(?,NULL,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET last_timestamp=excluded.last_timestamp,fingerprint=excluded.fingerprint,updated_at=excluded.updated_at').run(key,minTimestamp,fingerprint??null,Date.now());
        if(!fingerprint)break;
      }return;
    }
    const chain=scope.chain;if(chain!=='bsc'&&chain!=='polygon')throw Error('PAYMENT_CHAIN_VERIFIER_MISMATCH');
    const head=await this.rpc.call('mainnet','eth_getBlockByNumber',['finalized',false],chain),last=rpcInteger(head?.number);let start=Number(cursor?.next_block??scope.start_block);
    if(!Number.isSafeInteger(start)||start<0)throw Error('PAYMENT_CURSOR_INVALID');
    for(let page=0;page<5&&start<=last;page++){
      if(this.stopping)return;const end=Math.min(start+499,last),logs=await this.rpc.call('mainnet','eth_getLogs',[{address:scope.mint,fromBlock:rpcHex(start),toBlock:rpcHex(end),topics:[TRANSFER_TOPIC,null,'0x'+'0'.repeat(24)+scope.recipient_address.slice(2)]}],chain);
      if(!Array.isArray(logs))throw Error('PAYMENT_LOG_RESPONSE_INVALID');const cache=new Map<string,any>();
      for(const log of logs){if(this.stopping)return;if(typeof log.transactionHash!=='string'||!/^0x[a-f0-9]{64}$/i.test(log.transactionHash)||typeof log.data!=='string'||!/^0x[a-f0-9]{64}$/i.test(log.data))throw Error('PAYMENT_LOG_RESPONSE_INVALID');
        if(BigInt(log.data)===0n)continue;let evidence=cache.get(log.transactionHash);
        if(!evidence){const receipt=await this.rpc.call('mainnet','eth_getTransactionReceipt',[log.transactionHash],chain);if(!receipt)throw Error('PAYMENT_RECEIPT_NOT_AVAILABLE');
          const block=await this.rpc.call('mainnet','eth_getBlockByNumber',[receipt.blockNumber,false],chain);evidence={chainId:USDT_CHAINS[chain].chainId,receipt,block,finalizedHead:head};cache.set(log.transactionHash,evidence);}
        this.transfer(scope,log.transactionHash,BigInt(log.data).toString(),evidence);
      }
      start=end+1;this.service.db.prepare('INSERT INTO payment_chain_cursors VALUES(?,?,NULL,NULL,?) ON CONFLICT(scope_key) DO UPDATE SET next_block=excluded.next_block,updated_at=excluded.updated_at').run(key,start,Date.now());
    }
  }
  async stop(){this.stopping=true;if(this.timer)clearInterval(this.timer);this.timer=undefined;for(const socket of this.sockets)socket.close();this.sockets=[];this.subscriptions.clear();
    // Drain manual HTTP scans as well as timer scans. Read failures are already reported; known receipts must reach Final Dream.
    await Promise.allSettled([...this.activeScans]);this.service.deliverMemories();this.state='STOPPED';}
}
