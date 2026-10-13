import type { FastifyInstance } from 'fastify';
import type { OwnerOverviewService } from '../services/owner_overview_service.js';
import type { OwnerChatService } from '../services/owner_chat_service.js';
import { proposeOwnerAction } from '../services/owner_actions.js';
import type { OwnerWorkService } from '../services/owner_work_service.js';
import type { OwnerAutomationGate } from '../services/owner_automation_gate.js';
import type { OwnerGoalScheduler } from '../services/owner_goal_scheduler.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export function registerOwnerRoutes(app:FastifyInstance, overview:OwnerOverviewService, chat?:OwnerChatService, work?:OwnerWorkService, gate?:OwnerAutomationGate, scheduler?:OwnerGoalScheduler){
  if(gate){
    const goals=gate.goals;
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
    app.patch<{Params:{id:string}}>('/owner/goals/:id',async req=>{const goal=goals.edit(req.params.id,req.body);await scheduler?.tick();return goal;});
    app.post<{Params:{id:string}}>('/owner/goals/:id/actions',async req=>{const goal=goals.action(req.params.id,req.body);if(goal.status==='READY'&&gate.isOn())await work?.manager.resumeInterrupted();await scheduler?.tick();return goals.get(goal.id);});
    app.get('/owner/automation',()=>gate.view());
    app.get('/owner/automation/report',()=>gate.report());
    app.get('/owner/automation/calls',()=>({items:gate.modelCalls()}));
    app.post<{Params:{id:string}}>('/owner/automation/calls/:id/reconcile',req=>gate.reconcileCall(req.params.id,req.body));
    app.post('/owner/automation',async req=>{gate.control(req.body);if(gate.isOn())await work?.manager.resumeInterrupted();await scheduler?.tick();return gate.view();});
  }
  app.get('/owner/overview',()=>overview.overview());
  app.post('/owner/chat',async(req,reply)=>{
    const b=req.body as any;
    if(typeof b?.question!=='string'||!b.question.trim()||b.question.length>2000||!Array.isArray(b.history)||b.history.length>12||b.history.some((t:any)=>!t||!['user','assistant'].includes(t.role)||typeof t.content!=='string'||t.content.length>4000)||!['en','zh-CN'].includes(b.language))
      return reply.status(400).send({detail:'INVALID_OWNER_CHAT'});
    if(b.requestKey!==undefined&&(!/^[a-zA-Z0-9_-]{1,128}$/.test(b.requestKey)||typeof b.requestKey!=='string'))return reply.status(400).send({detail:'INVALID_OWNER_CHAT'});
    if(work&&b.requestKey){const cached=work.cached(b.requestKey,b.question,b.history,b.language);if(cached)return cached;}
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
      try{return await work.decide(req.params.id,b.hash,b.decision);}catch(e){return reply.status(409).send({detail:e instanceof Error?e.message:String(e)});}
    });
  }
}
