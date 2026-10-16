import {afterEach,expect,it} from 'vitest';
import {CoreStore} from '../src/index.js';
let store:CoreStore;afterEach(()=>store?.close());
it('company Runs bypass Pixel, Run and execution Token caps while retaining usage and execution scope',()=>{
  store=new CoreStore(':memory:');const profile=store.qianji.createProfile({careerStatus:'active'}),binding=store.qianji.createBinding({qianjiId:profile.qianjiId,pixelId:'0_0_0',incarnation:1});
  store.pixels.upsertPixelAccount({pixelId:'0_0_0',energy:0,active:true,refundDeficitTokens:0,spendBlockedReason:null});
  const execution=store.executions.create({kind:'mission',subjectId:'money-only',budgetTokens:1,roundsLimit:1,inputSnapshot:{},toolsSnapshot:[],bindingIds:[binding.bindingId]});store.executions.transition(execution.executionId,'ready','running');
  store.runs.createRun({run_id:'company',execution_id:execution.executionId,start_round:1,run_limit:1,run_spent:0,run_reserved:0,genesis_revision:1,status:'RUNNING',created_at:1});
  store.budgets.useCompanyMoneyBudget(id=>id==='company');
  expect(store.budgets.getAvailableTokenCapacity({runId:'company',pixelId:'0_0_0',executionId:execution.executionId}).availableTokens).toBeGreaterThan(1000000);
  store.budgets.reserve({callId:'paid',runId:'company',pixelId:'0_0_0',executionId:execution.executionId,estimatedTokens:500});
  store.budgets.settle({callId:'paid',actualTokens:300,costCny:0.001});
  expect(store.executions.get(execution.executionId)).toMatchObject({spentTokens:300,reservedTokens:0});expect(store.pixels.getPixelAccount('0_0_0')).toMatchObject({energy:0,active:true});
  expect(()=>store.budgets.reserve({callId:'wrong',runId:'company',pixelId:'0_0_0',estimatedTokens:1})).toThrow('EXECUTION_SCOPE_RUN_CONFLICT');
});
