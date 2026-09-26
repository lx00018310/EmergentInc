export type MissionStatus =
  | "draft"
  | "issued"
  | "running"
  | "awaiting_acceptance"
  | "completed"
  | "failed"
  | "cancelled";

export interface MissionParticipant {
  missionId: string;
  qianjiId: string;
  bindingId: string;
  duty: string | null;
}

export interface Mission {
  missionId: string;
  title: string;
  missionType: string;
  objective: string;
  acceptanceCriteria: string;
  budgetTokens: number;
  roundsLimit: number;
  deadlineRound: number | null;
  status: MissionStatus;
  ownerQianjiId: string;
  acceptanceNote: string | null;
  createdAt: number;
  completedAt: number | null;
  executionId: string | null;
  participants: MissionParticipant[];
}
