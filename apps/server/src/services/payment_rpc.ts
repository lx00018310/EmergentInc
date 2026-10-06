import {PaymentNetwork,SOLANA_GENESIS} from './solana_payment.js';
import {PaymentChain,USDT_CHAINS,TRON_GENESIS} from './payment_assets.js';
export interface PaymentRpc{call(network:PaymentNetwork,method:string,params:any[],chain?:PaymentChain):Promise<any>}
/** Read-only, bounded requests to Owner-selected RPC; endpoint credentials never enter invoice data or errors. */
export class MultiChainRpc implements PaymentRpc{
  private checked=new Set<PaymentChain>();
  constructor(readonly env:NodeJS.ProcessEnv=process.env){}
  endpoint(chain:PaymentChain){const defaults={solana:'https://api.mainnet-beta.solana.com',bsc:'https://bsc-rpc.publicnode.com',polygon:'https://polygon-bor-rpc.publicnode.com',tron:'https://api.trongrid.io'};
    try{const url=new URL(this.env[`EMERGENTINC_${chain.toUpperCase()}_RPC_MAINNET`]??defaults[chain]);if(url.protocol!=='https:')throw Error();return url.href.replace(/\/$/,'');}catch{throw Error('PAYMENT_HTTPS_RPC_REQUIRED');}}
  websocket(){try{const url=new URL(this.env.EMERGENTINC_SOLANA_WS_MAINNET??this.endpoint('solana').replace(/^https:/,'wss:'));if(url.protocol!=='wss:')throw Error();return url.href;}catch{throw Error('PAYMENT_WSS_REQUIRED');}}
  private async request(chain:PaymentChain,method:string,params:any[]){
    try{let url=this.endpoint(chain),body:any,post=true;
      if(chain!=='tron'){const allowed=chain==='solana'?['getGenesisHash','getAccountInfo','getSignaturesForAddress','getSignatureStatuses','getTransaction']:['eth_chainId','eth_call','eth_getLogs','eth_getTransactionReceipt','eth_getBlockByNumber'];
        if(!allowed.includes(method))throw Error('READ_ONLY');body={jsonrpc:'2.0',id:1,method,params};
      }else{
        if(method==='tron_block') {url+='/walletsolidity/getblockbynum';body={num:params[0]};}
        else if(method==='tron_head'){url+='/walletsolidity/getnowblock';body={};}
        else if(method==='tron_info'){url+='/walletsolidity/gettransactioninfobyid';body={value:params[0]};}
        else if(method==='tron_decimals'){url+='/walletsolidity/triggerconstantcontract';body={visible:true,owner_address:params[0],contract_address:USDT_CHAINS.tron.contract,function_selector:'decimals()',parameter:''};}
        else if(method==='tron_transfers'){post=false;url+='/v1/accounts/'+encodeURIComponent(params[0].address)+'/transactions/trc20';const query=new URLSearchParams({only_confirmed:'true',only_to:'true',contract_address:USDT_CHAINS.tron.contract,limit:'200',order_by:'block_timestamp,asc',min_timestamp:String(params[0].minTimestamp)});if(params[0].fingerprint)query.set('fingerprint',params[0].fingerprint);url+='?'+query;}
        else throw Error('READ_ONLY');
      }
      const response=await fetch(url,{method:post?'POST':'GET',headers:{'Content-Type':'application/json',...(chain==='tron'&&this.env.EMERGENTINC_TRON_API_KEY?{'TRON-PRO-API-KEY':this.env.EMERGENTINC_TRON_API_KEY}:{})},...(post?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(8000)});
      if(!response.ok||!response.body)throw Error();const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>2*1024*1024){await reader.cancel();throw Error();}chunks.push(item.value);}
      const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(chain==='tron'){if(value.Error||value.error)throw Error();return value;}
      if(value.error||!Object.hasOwn(value,'result'))throw Error();return value.result;
    }catch{throw Error('PAYMENT_RPC_UNAVAILABLE_OR_INVALID');}
  }
  async call(network:PaymentNetwork,method:string,params:any[],chain:PaymentChain='solana'){
    if(network!=='mainnet')throw Error('USDT_MAINNET_REQUIRED');
    if(!this.checked.has(chain)){
      if(chain==='solana'){if(await this.request(chain,'getGenesisHash',[])!==SOLANA_GENESIS.mainnet)throw Error('PAYMENT_RPC_NETWORK_MISMATCH');}
      else if(chain==='tron'){if((await this.request(chain,'tron_block',[0]))?.blockID!==TRON_GENESIS)throw Error('PAYMENT_RPC_NETWORK_MISMATCH');}
      else if(await this.request(chain,'eth_chainId',[])!=='0x'+USDT_CHAINS[chain].chainId.toString(16))throw Error('PAYMENT_RPC_NETWORK_MISMATCH');
      this.checked.add(chain);
    }return this.request(chain,method,params);
  }
}
