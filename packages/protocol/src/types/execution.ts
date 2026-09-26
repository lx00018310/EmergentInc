export type ExecutionKind = "mission" | "trial_candidate";
export type ExecutionStatus = "ready" | "running" | "awaiting_review" | "blocked" | "closed";

export interface ExecutionParticipant {
  executionId: string;
  bindingId: string;
  releasedAt: number | null;
}

export interface ExecutionEvidence {
  evidenceId: string;
  executionId: string;
  bindingId: string;
  operationId: string | null;
  relativePath: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  evidenceType: string;
  createdAt: number;
}

export interface Execution {
  executionId: string;
  kind: ExecutionKind;
  subjectId: string;
  budgetTokens: number;
  spentTokens: number;
  reservedTokens: number;
  roundsLimit: number;
  roundsUsed: number;
  status: ExecutionStatus;
  inputSnapshot: Record<string, unknown>;
  toolsSnapshot: string[];
  createdAt: number;
  participants: ExecutionParticipant[];
}
