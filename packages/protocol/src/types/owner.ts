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
  id: string; type: 'gene' | 'plan' | 'resource' | 'run' | 'external' | 'upgrade' | 'recruit' | 'code';
  title: string; summary: string; priority: 'normal' | 'critical'; createdAt: number | null;
  source: string; href: string; actions?: OwnerActionProposal[];
  approveEffect?: string; rejectEffect?: string;
}
export interface OwnerAlert { id: string; kind: string; severity: 'normal' | 'critical'; title: string; summary: string; createdAt: number | null; source: string; href: string }
export interface OwnerActivityItem { id: string; type: string; summary: string; createdAt: number; source: string; href: string }
export interface OwnerPerson { id: string; name: string; worldId: string; status: string; running: boolean; runStatus: string; role?: string | null; behaviorProfile?: string[]; infiniteEnergy?: boolean; gatewayPixelId?: string | null; round?: number; energy?: number; pixels?: unknown[] }
export interface OwnerWorkTask {
  id: string; personId: string; personName: string; instruction: string;
  state: 'QUEUED' | 'RUNNING' | 'REPLIED' | 'BLOCKED' | 'NO_REPLY' | 'FAILED';
  turnId: string | null; runId: string | null; reply: string | null; reason: string | null; createdAt: number; updatedAt: number;
}
export interface OwnerRecruitRequest {
  id: string; hash: string; requester: string; role: string; reason: string; instruction: string;
  state: 'PENDING' | 'APPROVED' | 'REJECTED'; personId: string | null; createdAt: number;
}
export interface AppCodeFile { path: string; content: string | null; baseHash: string | null }
export interface AppCodeReport {
  schema: 1; id: string; hash: string; worldId: string; pixelId: string; personName: string;
  title: string; summary: string; baseGeneration: string; baseRelease: string; files: AppCodeFile[]; createdAt: number;
}
export interface OwnerWork { tasks: OwnerWorkTask[]; requests: OwnerRecruitRequest[]; codeReports: (Omit<AppCodeReport,'files'> & {paths:string[]})[]; upgradeOrigin?: string; schedulerError?:string }
export interface OwnerOverview {
  asOf: number;
  summary: { qianjiCount: number; activeWorlds: number; runningWorlds: number; inboxCount: number; currentGeneration: string | null;
    pixelCount?: number | null; availableEnergy?: number | null; pendingApprovals?: number; serviceStatus?: 'ready' | 'paused' | 'attention' };
  inbox: OwnerInboxItem[]; activity: OwnerActivityItem[]; people: OwnerPerson[];
  alerts?: OwnerAlert[];
  availability: { business: boolean; upgrade: 'available' | 'unavailable' | 'not_configured' };
  upgrade?: { active: string | null; busy: boolean };
  work?: OwnerWork;
}
