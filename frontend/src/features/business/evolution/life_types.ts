import { language, t } from '../../../i18n';
export type BusinessTab = 'business' | 'plans' | 'resources';
export type LifeAction = (fn: () => Promise<unknown>) => Promise<void>;
export interface LifeEvent {
  id: string; time: number; type: string; layer: 'ROOT' | 'GENOME' | 'EVOLUTION' | 'BODY';
  title: string; detail: string; state: string; generation: string;
}
export function eventTitle(event: LifeEvent): string {
  return event.id.startsWith('memory:') ? event.title : event.id.startsWith('generation:') ? t('{0} 出生', [event.generation]) : t(event.title);
}
export interface Generation {
  id: string; generation_no: number; parent_id: string | null; gene_hash: string; release_id: string;
  state: string; born_at: number | null; retired_at: number | null; failure_reason: string | null;
}
export interface Proposal {
  id: string; generation_id: string; source: string; source_ref: string; point: string; reason: string; effect: string;
  state: string; candidate_hash: string | null; target_generation_id: string | null;
}
export interface DreamRun {
  id: string; generation_id: string; status: string; trigger: string; error: string | null;
  created_at: number; finished_at: number | null; retry_available: number; fact_count: number | null;
  memory_count: number; proposal_count: number;
}
export interface LifeOverview {
  trust: {
    state: string; recovery: { state: string }; control: string; runtime: string; supervisor: string;
    ownerExactApproval: string; releaseRecovery: string; activeGeneration: string | null; evidence: LifeEvent[];
  };
  genome: {
    generation: number; geneHash: string; bodyInterfaceVersion: string; protectedPaths: string[];
    capabilityContracts: Record<string, unknown>; proposals: Proposal[]; generations: Generation[]; events: LifeEvent[];
  };
  evolution: {
    dream: { busy: boolean; failure: string | null; time: string; timezone: string; hasNewFacts: boolean; pendingFactCount: number };
    dreamRuns: DreamRun[]; proposals: Proposal[]; generations: Generation[]; evolutionEvents: LifeEvent[];
    memories: { id: string; point: string; reason: string; effect: string; source: string; kind: string; generation_id: string }[];
  };
  body: {
    projection?:boolean;worlds?:{world_id:string;runtimeFailure:string|null;blockedReason:unknown;current?:{generation_id:string;body_revision:number};skills?:unknown[]}[];
    current: { generation_id: string; body_revision: number; gene_hash: string; body_interface_version: string };
    database: string;
    skills: { skill_id: string; name: string; state: string; body_revision: number | null; successful_runs: number; failed_runs: number }[];
    needs: { id: string; pixel_id: string; need: string; evidence: string; state: string }[];
    bodyCandidates: { id: string; skill_id: string; need_id: string | null; candidate_hash: string | null; state: string;
      previous_id: string | null; body_revision: number | null }[];
    currentEvents: LifeEvent[];
    businessSummary: { activePlans: number; runningTasks: number; waitingResources: number; datasets: number; connections: number;
      recentResults: { id: string; capability: string; state: string; error: string | null; time: number }[] };
  };
}
export const lifeTime = (time: number | null | undefined) => time == null ? t('无记录') : new Date(time).toLocaleString(language(), { hour12: false });
