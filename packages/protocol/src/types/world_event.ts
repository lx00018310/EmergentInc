export type WorldEventType =
  | "QIANJI_PROFILE_CREATED"
  | "QIANJI_NARRATIVE_UPDATED"
  | "QIANJI_BOUND"
  | "QIANJI_UNBOUND"
  | "QIANJI_RETIRED"
  | "RECRUITMENT_POSTED"
  | "TRIAL_STARTED"
  | "TRIAL_AWAITING_SELECTION"
  | "TRIAL_COMPLETED"
  | "TRIAL_CANCELLED"
  | "QIANJI_RECRUITED"
  | "MISSION_ISSUED"
  | "MISSION_STARTED"
  | "MISSION_AWAITING_ACCEPTANCE"
  | "MISSION_COMPLETED"
  | "MISSION_FAILED"
  | "MISSION_CANCELLED"
  | "PRODUCT_CREATED"
  | "PRODUCT_STATUS_CHANGED"
  | "EXTERNAL_FEEDBACK_RECEIVED"
  | "DELIVERY_STATUS_CHANGED"
  | "REVENUE_RECEIVED"
  | "REFUND_RECORDED";

export type WorldEventSubjectType = "qianji" | "pixel" | "mission" | "trial" | "product";

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
