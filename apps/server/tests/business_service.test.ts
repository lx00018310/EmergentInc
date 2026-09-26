import { afterEach, describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { BusinessService } from "../src/services/business_service.js";

describe("BusinessService", () => {
  let root: string | null = null;
  let store: CoreStore | null = null;
  afterEach(() => { store?.close(); store = null; if (root) fs.rmSync(root, { recursive: true, force: true }); root = null; });

  function setup(memberIds = ["qj_a"] as string[]) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "business-service-"));
    fs.mkdirSync(path.join(root, "live", "pixels"), { recursive: true });
    fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
    store = new CoreStore(":memory:");
    const members = memberIds.map((qianjiId, index) => {
      const pixelId = index === 0 ? "0_0_0" : "1_0_0";
      const profile = store!.qianji.createProfile({ qianjiId, careerStatus: "active" });
      const binding = store!.qianji.createBinding({ qianjiId, pixelId, incarnation: 1 });
      store!.pixels.upsertPixelAccount({ pixelId, energy: 5000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
      return { profile, binding, pixelId };
    });
    return { service: new BusinessService(store, root), members };
  }

  function makeDraftMission(members: ReturnType<typeof setup>["members"]) {
    const mission = store!.missions.createDraft({ title: "Build sample", missionType: "delivery", objective: "Make sample",
      acceptanceCriteria: "Owner accepts", budgetTokens: 10000, roundsLimit: 3, ownerQianjiId: members[0]!.profile.qianjiId,
      participants: members.map(({ profile, binding }, index) => ({ qianjiId: profile.qianjiId, bindingId: binding.bindingId, duty: `Duty ${index + 1}` })) });
    const execution = store!.executions.create({ kind: "mission", subjectId: mission.missionId, budgetTokens: 10000, roundsLimit: 3,
      inputSnapshot: {}, toolsSnapshot: ["save_artifact"], bindingIds: members.map(member => member.binding.bindingId) });
    store!.missions.setExecution(mission.missionId, execution.executionId);
    return { mission, execution };
  }

  function completeMission(missionId: string, executionId: string) {
    store!.missions.transition(missionId, "draft", "issued");
    store!.missions.transition(missionId, "issued", "running");
    store!.missions.transition(missionId, "running", "awaiting_acceptance");
    store!.missions.setAcceptance(missionId, "Accepted");
    store!.missions.transition(missionId, "awaiting_acceptance", "completed");
    store!.executions.transition(executionId, "ready", "running");
    store!.executions.transition(executionId, "running", "awaiting_review");
    store!.executions.transition(executionId, "awaiting_review", "closed");
    store!.executions.releaseParticipants(executionId);
  }

  function evidenceFor(executionId: string, bindingId: string) {
    const relativePath = `evidence/${executionId}/snapshots/evidence_1/result.txt`;
    const absolute = path.join(root!, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const bytes = Buffer.from("verified sample result", "utf8");
    fs.writeFileSync(absolute, bytes);
    return store!.executions.addEvidence({ evidenceId: "evidence_1", executionId, bindingId, operationId: "save-op-1",
      relativePath, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, evidenceType: "text_artifact" });
  }

  it("completes product, accepted evidence delivery, feedback, revenue, partial refund and privacy-safe export", () => {
    const { service, members } = setup();
    const { mission, execution } = makeDraftMission(members);
    const product = service.createProduct({ name: "Sample", description: "A sample product", targetUser: "Researchers",
      problemStatement: "Need a summary", ownerQianjiId: members[0]!.profile.qianjiId });
    service.linkMission(product.productId, mission.missionId);
    completeMission(mission.missionId, execution.executionId);
    const evidence = evidenceFor(execution.executionId, members[0]!.binding.bindingId);

    const delivery = service.createDelivery({ productId: product.productId, missionId: mission.missionId,
      contactAlias: "Customer A", evidenceIds: [evidence.evidenceId] });
    expect(service.transitionDelivery(delivery.deliveryId, "delivered").status).toBe("delivered");
    expect(service.transitionDelivery(delivery.deliveryId, "accepted", "Customer accepted").status).toBe("accepted");
    expect(() => service.createDelivery({ productId: product.productId, missionId: mission.missionId, evidenceIds: ["missing"] }))
      .toThrow("DELIVERY_EVIDENCE_NOT_FOUND:missing");

    service.createFeedback({ productId: product.productId, missionId: mission.missionId, contactAlias: "Customer A",
      source: "interview", privateFeedbackText: "PRIVATE ORIGINAL CUSTOMER TEXT", publicSummary: "Needs a shorter report" });
    expect(service.listFeedback(product.productId)[0]?.privateFeedbackText).toContain("PRIVATE ORIGINAL");

    const revenueInput = { externalTxId: "tx-001", amountFen: 1001, productId: product.productId, missionId: mission.missionId,
      primaryQianjiId: members[0]!.profile.qianjiId, evidenceRef: "receipt-index-1", idempotencyKey: "revenue-once" };
    expect(service.recordRevenue(revenueInput).verified).toBe(true);
    service.recordRevenue(revenueInput);
    expect(() => service.recordRevenue({ ...revenueInput, evidenceRef: "different-receipt", idempotencyKey: "revenue-conflicting-retry" })).toThrow("REVENUE_TRANSACTION_CONFLICT");
    expect(service.listRevenues()).toHaveLength(1);
    service.recordRefund({ externalTxId: "tx-001", refundId: "refund-a", amountFen: 300,
      reason: "Partial refund", evidenceRef: "refund-index-a", idempotencyKey: "refund-a-key" });
    expect(() => service.recordRefund({ externalTxId: "tx-001", refundId: "refund-b", amountFen: 702,
      reason: "Too much", evidenceRef: "refund-index-b", idempotencyKey: "refund-b-key" })).toThrow("REFUND_EXCEEDS_REVENUE");
    expect(store!.pixels.getPixelAccount(members[0]!.pixelId)?.energy).toBe(5000);

    store!.modelCalls.recordModelCall({ callId: "model-cost", runId: "run-cost", executionId: execution.executionId,
      pixelId: members[0]!.pixelId, bindingId: members[0]!.binding.bindingId, narrativeRevision: 0,
      model: "mock", promptTokens: 10, completionTokens: 5, cachedTokens: null, actualTokens: 15,
      costCny: 0.2, outcome: "SUCCESS", createdAt: Date.now() / 1000 });
    const message = store!.messages.enqueueMessage({ executionId: execution.executionId, roundNum: 1, sender: "human",
      recipient: members[0]!.pixelId, content: "tool receipt", sourceType: "human", senderBindingId: null,
      recipientBindingId: members[0]!.binding.bindingId });
    store!.toolExecutions.recordStarted({ operation_id: "tool-cost", run_id: "run-cost", message_id: message.messageId,
      pixel_id: members[0]!.pixelId, op_index: 0, tool: "save_artifact", args_hash: "hash", model_call_id: "model-cost", started_at: Date.now() / 1000 });
    store!.toolExecutions.recordFinished({ operationId: "tool-cost", status: "SUCCESS", result: "{}", finishedAt: Date.now() / 1000, costCny: 0.1 });
    const metrics = service.getMetrics("product", product.productId);
    expect(metrics).toMatchObject({ confirmedRevenueFen: 1001, refundFen: 300, netRevenueFen: 701, knownCostCny: 0.3, totalCostCny: 0.3 });
    expect(metrics.roi).toBeCloseTo((7.01 - 0.3) / 0.3);

    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const exported = service.exportFacts(from, to);
    const serialized = JSON.stringify(exported);
    expect(exported.businessMetrics.confirmedRevenueFen).toBe(1001);
    expect(exported.feedback[0]?.publicSummary).toBe("Needs a shorter report");
    expect(serialized).not.toContain("PRIVATE ORIGINAL CUSTOMER TEXT");
    expect(exported.omittedCounts.privateFeedbackText).toBe(1);
    expect(exported.artifactMetadata[0]).not.toHaveProperty("relativePath");
  });

  it("allocates a one-fen net receipt deterministically and leaves legacy rows unattributed", () => {
    const { service, members } = setup(["qj_a", "qj_b"]);
    const { mission, execution } = makeDraftMission(members);
    const product = service.createProduct({ name: "Shared", description: "Shared", targetUser: "Users", problemStatement: "Need", ownerQianjiId: "qj_a" });
    service.linkMission(product.productId, mission.missionId);
    completeMission(mission.missionId, execution.executionId);
    service.recordRevenue({ externalTxId: "tx-cent", amountFen: 1, productId: product.productId, missionId: mission.missionId,
      primaryQianjiId: "qj_a", evidenceRef: "receipt-cent", idempotencyKey: "cent-key",
      contributions: [{ qianjiId: "qj_a", shareBps: 5000 }, { qianjiId: "qj_b", shareBps: 5000 }] });
    store!.db.prepare(`INSERT INTO external_revenues(external_tx_id,pixel_id,net_amount,amount_tokens,timestamp,details)
      VALUES ('legacy-tx','0_0_0',99.99,0,?,NULL)`).run(Date.now() / 1000);
    expect(service.getMetrics("qianji", "qj_a").confirmedRevenueFen).toBe(1);
    expect(service.getMetrics("qianji", "qj_b").confirmedRevenueFen).toBe(0);
    expect(service.getMetrics("organization").confirmedRevenueFen).toBe(1);
    expect(service.listRevenues().find(row => row.externalTxId === "legacy-tx")).toMatchObject({ verified: false, amountFen: null, recordSource: "legacy_unattributed" });
  });

  it("pauses product status and only resumes to the saved prior stage", () => {
    const { service, members } = setup();
    const product = service.createProduct({ name: "P", description: "D", targetUser: "U", problemStatement: "X", ownerQianjiId: "qj_a" });
    expect(service.transitionProduct(product.productId, "validation").status).toBe("validation");
    expect(service.transitionProduct(product.productId, "paused").previousStatus).toBe("validation");
    expect(() => service.transitionProduct(product.productId, "live")).toThrow("PRODUCT_RESUME_STATUS_MISMATCH");
    expect(service.transitionProduct(product.productId, "validation").status).toBe("validation");
    expect(() => service.transitionProduct(product.productId, "retired")).toThrow("PRODUCT_RETIREMENT_REASON_REQUIRED");
    void members;
  });

  it("filters Chronicle facts by person and mission while keeping payloads on the public allow-list", () => {
    const { service, members } = setup(["qj_a", "qj_b"]);
    const { mission } = makeDraftMission(members);
    const now = Math.floor(Date.now() / 1000);
    const matching = store!.worldEvents.append({ eventType: "MISSION_COMPLETED", subjectType: "mission", subjectId: mission.missionId,
      qianjiId: "qj_a", sourceKey: "chronicle:mission-a", createdAt: now,
      payload: { missionId: mission.missionId, outcome: "completed", privateText: "must not appear" } });
    store!.worldEvents.append({ eventType: "MISSION_COMPLETED", subjectType: "mission", subjectId: "mission-other",
      qianjiId: "qj_b", sourceKey: "chronicle:mission-b", createdAt: now,
      payload: { missionId: "mission-other", outcome: "completed" } });
    const artifactInput = { title: "A factual story", body: "A plain text draft", sourceEventIds: [matching.eventId], sourceMissionIds: [mission.missionId], idempotencyKey: "narrative-import-once" };
    const missionStatusBeforeImport = store!.missions.get(mission.missionId)?.status;
    const productCountBeforeImport = Number((store!.db.prepare("SELECT COUNT(*) AS count FROM products").get() as any).count);
    const narrative = service.createNarrativeArtifact(artifactInput);
    expect(service.createNarrativeArtifact(artifactInput).artifactId).toBe(narrative.artifactId);
    expect(() => service.createNarrativeArtifact({ ...artifactInput, body: "changed", idempotencyKey: "narrative-import-once" })).toThrow();
    expect(store!.missions.get(mission.missionId)?.status).toBe(missionStatusBeforeImport);
    expect(Number((store!.db.prepare("SELECT COUNT(*) AS count FROM products").get() as any).count)).toBe(productCountBeforeImport);
    expect(service.listRevenues()).toHaveLength(0);

    const result = service.listChronicle({ from: new Date((now - 10) * 1000).toISOString(), to: new Date((now + 10) * 1000).toISOString(),
      qianjiId: "qj_a", missionId: mission.missionId });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ eventId: matching.eventId, qianjiId: "qj_a", subjectId: mission.missionId,
      payload: { missionId: mission.missionId, outcome: "completed" } });
    expect(JSON.stringify(result)).not.toContain("must not appear");
    expect(result.narratives).toHaveLength(1);
  });

  it("counts receipts and refunds in the period when each was recorded", () => {
    const { service, members } = setup();
    const { mission, execution } = makeDraftMission(members);
    const product = service.createProduct({ name: "Period", description: "D", targetUser: "U", problemStatement: "P", ownerQianjiId: "qj_a" });
    service.linkMission(product.productId, mission.missionId);
    completeMission(mission.missionId, execution.executionId);
    service.recordRevenue({ externalTxId: "tx-period", amountFen: 1001, productId: product.productId, missionId: mission.missionId,
      primaryQianjiId: "qj_a", evidenceRef: "receipt-period", idempotencyKey: "period-revenue" });
    service.recordRefund({ externalTxId: "tx-period", refundId: "refund-period", amountFen: 300,
      reason: "Partial", evidenceRef: "refund-period", idempotencyKey: "period-refund" });
    store!.db.prepare("UPDATE external_revenues SET timestamp=100 WHERE external_tx_id='tx-period'").run();
    store!.db.prepare("UPDATE external_refunds SET timestamp=300 WHERE refund_id='refund-period'").run();

    const receiptPeriod = service.exportFacts(new Date(50_000).toISOString(), new Date(200_000).toISOString());
    const refundPeriod = service.exportFacts(new Date(200_000).toISOString(), new Date(400_000).toISOString());
    expect(receiptPeriod.businessMetrics).toMatchObject({ confirmedRevenueFen: 1001, refundFen: 0 });
    expect(refundPeriod.businessMetrics).toMatchObject({ confirmedRevenueFen: 0, refundFen: 300 });
  });
});
