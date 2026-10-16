import type { BusinessPlanView } from './business.js';

export type OwnerAction =
  | { type: 'open_details'; href: string }
  | { type: 'qianji_chat'; targets: { id: string; name: string }[]; message: string }
  | { type: 'recruit_approve' | 'recruit_reject'; requestId: string; hash: string; role: string; reason: string; instruction: string }
  | { type: 'business_plan_approve' | 'business_plan_reject'; plan: BusinessPlanView }
  | { type: 'resource_provided' | 'resource_reject'; requestId: string; planId: string; revision: number; resource: string; note: string }
  | { type: 'gene_proposal_approve' | 'gene_proposal_reject'; proposalId: string; expectedGeneration: string; expectedState: 'PROPOSED' };
export interface OwnerActionProposal { id: string; explanation?: string; risk?: 'read' | 'normal' | 'sensitive'; requiresApproval: boolean; action: OwnerAction }
export interface OwnerInboxItem {
  id: string; type: 'gene' | 'plan' | 'resource' | 'run' | 'external' | 'upgrade' | 'recruit' | 'code' | 'goal';
  title: string; summary: string; priority: 'normal' | 'critical'; createdAt: number | null;
  source: string; href: string; actions?: OwnerActionProposal[];
  approveEffect?: string; rejectEffect?: string;
  approveEffectValues?: (string | number)[]; rejectEffectValues?: (string | number)[];
}
export interface OwnerAlert { id: string; kind: string; severity: 'normal' | 'critical'; title: string; summary: string; reasonKey?:string; createdAt: number | null; source: string; href: string }
export interface OwnerActivityItem { id: string; type: string; summary: string; summaryKey?: string; summaryValues?: (string | number)[]; createdAt: number; source: string; href: string }
export interface OwnerPerson { id: string; name: string; worldId: string; status: string; running: boolean; runStatus: string; runId?: string | null; role?: string | null; behaviorProfile?: string[]; infiniteEnergy?: boolean; gatewayPixelId?: string | null; round?: number; energy?: number; pixels?: unknown[] }
export interface OwnerWorkTask {
  goalId?: string | null;
  id: string; personId: string; personName: string; instruction: string;
  state: 'QUEUED' | 'RUNNING' | 'REPLIED' | 'BLOCKED' | 'NO_REPLY' | 'FAILED';
  turnId: string | null; runId: string | null; reply: string | null; reason: string | null; createdAt: number; updatedAt: number;
}
export interface OwnerRecruitRequest {
  id: string; hash: string; requester: string; role: string; reason: string; instruction: string;
  state: 'PENDING' | 'APPROVED_QUEUED' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; personId: string | null; createdAt: number;
}
export interface AppCodeFile { path: string; content: string | null; baseHash: string | null }
export interface AppCodeReport {
  schema: 1; id: string; hash: string; worldId: string; pixelId: string; personName: string;
  title: string; summary: string; baseGeneration: string; baseRelease: string; files: AppCodeFile[]; createdAt: number;
}
export interface OwnerWork { tasks: OwnerWorkTask[]; requests: OwnerRecruitRequest[]; codeReports: (Omit<AppCodeReport,'files'> & {paths:string[]})[]; upgradeOrigin?: string; schedulerError?:string }
export interface OwnerOverview {
  goals?: OwnerGoal[];
  automation?: OwnerAutomation;
  budget?:CompanyBudget;
  proposals?:CompanyProposal[];
  taskPlans?:CompanyTaskPlanView[];
  revenue?:{asset:string;amount:string;at:number}[];
  costs?:{day:string;micros:number}[];
  legacyBusiness?:{id:string;title:string;state:string;nextAt:number|null}[];
  storefront?:{products:{id:string;nameEn:string;nameZh:string;enabled:boolean;price:string|null;currency:string}[];orders:{id:string;product:string;amount:string;currency:string;status:string;at:number}[]};
  asOf: number;
  summary: { qianjiCount: number; activeWorlds: number; runningWorlds: number; inboxCount: number; currentGeneration: string | null;
    pixelCount?: number | null; availableEnergy?: number | null; pendingApprovals?: number; serviceStatus?: 'ready' | 'paused' | 'attention' };
  inbox: OwnerInboxItem[]; activity: OwnerActivityItem[]; people: OwnerPerson[];
  alerts?: OwnerAlert[];
  availability: { business: boolean; upgrade: 'available' | 'unavailable' | 'not_configured' };
  upgrade?: { active: string | null; busy: boolean };
  work?: OwnerWork;
}

export type OwnerGoalStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'WAITING_APPROVAL' | 'WAITING_RESOURCE' | 'PAUSED' | 'BLOCKED' | 'FAILED' | 'COMPLETED' | 'STOPPED' | 'ARCHIVED';
/** Only an artifact hash can satisfy artifact acceptance; reports are never business evidence. */
export type OwnerGoalAcceptance = { kind: 'artifact'; filename: string; minBytes: number } | { kind: 'manual'; description: string } | {kind:'confirmed_payments';invoiceIds:string[];targetCount:number};
export interface OwnerGoal {
  id: string; revision: number; specificationRevision: number; title: string; objective: string;
  acceptance: OwnerGoalAcceptance; maxTokens: number; status: OwnerGoalStatus;
  nextAction: string; reason: string | null; verifiedCount: number; evidenceCount: number;
  spentTokens: number; reservedTokens: number; createdAt: number; updatedAt: number; lastScheduledAt: number;
}
export interface OwnerGoalEvent { id: number; goalId: string; revision: number; kind: string; payload: unknown; createdAt: number }
export interface OwnerGoalEvidence { id: string; goalId: string; specificationRevision: number; runId: string | null; worldId: string | null; kind: 'artifact' | 'report' | 'payment'; reference: string; sha256: string; bytes: number; createdAt: number }
export interface OwnerGoalDetail { goal: OwnerGoal; events: OwnerGoalEvent[]; evidence: OwnerGoalEvidence[]; dispatches: { id: string; taskId: string | null; runId: string | null; worldId: string; state: string; reason: string | null }[] }
export interface OwnerAutomation {
  desiredMode: 'OFF' | 'ON'; runMode: 'CONTINUOUS' | 'BOUNDED'; requestedRounds: number | null;
  startedRounds: number; completedRounds: number; reservedRounds: number;
  maxTokens: number; spentTokens: number; reservedTokens: number; knownCostCny: number; unknownCostCalls: number;
  budget?:CompanyBudget;
  revision: number; batchId: string; updatedAt: number; reason: string | null;
  observedState: 'STOPPED' | 'STARTING' | 'RUNNING' | 'IDLE' | 'STOPPING' | 'BLOCKED' | 'LIMIT_REACHED' | 'ERROR';
  inFlight: number;
}
export interface OwnerRunReport { asOf:number; automation:OwnerAutomation; goals:{goalId:string;title:string;status:OwnerGoalStatus;spentTokens:number;reservedTokens:number;knownCostCny:number;evidence:OwnerGoalEvidence[];reason:string|null}[] }

export const COMPANY_BUDGET_USD_CNY = 7;
export interface CompanyBudget { configuration?:{tokenMillions:number;unitPriceCnyMicros:number}|null;needsRefill?:boolean;currency:'CNY'; totalMicros:number; spentMicros:number; reservedMicros:number; availableMicros:number; revision:number; activatedAt:number|null; unknownCalls:number; historicalCostMicros?:number }
export interface CompanyProposal { id:string; kind:'budget'|'task_plan'|'close_task'; goalId:string|null; goalRevision:number|null; hash:string; payload:any; state:'PENDING'|'APPROVED'|'REJECTED'|'EXECUTED'; createdAt:number; result:any }
export type TaskTrigger = {kind:'once'} | {kind:'continuous'} | {kind:'interval';everyMinutes:number} | {kind:'daily'|'weekly';time:string;timezone:string;weekdays?:number[]};
export interface CompanyTaskNode { key:string; title:string; instruction:string; dependsOn:string[]; trigger:TaskTrigger; filename:string; personId?:string }
export interface CompanyTaskPlan { summary:string; nodes:CompanyTaskNode[] }
export interface CompanyTaskNodeView extends CompanyTaskNode { state:string; nextAt:number|null; latestEvidence:string[]; occurrences:number }
export interface CompanyTaskPlanView { goalId:string; goalRevision:number; planRevision:number; approved:boolean; summary:string; nodes:CompanyTaskNodeView[] }
