import {USDT_CHAINS,PaymentChain,TRANSFER_TOPIC,TRON_GENESIS,tronHex} from './payment_assets.js';

export function rpcInteger(value:unknown){if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw Error('PAYMENT_RPC_INTEGER_INVALID');const n=Number(BigInt(value));if(!Number.isSafeInteger(n)||n<0)throw Error('PAYMENT_RPC_INTEGER_INVALID');return n;}
export const rpcHex=(value:number)=>'0x'+value.toString(16);
export interface TokenInvoice{chain:PaymentChain;network:'mainnet';mint:string;recipient_address:string;amount_atomic:string;decimals:number}
/** Genuine canonical-contract Transfer logs, not a client-supplied amount or a receipt status alone. */
export function verifyTokenPayment(invoice:TokenInvoice,signature:string,commitment:'confirmed'|'finalized',evidence:any){
  if(invoice.chain==='solana')throw Error('PAYMENT_CHAIN_VERIFIER_MISMATCH');
  const token=USDT_CHAINS[invoice.chain];if(invoice.network!=='mainnet'||invoice.mint!==token.contract||invoice.decimals!==token.decimals)throw Error('PAYMENT_TOKEN_NOT_ALLOWLISTED');
  let logs:any[],slot:number,paidAt:number,recipient:string,contract:string,tron=false;
  if(invoice.chain==='tron'){
    tron=true;const info=evidence?.info,block=evidence?.block,head=evidence?.solidHead;
    if(!/^[a-f0-9]{64}$/i.test(signature)||info?.id!==signature||info.receipt?.result!=='SUCCESS'||evidence.genesis!==TRON_GENESIS)throw Error('PAYMENT_TRON_TRANSACTION_INVALID');
    slot=info.blockNumber;paidAt=info.blockTimeStamp;
    if(!Number.isSafeInteger(slot)||slot<0||block?.block_header?.raw_data?.number!==slot||block.block_header.raw_data.timestamp!==paidAt||!block.transactions?.some((t:any)=>t.txID===signature))throw Error('PAYMENT_BLOCK_IDENTITY_MISMATCH');
    if(commitment!=='finalized'||!Number.isSafeInteger(head?.block_header?.raw_data?.number)||head.block_header.raw_data.number<slot)throw Error('PAYMENT_NOT_SOLIDIFIED');
    recipient=tronHex(invoice.recipient_address);contract=tronHex(invoice.mint);logs=info.log;
  }else{
    const receipt=evidence?.receipt,block=evidence?.block;
    if(!/^0x[a-f0-9]{64}$/i.test(signature)||receipt?.transactionHash!==signature||receipt.status!=='0x1'||evidence.chainId!==token.chainId)throw Error('PAYMENT_EVM_TRANSACTION_INVALID');
    slot=rpcInteger(receipt.blockNumber);paidAt=rpcInteger(block?.timestamp)*1000;
    if(rpcInteger(block?.number)!==slot||!/^0x[a-f0-9]{64}$/i.test(receipt.blockHash)||receipt.blockHash!==block.hash)throw Error('PAYMENT_BLOCK_IDENTITY_MISMATCH');
    if(commitment==='finalized'&&rpcInteger(evidence.finalizedHead?.number)<slot)throw Error('PAYMENT_NOT_FINALIZED');
    recipient=invoice.recipient_address.slice(2);contract=invoice.mint.slice(2);logs=receipt.logs;
  }
  if(!Number.isSafeInteger(paidAt)||paidAt<=0||!Array.isArray(logs))throw Error('PAYMENT_TRANSFER_LOGS_REQUIRED');
  const topic=(value:unknown)=>{if(typeof value!=='string')throw Error('PAYMENT_TRANSFER_LOG_INVALID');const raw=value.replace(/^0x/,'').toLowerCase();if(!/^0{24}[a-f0-9]{40}$/.test(raw))throw Error('PAYMENT_TRANSFER_LOG_INVALID');return raw.slice(24);};
  const transfers=logs.map((log:any,index:number)=>({log,index})).filter(({log})=>String(log.address).replace(/^0x/,'').toLowerCase()===contract&&String(log.topics?.[0]).replace(/^0x/,'').toLowerCase()===TRANSFER_TOPIC.slice(2));
  const matches=[];
  for(const {log,index} of transfers){if(log.removed===true||log.topics.length!==3||typeof log.data!=='string'||!/^(0x)?[a-f0-9]{64}$/i.test(log.data))throw Error('PAYMENT_TRANSFER_LOG_INVALID');
    const from=topic(log.topics[1]),to=topic(log.topics[2]),amount=BigInt('0x'+log.data.replace(/^0x/,''));
    if(from===recipient)throw Error('PAYMENT_TREASURY_SELF_TRANSFER');
    if(to!==recipient||amount!==BigInt(invoice.amount_atomic))continue;
    if(/^0{40}$/.test(from))throw Error('PAYMENT_TOKEN_MINT_NOT_CUSTOMER_TRANSFER');
    if(!tron&&(log.transactionHash!==signature||log.blockHash!==evidence.receipt.blockHash||log.blockNumber!==evidence.receipt.blockNumber))throw Error('PAYMENT_LOG_TRANSACTION_MISMATCH');
    matches.push(tron?index:rpcInteger(log.logIndex));
  }
  if(matches.length!==1)throw Error('PAYMENT_EXACT_TRANSFER_MISSING_OR_AMBIGUOUS');
  return {slot,paidAt,transferIndex:matches[0]!};
}
