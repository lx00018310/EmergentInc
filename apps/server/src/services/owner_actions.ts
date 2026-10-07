import { randomUUID } from 'node:crypto';
import type { OwnerOverview, OwnerActionProposal } from '@emergentinc/protocol';

/** A finite grammar emits proposals only. Model output is never executable input. */
export function proposeOwnerAction(question:string, data:OwnerOverview, language:'en'|'zh-CN'):{answer:string;proposals:OwnerActionProposal[]}|null {
  const reply=(zh:string,en:string,proposals:OwnerActionProposal[]=[])=>{
    const answer=language==='en'?en:zh;
    return {answer,proposals:proposals.map(p=>({...p,explanation:answer,risk:p.action.type==='open_details'?'read' as const:p.action.type==='business_plan_approve'?'sensitive' as const:'normal' as const}))};
  };
  const chat=/^(?:问|询问)\s*(所有人|全部人物)[\s：:]*(.+)$/.exec(question) ?? /^(?:问|询问)\s*(\S+?)\s*[：:]?\s+(.+)$/.exec(question) ?? /^ask\s+(everyone|all|\S+)\s+(.+)$/i.exec(question);
  // Chinese names commonly have no separating space: match actual names, never guess a recipient.
  const named=!chat ? data.people.filter(p=>question.startsWith('问'+p.name)||question.startsWith('询问'+p.name)) : [];
  if(chat||named.length){
    const target=chat?.[1];
    const people=chat ? /^(所有人|全部人物|everyone|all)$/i.test(target!)?data.people.filter(p=>p.status==='ACTIVE'):data.people.filter(p=>p.name===target||p.id===target) : named;
    if(!people.length||(!chat&&people.length!==1)||chat&&!/^(所有人|全部人物|everyone|all)$/i.test(target!)&&people.length!==1)
      return reply('人物名称不唯一或不存在，请使用人物 ID。','The person is missing or ambiguous. Use a person ID.');
    const message=chat?.[2] ?? question.replace(/^(询问|问)/,'').slice(people[0]!.name.length).replace(/^[\s：:]+/,'');
    if(!message.trim())return reply('请写明要发送的内容。','Specify the message to send.');
    return reply('已生成对话提案，请检查收件人和内容后确认。','Review the recipients and message, then confirm.',[{id:randomUUID(),requiresApproval:true,action:{type:'qianji_chat',targets:people.map(p=>({id:p.id,name:p.name})),message}}]);
  }
  const plan=/^(拒绝资源|reject resource)/i.test(question)?null:/^(批准|拒绝|approve|reject)\s*(.*)$/i.exec(question);
  const hire=/^(批准招聘(?:申请)?|同意招聘(?:申请)?|拒绝招聘(?:申请)?|批准新建|同意新建|拒绝新建|approve recruitment(?: request)?|reject recruitment(?: request)?)\s*(.*)$/i.exec(question);
  if(hire){const key=hire[2]!.trim(),matches=data.work?.requests.filter(r=>r.state==='PENDING'&&(!key||r.id===key||r.role===key))??[];
    if(matches.length!==1)return reply('请指定唯一的招聘申请 ID 或职责名称。','Specify a unique recruitment request ID or role.');
    const r=matches[0]!,type=/^(批准|同意|approve)/i.test(hire[1]!)?'recruit_approve':'recruit_reject';
    return reply('已识别招聘决定。','Recruitment decision identified.',[{id:randomUUID(),requiresApproval:true,action:{type,requestId:r.id,hash:r.hash,role:r.role,reason:r.reason,instruction:r.instruction}}]);
  }
  if(plan){
    const key=plan[2]!.trim(), pending=data.inbox.filter(i=>i.type==='plan');
    const matches=/^(刚才那个(?:营销)?方案|这个方案|方案|the plan)?$/i.test(key)?pending:pending.filter(i=>i.id===`plan:${key}`||i.summary===key);
    if(matches.length!==1)return reply('请指定待批准方案的 ID 或完整名称。','Specify the pending plan ID or full title.');
    const type=/^(批准|approve)$/i.test(plan[1]!)?'business_plan_approve':'business_plan_reject';
    return reply('请检查当前方案版本、额度和外部动作，再确认。','Review the current plan version, budget and external actions before confirming.',matches[0]!.actions!.filter(p=>p.action.type===type));
  }
  const resource=/^(提供资源|拒绝资源|provide resource|reject resource)\s+(.+)$/i.exec(question) ?? (question==='这个数据以后再提供'?['','拒绝资源','']:null);
  if(resource){
    const matches=data.inbox.filter(i=>i.type==='resource'&&(!resource[2]||i.id===`resource:${resource[2]}`||i.summary===resource[2]));
    if(matches.length!==1||!matches[0]!.actions?.length)return reply('请指定资源请求 ID；恢复类请求需进入详情处理。','Specify a resource request ID. Recovery requests require the detail page.');
    const type=/^(提供资源|provide resource)$/i.test(resource[1]!)?'resource_provided':'resource_reject';
    return reply('确认提供会验证资料已存在；拒绝会停止关联方案。','Providing verifies that the resource exists; rejecting stops its plan.',matches[0]!.actions!.filter(p=>p.action.type===type));
  }
  if(/^(打开|open)\s*(发布页面|升级页面|upgrade|publish)$/i.test(question))return reply('请通过高级菜单打开独立发布升级页面。发布仍需在该服务检查并批准。','Open the independent upgrade page from Advanced. Review and approval remain in that service.');
  const detail=/^(?:打开|open)\s+(\S+?)(?:\s*详情|\s+details)?$/i.exec(question);
  if(detail){
    const key=detail[1]!,person=data.people.filter(p=>p.id===key||p.name===key),item=data.inbox.filter(i=>i.id===key||i.id.endsWith(':'+key));
    const href=person.length===1?`/QIAN?qianji=${encodeURIComponent(person[0]!.id)}`:item.length===1&&item[0]!.href.startsWith('/')?item[0]!.href:null;
    if(href)return reply('查看对应的详情与证据。','Open the relevant details and evidence.',[{id:randomUUID(),requiresApproval:false,action:{type:'open_details',href}}]);
    return reply('请指定唯一的人物 ID 或待办 ID。','Specify a unique person or Inbox item ID.');
  }
  return null;
}
