import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync,TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { randomBytes } from 'node:crypto';

export const SOLANA_USDT={mainnet:'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'} as const;
export const SOLANA_GENESIS={mainnet:'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'} as const;
export type PaymentNetwork=keyof typeof SOLANA_USDT;
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58Encode(bytes:Uint8Array){let value=0n;for(const byte of bytes)value=value*256n+BigInt(byte);let text='';while(value){text=alphabet[Number(value%58n)]+text;value/=58n;}for(const byte of bytes){if(byte!==0)break;text='1'+text;}return text;}
export function base58Decode(value:string){if(typeof value!=='string'||value.length>150)throw new Error('BASE58_INVALID');let n=0n;
  for(const character of value){const digit=alphabet.indexOf(character);if(digit<0)throw new Error('BASE58_INVALID');n=n*58n+BigInt(digit);}
  const bytes:number[]=[];while(n){bytes.unshift(Number(n%256n));n/=256n;}for(const character of value){if(character!=='1')break;bytes.unshift(0);}return Buffer.from(bytes);
}
export function publicAddress(value:unknown){if(typeof value!=='string'||base58Decode(value).length!==32)throw new Error('SOLANA_PUBLIC_ADDRESS_REQUIRED');return new PublicKey(value).toBase58();}
export const paymentReference=()=>new PublicKey(randomBytes(32)).toBase58();
export function amountAtomic(value:unknown){if(typeof value!=='string'||!/^\d+(\.\d{1,6})?$/.test(value)||value.length>26)throw new Error('USDT_DECIMAL_AMOUNT_REQUIRED');
  const [whole,fraction='']=value.split('.'),atomic=BigInt(whole!)*1000000n+BigInt(fraction.padEnd(6,'0'));if(atomic<=0n||atomic>18446744073709551615n)throw new Error('USDT_AMOUNT_OUT_OF_RANGE');return atomic.toString();}
export function displayAtomic(value:string){const n=BigInt(value);return `${n/1000000n}.${(n%1000000n).toString().padStart(6,'0')}`;}
export function solanaPayUrl(recipient:string,mint:string,reference:string,atomic:string,invoiceId:string){
  const url=new URL('solana:'+publicAddress(recipient));url.searchParams.set('amount',displayAtomic(atomic));url.searchParams.set('spl-token',publicAddress(mint));
  url.searchParams.set('reference',publicAddress(reference));url.searchParams.set('label','EmergentInc');url.searchParams.set('memo',invoiceId);return url.toString();
}
export interface PaymentInvoice { invoice_id:string;network:PaymentNetwork;mint:string;recipient_address:string;reference:string;amount_atomic:string;memo:string|null;expires_at:number;status:string;world_id:string;qianji_id:string }
/** Verify wire instruction keys/data, canonical recipient ATA, exact net receipt and reference; no payer-address guess. */
export function verifySolanaPayment(invoice:PaymentInvoice,signature:string,transaction:any,allReferences:string[]){
  if(!transaction?.meta||transaction.meta.err!==null||transaction.transaction?.signatures?.[0]!==signature)throw new Error('PAYMENT_TRANSACTION_FAILED_OR_MISMATCH');
  const message=transaction.transaction.message,staticKeys:string[]=message?.accountKeys;
  if(!Array.isArray(staticKeys)||!message.header||!Array.isArray(message.instructions))throw new Error('PAYMENT_WIRE_MESSAGE_REQUIRED');
  if(!Number.isSafeInteger(transaction.slot)||transaction.slot<0||!['numRequiredSignatures','numReadonlyUnsignedAccounts','numReadonlySignedAccounts'].every(k=>Number.isSafeInteger(message.header[k])&&message.header[k]>=0))throw new Error('PAYMENT_WIRE_HEADER_INVALID');
  const writable:string[]=transaction.meta.loadedAddresses?.writable??[],readonly:string[]=transaction.meta.loadedAddresses?.readonly??[],keys=[...staticKeys,...writable,...readonly];
  if(keys.filter(k=>allReferences.includes(k)).length!==1||!keys.includes(invoice.reference))throw new Error('PAYMENT_REFERENCE_AMBIGUOUS_OR_MISSING');
  const referenceIndex=keys.indexOf(invoice.reference),header=message.header;
  const refReadOnly=referenceIndex<staticKeys.length?referenceIndex>=staticKeys.length-header.numReadonlyUnsignedAccounts:referenceIndex>=staticKeys.length+writable.length;
  if(referenceIndex<header.numRequiredSignatures||!refReadOnly)throw new Error('PAYMENT_REFERENCE_NOT_READONLY');
  const instruction=message.instructions.at(-1);
  if(!instruction||keys[instruction.programIdIndex]!==TOKEN_PROGRAM_ID.toBase58()||!Array.isArray(instruction.accounts))throw new Error('PAYMENT_STANDARD_TOKEN_TRANSFER_REQUIRED');
  const data=base58Decode(instruction.data),checked=data[0]===12,plain=data[0]===3;
  if((checked&&data.length!==10)||(plain&&data.length!==9)||(!checked&&!plain))throw new Error('PAYMENT_TOKEN_INSTRUCTION_INVALID');
  const position=checked?2:1,required=checked?4:3;
  if(instruction.accounts.indexOf(referenceIndex)<required)throw new Error('PAYMENT_REFERENCE_NOT_ON_TRANSFER');
  if(checked&&(data[9]!==6||keys[instruction.accounts[1]]!==invoice.mint))throw new Error('PAYMENT_MINT_OR_DECIMALS_MISMATCH');
  if(data.readBigUInt64LE(1)!==BigInt(invoice.amount_atomic))throw new Error('PAYMENT_AMOUNT_MISMATCH');
  const destinationIndex=instruction.accounts[position],destination=keys[destinationIndex];
  const sourceBalance=transaction.meta.preTokenBalances?.find((b:any)=>b.accountIndex===instruction.accounts[0]);
  if(sourceBalance?.owner===invoice.recipient_address)throw new Error('PAYMENT_TREASURY_SELF_TRANSFER');
  const ata=getAssociatedTokenAddressSync(new PublicKey(invoice.mint),new PublicKey(invoice.recipient_address),true).toBase58();
  if(destination!==ata)throw new Error('PAYMENT_RECIPIENT_ATA_MISMATCH');
  const post=transaction.meta.postTokenBalances?.find((b:any)=>b.accountIndex===destinationIndex);
  const pre=transaction.meta.preTokenBalances?.find((b:any)=>b.accountIndex===destinationIndex);
  if(!post||post.owner!==invoice.recipient_address||post.mint!==invoice.mint||post.uiTokenAmount?.decimals!==6||
    (pre&&(pre.owner!==invoice.recipient_address||pre.mint!==invoice.mint)))throw new Error('PAYMENT_TOKEN_BALANCE_IDENTITY_MISMATCH');
  if(BigInt(post.uiTokenAmount.amount)-BigInt(pre?.uiTokenAmount.amount??'0')!==BigInt(invoice.amount_atomic))throw new Error('PAYMENT_NET_RECEIPT_MISMATCH');
  if(invoice.memo){const memo=message.instructions.at(-2);if(!memo||keys[memo.programIdIndex]!=='MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'||base58Decode(memo.data).toString('utf8')!==invoice.memo)throw new Error('PAYMENT_MEMO_MISMATCH');}
  const walletBefore:bigint=(transaction.meta.preTokenBalances??[]).filter((b:any)=>b.owner===invoice.recipient_address&&b.mint===invoice.mint).reduce((n:bigint,b:any)=>n+BigInt(b.uiTokenAmount.amount),0n);
  const walletAfter:bigint=(transaction.meta.postTokenBalances??[]).filter((b:any)=>b.owner===invoice.recipient_address&&b.mint===invoice.mint).reduce((n:bigint,b:any)=>n+BigInt(b.uiTokenAmount.amount),0n);
  if(walletAfter-walletBefore!==BigInt(invoice.amount_atomic))throw new Error('PAYMENT_TREASURY_NET_RECEIPT_MISMATCH');
  if(transaction.blockTime!=null&&(!Number.isSafeInteger(transaction.blockTime)||transaction.blockTime<0))throw new Error('PAYMENT_BLOCK_TIME_INVALID');
  const paidAt=transaction.blockTime==null?null:Number(transaction.blockTime)*1000;
  return {slot:Number(transaction.slot),paidAt};
}
