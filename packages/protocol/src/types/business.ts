export interface RevenueContribution {
  qianjiId: string;
  bindingId: string;
  shareBps: number;
  evidenceRef: string | null;
}

export interface RevenueRecord {
  externalTxId: string;
  amountFen: number | null;
  currency: string | null;
  productId: string | null;
  missionId: string | null;
  primaryQianjiId: string | null;
  primaryBindingId: string | null;
  evidenceRef: string | null;
  recordSource: string;
  idempotencyKey: string | null;
  timestamp: number;
  refundFen: number;
  verified: boolean;
  contributions: RevenueContribution[];
}

export interface RefundRecord {
  refundId: string;
  externalTxId: string;
  refundAmountFen: number | null;
  evidenceRef: string | null;
  reason: string;
  timestamp: number;
}

export interface BusinessCostSummary {
  knownCostCny: number;
  unknownModelCount: number;
  unknownToolCount: number;
  totalCostCny: number | null;
}

export interface BusinessMetrics extends BusinessCostSummary {
  confirmedRevenueFen: number;
  refundFen: number;
  netRevenueFen: number;
  roi: number | null;
  scope: "organization" | "product" | "qianji" | "mission";
}
