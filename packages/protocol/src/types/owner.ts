import type { BusinessPlanView } from './business.js';

export type OwnerAction =
  | { type: 'open_details'; href: string }
  | { type: 'qianji_chat'; targets: { id: string; name: string }[]; message: string }
  | { type: 'business_plan_approve' | 'business_plan_reject'; plan: BusinessPlanView }
  | { type: 'resource_provided' | 'resource_reject'; requestId: string; planId: string; revision: number; resource: string; note: string };
export interface OwnerActionProposal { id: string; explanation?: string; risk?: 'read' | 'normal' | 'sensitive'; requiresApproval: boolean; action: OwnerAction }
export interface OwnerInboxItem {
  id: string; type: 'gene' | 'plan' | 'resource' | 'run' | 'external' | 'upgrade';
  title: string; summary: string; priority: 'normal' | 'critical'; createdAt: number | null;
  source: string; href: string; actions?: OwnerActionProposal[];
}
export interface OwnerActivityItem { id: string; type: string; summary: string; createdAt: number; source: string; href: string }
export interface OwnerPerson { id: string; name: string; worldId: string; status: string; running: boolean; runStatus: string; round?: number; energy?: number; pixels?: unknown[] }
export interface OwnerOverview {
  asOf: number;
  summary: { qianjiCount: number; activeWorlds: number; runningWorlds: number; inboxCount: number; currentGeneration: string | null };
  inbox: OwnerInboxItem[]; activity: OwnerActivityItem[]; people: OwnerPerson[];
  availability: { business: boolean; upgrade: 'available' | 'unavailable' | 'not_configured' };
  upgrade?: { active: string | null; busy: boolean };
}
