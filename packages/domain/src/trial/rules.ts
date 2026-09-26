import { TrialStatus } from "@emergentinc/protocol";

const transitions: Record<TrialStatus, readonly TrialStatus[]> = {
  draft: ["running", "cancelled"],
  running: ["awaiting_selection", "cancelled"],
  awaiting_selection: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionTrial(from: TrialStatus, to: TrialStatus): boolean {
  return transitions[from].includes(to);
}

export function assertTrialTransition(from: TrialStatus, to: TrialStatus): void {
  if (!canTransitionTrial(from, to)) throw new Error(`TRIAL_TRANSITION_INVALID:${from}:${to}`);
}

export function validateTrialBudget(candidateCount: number, totalBudgetTokens: number, candidateBudgetTokens: number, roundsPerCandidate: number): void {
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 2 || candidateCount > 3) throw new Error("TRIAL_CANDIDATE_COUNT_INVALID");
  if (!Number.isSafeInteger(totalBudgetTokens) || totalBudgetTokens < 1) throw new Error("TRIAL_TOTAL_BUDGET_INVALID");
  if (!Number.isSafeInteger(candidateBudgetTokens) || candidateBudgetTokens < 1) throw new Error("TRIAL_CANDIDATE_BUDGET_INVALID");
  if (candidateCount * candidateBudgetTokens > totalBudgetTokens) throw new Error("TRIAL_BUDGET_EXCEEDED");
  if (!Number.isSafeInteger(roundsPerCandidate) || roundsPerCandidate < 1) throw new Error("TRIAL_ROUNDS_INVALID");
}
