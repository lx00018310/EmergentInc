import { QianjiCareerStatus } from "@emergentinc/protocol";

const transitions: Record<QianjiCareerStatus, readonly QianjiCareerStatus[]> = {
  candidate: ["trial", "retired"],
  trial: ["candidate", "active", "retired"],
  active: ["retired"],
  retired: [],
};

export function canTransitionQianji(from: QianjiCareerStatus, to: QianjiCareerStatus): boolean {
  return transitions[from].includes(to);
}

export function assertQianjiTransition(from: QianjiCareerStatus, to: QianjiCareerStatus): void {
  if (!canTransitionQianji(from, to)) throw new Error(`QIANJI_TRANSITION_INVALID:${from}:${to}`);
}
