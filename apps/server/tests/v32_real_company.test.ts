import {it,expect} from 'vitest';
import * as fs from 'node:fs';
import {resolve,join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {OpenAICompatibleProvider,UsageMeter} from '@emergentinc/model';
import {goalFixture} from './fixtures/owner_goals.js';
import {OwnerWorkService} from '../src/services/owner_work_service.js';
import {OwnerChatService} from '../src/services/owner_chat_service.js';
import {createServer} from '../src/app.js';
// @ts-ignore Local credential loader; values are never printed or committed.
import {ownerEnvironment} from '../../../scripts/local-release.mjs';

it.skipIf(!process.env.EMERGENTINC_TEST_REAL_COMPANY_BUDGET_CNY||process.env.EMERGENTINC_CANDIDATE_MODE==='1')('uses a real model for a composed task, resumes in a new process, triggers a timed batch and closes only with Owner approval',async()=>{
  const limit=Number(process.env.EMERGENTINC_TEST_REAL_COMPANY_BUDGET_CNY)*1000000;if(!Number.isSafeInteger(limit)||limit<=0||limit>1000000)throw new Error('REAL_VERIFICATION_BUDGET_MUST_BE_EXPLICIT_AND_AT_MOST_ONE_CNY');
  const env=ownerEnvironment(resolve('.')),model=env.MCL_DECISION_MODEL||env.MCL_MODEL;if(!env.MCL_API_KEY||!model)throw new Error('REAL_MODEL_NOT_CONFIGURED');
  const meter=new UsageMeter(JSON.parse(fs.readFileSync(resolve('resources/config/model_pricing.json'),'utf8'))),real=new OpenAICompatibleProvider({baseUrl:env.MCL_BASE_URL,apiKey:env.MCL_API_KEY,maxRetries:0,timeoutMs:120000}),f=goalFixture();
  f.manager.options.projectRoot=resolve('.');f.manager.options.modelName=model;f.manager.options.usageMeter=meter;f.respond(r=>real.call(r));const work=new OwnerWorkService(f.manager),chat=new OwnerChatService({projectRoot:resolve('.'),workspaceRoot:f.root,store:f.control,provider:f.gate.provider(f.provider,meter),usageMeter:meter,modelName:model,isModelConfigured:true});
  let completed=false;try{
    f.gate.budget.authorize(limit);f.gate.ensureRunning('explicit_isolated_real_verification',0,'initial');
    const response=await work.ask('real-v32-plan','创建一个内部验证组合任务，严格只有三个节点：第一步用已有源码读取工具检查 frontend/src/features/owner/OwnerConsole.tsx，并保存 first.md；第二步依赖第一步的真实产物，核对两入口并保存 second.md；第三步依赖第二步，每5分钟检查前两步产物并保存 report.md。前两步一次性，第三步interval每5分钟。不得招聘、外发、发布或修改源码。没有秘书，使用现有执行者。',[],'zh-CN',{people:f.manager.list().map(w=>({id:w.qianji_id,name:'Existing executor',worldId:w.world_id,role:'research',running:false,status:'ACTIVE',runStatus:'READY'})),inbox:[],goals:[],taskPlans:[]} as any,chat);
    const proposal=response.companyProposal as any;expect(proposal.kind).toBe('task_plan');const goalId=(response.createdGoal as any).id,plan=f.gate.proposals.plans.get(goalId)!;
    expect(plan.nodes.map(n=>n.filename)).toEqual(['first.md','second.md','report.md']);expect(plan.nodes.map(n=>n.trigger.kind)).toEqual(['once','once','interval']);expect(plan.nodes[2]!.trigger).toEqual({kind:'interval',everyMinutes:5});
    f.gate.proposals.decide(proposal.id,{decision:'approve',hash:proposal.hash,idempotencyKey:'real-plan-approve'});
    const childEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,MCL_API_KEY:env.MCL_API_KEY,MCL_BASE_URL:env.MCL_BASE_URL,MCL_MODEL:model,EMERGENTINC_TEST_REAL_COMPANY_BUDGET_CNY:String(limit/1000000)},run=promisify(execFile);
    const child=async(mode:string,clock?:number)=>{const result=await run(process.execPath,['--import','tsx',resolve('apps/server/tests/fixtures/v32_real_company_child.ts'),f.root,goalId,mode,...(clock?[String(clock)]:[])],{cwd:resolve('.'),env:childEnv,windowsHide:true,timeout:360000,maxBuffer:200000});return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);};
    const beforeRestart=await child('first'),afterRestart=await child('finish'),next=f.gate.proposals.plans.get(goalId)!.nodes.find(n=>n.trigger.kind==='interval')!.nextAt!,timed=await child('timer',next+1);
    const app=await createServer({workspaceRoot:f.root,worlds:f.worlds});try{
      const closeResponse=await app.inject({method:'POST',url:'/api/owner/chat',payload:{question:`结案任务 ${goalId}`,history:[],language:'zh-CN',requestKey:'real-close-request'}});expect(closeResponse.statusCode).toBe(200);const close=closeResponse.json().companyProposal;expect(close.kind).toBe('close_task');
      const approved=await app.inject({method:'POST',url:`/api/owner/proposals/${close.id}/decision`,payload:{decision:'approve',hash:close.hash,idempotencyKey:'real-close-approve'}});expect(approved.statusCode).toBe(200);
    }finally{await app.close();}
    expect(f.gate.goals.get(goalId).status).toBe('COMPLETED');expect(f.gate.budget.view().spentMicros).toBeGreaterThan(0);expect(f.gate.budget.view().unknownCalls).toBe(0);
    const output=resolve('cache/v32-validation');fs.mkdirSync(output,{recursive:true});for(const e of f.gate.goals.detail(goalId).evidence.filter(e=>e.kind==='artifact'))fs.copyFileSync(join(f.registry.directory(e.worldId!),e.reference),join(output,e.sha256+'-'+e.reference.split('/').at(-1)));
    fs.writeFileSync(join(output,'real-company-evidence.json'),JSON.stringify({passed:true,realModel:model,budget:f.gate.budget.view(),beforeRestart,afterRestart,timed,timerClock:'explicitly accelerated in an isolated process; model calls and artifacts are real',goal:f.gate.goals.get(goalId),evidence:f.gate.goals.detail(goalId).evidence},null,2));
    completed=true;
  }finally{await work.close();if(!completed){fs.mkdirSync(resolve('cache/v32-validation'),{recursive:true});fs.writeFileSync(resolve('cache/v32-validation/real-company-failure.json'),JSON.stringify({workspaceRetained:f.root,budget:f.gate.budget.view(),automation:f.gate.view()}));}await f.close(!completed);}
},1200000);
