import { randomUUID } from "node:crypto";
import { CustomerFeedback, Delivery, Product, RevenueContribution, RevenueRecord, RefundRecord, NarrativeArtifact, ProductStatus, DeliveryStatus } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";

export interface CreateProductInput {
  productId?: string; name: string; description: string; targetUser: string; problemStatement: string;
  ownerQianjiId: string; createdFromMissionId?: string | null;
}

export class BusinessRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public createProduct(input: CreateProductInput): Product {
    const productId = input.productId ?? `product_${randomUUID()}`;
    this.db.prepare(`INSERT INTO products(product_id,name,description,target_user,problem_statement,owner_qianji_id,status,
      previous_status,retirement_reason,created_from_mission_id,created_at) VALUES (?,?,?,?,?,?,'idea',NULL,NULL,?,?)`)
      .run(productId, input.name, input.description, input.targetUser, input.problemStatement, input.ownerQianjiId,
        input.createdFromMissionId ?? null, Date.now() / 1000);
    return this.getProduct(productId)!;
  }

  public getProduct(id: string): Product | null {
    const row = this.db.prepare("SELECT * FROM products WHERE product_id=?").get(id) as any;
    if (!row) return null;
    const missions = this.db.prepare("SELECT mission_id FROM product_missions WHERE product_id=? ORDER BY linked_at, mission_id").all(id) as any[];
    return { productId: String(row.product_id), name: String(row.name), description: String(row.description),
      targetUser: String(row.target_user), problemStatement: String(row.problem_statement), ownerQianjiId: String(row.owner_qianji_id),
      status: row.status, previousStatus: row.previous_status ?? null, retirementReason: row.retirement_reason ?? null,
      createdFromMissionId: row.created_from_mission_id ?? null, createdAt: Number(row.created_at),
      missions: missions.map(item => String(item.mission_id)) };
  }

  public listProducts(limit = 100): Product[] {
    this.assertLimit(limit);
    return (this.db.prepare("SELECT product_id FROM products ORDER BY created_at DESC, product_id DESC LIMIT ?").all(limit) as any[])
      .map(row => this.getProduct(String(row.product_id))!).filter(Boolean);
  }

  public updateProduct(id: string, input: Omit<CreateProductInput, "productId" | "ownerQianjiId" | "createdFromMissionId">): Product {
    const result = this.db.prepare(`UPDATE products SET name=?,description=?,target_user=?,problem_statement=?
      WHERE product_id=? AND status NOT IN ('paused','retired')`)
      .run(input.name, input.description, input.targetUser, input.problemStatement, id);
    if (Number(result.changes) !== 1) throw new Error("PRODUCT_NOT_EDITABLE_OR_NOT_FOUND");
    return this.getProduct(id)!;
  }

  public transitionProduct(id: string, expected: ProductStatus, next: ProductStatus, previousStatus: ProductStatus | null, reason?: string): Product {
    const result = this.db.prepare(`UPDATE products SET status=?,previous_status=?,retirement_reason=?
      WHERE product_id=? AND status=?`)
      .run(next, previousStatus, next === "retired" ? reason ?? null : null, id, expected);
    if (Number(result.changes) !== 1) throw new Error("PRODUCT_STATUS_CONFLICT");
    return this.getProduct(id)!;
  }

  public linkMission(productId: string, missionId: string): Product {
    this.db.prepare("INSERT INTO product_missions(product_id,mission_id,linked_at) VALUES (?,?,?)")
      .run(productId, missionId, Date.now() / 1000);
    return this.getProduct(productId)!;
  }

  public createFeedback(input: Omit<CustomerFeedback, "feedbackId" | "createdAt">): CustomerFeedback {
    const feedbackId = `feedback_${randomUUID()}`;
    const createdAt = Date.now() / 1000;
    this.db.prepare(`INSERT INTO customer_feedback(feedback_id,product_id,mission_id,contact_alias,source,
      private_feedback_text,public_summary,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(feedbackId, input.productId, input.missionId, input.contactAlias, input.source, input.privateFeedbackText,
        input.publicSummary, input.occurredAt, createdAt);
    return { ...input, feedbackId, createdAt };
  }

  public listFeedback(productId?: string): CustomerFeedback[] {
    const rows = productId
      ? this.db.prepare("SELECT * FROM customer_feedback WHERE product_id=? ORDER BY occurred_at DESC, feedback_id").all(productId) as any[]
      : this.db.prepare("SELECT * FROM customer_feedback ORDER BY occurred_at DESC, feedback_id").all() as any[];
    return rows.map(row => ({ feedbackId: String(row.feedback_id), productId: String(row.product_id), missionId: row.mission_id ?? null,
      contactAlias: row.contact_alias ?? null, source: String(row.source), privateFeedbackText: String(row.private_feedback_text),
      publicSummary: row.public_summary ?? null, occurredAt: Number(row.occurred_at), createdAt: Number(row.created_at) }));
  }

  public createDelivery(input: Omit<Delivery, "deliveryId" | "status" | "deliveredAt" | "acceptedAt" | "acceptanceNote">): Delivery {
    const deliveryId = `delivery_${randomUUID()}`;
    this.db.prepare(`INSERT INTO deliveries(delivery_id,product_id,mission_id,contact_alias,evidence_ids_json,status,
      delivered_at,accepted_at,acceptance_note) VALUES (?,?,?,?,?,'draft',NULL,NULL,NULL)`)
      .run(deliveryId, input.productId, input.missionId, input.contactAlias, JSON.stringify(input.evidenceIds));
    return this.getDelivery(deliveryId)!;
  }

  public getDelivery(id: string): Delivery | null {
    const row = this.db.prepare("SELECT * FROM deliveries WHERE delivery_id=?").get(id) as any;
    return row ? { deliveryId: String(row.delivery_id), productId: String(row.product_id), missionId: String(row.mission_id),
      contactAlias: row.contact_alias ?? null, evidenceIds: JSON.parse(String(row.evidence_ids_json)), status: row.status,
      deliveredAt: row.delivered_at == null ? null : Number(row.delivered_at), acceptedAt: row.accepted_at == null ? null : Number(row.accepted_at),
      acceptanceNote: row.acceptance_note ?? null } : null;
  }

  public listDeliveries(productId?: string): Delivery[] {
    const rows = productId
      ? this.db.prepare("SELECT delivery_id FROM deliveries WHERE product_id=? ORDER BY delivery_id DESC").all(productId) as any[]
      : this.db.prepare("SELECT delivery_id FROM deliveries ORDER BY delivery_id DESC").all() as any[];
    return rows.map(row => this.getDelivery(String(row.delivery_id))!).filter(Boolean);
  }

  public transitionDelivery(id: string, expected: DeliveryStatus, next: DeliveryStatus, note?: string): Delivery {
    const now = Date.now() / 1000;
    const result = this.db.prepare(`UPDATE deliveries SET status=?,delivered_at=CASE WHEN ?='delivered' THEN COALESCE(delivered_at,?) ELSE delivered_at END,
      accepted_at=CASE WHEN ? IN ('accepted','rejected') THEN COALESCE(accepted_at,?) ELSE accepted_at END,
      acceptance_note=COALESCE(?,acceptance_note) WHERE delivery_id=? AND status=?`)
      .run(next, next, now, next, now, note ?? null, id, expected);
    if (Number(result.changes) !== 1) throw new Error("DELIVERY_STATUS_CONFLICT");
    return this.getDelivery(id)!;
  }

  public createRevenue(input: { externalTxId: string; amountFen: number; productId: string; missionId: string;
    primaryQianjiId: string; primaryBindingId: string; evidenceRef: string; idempotencyKey: string;
    contributions: RevenueContribution[] }): RevenueRecord {
    const now = Date.now() / 1000;
    this.db.prepare(`INSERT INTO external_revenues(external_tx_id,pixel_id,net_amount,amount_tokens,timestamp,details,
      amount_fen,currency,product_id,mission_id,primary_qianji_id,primary_binding_id,evidence_ref,record_source,idempotency_key)
      VALUES (?,?,?,0,?,?,?,'CNY',?,?,?,?,?,'owner_confirmed',?)`)
      .run(input.externalTxId, this.bindingPixel(input.primaryBindingId), input.amountFen / 100, now,
        JSON.stringify({ evidenceRef: input.evidenceRef, source: "owner_confirmed" }), input.amountFen, input.productId,
        input.missionId, input.primaryQianjiId, input.primaryBindingId, input.evidenceRef, input.idempotencyKey);
    const add = this.db.prepare(`INSERT INTO revenue_contributions(external_tx_id,qianji_id,binding_id,share_bps,evidence_ref)
      VALUES (?,?,?,?,?)`);
    for (const contribution of input.contributions) add.run(input.externalTxId, contribution.qianjiId,
      contribution.bindingId, contribution.shareBps, contribution.evidenceRef);
    return this.getRevenue(input.externalTxId)!;
  }

  public getRevenue(id: string): RevenueRecord | null {
    const row = this.db.prepare("SELECT * FROM external_revenues WHERE external_tx_id=?").get(id) as any;
    return row ? this.mapRevenue(row) : null;
  }

  public listRevenues(): RevenueRecord[] {
    return (this.db.prepare("SELECT * FROM external_revenues ORDER BY timestamp DESC, external_tx_id").all() as any[]).map(row => this.mapRevenue(row));
  }

  public revenueSumsBetween(from: number, to: number): { gross: number; refund: number } {
    const gross = this.db.prepare(`SELECT COALESCE(SUM(amount_fen),0) AS total FROM external_revenues
      WHERE amount_fen IS NOT NULL AND currency='CNY' AND product_id IS NOT NULL AND mission_id IS NOT NULL
        AND record_source='owner_confirmed' AND evidence_ref IS NOT NULL AND timestamp>=? AND timestamp<?`).get(from, to) as any;
    const refund = this.db.prepare(`SELECT COALESCE(SUM(er.refund_amount_fen),0) AS total FROM external_refunds er
      JOIN external_revenues r ON r.external_tx_id=er.external_tx_id
      WHERE er.refund_amount_fen IS NOT NULL AND r.amount_fen IS NOT NULL AND r.currency='CNY'
        AND r.product_id IS NOT NULL AND r.mission_id IS NOT NULL AND r.record_source='owner_confirmed'
        AND r.evidence_ref IS NOT NULL AND er.timestamp>=? AND er.timestamp<?`).get(from, to) as any;
    return { gross: Number(gross.total), refund: Number(refund.total) };
  }

  public createRefund(input: { refundId: string; externalTxId: string; amountFen: number; reason: string; evidenceRef: string; idempotencyKey: string }): RefundRecord {
    const revenue = this.getRevenue(input.externalTxId);
    if (!revenue) throw new Error("REVENUE_NOT_FOUND");
    const now = Date.now() / 1000;
    this.db.prepare(`INSERT INTO external_refunds(refund_id,external_tx_id,pixel_id,refund_amount_cny,tokens_deducted,
      deficit_tokens,reason,timestamp,refund_amount_fen,evidence_ref,idempotency_key) VALUES (?,?,?, ?,0,0,?,?,?,?,?)`)
      .run(input.refundId, input.externalTxId, this.bindingPixel(revenue.primaryBindingId ?? ""), input.amountFen / 100,
        input.reason, now, input.amountFen, input.evidenceRef, input.idempotencyKey);
    return { refundId: input.refundId, externalTxId: input.externalTxId, refundAmountFen: input.amountFen,
      evidenceRef: input.evidenceRef, reason: input.reason, timestamp: now };
  }

  public listRefunds(externalTxId?: string): RefundRecord[] {
    const rows = externalTxId
      ? this.db.prepare("SELECT * FROM external_refunds WHERE external_tx_id=? ORDER BY timestamp, refund_id").all(externalTxId) as any[]
      : this.db.prepare("SELECT * FROM external_refunds ORDER BY timestamp, refund_id").all() as any[];
    return rows.map(row => ({ refundId: String(row.refund_id), externalTxId: String(row.external_tx_id),
      refundAmountFen: row.refund_amount_fen == null ? null : Number(row.refund_amount_fen), evidenceRef: row.evidence_ref ?? null,
      reason: String(row.reason ?? ""), timestamp: Number(row.timestamp) }));
  }

  public createNarrativeArtifact(input: { title: string; body: string; sourceEventIds: string[]; sourceMissionIds: string[] }): NarrativeArtifact {
    const artifactId = `narrative_${randomUUID()}`;
    const createdAt = Date.now() / 1000;
    this.db.prepare(`INSERT INTO narrative_artifacts(artifact_id,title,body,source_event_ids_json,source_mission_ids_json,content_revision,created_at)
      VALUES (?,?,?,?,?,1,?)`).run(artifactId, input.title, input.body, JSON.stringify(input.sourceEventIds), JSON.stringify(input.sourceMissionIds), createdAt);
    return { ...input, artifactId, contentRevision: 1, createdAt };
  }

  public listNarrativeArtifacts(limit = 100): NarrativeArtifact[] {
    this.assertLimit(limit);
    return (this.db.prepare("SELECT * FROM narrative_artifacts ORDER BY created_at DESC, artifact_id DESC LIMIT ?").all(limit) as any[])
      .map(row => ({ artifactId: String(row.artifact_id), title: String(row.title), body: String(row.body),
        sourceEventIds: JSON.parse(String(row.source_event_ids_json)), sourceMissionIds: JSON.parse(String(row.source_mission_ids_json)),
        contentRevision: Number(row.content_revision), createdAt: Number(row.created_at) }));
  }

  private mapRevenue(row: any): RevenueRecord {
    const contributions = this.db.prepare(`SELECT qianji_id AS qianjiId,binding_id AS bindingId,share_bps AS shareBps,evidence_ref AS evidenceRef
      FROM revenue_contributions WHERE external_tx_id=? ORDER BY qianji_id`).all(row.external_tx_id) as any[];
    const refunds = this.db.prepare(`SELECT COALESCE(SUM(refund_amount_fen),0) AS total FROM external_refunds WHERE external_tx_id=? AND refund_amount_fen IS NOT NULL`).get(row.external_tx_id) as any;
    const amountFen = row.amount_fen == null ? null : Number(row.amount_fen);
    return { externalTxId: String(row.external_tx_id), amountFen, currency: row.currency ?? null,
      productId: row.product_id ?? null, missionId: row.mission_id ?? null, primaryQianjiId: row.primary_qianji_id ?? null,
      primaryBindingId: row.primary_binding_id ?? null, evidenceRef: row.evidence_ref ?? null,
      recordSource: row.record_source ?? "legacy_unattributed", idempotencyKey: row.idempotency_key ?? null,
      timestamp: Number(row.timestamp), refundFen: Number(refunds.total), verified: amountFen !== null && row.currency === "CNY" &&
        row.product_id != null && row.mission_id != null && row.record_source === "owner_confirmed" && row.evidence_ref != null,
      contributions: contributions.map(item => ({ ...item, shareBps: Number(item.shareBps) })) };
  }

  private bindingPixel(bindingId: string): string {
    const row = this.db.prepare("SELECT pixel_id FROM qianji_bindings WHERE binding_id=?").get(bindingId) as any;
    if (!row) throw new Error("REVENUE_BINDING_NOT_FOUND");
    return String(row.pixel_id);
  }

  private assertLimit(limit: number): void { if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("LIMIT_INVALID"); }
}
