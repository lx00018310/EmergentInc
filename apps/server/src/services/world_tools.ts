import { ToolRegistry } from '@emergentinc/tools';
import { GenePromotionService, readGeneCatalog, loadGeneAsset, executeGeneSkill } from './gene_promotion_service.js';
import { PaymentService } from './payment_service.js';

/** Closures resolve World and actor from the trusted runtime, never from agent arguments. */
export function registerWorldTools(registry:ToolRegistry,worldId:string,promotion:GenePromotionService,payments:PaymentService){
  const register=(name:string,description:string,effect:'read'|'write',properties:Record<string,any>,required:string[],handler:(args:any,pixel:string,key:string)=>Promise<unknown>|unknown)=>{
    registry.register({name,description,effect,enabled:true,timeout_seconds:30,input_schema:{type:'object',properties,required,additionalProperties:false}},async(args,ctx)=>{
      if(ctx.workspaceRoot!==promotion.manager.registry.directory(worldId))throw new Error('WORLD_TOOL_CONTEXT_CONFLICT');
      return {operation_id:ctx.operationId,tool:name,status:'SUCCESS',output:await handler(args,ctx.pixelId,ctx.operationId),duration_ms:0,truncated:false,costCny:0};
    });
  };
  register('CREATE_BODY_SKILL','生成并测试本 World 的纯 JSON JavaScript 技能；不改变 Gene。','write',
    {candidate:{type:'object',description:'skill_id,purpose,source,interface_version,tests'}},['candidate'],(a,p)=>promotion.createBodySkill(worldId,p,a.candidate));
  register('CALL_BODY_SKILL','执行本 World 已验证的 Body 技能。','write',{skill_id:{type:'string'},input:{}},['skill_id','input'],a=>promotion.runBodySkill(worldId,a.skill_id,a.input));
  register('NOMINATE_GENE_ASSET','冻结本 World 资产快照并提名；等待 Owner 隐私审查与批准，不自动晋升。','write',
    {kind:{type:'string',enum:['knowledge','template','dataset','skill','code']},sourcePath:{type:'string'},metadata:{type:'object'}},['kind','sourcePath','metadata'],(a,p)=>promotion.nominate(worldId,p,a));
  register('PROMOTE_BODY_SKILL','提名已实际成功运行的本 World Body 技能，保留创建者和使用证据，等待 Owner 审批。','write',
    {skill_id:{type:'string'},metadata:{type:'object'}},['skill_id'],(a,p)=>promotion.promoteBodySkill(worldId,p,a.skill_id,a.metadata));
  register('LIST_WORLD_ASSETS','读取仅本 World 可见的已共享资产目录。','read',{},[],()=>promotion.worldAssets(worldId));
  register('READ_WORLD_ASSET','读取本 World 共享资产并验证快照哈希。','read',{asset_id:{type:'string'}},['asset_id'],a=>promotion.readWorldAsset(worldId,a.asset_id));
  register('LIST_GENE_ASSETS','读取本代公共 Gene 资产目录。','read',{},[],()=>readGeneCatalog(promotion.release));
  register('READ_GENE_ASSET','读取本代公共 Gene 资产，验证内容哈希。','read',{asset_id:{type:'string'}},['asset_id'],a=>loadGeneAsset(promotion.release,a.asset_id));
  register('CALL_GENE_SKILL','执行本代公共 Gene 技能，输出来源、版本和实现哈希。','read',{asset_id:{type:'string'},input:{}},['asset_id','input'],a=>executeGeneSkill(promotion.release,a.asset_id,a.input,String(promotion.manager.registry.effectiveGeneration().gene_hash)));
  register('LIST_PAYMENT_RAILS','查看 Owner 已启用的 USDT 收款链和公开地址；不返回 RPC 配置或凭据。','read',{},[],()=>payments.rails().filter(r=>r.status==='ENABLED').map(r=>({rail_id:r.rail_id,chain:r.chain,asset:r.asset,mint:r.mint,decimals:r.decimals,recipient_address:r.recipient_address})));
  register('CREATE_PAYMENT_INVOICE','创建本 World 的 USDT 收款发票；只使用 Owner 已启用 rail，无钱包签名或付款能力。','write',
    {rail_id:{type:'string'},amount:{type:'string',description:'USDT 十进制字符串，最多6位小数；非 Solana 订单会有唯一尾数，请按发票实际金额支付'},expires_at:{type:'integer'}},['rail_id','amount'],(a,_p,key)=>payments.createInvoice({...a,qianji_id:promotion.manager.registry.control.world(worldId).qianji_id,idempotency_key:key},worldId));
}
