import {afterEach,beforeEach,expect,it} from 'vitest';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CoreStore} from '@emergentinc/persistence';
import {ToolRegistry,ToolRuntime} from '@emergentinc/tools';
import {DecisionCompiler,EffectRuntime,RoundScheduler} from '../src/index.js';
let store:CoreStore,root:string;
beforeEach(()=>{root=fs.mkdtempSync(join(tmpdir(),'company-money-execution-'));store=new CoreStore(':memory:');store.budgets.useCompanyMoneyBudget(id=>id==='company');store.pixels.upsertPixelAccount({pixelId:'0_0_0',energy:0,active:true,refundDeficitTokens:0,spendBlockedReason:null});});
afterEach(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
it('executes a zero-energy recipient queued during a round without waking dormant or retired members',async()=>{
  for(const pixelId of ['1_0_0','2_0_0','3_0_0'])store.pixels.upsertPixelAccount({pixelId,energy:0,active:false,refundDeficitTokens:0,spendBlockedReason:null});
  const retired=store.qianji.createProfile({careerStatus:'active'}),binding=store.qianji.createBinding({qianjiId:retired.qianjiId,pixelId:'2_0_0',incarnation:1});store.qianji.unbindAndRetire(binding.bindingId,'history/retired','retired');
  store.messages.enqueueMessage({roundNum:1,sender:'human',recipient:'0_0_0',content:'Actual task'});store.messages.enqueueMessage({roundNum:1,sender:'human',recipient:'2_0_0',content:'Late retired input'});
  const processed:string[]=[];const scheduler=new RoundScheduler({workspaceRoot:root,store,stepRunner:{async execute(input:any){processed.push(input.message.recipient);store.messages.commitMessage(input.message.messageId);if(input.message.recipient==='0_0_0')store.messages.enqueueMessage({roundNum:1,sender:'0_0_0',recipient:'1_0_0',content:'Delegated work'});return {decision:{send_to:'STOP',operations:[]}};},isReadOnlyTool:()=>false} as any});
  await scheduler.executeRound(1,'company');expect(processed).toEqual(['0_0_0','1_0_0']);expect(store.pixels.getPixelAccount('3_0_0')!.active).toBe(false);expect(store.pixels.getPixelAccount('1_0_0')!.energy).toBe(0);
});
it('creates a body without a separate virtual energy stake, while preserving the source balance',async()=>{
  const message=store.messages.enqueueMessage({roundNum:1,sender:'human',recipient:'0_0_0',content:'Create a body'}),effects=DecisionCompiler.compile({pixelId:'0_0_0',messageId:message.messageId,currentHop:0,decision:{reproduce:{direction:'1_0_0',initial_energy:15000}}});
  await new EffectRuntime({workspaceRoot:root,store,toolRuntime:new ToolRuntime(new ToolRegistry()),round:1,runId:'company',worldMode:true}).applyEffects(effects);
  expect(store.effects.getEffect(effects[0].effectId)?.status).toBe('APPLIED');expect(store.pixels.getPixelAccount('0_0_0')).toMatchObject({active:true,energy:0});expect(store.pixels.getPixelAccount('1_0_0')).toMatchObject({active:true,energy:0});
});
it('retires virtual energy transfers without creating top-ups or moving balances',async()=>{
  store.pixels.upsertPixelAccount({pixelId:'1_0_0',energy:0,active:false,refundDeficitTokens:0,spendBlockedReason:null});
  const message=store.messages.enqueueMessage({roundNum:1,sender:'human',recipient:'0_0_0',content:'Legacy energy request'}),effects=DecisionCompiler.compile({pixelId:'0_0_0',messageId:message.messageId,currentHop:0,decision:{energy_transfer:[{target:'1_0_0',amount:100000}]}});
  const runtime=new EffectRuntime({workspaceRoot:root,store,toolRuntime:new ToolRuntime(new ToolRegistry()),round:1,runId:'company',worldMode:true});await runtime.applyEffects(effects);await runtime.applyEffects(effects);
  expect(store.effects.getEffect(effects[0].effectId)?.status).toBe('APPLIED');expect(store.pixels.getPixelAccount('0_0_0')!.energy).toBe(0);expect(store.pixels.getPixelAccount('1_0_0')!.energy).toBe(0);expect(store.db.prepare('SELECT COUNT(*) n FROM external_reward_requests').get()!.n).toBe(0);
});
