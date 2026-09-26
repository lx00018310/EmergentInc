import { MissionStatus } from "@emergentinc/protocol";

const transitions: Record<MissionStatus, readonly MissionStatus[]> = {
  draft: ["issued", "cancelled"],
  issued: ["running", "cancelled"],
  running: ["awaiting_acceptance", "cancelled"],
  awaiting_acceptance: ["completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransitionMission(from: MissionStatus, to: MissionStatus): boolean {
  return transitions[from].includes(to);
}

export function assertMissionTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransitionMission(from, to)) throw new Error(`MISSION_TRANSITION_INVALID:${from}:${to}`);
}

export function validateMissionLimits(budgetTokens: number, roundsLimit: number, deadlineRound: number | null): void {
  if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 1) throw new Error("MISSION_BUDGET_INVALID");
  if (!Number.isSafeInteger(roundsLimit) || roundsLimit < 1) throw new Error("MISSION_ROUNDS_INVALID");
  if (deadlineRound !== null && (!Number.isSafeInteger(deadlineRound) || deadlineRound < 1)) {
    throw new Error("MISSION_DEADLINE_INVALID");
  }
}
