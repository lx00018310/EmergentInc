import { createHash } from 'node:crypto';
import type { OwnerGoal } from '@emergentinc/protocol';
import { exactKeys, ownerInput, ownerConflict, goalHash } from './owner_goal_service.js';
import type { OwnerAutomationGate } from './owner_automation_gate.js';
import type { PublicStore } from './public_store.js';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import { CompanyArtifactService } from './company_artifact_service.js';

const stableKey = (key: string) => createHash('sha256').update(key).digest('hex');
type Authority = { question: string; productId: string; createNew: boolean; price: string | null; autonomousPrice: boolean; publish: boolean; unpublish: boolean; humanCondition: boolean };
export type ProductInput = { productId?: string; createNew?: boolean; nameEn: string; nameZh: string; descEn: string; descZh: string; priceUsdt?: string; enabled: boolean };

/** The only Owner product writer; deliberately not registered as a World tool. */
export class OwnerProductService {
  constructor(readonly store: PublicStore, private gate: OwnerAutomationGate, private manager: WorldRuntimeManager) {
    gate.store.db.exec(`CREATE TABLE IF NOT EXISTS owner_product_intents(
      goal_id TEXT PRIMARY KEY REFERENCES owner_goals(id),goal_revision INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,
      authority_json TEXT NOT NULL,target_hash TEXT,filename TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PENDING','PUBLISHED','BLOCKED','OUTCOME_UNKNOWN')),
      result_json TEXT,reason TEXT,updated_at INTEGER NOT NULL);`);
    gate.addUnknownCheck((_worldId,goalId) => Boolean(goalId&&gate.store.db.prepare("SELECT 1 FROM owner_product_intents WHERE goal_id=? AND state='OUTCOME_UNKNOWN'").get(goalId)));
  }
  catalog() { return this.store.products().items; }
  private authority(question: string, key: string, target: {productId?:unknown;createNew?:unknown}): Authority {
    // Only the current direct imperative grants authority, never a quote, question, history or a tool reply.
    const q = question.trim().replace(/^(?:(?:请|帮我|给我|再|我要|我希望|我需要)\s*)+|^(?:(?:please|I want to|I'd like to)\s+)+/i, '');
    const command=q.replace(/“[^”]*”|「[^」]*」|"[^"]*"|'[^']*'/g,' ');
    ownerInput(!/[?？]/.test(command) && !/^(?:看|查询|有什么|我想|能否|是否|怎么|如何)|^(?:what|show|can|could|how|is|are|do)\b/i.test(command), 'OWNER_PRODUCT_AUTH_REQUIRED');
    ownerInput(/^(?:把|将|上架|下架|新增|新建|创建|修改|更新|编辑|启用|停用|先|调查|调研|研究|你决定)|^(?:publish|unpublish|update|change|edit|create|add|research|investigate|first|decide|list)\s/i.test(q), 'OWNER_PRODUCT_AUTH_REQUIRED');
    ownerInput(/商品|产品|服务|卖什么|product|service|what to sell/i.test(q), 'OWNER_PRODUCT_AUTH_REQUIRED');
    ownerInput(!/翻译|复述|引用|转述|历史(?:对话|记录)|(?:skill|pixel|人物).{0,15}(?:说|写|回复|said|says)/i.test(command),'OWNER_PRODUCT_AUTH_REQUIRED');
    const publish = /上架|发布(?:这款|该|一个|一款|站内|公开|商城|的)?(?:商品|产品|服务)|\b(?:publish|list|enable)\b/i.test(command);
    const unpublish = /下架|停用|\b(?:disable|unpublish)\b/i.test(command);
    const edit = /修改|更新|编辑|改成|改为|定为|update|change|edit/i.test(command);
    ownerInput((publish || unpublish || edit) && !(publish && unpublish), 'OWNER_PRODUCT_AUTH_REQUIRED');
    ownerInput(!/不要(?:上架|发布|修改)|别(?:上架|发布)|\b(?:do not|don't)\s+(?:publish|list|enable|update|change|edit|create|add|unpublish|disable)\b/i.test(command), 'OWNER_PRODUCT_AUTH_REQUIRED');
    const createNew = target.createNew === true;
    ownerInput(target.createNew === undefined || typeof target.createNew === 'boolean', 'OWNER_PRODUCT_INPUT_INVALID');
    let productId: string;
    if (createNew) {
      ownerInput(target.productId === undefined && /新增|新建|创建|上架(?:一个|一款)|决定卖什么|(?:new|create|add|decide what to sell)/i.test(q), 'OWNER_PRODUCT_TARGET_REQUIRED');
      productId = `product_owner_${stableKey(key).slice(0,40)}`;
    } else {
      ownerInput(typeof target.productId === 'string', 'OWNER_PRODUCT_TARGET_REQUIRED');
      const matches = this.catalog().filter(p => [p.product_id,p.product_name_en,p.product_name_zh,...(p.product_id==='custom-service'?['定制服务','custom service']:[])].some(n=>typeof n==='string'&&n.trim()&&q.toLowerCase().includes(n.toLowerCase())));
      ownerInput(matches.length === 1 && matches[0]!.product_id === target.productId, 'OWNER_PRODUCT_TARGET_REQUIRED');
      productId = target.productId;
    }
    const prices = [...q.matchAll(/(?:USDT\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*USDT)/gi)].map(m=>m[1]??m[2]!);
    ownerInput(prices.length <= 1 && !/USDC|USD(?!T)|人民币|CNY|\bETH\b|\bBTC\b/i.test(q), 'OWNER_PRODUCT_PRICE_REQUIRED');
    const autonomousPrice = /(?:你|自行|自主).{0,25}(?:定价|价格)|(?:定价|价格).{0,12}(?:你决定|自行|自主)|(?:you decide|choose|decide|set).{0,30}(?:price|pricing)/i.test(q);
    const existingPrice = createNew ? null : this.store.product(false,productId).product_price;
    ownerInput(Boolean(prices[0] || autonomousPrice || existingPrice), 'OWNER_PRODUCT_PRICE_REQUIRED');
    return {question,productId,createNew,price:prices[0]??(!autonomousPrice&&existingPrice?String(existingPrice):null),autonomousPrice,publish,unpublish,
      humanCondition:/满足|验证|证明|确认.{0,15}(?:需求|市场|客户)|需求.{0,10}成立|真实客户|有客户|有需求|\bif\b|(?:once|when).{0,80}(?:demand|customer|market)|verified demand|proven demand|paying customers/i.test(command)};
  }
  private validate(input: unknown): asserts input is ProductInput {
    exactKeys(input,['productId','createNew','nameEn','nameZh','descEn','descZh','priceUsdt','enabled']);
    ownerInput(typeof input.enabled==='boolean' && ['nameEn','nameZh','descEn','descZh'].every(k=>typeof input[k]==='string'&&input[k].trim()),'OWNER_PRODUCT_INPUT_INVALID');
    ownerInput(input.priceUsdt===undefined||typeof input.priceUsdt==='string','OWNER_PRODUCT_INPUT_INVALID');
    // Unverifiable financial/customer/guaranteed performance claims require human evidence review.
    const claims=`${input.descEn} ${input.descZh}`.replace(/(?:不|无法|不能)保证(?:任何|具体)?(?:收益|赚钱|成功|准确(?:性|率)?)/g,'').replace(/\b(?:no guaranteed|not guaranteed|does not guarantee|cannot guarantee) (?:profits?|income|returns|success)/gi,'');
    ownerInput(!/保证.{0,12}(?:收益|赚钱|成功|准确)|稳赚|已有\d+.{0,8}客户|guaranteed (?:profit|income|returns)|\d+ paying customers/i.test(claims),'OWNER_PRODUCT_CLAIMS_REVIEW_REQUIRED');
  }
  configure(key: string, question: string, input: unknown) {
    this.validate(input);
    const old=this.gate.store.db.prepare('SELECT * FROM owner_control_requests WHERE key=?').get(`product_${stableKey(key)}`);
    if(old){if(old.payload_hash!==goalHash({question,input}))ownerConflict('IDEMPOTENCY_CONFLICT');return JSON.parse(String(old.response));}
    return this.write(key,this.authority(question,key,input),input);
  }
  private write(key: string, authority: Authority, input: ProductInput, targetHash?: string | null) {
    return this.gate.goals.request(`product_${stableKey(key)}`,{question:authority.question,input},()=>{
      this.gate.assertOn();
      const {productId,createNew}=authority;
      if (targetHash !== undefined) {
        const current = this.catalog().find(p=>p.product_id===productId);
        if ((current ? goalHash(current) : null) !== targetHash) ownerConflict('OWNER_PRODUCT_CHANGED');
      }
      const old = this.catalog().find(p=>p.product_id===productId);
      ownerInput(!authority.publish||input.enabled,'OWNER_PRODUCT_AUTH_REQUIRED');
      ownerInput(!authority.unpublish||!input.enabled,'OWNER_PRODUCT_AUTH_REQUIRED');
      ownerInput(input.enabled ? authority.publish || Boolean(old?.product_enabled) && !authority.unpublish : authority.unpublish || !old?.product_enabled,'OWNER_PRODUCT_AUTH_REQUIRED');
      if(authority.price && input.priceUsdt !== undefined)ownerInput(Number(input.priceUsdt)===Number(authority.price),'OWNER_PRODUCT_PRICE_MISMATCH');
      const price=authority.price??(authority.autonomousPrice?input.priceUsdt:undefined);
      ownerInput(Boolean(price),'OWNER_PRODUCT_PRICE_REQUIRED');
      const enabled=input.enabled && this.store.rails().length>0;
      if(createNew)this.store.ensureOwnerProduct(productId);
      const product=this.store.configureProduct(productId,{product_enabled:enabled,product_name_en:input.nameEn,product_name_zh:input.nameZh,
        product_description_en:input.descEn,product_description_zh:input.descZh,product_price:price,product_currency:'USDT'});
      const readback=this.store.product(false,productId),now=Date.now();
      const result={productId,enabled:readback.product_enabled===1,price:String(readback.product_price),nameEn:String(product.product_name_en),nameZh:String(product.product_name_zh),
        href:'/#products',updatedAt:now,reason:input.enabled&&!enabled?'PRICE_AND_PAYMENT_RAIL_REQUIRED':null};
      const event=this.gate.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_product_configured',NULL,?,?)").run(JSON.stringify({...result,requestKey:key,productHash:goalHash(readback)}),now);
      return {...result,eventId:Number(event.lastInsertRowid)};
    });
  }
  bind(goal: OwnerGoal, key: string, question: string, input: unknown, filename: unknown) {
    exactKeys(input,['productId','createNew']);
    ownerInput(typeof filename==='string'&&/^[a-zA-Z0-9_-]{1,60}\.json$/.test(filename),'OWNER_PRODUCT_INPUT_INVALID');
    ownerInput(/先|再|后|调查|调研|研究|research|investigate|then|after|first/i.test(question),'OWNER_PRODUCT_AUTH_REQUIRED');
    const authority=this.authority(question,key,input);ownerInput(authority.publish,'OWNER_PRODUCT_AUTH_REQUIRED');
    const current=this.catalog().find(p=>p.product_id===authority.productId);
    this.gate.store.db.prepare("INSERT INTO owner_product_intents VALUES(?,?,?,?,?,?,'PENDING',NULL,NULL,?)").run(goal.id,goal.specificationRevision,key,JSON.stringify(authority),current?goalHash(current):null,filename,Date.now());
  }
  instruction(goalId: string) {
    const row=this.gate.store.db.prepare('SELECT * FROM owner_product_intents WHERE goal_id=?').get(goalId);
    if(!row)return '';
    const a:Authority=JSON.parse(String(row.authority_json));
    return `\nPrepare ${row.filename} with save_artifact after actual research. Strict JSON: {"nameEn":"...","nameZh":"...","descEn":"...","descZh":"...","priceUsdt":"${a.price??'choose a justified price'}","enabled":true,"sourceOperationIds":["successful source-reading tool operation_id"],"requiresHumanReview":false}. Use truthful service scope, no invented customers, revenue or guarantees. Sources must be actual webfetch/READ_GENE_ASSET/READ_WORLD_ASSET receipts in this goal's Run. The server alone may publish this one authorized product; you have no publishing tool. Conditions needing market/customer verification require human review.`;
  }
  continuePublication(goal: OwnerGoal, dispatchId: string) {
    const db=this.gate.store.db,row=db.prepare("SELECT * FROM owner_product_intents WHERE goal_id=? AND state='PENDING'").get(goal.id);
    if(!row)return;
    const block=(reason:string)=>{db.prepare("UPDATE owner_product_intents SET state='BLOCKED',reason=?,updated_at=? WHERE goal_id=? AND state='PENDING'").run(reason,Date.now(),goal.id);this.gate.goals.event(goal.id,'product_blocked',{reason});};
    if(goal.specificationRevision!==row.goal_revision||['STOPPED','ARCHIVED'].includes(goal.status)){block('OWNER_GOAL_PERMISSION_CHANGED');return;}
    if(goal.status==='PAUSED'||!this.gate.isOn())return;
    const authority:Authority=JSON.parse(String(row.authority_json));
    if(authority.humanCondition && goal.status!=='COMPLETED'){block('OWNER_PRODUCT_EVIDENCE_REVIEW_REQUIRED');return;}
    const artifacts=new CompanyArtifactService(this.gate.store,this.manager.registry.workspace);
    const evidence=this.gate.goals.detail(goal.id).evidence.filter(e=>e.kind==='artifact'&&e.specificationRevision===goal.specificationRevision&&e.reference.endsWith('/'+row.filename)&&(e.worldId?e.reference.startsWith(`evidence/owner-${dispatchId}/`):artifacts.boundTo(e,dispatchId)));
    if(evidence.length!==1){block('OWNER_PRODUCT_DELIVERABLE_REQUIRED');return;}
    const e=evidence[0]!,runtime=e.worldId?this.manager.peek(e.worldId):undefined;
    try {
      ownerInput(e.bytes<=50_000,'OWNER_EVIDENCE_CHANGED');const bytes=artifacts.read(e);
      const delivery=JSON.parse(bytes.toString('utf8'));exactKeys(delivery,['nameEn','nameZh','descEn','descZh','priceUsdt','enabled','sourceOperationIds','requiresHumanReview']);
      ownerInput(delivery.requiresHumanReview===false,'OWNER_PRODUCT_EVIDENCE_REVIEW_REQUIRED');
      ownerInput(delivery.enabled===true&&Array.isArray(delivery.sourceOperationIds)&&delivery.sourceOperationIds.length>0&&delivery.sourceOperationIds.length<=20,'OWNER_PRODUCT_SOURCE_REQUIRED');
      for(const id of delivery.sourceOperationIds){
        ownerInput(typeof id==='string','OWNER_PRODUCT_SOURCE_REQUIRED');
        if(runtime){
          const source=runtime.store.db.prepare("SELECT t.result FROM tool_executions t WHERE t.operation_id=? AND t.status='SUCCESS' AND t.tool IN ('webfetch','READ_GENE_ASSET','READ_WORLD_ASSET') AND t.run_id IN (SELECT run_id FROM runs)").get(id);
          const tool=runtime.store.db.prepare('SELECT run_id FROM tool_executions WHERE operation_id=?').get(id);
          ownerInput(source&&tool&&db.prepare('SELECT 1 FROM owner_run_permits WHERE run_id=? AND goal_id=? AND goal_revision=? AND dispatch_id=?').get(tool.run_id,goal.id,goal.specificationRevision,dispatchId),'OWNER_PRODUCT_SOURCE_REQUIRED');
        }else if(e.worldId){
          const legacy=db.prepare("SELECT 1 FROM sqlite_master WHERE name='company_legacy_receipts'").get()&&db.prepare(`SELECT 1 FROM company_legacy_receipts r JOIN company_execution_attempts a ON a.run_id=r.run_id WHERE r.operation_id=? AND r.status='SUCCESS' AND r.tool IN ('webfetch','READ_GENE_ASSET','READ_WORLD_ASSET') AND a.goal_id=? AND a.goal_revision=? AND a.dispatch_id=? AND a.world_id=? AND a.state='COMPLETED'`).get(id,goal.id,goal.specificationRevision,dispatchId,e.worldId);
          ownerInput(typeof id==='string'&&legacy,'OWNER_PRODUCT_SOURCE_REQUIRED');
        }else ownerInput(typeof id==='string'&&db.prepare(`SELECT 1 FROM company_worker_receipts r JOIN company_execution_attempts a ON a.id=r.attempt_id WHERE r.applied=1 AND a.goal_id=? AND a.goal_revision=? AND a.dispatch_id=? AND a.state='COMPLETED' AND json_extract(r.payload_json,'$.kind')='tool' AND json_extract(r.payload_json,'$.payload.result.operation_id')=? AND json_extract(r.payload_json,'$.payload.result.status')='SUCCESS' AND json_extract(r.payload_json,'$.payload.result.tool') IN ('webfetch','READ_GENE_ASSET','READ_WORLD_ASSET')`).get(goal.id,goal.specificationRevision,dispatchId,id),'OWNER_PRODUCT_SOURCE_REQUIRED');
      }
      const {sourceOperationIds,requiresHumanReview,...input}=delivery;this.validate(input);
      this.gate.store.transaction(()=>{
        const current=this.gate.goals.get(goal.id);ownerInput(current.specificationRevision===row.goal_revision&&!['PAUSED','STOPPED','ARCHIVED'].includes(current.status),'OWNER_GOAL_PERMISSION_CHANGED');
        this.gate.assertOn();
        if(!this.store.rails().length)ownerConflict('PRICE_AND_PAYMENT_RAIL_REQUIRED');
        const result=this.write(`goal:${row.request_key}`,authority,input,row.target_hash as string|null);
        db.prepare("UPDATE owner_product_intents SET state='PUBLISHED',result_json=?,reason=NULL,updated_at=? WHERE goal_id=? AND state='PENDING'").run(JSON.stringify(result),Date.now(),goal.id);
        this.gate.goals.event(goal.id,'product_published',result);
      });
    } catch(error) { block(error instanceof Error?error.message:'OWNER_PRODUCT_EVIDENCE_REVIEW_REQUIRED'); }
  }
}
