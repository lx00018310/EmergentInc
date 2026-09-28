export type QianjiCareerStatus = "candidate" | "trial" | "active" | "retired";

export const GACHA_ATTRIBUTE_KEYS = ["谋", "察", "决", "行", "言", "创", "韧", "学"] as const;
export type GachaAttributeKey = typeof GACHA_ATTRIBUTE_KEYS[number];
export type GachaAttributes = Record<GachaAttributeKey, number>;
export type GachaRarity = "N" | "R" | "SR" | "SSR";
export type GachaOrigin = "appointed" | "github" | "random";
export type GachaChannel = "owner" | "reproduction" | "legacy_trial";
export type GachaGenerationStatus = "pending" | "ready" | "failed";

export interface QianjiDraw {
  qianjiId: string;
  algorithmVersion: 1;
  seed: number;
  channel: GachaChannel;
  pityBefore: number | null;
  guaranteed: boolean;
  attributes: GachaAttributes;
  rarity: GachaRarity;
  traitTags: string[];
  drawFingerprint: string;
  requestedOrigin: GachaOrigin;
  origin: GachaOrigin;
  lineage: string[];
  skillTags: string[];
  lineageEvidence: Array<{ fullName: string; url: string; description: string; language?: string | null; topics?: string[] }>;
  fallbackReason: string | null;
  generationStatus: GachaGenerationStatus;
  cardPrompt: string | null;
  promptFingerprint: string | null;
  promptNarrativeRevision: number | null;
  imageStatus: "pending" | "generating" | "ready" | "failed";
  imageError: string | null;
  createdAt: number;
}

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
  draw?: QianjiDraw | null;
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
  attributes?: GachaAttributes | null;
  rarity?: GachaRarity | null;
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
