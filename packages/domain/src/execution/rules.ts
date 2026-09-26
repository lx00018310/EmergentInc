import { ExecutionStatus } from "@emergentinc/protocol";

const transitions: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
  ready: ["running", "blocked", "closed"],
  running: ["awaiting_review", "blocked", "closed"],
  awaiting_review: ["running", "closed"],
  blocked: ["running", "closed"],
  closed: [],
};

export function canTransitionExecution(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return transitions[from].includes(to);
}

export function assertExecutionTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransitionExecution(from, to)) throw new Error(`EXECUTION_TRANSITION_INVALID:${from}:${to}`);
}
