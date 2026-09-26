export type ProductStatus = "idea" | "validation" | "building" | "live" | "paused" | "retired";
export type DeliveryStatus = "draft" | "delivered" | "accepted" | "rejected";

export interface Product {
  productId: string;
  name: string;
  description: string;
  targetUser: string;
  problemStatement: string;
  ownerQianjiId: string;
  status: ProductStatus;
  previousStatus: Exclude<ProductStatus, "paused" | "retired"> | null;
  retirementReason: string | null;
  createdFromMissionId: string | null;
  createdAt: number;
  missions: string[];
}

export interface CustomerFeedback {
  feedbackId: string;
  productId: string;
  missionId: string | null;
  contactAlias: string | null;
  source: string;
  privateFeedbackText: string;
  publicSummary: string | null;
  occurredAt: number;
  createdAt: number;
}

export interface Delivery {
  deliveryId: string;
  productId: string;
  missionId: string;
  contactAlias: string | null;
  evidenceIds: string[];
  status: DeliveryStatus;
  deliveredAt: number | null;
  acceptedAt: number | null;
  acceptanceNote: string | null;
}
