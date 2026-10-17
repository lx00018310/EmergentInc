import {expect,it,vi} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {randomBytes} from 'node:crypto';
import {LineageStore,WorldRegistryStore} from '@emergentinc/persistence';
import {listenTestHttp,reserveTestHttpPort} from '../../../tests/http_port.js';
import {mockRpcKey,mockRpcCertificate} from './mock_rpc_tls';
import {initializeBossWorkspace} from '../src/boss_workspace.js';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {LocalWorldRuntime} from '../../../supervisor/local_world_runtime.js';
import {PaymentService} from '../src/services/payment_service.js';
import {TRANSFER_TOPIC} from '../src/services/payment_assets.js';

/** Real processes and real publisher; model and chain evidence are explicitly synthetic. */
it.skipIf(process.env.EMERGENTINC_CANDIDATE_MODE==='1')('starts empty V34, executes a bounded goal, preserves new payments/artifacts/OFF through restart, publication and rollback',async()=>{
  const root=fs.mkdtempSync(join(resolve('cache'),'v34-process-')),workspace=join(root,'workspace'),releases=join(root,'releases'),state=join(root,'trusted');fs.mkdirSync(state,{recursive:true});
  const format=initializeBossWorkspace(resolve('.'),workspace),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true}),control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3'));
  const initial=lineage.activeGeneration()!,base=join(releases,String(initial.release_id));
  const {freezeLocalRelease}=await import('../../../scripts/local-release.mjs');await freezeLocalRelease(resolve('.'),base);
  let chainEvidence:any,artifactMade=false,modelCalls=0;
  const model=createServer((req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{modelCalls++;const input=JSON.parse(body),routing=String(input.messages[0].content).startsWith('你是 Owner');
    const content=routing?{kind:'answer',answer:'Synthetic test company is ready.'}:!artifactMade?{operations:[{tool:'save_artifact',args:{filename:'result.md',content:'Synthetic verified artifact for V34 continuity.'}}],send_to:'STOP'}:{owner_reply:'Review the actual saved artifact.',send_to:'STOP'};
    if(!routing)artifactMade=true;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}],usage:{prompt_tokens:50,completion_tokens:50,total_tokens:100,prompt_tokens_details:{cached_tokens:0}}}));});});
  const rpc=createHttpsServer({key:mockRpcKey,cert:mockRpcCertificate},(req,res)=>{let body='';req.on('data',d=>body+=d);req.on('end',()=>{const input=JSON.parse(body),result=input.method==='eth_chainId'?'0x38':input.method==='eth_getBlockByNumber'?(chainEvidence?.block??{number:'0x64',hash:'0x'+'cd'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}):input.method==='eth_getLogs'?(chainEvidence?.receipt.logs??[]):input.method==='eth_getTransactionReceipt'?chainEvidence?.receipt:null;
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:input.id,result}));});});
  const modelPort=await listenTestHttp(model),rpcPort=await listenTestHttp(rpc),ca=join(root,'test-ca.pem');fs.writeFileSync(ca,mockRpcCertificate);
  const secret=randomBytes(32).toString('hex'),port=await reserveTestHttpPort(),activeReleaseFile=join(state,'active.json');fs.writeFileSync(activeReleaseFile,JSON.stringify({directory:base}));
  const runtime=new LocalWorldRuntime({workspace,releases,stateDirectory:state,activeReleaseFile,appUrl:`http://127.0.0.1:${port}`,ownerEnvironment:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,EMERGENTINC_OWNER_SECRET:secret,EMERGENTINC_SECURE_COOKIES:'0',MCL_API_KEY:'explicit-synthetic-key',MCL_MODEL:'gpt-4o-mini',MCL_DECISION_MODEL:'gpt-4o-mini',MCL_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,EMERGENT_MOCK_MODE:'1',EMERGENTINC_BSC_RPC_MAINNET:`https://127.0.0.1:${rpcPort}/rpc`,NODE_EXTRA_CA_CERTS:ca}});
  const supervisor=new GenerationSupervisor(state,join(workspace,'system'),releases,lineage,runtime,true);let cookie='';
  const call=async(method:string,url:string,payload?:any,token?:string)=>{const r=await fetch(runtime.config.appUrl+url,{method,headers:{cookie,'Content-Type':'application/json',Connection:'close',...(token?{Authorization:'Bearer '+token}:{})},...(payload?{body:JSON.stringify(payload)}:{})});const data=await r.json() as any;expect(r.status,JSON.stringify(data)).toBeLessThan(300);return data;};
  const login=async()=>{const r=await fetch(runtime.config.appUrl+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({secret})});expect(r.status).toBe(200);cookie=r.headers.get('set-cookie')!.split(';')[0]!;};
  const controlCompany=async(mode:string)=>{const c=await call('GET','/api/owner/automation');return call('POST','/api/owner/automation',{desiredMode:mode,expectedRevision:c.revision,idempotencyKey:crypto.randomUUID()});};
  try{
    await runtime.start();await runtime.healthy('G0001');await runtime.resume();await login();
    expect(await call('GET','/api/boss/overview')).toMatchObject({instanceId:format.instanceId,goals:[],revenue:[],events:[],paidOrderCount:0,automation:{desiredMode:'OFF'},budget:{activatedAt:null,totalMicros:0}});
    expect(control.db.prepare('SELECT COUNT(*) n FROM qianji_worlds').get()!.n).toBe(0);expect(modelCalls).toBe(0);
    await call('POST','/api/owner/budget',{tokenMillions:1,unitPrice:10,priceCurrency:'CNY',expectedRevision:0,idempotencyKey:crypto.randomUUID()});await controlCompany('ON');
    const goal=await call('POST','/api/owner/goals',{title:'V34 synthetic delivery',objective:'Produce result.md for an isolated test',acceptance:{kind:'artifact',filename:'result.md',minBytes:10},idempotencyKey:crypto.randomUUID()});
    let request:any;await vi.waitFor(async()=>{const o=await call('GET','/api/boss/overview');request=o.inbox.find((i:any)=>i.type==='recruit')?.actions[0].action;expect(request).toBeTruthy();},{timeout:20000});
    await call('POST',`/api/owner/requests/${request.requestId}/decision`,{hash:request.hash,decision:'approve'});
    let detail:any;await vi.waitFor(async()=>{detail=await call('GET',`/api/owner/goals/${goal.id}`);expect(detail.evidence.some((e:any)=>e.kind==='artifact')).toBe(true);expect(detail.goal.status).toBe('WAITING_APPROVAL');},{timeout:30000});
    const artifact=detail.evidence.find((e:any)=>e.kind==='artifact'),operation=control.db.prepare('SELECT attempt_id FROM company_artifacts WHERE operation_id=?').get(String(artifact.id).slice(9))!;
    expect(artifact.worldId).toBeNull();expect(control.db.prepare('SELECT COUNT(*) n FROM qianji_worlds').get()!.n).toBe(0);
    const artifactFile=join(workspace,'system/executions',String(operation.attempt_id),artifact.reference),artifactBytes=fs.readFileSync(artifactFile);
    const paused=await call('POST',`/api/owner/goals/${goal.id}/actions`,{action:'pause',expectedRevision:detail.goal.revision,idempotencyKey:crypto.randomUUID()});await controlCompany('OFF');
    const configured=new PaymentService(join(workspace,'system/payment/payment.sqlite3'),control,lineage);configured.configureRail({rail_id:'bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'},100);configured.close();
    const initialSettings=(await call('GET','/api/public-site')).settings,{product_id:_id,updated_at:_at,...settings}=initialSettings;
    await call('PUT','/api/public-site',{...settings,product_enabled:true,product_price:'10',product_name_en:'Synthetic service',product_name_zh:'合成测试服务',product_description_en:'Isolated fixture',product_description_zh:'隔离测试夹具'});
    const checkout={product_id:'custom-service',customer_name:'Synthetic test',customer_contact:'test@example.invalid',customer_requirement:'Verify V34 continuity',rail_id:'bsc',language:'en',idempotency_key:'v34-process-order-00000000000000000001'};
    const paid=await call('POST','/api/public/orders',checkout),pending=await call('POST','/api/public/orders',{...checkout,idempotency_key:'v34-process-order-00000000000000000002'}),invoice=(await call('GET','/api/payments/invoices')).items.find((i:any)=>i.order_id===paid.order_id),signature='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
    chainEvidence={receipt:{status:'0x1',transactionHash:signature,blockHash,blockNumber:'0x64',logs:[{address:invoice.mint,topics:[TRANSFER_TOPIC,'0x'+'0'.repeat(24)+'34'.repeat(20),'0x'+'0'.repeat(24)+invoice.recipient_address.slice(2)],data:'0x'+BigInt(invoice.amount_atomic).toString(16).padStart(64,'0'),logIndex:'0x0',transactionHash:signature,blockHash,blockNumber:'0x64',removed:false}]},block:{number:'0x64',hash:blockHash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}};
    await call('POST',`/api/payments/invoices/${invoice.invoice_id}/scan`,{});await call('POST',`/api/payments/invoices/${invoice.invoice_id}/scan`,{});
    const verify=async()=>{const o=await call('GET','/api/boss/overview');expect(o.instanceId).toBe(format.instanceId);expect(o.automation.desiredMode).toBe('OFF');expect(o.paidOrderCount).toBe(1);expect(o.revenue).toHaveLength(1);expect((await call('GET',`/api/owner/goals/${goal.id}`)).goal).toEqual(paused);expect(fs.readFileSync(artifactFile)).toEqual(artifactBytes);
      expect((await call('GET',`/api/public/orders/${paid.order_id}/payment`,undefined,paid.public_order_token)).status).toBe('PAID');expect((await call('GET',`/api/public/orders/${pending.order_id}/payment`,undefined,pending.public_order_token)).status).toBe('AWAITING_PAYMENT');};
    const paidCalls=modelCalls;await runtime.stop();await runtime.start();await runtime.healthy('G0001');await runtime.resume();await login();await verify();expect(modelCalls).toBe(paidCalls);
    const proposal=lineage.proposeGene('G0001','owner',{point:'V34 software publication',reason:'Synthetic evidence',effect:'Preserve new company data'});lineage.decideProposal(String(proposal.id),'APPROVED');
    supervisor.submit({id:'v34-tested-update',base_generation:'G0001',base_release:String(initial.release_id),proposal_id:String(proposal.id),patch:[{path:'genome/manifest.json',content:JSON.stringify({...JSON.parse(fs.readFileSync(join(base,'genome/manifest.json'),'utf8')),generation:2})},{path:'genome/v34-verification.txt',content:'Synthetic V34 software release'}]});
    const checked=await supervisor.validate('v34-tested-update');expect(()=>supervisor.approve(checked.id,'wrong')).toThrow('OWNER_CANDIDATE_HASH');supervisor.approve(checked.id,checked.candidate.candidate_hash);await supervisor.birth(checked.id);await login();await verify();expect(modelCalls).toBe(paidCalls);
    await supervisor.rollback(checked.id,'Explicit synthetic V34 rollback');await login();await verify();expect(modelCalls).toBe(paidCalls);expect(lineage.activeGeneration()!.id).toBe('G0001');
    console.info('V34_PROCESS_VERIFIED '+JSON.stringify({emptyStart:true,workerCount:1,artifactRetained:true,verifiedReceipts:1,paidOrders:1,pendingOrders:1,company:'OFF',restart:true,published:'G0002',rollback:'G0001'}));
  }catch(e){throw new Error(String(e)+'\n'+fs.readFileSync(join(state,'server.log'),'utf8').slice(-2500)+'\n'+fs.readdirSync(state).filter(n=>n.startsWith('validation-')).map(n=>fs.readFileSync(join(state,n),'utf8').slice(-4000)).join('\n'));}
  finally{await runtime.stop();supervisor.close();control.close();lineage.close();await new Promise<void>(r=>model.close(()=>r()));await new Promise<void>(r=>rpc.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
},900000);
