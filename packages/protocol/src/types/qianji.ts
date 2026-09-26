export type QianjiCareerStatus = "candidate" | "trial" | "active" | "retired";

export interface QianjiNarrativeSpec {
  displayName: string;
  title?: string | null;
  roleLabel?: string | null;
  traits: Record<string, number>;
  behaviorProfile: string[];
  flaw?: string | null;
  shortBio?: string | null;
  appearanceSpec?: string | null;
  portraitAsset?: string | null;
  contentRevision?: string | null;
}

export interface QianjiProfile {
  qianjiId: string;
  careerStatus: QianjiCareerStatus;
  narrative: QianjiNarrativeSpec;
  narrativeRevision: number;
  createdAt: number;
  retiredAt: number | null;
  retiredReason: string | null;
}

export interface QianjiPromptIdentity {
  qianjiId: string;
  bindingId: string;
  narrativeRevision: number;
  displayName: string;
  title: string | null;
  roleLabel: string | null;
  traits: Record<string, number>;
  behaviorProfile: string[];
  flaw: string | null;
  careerStatus: QianjiCareerStatus;
}

export interface QianjiBinding {
  bindingId: string;
  qianjiId: string;
  pixelId: string;
  incarnation: number;
  boundAt: number;
  unboundAt: number | null;
  birthEffectId: string | null;
  archiveRelativePath: string | null;
}

export interface QianjiNarrativeRevision {
  qianjiId: string;
  revision: number;
  narrative: QianjiNarrativeSpec;
  createdAt: number;
}

export type QianjiChatStatus = "queued" | "processing" | "replied" | "no_reply" | "blocked" | "failed";

export interface QianjiChatTurn {
  turnId: string;
  qianjiId: string;
  bindingId: string;
  messageId: string;
  requestKey: string;
  question: string;
  reply: string | null;
  replyCallId: string | null;
  createdAt: number;
  repliedAt: number | null;
}
