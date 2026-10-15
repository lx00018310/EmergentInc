import type { FastifyInstance } from 'fastify';
import type { OwnerOverviewService } from '../services/owner_overview_service.js';
import type { OwnerChatService } from '../services/owner_chat_service.js';
import { proposeOwnerAction } from '../services/owner_actions.js';
import type { OwnerWorkService } from '../services/owner_work_service.js';
import type { OwnerAutomationGate } from '../services/owner_automation_gate.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export function registerOwnerRoutes(app:FastifyInstance, overview:OwnerOverviewService, chat?:OwnerChatService, work?:OwnerWorkService, gate?:OwnerAutomationGate, maintenance?:{quiesced?:()=>boolean;switching?:()=>boolean;resume?:()=>Promise<void>}){
  const assertModelReady=()=>{
    if(!work)return;
    if(!work.manager.options.isModelConfigured)throw Object.assign(new Error('MODEL_NOT_CONFIGURED'),{statusCode:409});
    const pricing=work.manager.options.usageMeter.getPricingForModel(work.manager.options.modelName);
    if(!pricing||pricing.currency&&(typeof pricing.currency!=='string'||pricing.currency.toUpperCase()!=='CNY')||![pricing.input_cost_per_million,pricing.output_cost_per_million].every(v=>Number.isFinite(v)&&v>=0))throw Object.assign(new Error('MODEL_PRICE_REQUIRED'),{statusCode:409});
  };
  if(gate){
    const goals=gate.goals;
    app.get('/owner/proposals',()=>({items:gate.proposals.list()}));
    app.post<{Params:{id:string}}>('/owner/proposals/:id/decision',async req=>{const p=gate.proposals.decide(req.params.id,req.body);return p;});
    app.get('/owner/goals',req=>{const query=req.query as any;return {items:goals.list(query.archived==='true')};});
    app.post('/owner/goals',req=>goals.create(req.body));
    app.get<{Params:{id:string}}>('/owner/goals/:id',req=>goals.detail(req.params.id));
    app.get<{Params:{id:string;evidenceId:string}}>('/owner/goals/:id/evidence/:evidenceId',async(req,reply)=>{
      const evidence=goals.detail(req.params.id).evidence.find(e=>e.id===req.params.evidenceId&&e.kind==='artifact');
      if(!evidence?.worldId||!work)return reply.status(404).send({detail:'OWNER_EVIDENCE_NOT_FOUND'});
      const root=work.manager.registry.directory(evidence.worldId),parts=evidence.reference.split('/');
      if(parts[0]!=='evidence'||parts.some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))return reply.status(409).send({detail:'OWNER_EVIDENCE_CHANGED'});
      let file=root;for(const part of parts){file=path.join(file,part);if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink())return reply.status(409).send({detail:'OWNER_EVIDENCE_CHANGED'});}
      if(!fs.statSync(file).isFile()||fs.statSync(file).size!==evidence.bytes||evidence.bytes>2000000)return reply.status(409).send({detail:'OWNER_EVIDENCE_CHANGED'});
      const bytes=fs.readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==evidence.sha256)return reply.status(409).send({detail:'OWNER_EVIDENCE_CHANGED'});
      return reply.type('text/plain; charset=utf-8').header('Content-Security-Policy',"default-src 'none'; sandbox").send(bytes);
    });
    app.patch<{Params:{id:string}}>('/owner/goals/:id',async req=>{const goal=goals.edit(req.params.id,req.body);return goal;});
    app.post<{Params:{id:string}}>('/owner/goals/:id/actions',async req=>{const goal=goals.action(req.params.id,req.body);return goals.get(goal.id);});
    app.get('/owner/automation',()=>gate.view());
    app.get('/owner/automation/report',()=>gate.report());
    app.get('/owner/automation/calls',()=>({items:gate.modelCalls()}));
    app.post<{Params:{id:string}}>('/owner/automation/calls/:id/reconcile',req=>gate.reconcileCall(req.params.id,req.body));
    app.post('/owner/automation',async req=>{
      if ((req.body as any)?.desiredMode === 'ON')assertModelReady();
      gate.control(req.body);return gate.view();
    });
  }
  app.get('/owner/overview',()=>overview.overview());
  app.post('/owner/chat',async(req,reply)=>{
    const b=req.body as any;
    if(typeof b?.question!=='string'||!b.question.trim()||b.question.length>2000||!Array.isArray(b.history)||b.history.length>12||b.history.some((t:any)=>!t||!['user','assistant'].includes(t.role)||typeof t.content!=='string'||t.content.length>4000)||!['en','zh-CN'].includes(b.language))
      return reply.status(400).send({detail:'INVALID_OWNER_CHAT'});
    if(b.requestKey!==undefined&&(!/^[a-zA-Z0-9_-]{1,128}$/.test(b.requestKey)||typeof b.requestKey!=='string'))return reply.status(400).send({detail:'INVALID_OWNER_CHAT'});
    if(work&&b.requestKey){const cached=work.cached(b.requestKey,b.question,b.history,b.language);if(cached)return cached;}
    const command = b.question.trim().replace(/[。.!！]+$/, '');
    const controlKey=`chat_control_${createHash('sha256').update(b.requestKey??'').digest('hex')}`;
    const controlPayload={question:b.question,history:b.history,language:b.language};
    if (gate && b.requestKey && /^(?:先|请)?(?:暂停|暂停公司|停止运行|暂停自动经营)$|^(?:please )?(?:pause|pause company|stop running)$/i.test(command)) {
      if(/^(?:先|请)?暂停$|^(?:please )?pause$/i.test(command)&&gate.goals.list().filter(g=>!['COMPLETED','STOPPED','ARCHIVED'].includes(g.status)).length>1)return {answer:b.language==='en'?'Specify the task name, or say “pause company”.':'请说明要暂停的任务名称，或明确说“暂停公司”。',usage:{tokens:0,cost_cny:0},sources:['owner_goals'],as_of:new Date().toISOString()};
      return gate.goals.request(controlKey,controlPayload,()=>{
        const automation=gate.control({desiredMode:'OFF',expectedRevision:gate.view().revision,idempotencyKey:`pause_${controlKey}`});
        return {answer:b.language==='en'?'Automatic operation is paused. Usage and work are retained.':'自动经营已暂停；用量和工作状态保留。',automation,sources:['owner_automation_control'],as_of:new Date().toISOString(),usage:{tokens:0,cost_cny:0}};
      });
    }
    if(gate&&b.requestKey){
      const say=(zh:string,en:string)=>b.language==='en'?en:zh;
      const response=(answer:string,extra:object={})=>({answer,...extra,sources:['owner_company_budget','owner_company_proposals','owner_goals'],as_of:new Date().toISOString(),usage:{tokens:0,cost_cny:0}});
      if(work&&/^(?:批准招聘(?:申请)?|同意招聘(?:申请)?|拒绝招聘(?:申请)?|批准新建|同意新建|拒绝新建|approve recruitment(?: request)?|reject recruitment(?: request)?)/i.test(command)){
        const data=await overview.overview(),proposal=proposeOwnerAction(command,data,b.language),hire=proposal?.proposals[0]?.action;
        if(hire&&(hire.type==='recruit_approve'||hire.type==='recruit_reject'))return work.ask(b.requestKey,b.question,b.history,b.language,data,chat!,undefined,{id:hire.requestId,hash:hire.hash,decision:hire.type==='recruit_approve'?'approve':'reject'});
        return response(proposal?.answer??say('请指定唯一的招聘申请 ID 或职责名称。','Specify a unique recruitment request ID or role.'));
      }
      const amount=command.match(/^(?:(批准|同意|approve)\s*)?(?:公司(?:总)?预算(?:设为|为|是)?|company (?:total )?budget(?: is| of)?)\s*(?:¥|￥|CNY\s*)?(\d+(?:\.\d{1,6})?)\s*(?:元|人民币|CNY)?$/i);
      if(amount){const result=gate.goals.request(controlKey,controlPayload,()=>{
        const [whole,fraction='']=amount[2]!.split('.'),micros=Number(BigInt(whole!)*1000000n+BigInt(fraction.padEnd(6,'0')));if(!Number.isSafeInteger(micros)||micros<=0)throw Object.assign(new Error('OWNER_MONEY_INVALID'),{statusCode:400});
        const p=gate.proposals.propose('budget',{totalMicros:Math.round(micros)},`budget:${controlKey}`);
        if(amount[1]){const decided=gate.proposals.decide(p.id,{decision:'approve',hash:p.hash,idempotencyKey:`budget_${controlKey}`});return response(say('公司金额预算已批准。','The company money budget is approved.'),{companyProposal:decided,budget:gate.budget.view()});}
        return response(say('公司预算提案已生成，请批准或拒绝。','The company budget proposal is ready for approval or rejection.'),{companyProposal:p});
      });return result;}
      const decision=command.replace(/^(批准|同意|拒绝)(任务|计划|提案)/,'$1 $2 ').match(/^(批准|同意|拒绝|approve|reject)(?:\s+(.+))?$/i)??(/^(?:按这个计划执行|批准这项任务|执行这个计划)$/.test(command)?['','approve','']:null);
      if(decision){const result=gate.goals.request(controlKey,controlPayload,()=>{
        const target=decision[2]?.replace(/^(?:任务|计划|提案)\s*|^(?:task|plan|proposal)\s+/i,''),all=gate.proposals.list(),matches=target?all.filter(p=>p.id===target||p.payload.title===target):all.filter(p=>p.state==='PENDING');
        if(matches.length!==1)return response(say('请说明要决定的提案名称，或在看板点击对应审批。','Specify the proposal name, or use its decision buttons on the dashboard.'));
        const p=matches[0]!,decided=gate.proposals.decide(p.id,{decision:/拒绝|reject/i.test(decision[1]!)?'reject':'approve',hash:p.hash,idempotencyKey:'decision_'+controlKey});return response(say('提案决定已记录，实际结果见公司看板。','The decision is recorded. Actual execution results appear on the company dashboard.'),{companyProposal:decided});
      });return result;}
      const task=command.match(/^(暂停|停止|继续|结案|pause|stop|resume|close)\s*(?:任务|task)\s*(.*)$/i);
      if(task){const matches=gate.goals.list().filter(g=>task[2]?g.id===task[2]||g.title===task[2]:!['COMPLETED','STOPPED'].includes(g.status));if(matches.length!==1)return response(say('请说明要操作的任务名称或 ID。','Specify the task name or ID.'));
        const goal=matches[0]!;if(/结案|close/i.test(task[1]!)){if(gate.store.db.prepare("SELECT 1 FROM owner_goal_dispatches WHERE goal_id=? AND state IN ('QUEUED','RUNNING')").get(goal.id))return response(say('该任务仍在执行，请等待当前动作结束后再结案。','Wait for the active task action to finish before closing.'));const p=gate.proposals.closeProposal(goal.id);if(p)gate.goals.state(goal.id,'WAITING_APPROVAL','OWNER_GOAL_NEEDS_VERIFICATION');return response(p?say('结案提案已生成，请核对成果后批准。','The close proposal is ready; review the deliverables before approval.'):say('尚无可核对的成果，不能结案。','There are no verifiable deliverables to close yet.'),p?{companyProposal:p}:{});}
        const action=/暂停|pause/i.test(task[1]!)?'pause':/停止|stop/i.test(task[1]!)?'stop':['PAUSED','WAITING_RESOURCE'].includes(goal.status)?'resume':'reopen';
        const updated=gate.goals.action(goal.id,{action,expectedRevision:goal.revision,idempotencyKey:controlKey});return response(say('任务状态已更新。','The task state is updated.'),{createdGoal:updated});
      }
      const budget=gate.budget.view(),automation=gate.view();
      if(/^(?:公司状态|任务进度|查看任务|查看预算|company status|task status|show budget)$/i.test(command)||budget.availableMicros===0||automation.reason==='OWNER_OUTCOME_REVIEW_REQUIRED'){
        const goals=gate.goals.list(),active=goals.filter(g=>!['COMPLETED','STOPPED','ARCHIVED'].includes(g.status));
        const statuses:Record<string,[string,string]>={DRAFT:['待批准','Awaiting approval'],READY:['待执行','Queued'],RUNNING:['执行中','Running'],WAITING_APPROVAL:['待验收','Awaiting acceptance'],WAITING_RESOURCE:['等待条件','Waiting for a condition'],PAUSED:['已暂停','Paused'],BLOCKED:['需要跟进','Needs follow-up'],FAILED:['需要跟进','Needs follow-up']};
        const money=(n:number)=>(n/1000000).toFixed(6),lines=active.slice(-10).map(g=>`- ${g.title}: ${say(...statuses[g.status]!)}`);
        const unknown=gate.modelCalls().length;
        if(automation.reason==='EVOLUTION_QUIESCED')lines.unshift(say('- 执行仍处于维护暂停。','- Execution is paused for maintenance.'));
        if(unknown)lines.push(say(`- 有 ${unknown} 笔模型调用的结果或费用待核对，核对前保持暂停。`,`- ${unknown} model call(s) need outcome or cost verification. Execution stays paused until verified.`));
        else if(automation.reason==='OWNER_OUTCOME_REVIEW_REQUIRED')lines.push(say('- 有执行结果待核对，核对前保持暂停。','- An execution outcome needs verification. Execution stays paused until verified.'));
        if(automation.desiredMode==='OFF')lines.push(say('- 自动经营开关当前关闭。结束维护、查询状态或补充预算不会自动开启。','- Automatic operation is off. Ending maintenance, reading status, or funding the budget does not turn it on.'));
        if(budget.activatedAt===null)lines.push(say('- 公司金额预算尚未授权。收费规划和执行前，请明确并批准人民币总额度；元胞能量与金额预算分别记录。','- The company money budget has not been authorized. Specify and approve the total CNY amount before paid planning or execution; Pixel energy is recorded separately.'));
        else if(!budget.availableMicros)lines.push(say('- 公司可用金额预算为零，收费规划和执行需先补充并批准额度。','- The available company money budget is zero. Paid planning and execution require an approved increase.'));
        const worlds=work?.manager.list()??[];
        for(const task of work?.view().tasks.filter(t=>['BLOCKED','FAILED','NO_REPLY'].includes(t.state)).slice(0,10)??[]){
          const world=worlds.find(w=>w.qianji_id===task.personId),infinite=world&&gate.store.gatewayInfiniteEnergy(world.world_id);
          const state=task.reason==='WAITING_PIXEL_BUDGET'?infinite?say('任务记录仍标记等待元胞能量，但该人物已启用无限能量；需核对当前执行条件。','The task still records an energy wait, but this person has unlimited energy; current execution conditions need review.'):say('任务记录为等待元胞能量。','The task records an energy wait.'):say('任务记录需要跟进。','The task needs follow-up.');
          lines.push(`- ${task.personName}: ${state}`);
        }
        return {...response(say(`公司记录：总授权 ¥${money(budget.totalMicros)}，已结算 ¥${money(budget.spentMicros)}，预留 ¥${money(budget.reservedMicros)}，可用 ¥${money(budget.availableMicros)}。当前 ${active.length} 项未结案任务。`,`Company records: authorized ¥${money(budget.totalMicros)}, settled ¥${money(budget.spentMicros)}, reserved ¥${money(budget.reservedMicros)}, available ¥${money(budget.availableMicros)}. ${active.length} open tasks.`)+(lines.length?'\n'+lines.join('\n'):''),{automation,budget,goals}),sources:['owner_company_budget','owner_automation_control','owner_goals','owner_work_tasks','qianji_worlds','world_gateway_energy']};
      }
    }
    const resume = /^(?:请)?(?:继续(?:运行|执行|自动经营)?|开始执行|开始运行)$|^(?:please )?(?:resume|continue(?: running)?|start running)$/i.test(command);
    // Bootstrap only a current executable Owner command. Queries/history never wake a paused company.
    const actionable = /^(?:(?:请|帮我|给我|我要|我希望|我需要|再|先)\s*)*(?:建立|创建|设立|调查|调研|研究|安排|让|派|招聘|招募|上架|发布商品|新增商品|把|将|修改商品|更新商品|问|询问|运行|你决定)|^(?:(?:please|I want to|I'd like to|first)\s+)*(?:create|set up|research|investigate|assign|ask|recruit|hire|publish|update|change|run|decide)\s/i.test(command);
    if (gate && work && b.requestKey && (resume || actionable)) {
      if (resume) {
        if(gate.store.db.prepare('SELECT 1 FROM owner_control_requests WHERE key=?').get(controlKey))return gate.goals.request(controlKey,controlPayload,()=>{throw new Error('OWNER_REVISION_CONFLICT');});
        if(maintenance?.quiesced?.()){
          if(maintenance.switching?.())throw Object.assign(new Error('EVOLUTION_QUIESCED'),{statusCode:409});
          gate.goals.request('intent_'+controlKey,controlPayload,()=>{assertModelReady();if(!gate.budget.view().availableMicros)throw Object.assign(new Error('OWNER_COMPANY_BUDGET_EXHAUSTED'),{statusCode:409});gate.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_maintenance_resume_requested',NULL,?,?)").run(JSON.stringify({requestKey:controlKey}),Date.now());return {approved:true};});
          await maintenance.resume?.();
        }
        const response=gate.goals.request(controlKey,controlPayload,()=>{
          assertModelReady();gate.ensureRunning('owner_chat',0,'resume');
          return {answer:b.language==='en'?'Automatic operation is enabled. Tasks continue through the scheduler.':'自动经营已开启，任务由调度继续执行。',automation:gate.view(),sources:['owner_automation_control'],as_of:new Date().toISOString(),usage:{tokens:0,cost_cny:0}};
        });

        return response;
      }
      assertModelReady();gate.ensureRunning('owner_chat',0,'initial');
    }
    const data=await overview.overview(), proposal=proposeOwnerAction(b.question.trim(),data,b.language);
    const hire=proposal?.proposals[0]?.action;
    if(work&&b.requestKey&&hire&&(hire.type==='recruit_approve'||hire.type==='recruit_reject')){
      return work.ask(b.requestKey,b.question,b.history,b.language,data,chat!,undefined,{id:hire.requestId,hash:hire.hash,decision:hire.type==='recruit_approve'?'approve':'reject'});
    }
    if(work&&b.requestKey&&(!proposal||proposal.proposals.some(p=>p.action.type==='qianji_chat'))){
      if(!chat&&!proposal)return reply.status(409).send({detail:'MODEL_NOT_CONFIGURED'});
      const action=proposal?.proposals.find(p=>p.action.type==='qianji_chat')?.action;
      return work.ask(b.requestKey,b.question,b.history,b.language,data,chat!,action?.type==='qianji_chat'?action.targets.map(t=>({personId:t.id,instruction:action.message})):undefined);
    }
    if(proposal)return {...proposal,sources:['Owner overview / existing approval contracts'],as_of:new Date(data.asOf).toISOString(),usage:{tokens:0,cost_cny:0}};
    if(!chat)return reply.status(409).send({detail:'MODEL_NOT_CONFIGURED'});
    return chat.ask(b.question,b.history,b.language);
  });
  if(work){
    app.get('/owner/work',()=>work.view());
    app.get<{Params:{id:string}}>('/owner/code-reports/:id',async(req,reply)=>{try{return work.code?.get(req.params.id)??reply.status(404).send({detail:'APP_CODE_REPORT_NOT_FOUND'});}catch{return reply.status(404).send({detail:'APP_CODE_REPORT_NOT_FOUND'});}});
    app.post<{Params:{id:string}}>('/owner/requests/:id/decision',async(req,reply)=>{
      const b=req.body as any;if(!b||Object.keys(b).some(k=>!['decision','hash'].includes(k))||!['approve','reject'].includes(b.decision)||typeof b.hash!=='string')return reply.status(400).send({detail:'OWNER_REQUEST_INVALID'});
      try{return await work.decide(req.params.id,b.hash,b.decision,true);}catch(e){return reply.status(409).send({detail:e instanceof Error?e.message:String(e)});}
    });
  }
}
