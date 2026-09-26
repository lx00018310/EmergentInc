import * as fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { CoreStore } from "@emergentinc/persistence";
import { BusinessMetrics, Delivery, NarrativeArtifact, NarrativeExport, Product, ProductStatus, RevenueContribution, RevenueRecord } from "@emergentinc/protocol";
import { containedPath } from "./safe_path.js";

type RevenueInput = {
  externalTxId: string; amountFen: number; productId: string; missionId: string; primaryQianjiId: string;
  contributions?: Array<{ qianjiId: string; shareBps: number; evidenceRef?: string | null }>;
  evidenceRef: string; idempotencyKey: string;
};

const FORWARD: Record<Exclude<ProductStatus, "paused" | "retired">, Array<Exclude<ProductStatus, "idea" | "paused" | "retired"> | "paused" | "retired">> = {
  idea: ["validation", "paused", "retired"],
  validation: ["building", "paused", "retired"],
  building: ["live", "paused", "retired"],
  live: ["paused", "retired"],
};

export class BusinessService {
  constructor(private readonly store: CoreStore, private readonly workspaceRoot: string) {}

  public createProduct(input: { name: string; description: string; targetUser: string; problemStatement: string; ownerQianjiId: string; createdFromMissionId?: string | null }): Product {
    for (const [key, value] of Object.entries(input)) if (key !== "createdFromMissionId" && (typeof value !== "string" || !value.trim())) throw new Error(`PRODUCT_${key.toUpperCase()}_REQUIRED`);
    const profile = this.store.qianji.getProfile(input.ownerQianjiId);
    if (!profile) throw new Error("PRODUCT_OWNER_NOT_FOUND");
    if (input.name.length > 160 || input.description.length > 4000 || input.targetUser.length > 1000 || input.problemStatement.length > 2000) throw new Error("PRODUCT_FIELDS_TOO_LONG");
    return this.store.transaction(() => {
      const product = this.store.business.createProduct(input);
      this.store.worldEvents.append({ eventType: "PRODUCT_CREATED", subjectType: "product", subjectId: product.productId,
        qianjiId: product.ownerQianjiId, sourceKey: `product:${product.productId}:created`,
        payload: { status: product.status } });
      if (input.createdFromMissionId) this.linkMission(product.productId, input.createdFromMissionId);
      return this.store.business.getProduct(product.productId)!;
    });
  }

  public listProducts(limit = 100) { return this.store.business.listProducts(limit); }
  public getProduct(id: string) { return this.store.business.getProduct(id); }

  public updateProduct(id: string, input: { name: string; description: string; targetUser: string; problemStatement: string }): Product {
    if (!this.store.business.getProduct(id)) throw new Error("PRODUCT_NOT_FOUND");
    return this.store.business.updateProduct(id, input);
  }

  public transitionProduct(id: string, next: ProductStatus, reason?: string): Product {
    return this.store.transaction(() => {
      const current = this.store.business.getProduct(id);
      if (!current) throw new Error("PRODUCT_NOT_FOUND");
      let previous = current.previousStatus;
      if (next === "retired" && !reason?.trim()) throw new Error("PRODUCT_RETIREMENT_REASON_REQUIRED");
      if (next === "paused") {
        if (current.status === "paused" || current.status === "retired") throw new Error("PRODUCT_TRANSITION_INVALID");
        previous = current.status as Exclude<ProductStatus, "paused" | "retired">;
      } else if (current.status === "paused") {
        if (next !== current.previousStatus) throw new Error("PRODUCT_RESUME_STATUS_MISMATCH");
        previous = null;
      } else if (current.status === "retired" || !FORWARD[current.status as Exclude<ProductStatus, "paused" | "retired">].some(status => status === next)) {
        throw new Error("PRODUCT_TRANSITION_INVALID");
      }
      const updated = this.store.business.transitionProduct(id, current.status, next, previous, reason?.trim());
      this.store.worldEvents.append({ eventType: "PRODUCT_STATUS_CHANGED", subjectType: "product", subjectId: id,
        sourceKey: `product:${id}:status:${randomUUID()}`, payload: { from: current.status, to: updated.status } });
      return updated;
    });
  }

  public linkMission(productId: string, missionId: string): Product {
    return this.store.transaction(() => {
      const product = this.store.business.getProduct(productId);
      const mission = this.store.missions.get(missionId);
      if (!product || !mission) throw new Error("PRODUCT_OR_MISSION_NOT_FOUND");
      if (product.status === "retired" || product.status === "paused") throw new Error("PRODUCT_NOT_LINKABLE");
      if (mission.status !== "draft" && mission.status !== "issued") throw new Error("MISSION_ALREADY_STARTED");
      if (mission.executionId) {
        const execution = this.store.executions.get(mission.executionId);
        if (!execution || execution.roundsUsed !== 0 || execution.status !== "ready") throw new Error("MISSION_ALREADY_STARTED");
      }
      return this.store.business.linkMission(productId, missionId);
    });
  }

  public createFeedback(input: { productId: string; missionId?: string | null; contactAlias?: string | null; source: string;
    privateFeedbackText: string; publicSummary?: string | null; occurredAt?: number }): unknown {
    if (!input.source.trim() || !input.privateFeedbackText.trim()) throw new Error("FEEDBACK_FIELDS_REQUIRED");
    const product = this.store.business.getProduct(input.productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    if (input.missionId && !product.missions.includes(input.missionId)) throw new Error("FEEDBACK_MISSION_NOT_LINKED");
    const occurredAt = input.occurredAt ?? Date.now() / 1000;
    if (!Number.isFinite(occurredAt) || occurredAt < 0) throw new Error("FEEDBACK_TIME_INVALID");
    return this.store.transaction(() => {
      const feedback = this.store.business.createFeedback({ productId: input.productId, missionId: input.missionId ?? null,
        contactAlias: input.contactAlias?.trim() || null, source: input.source.trim(),
        privateFeedbackText: input.privateFeedbackText, publicSummary: input.publicSummary?.trim() || null, occurredAt });
      this.store.worldEvents.append({ eventType: "EXTERNAL_FEEDBACK_RECEIVED", subjectType: "product", subjectId: input.productId,
        sourceKey: `feedback:${feedback.feedbackId}:received`, payload: { source: feedback.source,
          hasPublicSummary: Boolean(feedback.publicSummary), publicSummary: feedback.publicSummary } });
      return feedback;
    });
  }

  public listFeedback(productId?: string) { return this.store.business.listFeedback(productId); }

  public createDelivery(input: { productId: string; missionId: string; contactAlias?: string | null; evidenceIds: string[] }): Delivery {
    return this.store.transaction(() => {
      const product = this.store.business.getProduct(input.productId);
      const mission = this.store.missions.get(input.missionId);
      if (!product || !mission) throw new Error("PRODUCT_OR_MISSION_NOT_FOUND");
      if (!product.missions.includes(input.missionId)) throw new Error("DELIVERY_MISSION_NOT_LINKED");
      if (mission.status !== "completed" || !mission.executionId) throw new Error("DELIVERY_REQUIRES_ACCEPTED_MISSION");
      if (!input.evidenceIds.length || new Set(input.evidenceIds).size !== input.evidenceIds.length) throw new Error("DELIVERY_EVIDENCE_REQUIRED");
      const evidence = this.store.executions.listEvidence(mission.executionId);
      for (const id of input.evidenceIds) {
        const item = evidence.find(value => value.evidenceId === id);
        if (!item) throw new Error(`DELIVERY_EVIDENCE_NOT_FOUND:${id}`);
        this.assertEvidence(item);
      }
      const delivery = this.store.business.createDelivery({ productId: input.productId, missionId: input.missionId,
        contactAlias: input.contactAlias?.trim() || null, evidenceIds: input.evidenceIds });
      return delivery;
    });
  }

  public transitionDelivery(id: string, next: "delivered" | "accepted" | "rejected", note?: string): Delivery {
    return this.store.transaction(() => {
      const delivery = this.store.business.getDelivery(id);
      if (!delivery) throw new Error("DELIVERY_NOT_FOUND");
      const allowed = delivery.status === "draft" && next === "delivered" || delivery.status === "delivered" && ["accepted", "rejected"].includes(next);
      if (!allowed) throw new Error("DELIVERY_TRANSITION_INVALID");
      if (next !== "delivered" && !note?.trim()) throw new Error("DELIVERY_ACCEPTANCE_NOTE_REQUIRED");
      const mission = this.store.missions.get(delivery.missionId)!;
      const evidence = this.store.executions.listEvidence(mission.executionId!);
      for (const id of delivery.evidenceIds) {
        const item = evidence.find(value => value.evidenceId === id);
        if (!item) throw new Error(`DELIVERY_EVIDENCE_NOT_FOUND:${id}`);
        this.assertEvidence(item);
      }
      const updated = this.store.business.transitionDelivery(id, delivery.status, next, note?.trim());
      this.store.worldEvents.append({ eventType: "DELIVERY_STATUS_CHANGED", subjectType: "product", subjectId: delivery.productId,
        sourceKey: `delivery:${id}:status:${next}`, payload: { deliveryId: id, missionId: delivery.missionId, status: next } });
      return updated;
    });
  }

  public listDeliveries(productId?: string) { return this.store.business.listDeliveries(productId); }

  public recordRevenue(input: RevenueInput): RevenueRecord {
    if (!Number.isSafeInteger(input.amountFen) || input.amountFen < 1) throw new Error("REVENUE_AMOUNT_INVALID");
    if (!input.externalTxId.trim() || input.externalTxId.length > 200 || !input.evidenceRef.trim() || input.evidenceRef.length > 1000 ||
        !input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new Error("REVENUE_FIELDS_REQUIRED");
    const action = `revenue.record:${input.externalTxId}`;
    return this.store.ownerActions.execute(input.idempotencyKey, action, input, () => this.store.transaction(() => {
      const existing = this.store.business.getRevenue(input.externalTxId);
      if (existing) {
        const requestedContributions = input.contributions?.length
          ? [...input.contributions].sort((a, b) => a.qianjiId.localeCompare(b.qianjiId))
          : [{ qianjiId: input.primaryQianjiId, shareBps: 10000 }];
        const storedContributions = [...existing.contributions].sort((a, b) => a.qianjiId.localeCompare(b.qianjiId));
        if (existing.amountFen === input.amountFen && existing.productId === input.productId && existing.missionId === input.missionId &&
            existing.primaryQianjiId === input.primaryQianjiId && existing.evidenceRef === input.evidenceRef && storedContributions.length === requestedContributions.length &&
            storedContributions.every((item, index) => item.qianjiId === requestedContributions[index]!.qianjiId && item.shareBps === requestedContributions[index]!.shareBps &&
              (item.evidenceRef ?? null) === (requestedContributions[index]!.evidenceRef?.trim() || null))) return existing;
        throw new Error("REVENUE_TRANSACTION_CONFLICT");
      }
      const product = this.store.business.getProduct(input.productId);
      const mission = this.store.missions.get(input.missionId);
      if (!product || !mission || !product.missions.includes(input.missionId)) throw new Error("REVENUE_PRODUCT_MISSION_MISMATCH");
      if (mission.status !== "completed") throw new Error("REVENUE_REQUIRES_COMPLETED_MISSION");
      const primary = mission.participants.find(p => p.qianjiId === input.primaryQianjiId);
      if (!primary) throw new Error("REVENUE_PRIMARY_NOT_PARTICIPANT");
      const raw = input.contributions?.length ? input.contributions : [{ qianjiId: input.primaryQianjiId, shareBps: 10000 }];
      if (new Set(raw.map(item => item.qianjiId)).size !== raw.length || raw.some(item =>
          !Number.isSafeInteger(item.shareBps) || item.shareBps < 0 || item.shareBps > 10000)) throw new Error("REVENUE_CONTRIBUTIONS_INVALID");
      if (raw.reduce((sum, item) => sum + item.shareBps, 0) !== 10000) throw new Error("REVENUE_SHARES_MUST_TOTAL_10000");
      const participants = new Map(mission.participants.map(p => [p.qianjiId, p]));
      const contributions: RevenueContribution[] = raw.map(item => {
        const participant = participants.get(item.qianjiId);
        if (!participant) throw new Error(`REVENUE_CONTRIBUTOR_NOT_PARTICIPANT:${item.qianjiId}`);
        return { qianjiId: item.qianjiId, bindingId: participant.bindingId, shareBps: item.shareBps,
          evidenceRef: item.evidenceRef?.trim() || null };
      });
      const revenue = this.store.business.createRevenue({ ...input, primaryBindingId: primary.bindingId, contributions });
      this.store.worldEvents.append({ eventType: "REVENUE_RECEIVED", subjectType: "product", subjectId: product.productId,
        qianjiId: input.primaryQianjiId, bindingId: primary.bindingId, sourceKey: `revenue:${input.externalTxId}:received`,
        payload: { amountFen: input.amountFen, currency: "CNY", productId: product.productId, missionId: mission.missionId } });
      return revenue;
    }));
  }

  public listRevenues(): RevenueRecord[] { return this.store.business.listRevenues(); }

  public recordRefund(input: { externalTxId: string; refundId: string; amountFen: number; reason: string; evidenceRef: string; idempotencyKey: string }) {
    if (!Number.isSafeInteger(input.amountFen) || input.amountFen < 1 || !input.reason.trim() || !input.evidenceRef.trim() ||
        !input.idempotencyKey.trim() || !input.refundId.trim()) throw new Error("REFUND_FIELDS_INVALID");
    const request = input;
    return this.store.ownerActions.execute(input.idempotencyKey, `refund.record:${input.refundId}`, request, () => this.store.transaction(() => {
      const revenue = this.store.business.getRevenue(input.externalTxId);
      if (!revenue || !revenue.verified || revenue.amountFen === null) throw new Error("REFUND_VERIFIED_REVENUE_REQUIRED");
      if (revenue.refundFen + input.amountFen > revenue.amountFen) throw new Error("REFUND_EXCEEDS_REVENUE");
      const refund = this.store.business.createRefund(input);
      const productId = revenue.productId!;
      this.store.worldEvents.append({ eventType: "REFUND_RECORDED", subjectType: "product", subjectId: productId,
        qianjiId: revenue.primaryQianjiId, bindingId: revenue.primaryBindingId,
        sourceKey: `refund:${input.refundId}:recorded`, payload: { externalTxId: input.externalTxId,
          refundAmountFen: input.amountFen, currency: "CNY" } });
      return refund;
    }));
  }

  public getMetrics(scope: "organization" | "product" | "qianji" | "mission" = "organization", id?: string): BusinessMetrics {
    const revenueRows = this.store.business.listRevenues().filter(row => row.verified);
    let scopedRevenues = revenueRows;
    let executionIds: string[] = [];
    if (scope === "product") {
      if (!id) throw new Error("PRODUCT_ID_REQUIRED");
      const product = this.store.business.getProduct(id); if (!product) throw new Error("PRODUCT_NOT_FOUND");
      scopedRevenues = revenueRows.filter(row => row.productId === id);
      executionIds = product.missions.flatMap(mid => { const m = this.store.missions.get(mid); return m?.executionId ? [m.executionId] : []; });
    } else if (scope === "mission") {
      if (!id) throw new Error("MISSION_ID_REQUIRED");
      const mission = this.store.missions.get(id); if (!mission) throw new Error("MISSION_NOT_FOUND");
      scopedRevenues = revenueRows.filter(row => row.missionId === id);
      executionIds = mission.executionId ? [mission.executionId] : [];
    } else if (scope === "qianji") {
      if (!id || !this.store.qianji.getProfile(id)) throw new Error("QIANJI_NOT_FOUND");
      const bindings = this.store.qianji.listBindings(id).map(item => item.bindingId);
      scopedRevenues = revenueRows.filter(row => row.contributions.some(item => item.qianjiId === id));
      return this.qianjiMetrics(id, bindings, scopedRevenues);
    } else {
      executionIds = (this.store.db.prepare("SELECT execution_id FROM executions").all() as any[]).map(row => String(row.execution_id));
    }
    const revenue = this.sumRevenue(scopedRevenues);
    const cost = scope === "organization" ? this.organizationCosts() : this.executionCosts(executionIds);
    const net = revenue.gross - revenue.refund;
    return { scope, confirmedRevenueFen: revenue.gross, refundFen: revenue.refund, netRevenueFen: net,
      ...cost, roi: cost.totalCostCny === null || cost.totalCostCny <= 0 ? null : (net / 100 - cost.totalCostCny) / cost.totalCostCny };
  }

  public exportFacts(fromIso: string, toIso: string): NarrativeExport {
    const fromMs = Date.parse(fromIso); const toMs = Date.parse(toIso);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new Error("NARRATIVE_PERIOD_INVALID");
    if (toMs - fromMs > 31 * 24 * 60 * 60 * 1000) throw new Error("NARRATIVE_PERIOD_EXCEEDS_31_DAYS");
    const from = fromMs / 1000; const to = toMs / 1000;
    return this.store.transaction(() => {
      const eventCount = this.store.worldEvents.countBetween(from, to);
      if (eventCount > 2000) throw new Error("NARRATIVE_EVENT_LIMIT_EXCEEDED:2000");
      const rawEvents = this.store.worldEvents.listBetween(from, to, 2000);
      const events = rawEvents.map(event => ({ eventId: event.eventId, eventType: event.eventType, subjectType: event.subjectType,
        subjectId: event.subjectId, qianjiId: event.qianjiId, bindingId: event.bindingId, pixelId: event.pixelId,
        createdAt: event.createdAt, payload: this.publicEventPayload(event.eventType, event.payload) }));
      const missions = this.periodRows(`SELECT mission_id,title,mission_type,objective,acceptance_criteria,status,owner_qianji_id,execution_id,created_at,completed_at
        FROM missions WHERE (created_at>=? AND created_at<?) OR (completed_at>=? AND completed_at<?) ORDER BY created_at,mission_id`, from, to);
      const trials = this.periodRows(`SELECT trial_id,recruitment_id,challenge_text,acceptance_criteria,total_budget_tokens,rounds_per_candidate,candidate_budget_tokens,model_name,status,winner_qianji_id,created_at
        FROM trials WHERE created_at>=? AND created_at<? ORDER BY created_at,trial_id`, from, to);
      const products = this.periodRows(`SELECT product_id,name,description,target_user,problem_statement,owner_qianji_id,status,created_from_mission_id,created_at
        FROM products WHERE created_at>=? AND created_at<? ORDER BY created_at,product_id`, from, to);
      const deliveries = this.periodRows(`SELECT delivery_id,product_id,mission_id,contact_alias,evidence_ids_json,status,delivered_at,accepted_at,acceptance_note
        FROM deliveries WHERE (delivered_at>=? AND delivered_at<?) OR (accepted_at>=? AND accepted_at<?) ORDER BY delivery_id`, from, to)
        .map(row => ({ deliveryId: row.delivery_id, productId: row.product_id, missionId: row.mission_id,
          evidenceIds: JSON.parse(String(row.evidence_ids_json)), status: row.status, deliveredAt: row.delivered_at, acceptedAt: row.accepted_at, acceptanceNote: row.acceptance_note }));
      const feedback = (this.store.business.listFeedback() as any[]).filter(item => item.occurredAt >= from && item.occurredAt < to)
        .map(item => ({ feedbackId: item.feedbackId, productId: item.productId, missionId: item.missionId,
          contactAlias: item.contactAlias, source: item.source, publicSummary: item.publicSummary, occurredAt: item.occurredAt }));
      const artifactMetadata = (this.store.db.prepare(`SELECT ee.evidence_id,ee.execution_id,ee.sha256,ee.size_bytes,ee.evidence_type,ee.created_at
        FROM execution_evidence ee WHERE ee.created_at>=? AND ee.created_at<? ORDER BY ee.created_at,ee.evidence_id`).all(from, to) as any[])
        .map(row => ({ evidenceId: String(row.evidence_id), executionId: String(row.execution_id), sha256: row.sha256 ?? null,
          sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes), evidenceType: String(row.evidence_type), createdAt: Number(row.created_at) }));
      const characters = new Map<string, { qianjiId: string; displayName: string | null; narrativeRevision: number | null }>();
      for (const event of rawEvents) if (event.qianjiId && !characters.has(event.qianjiId)) {
        const revision = this.store.db.prepare(`SELECT revision,narrative_json FROM qianji_narrative_revisions
          WHERE qianji_id=? AND created_at<=? ORDER BY created_at DESC,revision DESC LIMIT 1`).get(event.qianjiId, event.createdAt) as any;
        const narrative = revision ? JSON.parse(String(revision.narrative_json)) : null;
        characters.set(event.qianjiId, { qianjiId: event.qianjiId, displayName: narrative?.displayName ?? null,
          narrativeRevision: revision ? Number(revision.revision) : null });
      }
      const periodRevenue = this.revenueRowsBetween(from, to);
      const periodCosts = this.rangeCosts(from, to);
      const omittedCounts = { privateFeedbackText: feedback.length, artifactBodies: artifactMetadata.length,
        rawResponses: Number((this.store.db.prepare("SELECT COUNT(*) AS count FROM model_calls WHERE created_at>=? AND created_at<?").get(from, to) as any).count),
        absolutePaths: 0 };
      return { schemaVersion: 1, generatedAt: new Date().toISOString(), period: { from: fromIso, to: toIso },
        characters: [...characters.values()], events, missions, trials: trials.map(row => ({ trialId: row.trial_id,
          recruitmentId: row.recruitment_id, challengeText: row.challenge_text, acceptanceCriteria: row.acceptance_criteria,
          totalBudgetTokens: row.total_budget_tokens, roundsPerCandidate: row.rounds_per_candidate,
          candidateBudgetTokens: row.candidate_budget_tokens, modelName: row.model_name, status: row.status,
          winnerQianjiId: row.winner_qianji_id, createdAt: row.created_at })), products, deliveries, feedback,
        artifactMetadata, businessMetrics: { confirmedRevenueFen: periodRevenue.gross, refundFen: periodRevenue.refund,
          knownCostCny: periodCosts.knownCostCny, totalCostCny: periodCosts.totalCostCny }, omittedCounts,
        warnings: ["已确认收款由Owner录入，系统不核验银行流水。", "artifact正文、客户反馈原文、私有目录与完整模型响应未导出。"] };
    });
  }

  public createNarrativeArtifact(input: { title: string; body: string; sourceEventIds: string[]; sourceMissionIds: string[]; idempotencyKey: string }): NarrativeArtifact {
    if (!input.title.trim() || !input.body.trim() || input.title.length > 200 || input.body.length > 30000 || !input.idempotencyKey.trim() || input.idempotencyKey.length > 200) throw new Error("NARRATIVE_ARTIFACT_FIELDS_INVALID");
    if (new Set(input.sourceEventIds).size !== input.sourceEventIds.length || new Set(input.sourceMissionIds).size !== input.sourceMissionIds.length) throw new Error("NARRATIVE_SOURCE_IDS_DUPLICATE");
    for (const id of input.sourceEventIds) if (!this.store.worldEvents.getBySourceKey(id) &&
      !(this.store.db.prepare("SELECT 1 FROM world_events WHERE event_id=?").get(id))) throw new Error(`NARRATIVE_EVENT_NOT_FOUND:${id}`);
    for (const id of input.sourceMissionIds) if (!this.store.missions.get(id)) throw new Error(`NARRATIVE_MISSION_NOT_FOUND:${id}`);
    const { idempotencyKey, ...artifact } = input;
    return this.store.ownerActions.execute(idempotencyKey, "narrative.create", input,
      () => this.store.transaction(() => this.store.business.createNarrativeArtifact(artifact)));
  }

  public listNarrativeArtifacts(limit = 100) { return this.store.business.listNarrativeArtifacts(limit); }

  public listChronicle(input: { from: string; to: string; qianjiId?: string; missionId?: string; productId?: string; limit?: number }) {
    const fromMs = Date.parse(input.from); const toMs = Date.parse(input.to);
    const limit = input.limit ?? 100;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) throw new Error("CHRONICLE_PERIOD_INVALID");
    if (toMs - fromMs > 31 * 24 * 60 * 60 * 1000) throw new Error("CHRONICLE_PERIOD_EXCEEDS_31_DAYS");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("CHRONICLE_LIMIT_INVALID");
    const from = fromMs / 1000; const to = toMs / 1000;
    return this.store.transaction(() => {
      if (this.store.worldEvents.countBetween(from, to) > 2000) throw new Error("CHRONICLE_EVENT_LIMIT_EXCEEDED:2000");
      const matches = this.store.worldEvents.listBetween(from, to, 2000).filter(event =>
        (!input.qianjiId || event.qianjiId === input.qianjiId) &&
        (!input.missionId || (event.subjectType === "mission" && event.subjectId === input.missionId) || event.payload.missionId === input.missionId) &&
        (!input.productId || (event.subjectType === "product" && event.subjectId === input.productId) || event.payload.productId === input.productId));
      const events = matches.slice(-limit).reverse().map(event => ({ eventId: event.eventId, eventType: event.eventType,
        subjectType: event.subjectType, subjectId: event.subjectId, qianjiId: event.qianjiId, bindingId: event.bindingId,
        pixelId: event.pixelId, createdAt: event.createdAt, payload: this.publicEventPayload(event.eventType, event.payload) }));
      const eventIds = new Set(events.map(event => event.eventId));
      const narratives = this.store.business.listNarrativeArtifacts(500).filter(item => item.createdAt >= from && item.createdAt < to &&
        (!input.missionId || item.sourceMissionIds.includes(input.missionId)) &&
        (!input.qianjiId && !input.productId || item.sourceEventIds.some(id => eventIds.has(id)) || Boolean(input.missionId && item.sourceMissionIds.includes(input.missionId))));
      return { period: { from: input.from, to: input.to }, events, narratives };
    });
  }

  private assertEvidence(evidence: any): void {
    if (!evidence.relativePath || !evidence.sha256 || evidence.sizeBytes === null) throw new Error("BUSINESS_EVIDENCE_INCOMPLETE");
    const segments = String(evidence.relativePath).split("/");
    if (segments[0] !== "evidence" || !segments.includes("snapshots")) throw new Error("BUSINESS_EVIDENCE_PATH_INVALID");
    const file = containedPath(this.workspaceRoot, ...segments);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("BUSINESS_EVIDENCE_MISSING");
    const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (hash !== evidence.sha256 || fs.statSync(file).size !== evidence.sizeBytes) throw new Error("BUSINESS_EVIDENCE_CHANGED");
  }

  private sumRevenue(rows: RevenueRecord[]) {
    let gross = 0; let refund = 0;
    for (const row of rows) { gross += row.amountFen ?? 0; refund += row.refundFen; }
    return { gross, refund };
  }

  private revenueRowsBetween(from: number, to: number) {
    return this.store.business.revenueSumsBetween(from, to);
  }

  private executionCosts(executionIds: string[]) {
    if (!executionIds.length) return { knownCostCny: 0, unknownModelCount: 0, unknownToolCount: 0, totalCostCny: 0 };
    const marks = executionIds.map(() => "?").join(",");
    const models = this.store.db.prepare(`SELECT cost_cny FROM model_calls WHERE execution_id IN (${marks})`).all(...executionIds) as any[];
    const tools = this.store.db.prepare(`SELECT te.cost_cny FROM tool_executions te JOIN messages m ON m.message_id=te.message_id
      WHERE m.execution_id IN (${marks})`).all(...executionIds) as any[];
    return this.costFromRows(models, tools, []);
  }

  private organizationCosts() {
    const models = this.store.db.prepare("SELECT cost_cny FROM model_calls").all() as any[];
    const tools = this.store.db.prepare("SELECT cost_cny FROM tool_executions").all() as any[];
    const owners = this.store.db.prepare("SELECT cost_cny FROM owner_chat_calls").all() as any[];
    return this.costFromRows(models, tools, owners);
  }

  private qianjiMetrics(qianjiId: string, bindingIds: string[], revenues: RevenueRecord[]): BusinessMetrics {
    const marks = bindingIds.length ? bindingIds.map(() => "?").join(",") : "NULL";
    const models = bindingIds.length ? this.store.db.prepare(`SELECT cost_cny FROM model_calls WHERE binding_id IN (${marks})`).all(...bindingIds) as any[] : [];
    const tools = bindingIds.length ? this.store.db.prepare(`SELECT te.cost_cny FROM tool_executions te JOIN model_calls mc ON mc.call_id=te.model_call_id
      WHERE mc.binding_id IN (${marks})`).all(...bindingIds) as any[] : [];
    const cost = this.costFromRows(models, tools, []);
    const grossShares = this.attributedFen(qianjiId, revenues, false);
    const refundShares = this.attributedFen(qianjiId, revenues, true);
    const net = grossShares - refundShares;
    return { scope: "qianji", confirmedRevenueFen: grossShares, refundFen: refundShares, netRevenueFen: net, ...cost,
      roi: cost.totalCostCny === null || cost.totalCostCny <= 0 ? null : (net / 100 - cost.totalCostCny) / cost.totalCostCny };
  }

  private attributedFen(qianjiId: string, rows: RevenueRecord[], refund: boolean): number {
    let total = 0;
    for (const row of rows) {
      if (!row.amountFen) continue;
      const base = refund ? row.refundFen : row.amountFen;
      if (base <= 0 || !row.contributions.length) continue;
      const allocations = this.allocateFen(base, row.contributions.map(item => ({ qianjiId: item.qianjiId, shareBps: item.shareBps })));
      total += allocations.get(qianjiId) ?? 0;
    }
    return total;
  }

  private allocateFen(amountFen: number, shares: Array<{ qianjiId: string; shareBps: number }>): Map<string, number> {
    let allocated = 0;
    const values = shares.map(item => {
      const exact = BigInt(amountFen) * BigInt(item.shareBps);
      const base = Number(exact / 10000n); allocated += base;
      return { qianjiId: item.qianjiId, amount: base, remainder: exact % 10000n };
    });
    const remainderCents = amountFen - allocated;
    values.sort((a, b) => a.qianjiId.localeCompare(b.qianjiId));
    for (let index = 0; index < remainderCents; index++) values[index % values.length]!.amount++;
    return new Map(values.map(item => [item.qianjiId, item.amount]));
  }

  private costFromRows(models: any[], tools: any[], owners: any[]) {
    let knownCostCny = 0; let unknownModelCount = 0; let unknownToolCount = 0;
    for (const row of models) row.cost_cny == null ? unknownModelCount++ : knownCostCny += Number(row.cost_cny);
    for (const row of tools) row.cost_cny == null ? unknownToolCount++ : knownCostCny += Number(row.cost_cny);
    for (const row of owners) row.cost_cny == null ? unknownModelCount++ : knownCostCny += Number(row.cost_cny);
    knownCostCny = Number(knownCostCny.toFixed(8));
    return { knownCostCny, unknownModelCount, unknownToolCount,
      totalCostCny: unknownModelCount + unknownToolCount > 0 ? null : knownCostCny };
  }

  private rangeCosts(from: number, to: number) {
    const models = this.store.db.prepare("SELECT cost_cny FROM model_calls WHERE created_at>=? AND created_at<?").all(from, to) as any[];
    const tools = this.store.db.prepare("SELECT cost_cny FROM tool_executions WHERE started_at>=? AND started_at<?").all(from, to) as any[];
    const owners = this.store.db.prepare("SELECT cost_cny FROM owner_chat_calls WHERE created_at>=? AND created_at<?").all(from, to) as any[];
    return this.costFromRows(models, tools, owners);
  }

  private periodRows(sql: string, from: number, to: number): Array<Record<string, any>> {
    const parameterCount = (sql.match(/\?/g) ?? []).length;
    const values = Array.from({ length: parameterCount }, (_, index) => index % 2 === 0 ? from : to);
    return this.store.db.prepare(sql).all(...values) as any[];
  }

  private publicEventPayload(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
    const allowed = new Set(["executionId", "evidenceIds", "outcome", "winnerQianjiId", "candidateCount", "status", "from", "to",
      "amountFen", "refundAmountFen", "currency", "productId", "missionId", "deliveryId", "source", "hasPublicSummary", "publicSummary"]);
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) if (allowed.has(key)) result[key] = value;
    if (eventType !== "EXTERNAL_FEEDBACK_RECEIVED") delete result.publicSummary;
    return result;
  }
}
