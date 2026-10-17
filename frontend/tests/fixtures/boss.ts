import type {BossOverview,CompanyProposal} from '../../../packages/protocol/src/types/owner';
export function bossFixture(overrides:Partial<BossOverview>={}):BossOverview {
  return {instanceId:'v34-fixture',asOf:100000,modelConfigured:true,paymentConfigured:true,paidOrderCount:0,
    automation:{desiredMode:'OFF',runMode:'CONTINUOUS',requestedRounds:null,startedRounds:0,completedRounds:0,reservedRounds:0,maxTokens:0,spentTokens:0,reservedTokens:0,knownCostCny:0,unknownCostCalls:0,revision:0,batchId:'initial',updatedAt:0,reason:null,observedState:'STOPPED',inFlight:0},
    budget:{currency:'CNY',totalMicros:200000000,spentMicros:0,reservedMicros:0,availableMicros:200000000,revision:1,activatedAt:1,unknownCalls:0,configuration:{tokenMillions:100,unitPriceCnyMicros:2000000}},
    goals:[],proposals:[],inbox:[],alerts:[],revenue:[],events:[],costs:[],storefront:{products:[],orders:[]},...overrides};
}
export function planProposal(id='proposal_fixture',goalId='goal_fixture'):CompanyProposal {
  return {id,goalId,goalRevision:1,kind:'task_plan',hash:'a'.repeat(64),state:'PENDING',createdAt:100000,result:null,payload:{title:'Make a verified draft',plan:{summary:'Produce a real deliverable',nodes:[{key:'draft',title:'Draft',instruction:'Save a source-backed draft',trigger:{kind:'once'},dependsOn:[],filename:'result.md'}]}}};
}
