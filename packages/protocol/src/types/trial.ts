import { QianjiNarrativeSpec } from "./qianji.js";

export type RecruitmentStatus = "open" | "closed";
export type TrialStatus = "draft" | "running" | "awaiting_selection" | "completed" | "cancelled";

export interface Recruitment {
  recruitmentId: string;
  roleLabel: string;
  jd: string;
  status: RecruitmentStatus;
  createdAt: number;
}

export interface Trial {
  trialId: string;
  recruitmentId: string | null;
  challengeText: string;
  acceptanceCriteria: string;
  totalBudgetTokens: number;
  roundsPerCandidate: number;
  candidateBudgetTokens: number;
  allowedTools: string[];
  modelName: string;
  status: TrialStatus;
  winnerQianjiId: string | null;
  decisionReason: string | null;
  pauseReason?: string | null;
  createdAt: number;
  candidates: TrialCandidate[];
}

export interface TrialCandidate {
  candidateId: string;
  trialId: string;
  qianjiId: string;
  bindingId: string;
  executionId: string;
  ordinal: number;
  evidence: unknown[] | null;
  selected: boolean;
  formalNarrative?: QianjiNarrativeSpec | null;
}
