/** Company control-plane facts. Execution adapters never own business state. */
export type CompanyAttemptState = 'DISPATCH_PENDING' | 'RUNNING' | 'SUSPENDED' | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'INTERRUPTED';
export type CompanyAccountingState = 'NOT_STARTED' | 'PENDING' | 'SETTLED';
export interface CompanyAttempt {
  id: string; taskId: string; worldId: string; goalId: string | null; goalRevision: number | null;
  dispatchId: string | null; runId: string; fence: number; revision: number;
  state: CompanyAttemptState; accountingState: CompanyAccountingState;
  leaseOwner: string; leaseExpiresAt: number; lastSequence: number;
  reason: string | null; createdAt: number; updatedAt: number;
}
export interface CompanyDispatchCommand {
  schema: 1; attemptId: string; taskId: string; worldId: string; runId: string; fence: number;
  instruction: string; rounds: number; startRound: number;
  adapter?: 'worker';
  goal?: {goalId: string; specificationRevision: number; dispatchId: string};
}
export interface CompanyExecutionReceipt {
  schema: 1; eventId: string; attemptId: string; fence: number; sequence: number;
  kind: 'started' | 'completed' | 'failed' | 'blocked' | 'interrupted' | 'suspended';
  reason?: string; reply?: string;
}
