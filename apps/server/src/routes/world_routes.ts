import { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { CoreStore } from '@emergentinc/persistence';
import { validateQianjiNarrative } from '@emergentinc/domain';
import { WorldRuntimeManager } from '../services/world_runtime_manager.js';
import { QianjiWorldGateway } from '../services/qianji_world_gateway.js';
import { GenePromotionService,readGeneCatalog,loadGeneAsset,executeGeneSkill } from '../services/gene_promotion_service.js';
import { PaymentService } from '../services/payment_service.js';
import { PaymentMonitor } from '../services/payment_monitor.js';
import {USDT_CHAINS,paymentChain,recipientAddress} from '../services/payment_assets.js';
import { registerQianjiRoutes } from './qianji_routes.js';
import { GachaService } from '../services/gacha_service.js';
import { GachaImageService } from '../services/gacha_image.js';
import { registerGachaRoutes } from './gacha_routes.js';
import { ModelProvider,UsageMeter } from '@emergentinc/model';
import { RunService } from '../services/run_service.js';
import type { OwnerWorkService } from '../services/owner_work_service.js';

export interface WorldRouteServices {manager:WorldRuntimeManager;promotion:GenePromotionService;payments:PaymentService;monitor:PaymentMonitor;
  legacy?:CoreStore;provider?:ModelProvider;meter?:UsageMeter;modelName:string;ownerWork?:OwnerWorkService}
export async function registerWorldRoutes(app:FastifyInstance,s:WorldRouteServices){
  const {manager,promotion,payments,monitor}=s,control=manager.registry.control,gateway=new QianjiWorldGateway(manager);
  // Existing portrait/narrative endpoints keep their contracts; physical identity is explicitly replaced by World.
  const runGate={getStatus:()=>({running:manager.list().some(w=>w.running)})} as RunService;
  await registerQianjiRoutes(app,{store:control,workspaceRoot:manager.registry.workspace,runService:runGate,worlds:manager,gateway,historyStore:s.legacy,historyWorkspace:s.legacy?manager.registry.workspace+'/system/legacy/v22/raw':undefined});
  await registerGachaRoutes(app,new GachaService({store:control,workspaceRoot:manager.registry.workspace,provider:s.provider,usageMeter:s.meter,modelName:s.modelName,
    createWorld:(narrative,birth)=>manager.registry.create(narrative,{birthIdentity:birth}).qianji_id}),control,new GachaImageService(control,manager.registry.workspace));
  app.post('/qianji',async req=>{const b=req.body as any,checked=validateQianjiNarrative(b?.narrative);if(!checked.valid)throw new Error('QIANJI_NARRATIVE_INVALID');return manager.registry.create(checked.value);});
  app.get('/worlds',async()=>({items:manager.list()}));
  app.get<{Params:{id:string}}>('/qianji/:id/world',async req=>control.worldForQianji(req.params.id));
  app.get('/world',async()=>({worlds:manager.list(),pixels:[],round:0,environment_md:"请选择 World",metrics:{alive_pixels:0,total_pixels:0,total_energy:0}}));
  app.get('/run/status',async()=>({scope:'control',running:false,result_status:'SELECT_WORLD',current_round:0,completed_rounds:0,requested_rounds:0,unfinalized_operations:{hasUnfinalized:false}}));
  app.get<{Params:{id:string}}>('/worlds/:id',async req=>{const runtime=await manager.open(req.params.id);return {...control.world(req.params.id),...runtime.world.getWorldDto(),current:runtime.life.current.meta(),revenue:payments.revenue(req.params.id)};});
  app.put<{Params:{id:string}}>('/worlds/:id/gateway',async req=>{const b=req.body as any;await manager.replaceGateway(req.params.id,b?.pixel_id,b?.expected_revision);return control.world(req.params.id);});
  app.get<{Params:{id:string}}>('/worlds/:id/current',async req=>(await manager.open(req.params.id)).life.current.meta());
  app.post<{Params:{id:string}}>('/worlds/:id/body/skills',async req=>{const b=req.body as any;return promotion.createBodySkill(req.params.id,b?.pixel_id,b?.candidate);});
  app.post<{Params:{id:string;skill:string}}>('/worlds/:id/body/skills/:skill/run',async req=>promotion.runBodySkill(req.params.id,req.params.skill,(req.body as any)?.input));
  app.post<{Params:{id:string}}>('/worlds/:id/promotions',async req=>{const b=req.body as any;return promotion.nominate(req.params.id,b?.pixel_id,b);});
  app.get<{Params:{id:string}}>('/worlds/:id/revenue',async req=>payments.revenue(req.params.id));
  app.get<{Params:{id:string}}>('/worlds/:id/memories',async req=>{control.world(req.params.id);return {items:manager.registry.lineage.relevantMemories({worldId:req.params.id,limit:100})};});
  // Only the authenticated Root HTTP surface exposes review. Agent tools cannot route back into it.
  app.get('/evolution/promotions',async()=>({items:promotion.list()}));
  app.get('/evolution/migrations',async()=>{
    const groups=new Map<string,any>();
    for(const event of manager.registry.lineage.db.prepare("SELECT * FROM life_events WHERE kind IN ('world_migration_planned','world_current_migrated','world_current_migration_failed','generation_born','generation_restored') ORDER BY sequence DESC LIMIT 300").all().reverse()){
      const payload=JSON.parse(String(event.payload));if(!payload.candidateId)continue;
      const group=groups.get(payload.candidateId)??{candidateId:payload.candidateId,generation:event.generation_id,total:0,successfulWorlds:[],failedWorlds:[],state:'PREPARING'};
      if(event.kind==='world_migration_planned')group.total=payload.total;
      if(event.kind==='world_current_migrated')group.successfulWorlds.push(payload.worldId);
      if(event.kind==='world_current_migration_failed')group.failedWorlds.push({worldId:payload.worldId,reason:payload.reason});
      if(event.kind==='generation_born')group.state='BORN';if(event.kind==='generation_restored')group.state='RESTORED';groups.set(payload.candidateId,group);
    }
    return {items:[...groups.values()].reverse(),blockedWorlds:manager.list().filter(w=>w.blockedReason||w.runtimeFailure)};
  });
  app.get<{Params:{id:string}}>('/evolution/promotions/:id',async req=>promotion.get(req.params.id));
  app.post<{Params:{id:string}}>('/evolution/promotions/:id/propose',async req=>promotion.propose(req.params.id,req.body as any));
  app.get('/gene/assets',async()=>({...readGeneCatalog(promotion.release),provenance:manager.registry.lineage.db.prepare('SELECT v.*,s.world_id,s.pixel_id,s.candidate_id,s.source_hash,s.snapshot_hash FROM gene_asset_versions v JOIN gene_asset_sources s USING(asset_id,version)').all()}));
  app.get<{Params:{id:string}}>('/evolution/proposals/:id/request',async req=>{const row=manager.registry.lineage.db.prepare('SELECT id FROM gene_promotion_candidates WHERE proposal_id=?').get(req.params.id);if(!row)throw new Error('PROMOTION_REQUEST_NOT_FOUND');const fs=await import('node:fs'),path=await import('node:path');return JSON.parse(fs.readFileSync(path.join(manager.registry.workspace,'system/evolution/requests',req.params.id+'.json'),'utf8'));});
  app.get<{Params:{id:string}}>('/gene/assets/:id',async req=>loadGeneAsset(promotion.release,req.params.id));
  app.post<{Params:{id:string}}>('/gene/assets/:id/run',async req=>executeGeneSkill(promotion.release,req.params.id,(req.body as any)?.input,String(manager.registry.effectiveGeneration().gene_hash)));
  app.get('/payments/rails',async()=>({items:payments.rails(),chains:USDT_CHAINS,legacy:payments.legacy(),monitor:monitor.status()}));
  app.put('/payments/rails',async req=>{const b=req.body as any;if(!b||b.network!=='mainnet'||Object.keys(b).some(k=>!['rail_id','chain','network','recipient_address','status','expected_revision','rpc_id'].includes(k)))throw new Error('PAYMENT_RAIL_CONFIG_INVALID');const chain=paymentChain(b.chain);recipientAddress(chain,b.recipient_address);const start=b.status==='ENABLED'?await monitor.validateRecipient(chain,b.recipient_address):0;return payments.configureRail(b,start);});
  app.post('/payments/invoices',async req=>payments.createInvoice(req.body as any));
  app.get('/payments/invoices',async req=>{const worldId=(req.query as any)?.world_id;if(worldId)control.world(worldId);return {items:payments.db.prepare(`SELECT * FROM payment_invoices ${worldId?'WHERE world_id=?':''} ORDER BY created_at DESC LIMIT 200`).all(...(worldId?[worldId]:[]))};});
  app.get<{Params:{id:string}}>('/payments/invoices/:id',async req=>payments.invoice(req.params.id));
  app.get<{Params:{id:string}}>('/payments/invoices/:id/qr',async(req,reply)=>reply.type('image/png').send(await QRCode.toBuffer(payments.invoice(req.params.id).qr_payload,{width:320,errorCorrectionLevel:'M'})));
  app.post<{Params:{id:string}}>('/payments/invoices/:id/scan',async req=>{await monitor.scanInvoice(req.params.id);return payments.invoice(req.params.id);});
  app.get('/payments/unmatched',async()=>({items:payments.db.prepare('SELECT * FROM payment_unmatched ORDER BY created_at DESC LIMIT 200').all()}));
  app.post<{Params:{id:string}}>('/payments/invoices/:id/cancel',async req=>{payments.invoice(req.params.id);const result=payments.db.prepare("UPDATE payment_invoices SET status='CANCELLED',cancelled_at=? WHERE invoice_id=? AND status='WAITING'").run(Date.now(),req.params.id);if(!result.changes)throw new Error('INVOICE_NOT_CANCELLABLE');return payments.invoice(req.params.id);});
  // Forward scoped runtime requests only after the parent Owner auth hook. Each child has no listening socket.
  app.all<{Params:{id:string;'*':string}}>('/worlds/:id/api/*',async(req,reply)=>{
    const runtime=await manager.open(req.params.id),pathname=req.params['*'];
    if(/^(?:qianji|gacha|meetings|evolution|payments|gene|private)(?:\/|$)/.test(pathname))return reply.status(403).send({detail:'WORLD_API_SCOPE_DENIED'});
    const query=req.url.includes('?')?req.url.slice(req.url.indexOf('?')):'';
    const response=await runtime.api.inject({method:req.method as any,url:'/api/'+pathname+query,payload:req.body as any,
      headers:{...(req.headers['content-type']?{'content-type':req.headers['content-type']}: {})}});
    if(response.headers['content-type'])reply.type(String(response.headers['content-type']));return reply.status(response.statusCode).send(response.rawPayload);
  });
}
