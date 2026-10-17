import { randomUUID } from 'node:crypto';
import type { OwnerOverview, OwnerActionProposal } from '@emergentinc/protocol';
/** Only the current Owner sentence can select a real pending resource decision. */
export function proposeOwnerAction(question:string,data:OwnerOverview,language:'en'|'zh-CN'):{answer:string;proposals:OwnerActionProposal[]}|null {
  const reply=(zh:string,en:string,proposals:OwnerActionProposal[]=[])=>({answer:language==='en'?en:zh,proposals});
  const hire=/^(批准招聘(?:申请)?|同意招聘(?:申请)?|拒绝招聘(?:申请)?|批准新建|同意新建|拒绝新建|approve recruitment(?: request)?|reject recruitment(?: request)?)\s*(.*)$/i.exec(question);
  if(hire){
    const key=hire[2]!.trim(),matches=data.work?.requests.filter(r=>r.state==='PENDING'&&(!key||r.id===key||r.role===key))??[];
    if(matches.length!==1)return reply('请指定唯一的资源申请 ID 或职责名称。','Specify a unique resource request ID or role.');
    const request=matches[0]!,type=/^(批准|同意|approve)/i.test(hire[1]!)?'recruit_approve':'recruit_reject';
    return reply('已识别资源决定。','Resource decision identified.',[{id:randomUUID(),requiresApproval:true,action:{type,requestId:request.id,hash:request.hash,role:request.role,reason:request.reason,instruction:request.instruction}}]);
  }
  if(/^(打开|open)\s*(发布页面|升级页面|upgrade|publish)$/i.test(question))return data.work?.upgradeOrigin?reply(`请在独立维护界面审阅并批准准确软件候选：${data.work.upgradeOrigin}`,`Review and approve the exact software candidate in the independent maintenance service: ${data.work.upgradeOrigin}`):reply('独立维护服务尚未配置，请按部署指南设置。','The independent maintenance service is not configured; follow the deployment guide.');
  return null;
}
