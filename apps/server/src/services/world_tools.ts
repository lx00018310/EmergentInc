import { ToolRegistry, ToolContext } from '@emergentinc/tools';
import { GenePromotionService, readGeneCatalog, loadGeneAsset, executeGeneSkill } from './gene_promotion_service.js';
import { PaymentService } from './payment_service.js';
import { listSkills, readSkill } from './skill_library.js';

/** Closures resolve World and actor from the trusted runtime, never from agent arguments. */
export function registerWorldTools(registry:ToolRegistry,worldId:string,promotion:GenePromotionService,payments:PaymentService){
  const register=(name:string,description:string,effect:'read'|'write',properties:Record<string,any>,required:string[],handler:(args:any,pixel:string,key:string,ctx?:ToolContext)=>Promise<unknown>|unknown)=>{
    registry.register({name,description,effect,enabled:true,timeout_seconds:30,input_schema:{type:'object',properties,required,additionalProperties:false}},async(args,ctx)=>{
      if(ctx.workspaceRoot!==promotion.manager.registry.directory(worldId))throw new Error('WORLD_TOOL_CONTEXT_CONFLICT');
      return {operation_id:ctx.operationId,tool:name,status:'SUCCESS',output:await handler(args,ctx.pixelId,ctx.operationId,ctx),duration_ms:0,truncated:false,costCny:0};
    });
  };
  register('CREATE_BODY_SKILL','生成并测试本 World 的纯 JSON JavaScript 技能；不改变 Gene。','write',
    {candidate:{type:'object',description:'skill_id,purpose,source,interface_version,tests'}},['candidate'],(a,p)=>promotion.createBodySkill(worldId,p,a.candidate));
  register('CALL_BODY_SKILL','执行本 World 已验证的 Body 技能。','write',{skill_id:{type:'string'},input:{}},['skill_id','input'],a=>promotion.runBodySkill(worldId,a.skill_id,a.input));
  const extensions=async(pixel?:string)=>{if(pixel){const r=await promotion.manager.open(worldId);if(!r.store.pixels.getPixelAccount(pixel)?.active)throw new Error('EXTENSION_ACTOR_INVALID');}return promotion.manager.extensions(worldId);};
  register('LIST_EXTENSIONS','列出本 World 私有扩展、版本、哈希、契约及阻断原因；不读取其他 World。','read',{},[],async(_a,p)=> (await extensions(p)).list());
  register('RUN_EXTENSION','通过现有纯 JSON 解释器执行本 World 已启用扩展；不能访问网络、文件、数据库或凭据。','read',{id:{type:'string'},input:{}},['id','input'],async(a,p)=>(await extensions(p)).run(a.id,a.input));
  register('SUBMIT_EXTENSION','默认将私有纯计算程序保存为独立扩展，不改变 Core 或 Generation。manifest 须含 schema=1、id、version、engine、requiredContracts、dataSchemaVersion、source、至少两个 tests。expectedRevision/expectedHash 来自 LIST_EXTENSIONS，首次为 0/null；不支持的宿主代码只存档，不加载。','write',{manifest:{type:'object'},expectedRevision:{type:'integer'},expectedHash:{type:['string','null']}},['manifest','expectedRevision','expectedHash'],async(a,p,key)=>{
    const runtime=await promotion.manager.open(worldId);if(!runtime.store.pixels.getPixelAccount(p)?.active)throw new Error('EXTENSION_ACTOR_INVALID');
    const service=await extensions(),saved=service.submit(p,a.manifest);return saved.supported?service.action(saved.id,{action:'activate',hash:saved.hash,expectedRevision:a.expectedRevision,expectedHash:a.expectedHash,idempotencyKey:key}):saved;
  });
  register('SET_EXTENSION_STATE','按准确版本和指针 revision 激活、停用或回退本 World 私有扩展；保留所有版本与数据。','write',{id:{type:'string'},action:{type:'string',enum:['activate','disable','rollback']},hash:{type:'string'},expectedRevision:{type:'integer'},expectedHash:{type:['string','null']}},['id','action','expectedRevision','expectedHash'],async(a,p,key)=>{const {id,...input}=a;return (await extensions(p)).action(id,{...input,idempotencyKey:key});});
  register('NOMINATE_GENE_ASSET','冻结本 World 资产快照并提名；等待 Owner 隐私审查与批准，不自动晋升。','write',
    {kind:{type:'string',enum:['knowledge','template','dataset','skill','code']},sourcePath:{type:'string'},metadata:{type:'object'}},['kind','sourcePath','metadata'],(a,p)=>promotion.nominate(worldId,p,a));
  register('PROMOTE_BODY_SKILL','提名已实际成功运行的本 World Body 技能，保留创建者和使用证据，等待 Owner 审批。','write',
    {skill_id:{type:'string'},metadata:{type:'object'}},['skill_id'],(a,p)=>promotion.promoteBodySkill(worldId,p,a.skill_id,a.metadata));
  register('LIST_WORLD_ASSETS','读取仅本 World 可见的已共享资产目录。','read',{},[],()=>promotion.worldAssets(worldId));
  register('READ_WORLD_ASSET','读取本 World 共享资产并验证快照哈希。','read',{asset_id:{type:'string'}},['asset_id'],a=>promotion.readWorldAsset(worldId,a.asset_id));
  register('LIST_GENE_ASSETS','读取本代公共 Gene 资产目录。','read',{},[],()=>readGeneCatalog(promotion.release));
  register('READ_GENE_ASSET','读取本代公共 Gene 资产，验证内容哈希。','read',{asset_id:{type:'string'}},['asset_id'],a=>loadGeneAsset(promotion.release,a.asset_id));
  register('LIST_SKILLS','列出可用工作方法 Skill 目录：自己的 Body 文档与已批准 Gene 知识资产；只返回元数据，不返回正文。Skill 是参考方法，不授予任何额外权限。','read',{},[],(a,p,key,ctx)=>listSkills(ctx!,promotion.release));
  register('READ_SKILL','按 LIST_SKILLS 返回的 ref 读取一份工作方法 Skill 正文（body:<slug> 或 gene:<asset_id>）；仅限自己的 Body 与已批准 Gene。','read',{ref:{type:'string',description:'body:<slug> 或 gene:<asset_id>'}},['ref'],(a,p,key,ctx)=>readSkill(ctx!,promotion.release,a.ref));
  register('CALL_GENE_SKILL','执行本代公共 Gene 技能，输出来源、版本和实现哈希。','read',{asset_id:{type:'string'},input:{}},['asset_id','input'],a=>executeGeneSkill(promotion.release,a.asset_id,a.input,String(promotion.manager.registry.effectiveGeneration().gene_hash)));
  register('LIST_PAYMENT_RAILS','查看 Owner 已启用的 USDT 收款链和公开地址；不返回 RPC 配置或凭据。','read',{},[],()=>payments.rails().filter(r=>r.status==='ENABLED').map(r=>({rail_id:r.rail_id,chain:r.chain,asset:r.asset,mint:r.mint,decimals:r.decimals,recipient_address:r.recipient_address})));
  register('CREATE_PAYMENT_INVOICE','创建本 World 的 USDT 收款发票；只使用 Owner 已启用 rail，无钱包签名或付款能力。','write',
    {rail_id:{type:'string'},amount:{type:'string',description:'USDT 十进制字符串，最多6位小数；非 Solana 订单会有唯一尾数，请按发票实际金额支付'},expires_at:{type:'integer'}},['rail_id','amount'],(a,_p,key)=>payments.createInvoice({...a,qianji_id:promotion.manager.registry.control.world(worldId).qianji_id,idempotency_key:key},worldId));
}
