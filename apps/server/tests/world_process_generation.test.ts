import {it,expect} from 'vitest';
import * as fs from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {mockRpcKey,mockRpcCertificate} from './mock_rpc_tls';
import {randomBytes} from 'node:crypto';
import {LineageStore,WorldRegistryStore,CurrentStore,readGenome,writeGenerationPointer} from '@emergentinc/persistence';
import {WorldRegistryService} from '../src/services/world_registry_service.js';
import {GenerationSupervisor} from '../../../supervisor/generation_supervisor.js';
import {LocalWorldRuntime} from '../../../supervisor/local_world_runtime.js';
import {PaymentService} from '../src/services/payment_service.js';
import {TRANSFER_TOPIC} from '../src/services/payment_assets.js';

/** Real server processes and Supervisor; explicitly fake model and HTTPS chain evidence, without real payments. */
it.skipIf(process.env.EMERGENTINC_CANDIDATE_MODE==='1')('preserves public business facts across process restart, approved generation upgrade and compatible release rollback',async()=>{
  fs.mkdirSync(resolve('cache'),{recursive:true});const root=fs.mkdtempSync(join(resolve('cache'),'v23-process-')),workspace=join(root,'workspace'),releases=join(root,'releases'),state=join(root,'trusted');fs.mkdirSync(state,{recursive:true});
  const {freezeLocalRelease}=await import('../../../scripts/local-release.mjs');
  const base=join(releases,'r1');await freezeLocalRelease(resolve('.'),base);
  const manifestFile=join(base,'genome/manifest.json'),manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));manifest.generation=1;fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  const genome=readGenome(base),lineage=new LineageStore(join(workspace,'system/lineage/lineage.sqlite3'),{v23:true});
  const generation=lineage.createGeneration({id:'G0001',number:1,geneHash:genome.geneHash,releaseId:'r1',state:'ACTIVE'});writeGenerationPointer(join(workspace,'system'),'G0001');
  const current=new CurrentStore(join(workspace,'system/generations/G0001/current.sqlite3'));current.initialize(generation,'1');current.close();fs.mkdirSync(join(workspace,'system/generations/G0001/body/skills'),{recursive:true});
  const control=new WorldRegistryStore(join(workspace,'system/control/control.sqlite3')),registry=new WorldRegistryService(workspace,control,lineage,'1');
  const narrative=(displayName:string)=>({displayName,title:null,roleLabel:null,traits:{},behaviorProfile:[],flaw:null,shortBio:null,appearanceSpec:null,portraitAsset:null,contentRevision:null});
  const a=registry.create(narrative('A')),b=registry.create(narrative('B'));fs.writeFileSync(join(workspace,'workspace-layout.json'),JSON.stringify({schema:1,version:23}));
  lineage.configure({limitMicros:0,draftLimitMicros:0,draftCallLimit:30,draftExpiresAt:Date.now()+86400000});
  fs.mkdirSync(join(workspace,'private'),{recursive:true});fs.writeFileSync(join(workspace,'private/business_model_pricing.json'),JSON.stringify({models:{test:{currency:'CNY',input_cost_per_million:0,output_cost_per_million:0}}}));
  const candidate={skill_id:'count_rows',purpose:'count rows',source:'export default input=>({count:input.rows.length})',interface_version:'1',tests:[{input:{rows:[]},expected:{count:0}},{input:{rows:[1,2]},expected:{count:2}}]};
  let bodyMade=false,sharedAsset:string|undefined,chainEvidence:any;
  const mockHandler=(req:any,res:any)=>{let bytes='';req.on('data',(chunk:any)=>bytes+=chunk);req.on('end',()=>{
    const request=JSON.parse(bytes);
    if(request.jsonrpc){
      const result=request.method==='eth_chainId'?'0x38':request.method==='eth_getBlockByNumber'?(chainEvidence?.block??{number:'0x64',hash:'0x'+'cd'.repeat(32),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}):request.method==='eth_getLogs'?(chainEvidence?.receipt.logs??[]):request.method==='eth_getTransactionReceipt'?chainEvidence?.receipt:null;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));return;
    }
    const isDream=String(request.messages[0].content).startsWith('整理新的真实事实');
    let content;if(isDream){const input=JSON.parse(request.messages[1].content),worlds=[...new Set(input.facts.map((f:any)=>f.world_id).filter(Boolean))];
      content=JSON.stringify({memories:worlds.map(world_id=>({world_id,point:'Test World experience',reason:'Explicit deterministic test model',effect:'Scoped test memory'})),gene_proposals:input.facts.filter((f:any)=>f.kind==='gene_asset_nominated').map((f:any)=>({candidate_id:f.payload.id,point:'Shared counter',reason:'Frozen used Body skill',effect:'Fresh Worlds inherit'}))});}
    else{content=JSON.stringify({send_to:'STOP',owner_reply:'test reply',...(sharedAsset&&JSON.stringify(request).includes('use shared gene')?{operations:[{tool:'CALL_GENE_SKILL',args:{asset_id:sharedAsset,input:{rows:[1,2,3]}}}]}:{}),...(!bodyMade?{operations:[{tool:'CREATE_BODY_SKILL',args:{candidate}},{tool:'CALL_BODY_SKILL',args:{skill_id:'count_rows',input:{rows:[1,2,3]}}}],reproduce:{direction:'1_0_0',initial_energy:15000}}:{})});bodyMade=true;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:50,completion_tokens:50,total_tokens:100}}));
  });};const model=createServer(mockHandler),rpc=createHttpsServer({key:mockRpcKey,cert:mockRpcCertificate},mockHandler);
  await new Promise<void>(r=>model.listen(0,'127.0.0.1',r));const modelPort=(model.address() as any).port;
  await new Promise<void>(r=>rpc.listen(0,'127.0.0.1',r));const rpcPort=(rpc.address() as any).port,caFile=join(root,'mock-rpc-ca.pem');fs.writeFileSync(caFile,mockRpcCertificate);
  const portServer=createServer();await new Promise<void>(r=>portServer.listen(0,'127.0.0.1',r));const port=(portServer.address() as any).port;await new Promise<void>(r=>portServer.close(()=>r()));
  const secret=randomBytes(32).toString('hex'),activeReleaseFile=join(state,'active.json');fs.writeFileSync(activeReleaseFile,JSON.stringify({directory:base}));
  const runtime=new LocalWorldRuntime({workspace,releases,stateDirectory:state,activeReleaseFile,appUrl:`http://127.0.0.1:${port}`,ownerEnvironment:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,
    EMERGENTINC_OWNER_SECRET:secret,EMERGENTINC_SECURE_COOKIES:'0',MCL_API_KEY:'explicit-test-key',MCL_MODEL:'test',MCL_BASE_URL:`http://127.0.0.1:${modelPort}/v1`,EMERGENTINC_BSC_RPC_MAINNET:`https://127.0.0.1:${rpcPort}/rpc`,NODE_EXTRA_CA_CERTS:caFile}});
  const supervisor=new GenerationSupervisor(state,join(workspace,'system'),releases,lineage,runtime,true);let cookie='';
  const call=async(method:string,url:string,payload?:any)=>{const response=await fetch(runtime.config.appUrl+url,{method,headers:{cookie,'Content-Type':'application/json',Connection:'close'},...(payload?{body:JSON.stringify(payload)}:{})});
    const result=await response.json() as any;expect(response.status,JSON.stringify(result)).toBeLessThan(300);return result;};
  const login=async()=>{const response=await fetch(runtime.config.appUrl+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({secret})});cookie=response.headers.get('set-cookie')!.split(';')[0]!;};
  const publicCall=async(method:string,url:string,payload?:any,token?:string)=>{
    const response=await fetch(runtime.config.appUrl+url,{method,headers:{'Content-Type':'application/json',Connection:'close',...(token?{Authorization:'Bearer '+token}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
    const result=await response.json() as any;expect(response.status,JSON.stringify(result)).toBeLessThan(300);return result;
  };
  const configured=new PaymentService(join(workspace,'system/payment/payment.sqlite3'),control,lineage);
  configured.configureRail({rail_id:'bsc',chain:'bsc',network:'mainnet',recipient_address:'0x'+'12'.repeat(20),status:'ENABLED',expected_revision:0,rpc_id:'bsc-mainnet'},100);configured.close();
  try{
    await runtime.start();await runtime.healthy('G0001');await runtime.resume();await login();
    const initial=(await call('GET','/api/public-site')).settings,{product_id:_product,updated_at:_updated,...settings}=initial;
    await call('PUT','/api/public-site',{...settings,product_enabled:true,product_price:'10',product_name_en:'Process test service',product_name_zh:'进程测试服务',product_description_en:'Test service',product_description_zh:'测试服务'});
    const checkout={product_id:'custom-service',customer_name:'Process test customer',customer_contact:'test@example.invalid',customer_requirement:'V24 data continuity',rail_id:'bsc',language:'en',idempotency_key:'process-order-before-upgrade-00000001'};
    const publicOrder=await publicCall('POST','/api/public/orders',checkout);
    await runtime.stop();await runtime.start();await runtime.healthy('G0001');await runtime.resume();await login();
    expect((await publicCall('GET',`/api/public/orders/${publicOrder.order_id}/payment`,undefined,publicOrder.public_order_token)).status).toBe('AWAITING_PAYMENT');
    const publicInvoice=(await call('GET','/api/payments/invoices')).items.find((i:any)=>i.order_id===publicOrder.order_id),signature='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
    chainEvidence={receipt:{status:'0x1',transactionHash:signature,blockHash,blockNumber:'0x64',logs:[{address:publicInvoice.mint,topics:[TRANSFER_TOPIC,'0x'+'0'.repeat(24)+'34'.repeat(20),'0x'+'0'.repeat(24)+publicInvoice.recipient_address.slice(2)],data:'0x'+BigInt(publicInvoice.amount_atomic).toString(16).padStart(64,'0'),logIndex:'0x0',transactionHash:signature,blockHash,blockNumber:'0x64',removed:false}]},block:{number:'0x64',hash:blockHash,timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}};
    await call('POST',`/api/payments/invoices/${publicInvoice.invoice_id}/scan`,{});
    expect((await publicCall('GET',`/api/public/orders/${publicOrder.order_id}/payment`,undefined,publicOrder.public_order_token)).status).toBe('PAID');
    expect((await call('GET','/api/public-site')).revenue.mainnetAtomic).toBe('10000001');
    const pendingOrder=await publicCall('POST','/api/public/orders',{...checkout,idempotency_key:'process-order-before-upgrade-00000002'});
    await call('POST',`/api/qianji/${a.qianji_id}/chat`,{content:'generate capability',idempotencyKey:'chat',rounds:1,runBudgetTokens:80000});
    for(let i=0;i<100;i++){if(!(await call('GET',`/api/worlds/${a.world_id}/api/run/status`)).running)break;await new Promise(r=>setTimeout(r,30));}
    expect((await call('GET',`/api/worlds/${a.world_id}`)).pixels.some((p:any)=>p.id==='1_0_0')).toBe(true);
    expect((await call('GET',`/api/worlds/${b.world_id}`)).pixels).toHaveLength(1);
    const db=new CurrentStore(join(registry.directory(a.world_id),'generations/G0001/current.sqlite3'),{readOnly:true});const body=db.db.prepare('SELECT id FROM body_candidates').get()!;db.close();
    const nomination=await call('POST',`/api/worlds/${a.world_id}/promotions`,{pixel_id:'0_0_0',kind:'skill',sourcePath:`generations/G0001/body/skills/count_rows/${body.id}.json`,metadata:{privacy:'PUBLIC'}});
    await call('POST','/api/evolution/dream',{});
    const recommended=await call('GET',`/api/evolution/promotions/${nomination.id}`);expect(recommended.proposal_id).toBeTruthy();
    const blocked=await fetch(runtime.config.appUrl+`/api/evolution/proposals/${recommended.proposal_id}/decision`,{method:'POST',headers:{cookie,'Content-Type':'application/json',Connection:'close'},body:JSON.stringify({decision:'APPROVED'})});expect(blocked.status).toBe(400);
    const proposal=await call('POST',`/api/evolution/promotions/${nomination.id}/propose`,{shareConsent:true,privacy:'PUBLIC',license:'MIT',genericity:'JSON independent rows',point:'Shared counter',reason:'Tested on two inputs',effect:'Fresh Worlds inherit'});
    const direction=await call('POST',`/api/evolution/proposals/${proposal.id}/decision`,{decision:'APPROVED'});
    expect(direction.candidateRequest.patch).toHaveLength(3);supervisor.submit(direction.candidateRequest);
    const checked=await supervisor.validate(direction.candidateRequest.id);expect(()=>supervisor.approve(checked.id,'wrong')).toThrow('OWNER_CANDIDATE_HASH');
    supervisor.approve(checked.id,checked.candidate.candidate_hash);await supervisor.birth(checked.id);await login();
    expect((await call('GET','/api/public-site')).orders).toHaveLength(2);expect((await call('GET','/api/public-site')).revenue.mainnetAtomic).toBe('10000001');
    expect((await publicCall('GET',`/api/public/orders/${publicOrder.order_id}/payment`,undefined,publicOrder.public_order_token)).status).toBe('PAID');
    expect((await publicCall('GET',`/api/public/orders/${pendingOrder.order_id}/payment`,undefined,pendingOrder.public_order_token)).status).toBe('AWAITING_PAYMENT');
    expect(fs.existsSync(join(state,'snapshots',checked.id,'control-before.sqlite3'))).toBe(true);expect(fs.existsSync(join(state,'snapshots',checked.id,'payment-before.sqlite3'))).toBe(true);
    expect((await call('GET',`/api/worlds/${a.world_id}`)).current.generation_id).toBe('G0002');expect((await call('GET',`/api/worlds/${b.world_id}`)).current.generation_id).toBe('G0002');
    const fresh=await call('POST','/api/qianji/recruit',{idempotencyKey:'fresh'}),freshWorld=control.worldForQianji(fresh.profile.qianjiId);
    const info=await call('GET',`/api/worlds/${freshWorld.world_id}`);expect(info.current.generation_id).toBe('G0002');expect(fs.readdirSync(join(registry.directory(freshWorld.world_id),'generations/G0002/body/skills'))).toEqual([]);
    const catalog=await call('GET','/api/gene/assets'),asset=catalog.assets[0];sharedAsset=asset.id;expect(catalog.provenance[0].world_id).toBe(a.world_id);
    expect(await call('POST',`/api/gene/assets/${asset.id}/run`,{input:{rows:[1,2,3]}})).toMatchObject({origin:'gene',version:1,result:{count:3}});
    await call('POST',`/api/qianji/${fresh.profile.qianjiId}/chat`,{content:'use shared gene',idempotencyKey:'inheritance',rounds:1,runBudgetTokens:80000});
    for(let i=0;i<100;i++){if(!(await call('GET',`/api/worlds/${freshWorld.world_id}/api/run/status`)).running)break;await new Promise(r=>setTimeout(r,30));}
    const freshCore=new (await import('@emergentinc/persistence')).CoreStore(join(registry.directory(freshWorld.world_id),'ledger/v9_core.sqlite3'),{readOnly:true});
    try{const executed=freshCore.db.prepare("SELECT result,status FROM tool_executions WHERE tool='CALL_GENE_SKILL'").get();expect(executed?.status).toBe('SUCCESS');expect(String(executed?.result)).toContain('"origin":"gene"');}finally{freshCore.close();}
    await supervisor.rollback(checked.id,'Explicit test rollback after a new World was born');await login();
    expect((await publicCall('GET',`/api/public/orders/${publicOrder.order_id}/payment`,undefined,publicOrder.public_order_token)).status).toBe('PAID');
    expect((await publicCall('GET',`/api/public/orders/${pendingOrder.order_id}/payment`,undefined,pendingOrder.public_order_token)).status).toBe('AWAITING_PAYMENT');
    expect((await call('GET','/api/public-site')).revenue.mainnetAtomic).toBe('10000001');expect((await call('GET','/api/public-site')).orders).toHaveLength(2);
    expect((await call('GET',`/api/worlds/${a.world_id}`)).current.generation_id).toBe('G0001');expect((await call('GET','/api/worlds')).items.find((w:any)=>w.world_id===freshWorld.world_id).blockedReason).toBe('WORLD_CREATED_AFTER_RESTORED_GENERATION');
    expect(lineage.relevantMemories({kind:'generation_rollback'})).toHaveLength(1);
  }catch(error){throw new Error((error instanceof Error?error.stack+' Cause: '+String((error as any).cause):String(error))+' State: '+JSON.stringify(supervisor.list())+'\n'+fs.readFileSync(join(state,'server.log'),'utf8').slice(-1500)+'\n'+fs.readdirSync(state).filter(n=>n.startsWith('validation-')).map(n=>fs.readFileSync(join(state,n),'utf8').slice(-2500)).join('\n'));}
  finally{try{await runtime.stop();}catch{}supervisor.close();control.close();lineage.close();await new Promise<void>(r=>model.close(()=>r()));await new Promise<void>(r=>rpc.close(()=>r()));fs.rmSync(root,{recursive:true,force:true});}
},240000);
