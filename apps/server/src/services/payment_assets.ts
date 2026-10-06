import {createHash} from 'node:crypto';
import {keccak_256} from '@noble/hashes/sha3';
import {base58Decode,base58Encode,publicAddress,amountAtomic,displayAtomic,SOLANA_USDT} from './solana_payment.js';

export const USDT_CHAINS={
  solana:{label:'Solana · USDT',contract:SOLANA_USDT.mainnet,decimals:6,chainId:null},
  bsc:{label:'BSC · Binance-Peg USDT',contract:'0x55d398326f99059ff775485246999027b3197955',decimals:18,chainId:56},
  polygon:{label:'Polygon PoS · USDT0',contract:'0xc2132d05d31c914a87c6611c10748aeb04b58e8f',decimals:6,chainId:137},
  tron:{label:'TRON · TRC-20 USDT',contract:'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',decimals:6,chainId:null}
} as const;
export type PaymentChain=keyof typeof USDT_CHAINS;
export const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const TRON_GENESIS='00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc';
export function paymentChain(value:unknown):PaymentChain{if(typeof value!=='string'||!Object.hasOwn(USDT_CHAINS,value))throw Error('PAYMENT_CHAIN_NOT_SUPPORTED');return value as PaymentChain;}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest();
export function tronHex(value:string){const bytes=base58Decode(value);if(bytes.length!==25||bytes[0]!==0x41||!digest(digest(bytes.subarray(0,21))).subarray(0,4).equals(bytes.subarray(21)))throw Error('TRON_PUBLIC_ADDRESS_REQUIRED');return bytes.subarray(1,21).toString('hex');}
export function tronAddress(hex:string){if(!/^[a-fA-F0-9]{40}$/.test(hex))throw Error('TRON_ADDRESS_BYTES_INVALID');const bytes=Buffer.from('41'+hex,'hex');return base58Encode(Buffer.concat([bytes,digest(digest(bytes)).subarray(0,4)]));}
export function evmAddress(value:unknown){if(typeof value!=='string'||!/^0x[a-fA-F0-9]{40}$/.test(value)||/^0x0{40}$/i.test(value))throw Error('EVM_PUBLIC_ADDRESS_REQUIRED');
  const body=value.slice(2),lower=body.toLowerCase();if(body!==lower&&body!==body.toUpperCase()){
    const checksum=Buffer.from(keccak_256(Buffer.from(lower))).toString('hex');
    for(let i=0;i<40;i++)if(/[a-f]/.test(lower[i]!)&&(parseInt(checksum[i]!,16)>=8?lower[i]!.toUpperCase():lower[i])!==body[i])throw Error('EVM_ADDRESS_CHECKSUM_INVALID');
  }return '0x'+lower;
}
export function recipientAddress(chain:PaymentChain,value:unknown){const address=chain==='solana'?publicAddress(value):chain==='tron'?(tronHex(String(value)),String(value)):evmAddress(value);
  if(address===USDT_CHAINS[chain].contract)throw Error('PAYMENT_RECIPIENT_IS_TOKEN_CONTRACT');return address;}
export const chainAmount=(amount:unknown,decimals:number)=>(BigInt(amountAtomic(amount))*10n**BigInt(decimals-6)).toString();
export function tokenAmount(atomic:string,decimals:number){const n=BigInt(atomic),unit=10n**BigInt(decimals);return `${n/unit}.${(n%unit).toString().padStart(decimals,'0')}`;}
export function paymentPayload(chain:PaymentChain,recipient:string,atomic:string){const token=USDT_CHAINS[chain];if(chain==='tron')return {qrPayload:recipient,walletUrl:null};
  if(chain==='solana')throw Error('SOLANA_REFERENCE_PAYLOAD_REQUIRED');
  const uri=`ethereum:${token.contract}@${token.chainId}/transfer?address=${recipient}&uint256=${atomic}`;return {qrPayload:uri,walletUrl:uri};}
export const quotedAmount=(value:unknown)=>displayAtomic(amountAtomic(value));
