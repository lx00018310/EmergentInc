export type WorldEventType =
  | "QIANJI_PROFILE_CREATED"
  | "QIANJI_DRAWN"
  | "QIANJI_PORTRAIT_GENERATED"
  | "QIANJI_NARRATIVE_UPDATED"
  | "QIANJI_BOUND"
  | "QIANJI_UNBOUND"
  | "QIANJI_RETIRED"
  | "QIANJI_RECRUITED"
  | "TRIAL_STARTED";

export type WorldEventSubjectType = "qianji" | "pixel";

export interface WorldEvent {
  eventId: string;
  eventType: WorldEventType;
  subjectType: WorldEventSubjectType;
  subjectId: string;
  qianjiId: string | null;
  bindingId: string | null;
  pixelId: string | null;
  roundNum: number | null;
  sourceKey: string;
  payload: Record<string, unknown>;
  createdAt: number;
}
