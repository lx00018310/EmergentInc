import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { TrialService, TrialCandidateInput } from "../src/services/trial_service.js";
import { MissionService } from "../src/services/mission_service.js";
import { BusinessService } from "../src/services/business_service.js";
import { createHash } from "node:crypto";

describe("TrialService", () => {
  let root: string | null = null;
  let store: CoreStore | null = null;
  afterEach(() => {
    store?.close(); store = null;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function setup() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trial-service-"));
    fs.mkdirSync(path.join(root, "live", "pixels"), { recursive: true });
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(root, "live", "world_state.json"), JSON.stringify({ round: 4 }));
    store = new CoreStore(":memory:");
    const starts: Array<{ executionId: string; onRunFinalized: Function }> = [];
    let active = false;
    let runIndex = 0;
    const runService = {
      getWorldRound: () => 4,
      getStatus: () => ({ running: active, run_id: active ? `trial_run_${runIndex}` : null }),
      requestStop: () => { active = false; return { status: "STOPPING", message: "stopped" }; },
      async start(options: any) {
        if (active) throw new Error("RUN_IN_PROGRESS");
        runIndex++;
        active = true;
        store!.transaction(() => {
          store!.runs.createRun({ run_id: `trial_run_${runIndex}`, execution_id: options.executionId,
            start_round: 5, end_round: 5, run_limit: options.runBudgetTokens, run_spent: 0,
            run_reserved: 0, genesis_revision: 1, status: "RUNNING", created_at: Date.now() / 1000 });
          options.onRunCreated(`trial_run_${runIndex}`);
        });
        starts.push({ executionId: options.executionId, onRunFinalized: options.onRunFinalized });
        return { status: "STARTED", run_id: `trial_run_${runIndex}` };
      },
      finish(status: "awaiting_review" | "blocked") {
        const current = starts.at(-1)!;
        const execution = store!.executions.get(current.executionId)!;
        store!.executions.transition(current.executionId, "running", status);
        store!.runs.updateRunStatus(`trial_run_${runIndex}`, "COMPLETED", "NO_ACTIVE_MESSAGES");
        active = false;
        current.onRunFinalized(`trial_run_${runIndex}`, current.executionId, status, "NO_ACTIVE_MESSAGES");
      },
    };
    const service = new TrialService({ store, workspaceRoot: root, runService: runService as any,
      enabledTools: ["save_artifact", "read_artifact", "list_artifacts", "webfetch"], modelName: "mock-model",
      captureEvidence: executionId => store!.executions.listEvidence(executionId) });
    return { service, runService, starts };
  }

  function narrative(name: string) {
    return { displayName: name, title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null,
      shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null };
  }

  function createTrial(service: TrialService) {
    return service.create({ challengeText: "Write a neutral summary", acceptanceCriteria: "Clear and sourced",
      totalBudgetTokens: 2000, candidateBudgetTokens: 1000, roundsPerCandidate: 2,
      allowedTools: ["save_artifact", "read_artifact", "list_artifacts"] });
  }

  function candidate(pixelId: string, key: string, label: string): TrialCandidateInput {
    return { pixelId, idempotencyKey: key, initialEnergyTokens: 1200,
      formalNarrative: narrative(`${label} formal`) as any, testNarrative: narrative(`${label} test`) as any };
  }

  it("creates blank candidate workspaces and retries without duplicating reward or identity", () => {
    const { service } = setup();
    const trial = createTrial(service);
    const request = candidate("0_0_0", "candidate-key-a", "A");
    const first = service.createCandidate(trial.trialId, request);
    const balance = store!.pixels.getPixelAccount("0_0_0")!.energy;
    const retry = service.createCandidate(trial.trialId, request);
    expect(retry.candidateId).toBe(first.candidateId);
    expect(store!.pixels.getPixelAccount("0_0_0")!.energy).toBe(balance);
    expect(balance).toBe(1200);
    expect(store!.qianji.getProfile(first.qianjiId)?.narrative.displayName).toBe("A test");
    expect(first.formalNarrative?.displayName).toBe("A formal");
    for (const file of ["pixel.md", "tips.md", "mandate.md", "state.json"]) {
      expect(fs.existsSync(path.join(root!, "live", "pixels", "0_0_0", file))).toBe(true);
    }
    expect(fs.existsSync(path.join(root!, "live", "artifacts", "0_0_0"))).toBe(true);
    expect(() => service.createCandidate(trial.trialId, candidate("00_0_0", "bad-coordinate", "bad")))
      .toThrow("CANDIDATE_COORDINATE_INVALID");
  });

  it("rolls back identity and energy when safe directory installation fails and blocks retry over staging residue", () => {
    const { service } = setup();
    const trial = createTrial(service);
    fs.writeFileSync(path.join(root!, "live", "artifacts"), "occupied path");
    const request = candidate("0_0_0", "candidate-key-fail", "A");
    expect(() => service.createCandidate(trial.trialId, request)).toThrow();
    expect(store!.qianji.listProfiles({ limit: 200 })).toHaveLength(0);
    expect(store!.pixels.getPixelAccount("0_0_0")).toBeNull();
    expect(fs.existsSync(path.join(root!, "live", "pixels", "0_0_0"))).toBe(false);
    fs.unlinkSync(path.join(root!, "live", "artifacts"));
    expect(() => service.createCandidate(trial.trialId, request)).toThrow("CANDIDATE_STAGING_REMAINS");
  });

  it("runs candidates serially under the same rules, pauses on a blocked result, then accepts once", async () => {
    const { service, runService, starts } = setup();
    const trial = createTrial(service);
    const first = service.createCandidate(trial.trialId, candidate("0_0_0", "candidate-key-a", "A"));
    const second = service.createCandidate(trial.trialId, candidate("1_0_0", "candidate-key-b", "B"));
    const started = await service.start(trial.trialId);
    expect((started as any).candidateId).toBe(first.candidateId);
    expect(starts).toHaveLength(1);
    expect(store!.executions.get(first.executionId)!.inputSnapshot.rulesHash)
      .toBe(store!.executions.get(second.executionId)!.inputSnapshot.rulesHash);
    expect(JSON.stringify(store!.executions.get(first.executionId)!.inputSnapshot)).not.toContain(second.qianjiId);

    runService.finish("awaiting_review");
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(starts).toHaveLength(2);
    expect(starts[1].executionId).toBe(second.executionId);
    expect(store!.executions.get(first.executionId)?.status).toBe("closed");

    runService.finish("blocked");
    expect(service.get(trial.trialId)?.pauseReason).toContain("candidate_blocked");
    const resumed = await service.resume(trial.trialId, 1);
    expect((resumed as any).candidateId).toBe(second.candidateId);
    runService.finish("awaiting_review");
    const awaiting = service.get(trial.trialId)!;
    expect(awaiting.status).toBe("awaiting_selection");
    const selected = service.select({ trialId: trial.trialId, winnerQianjiId: first.qianjiId, reason: "Best evidence",
      evidenceIds: [], idempotencyKey: "select-trial-once" });
    expect(selected.status).toBe("completed");
    expect(store!.qianji.getProfile(first.qianjiId)?.careerStatus).toBe("active");
    expect(store!.qianji.getProfile(first.qianjiId)?.narrative.displayName).toBe("A formal");
    expect(store!.qianji.getProfile(second.qianjiId)?.careerStatus).toBe("retired");
  });

  it("runs a selected candidate through a Mission and Owner evidence acceptance", async () => {
    const { service, runService, starts } = setup();
    const missions = new MissionService({ store: store!, workspaceRoot: root!, runService: runService as any,
      enabledTools: ["save_artifact"], modelName: "mock-model" });
    const business = new BusinessService(store!, root!);
    const trial = createTrial(service);
    const winner = service.createCandidate(trial.trialId, candidate("0_0_0", "e2e-candidate-a", "A"));
    service.createCandidate(trial.trialId, candidate("1_0_0", "e2e-candidate-b", "B"));
    await service.start(trial.trialId);
    runService.finish("awaiting_review");
    for (let attempt = 0; attempt < 20 && starts.length < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(starts).toHaveLength(2);
    runService.finish("awaiting_review");
    expect(service.get(trial.trialId)?.status).toBe("awaiting_selection");
    service.select({ trialId: trial.trialId, winnerQianjiId: winner.qianjiId, reason: "Best sourced result",
      evidenceIds: [], idempotencyKey: "e2e-select-once" });

    const binding = store!.qianji.getCurrentBindingByQianji(winner.qianjiId)!;
    const product = business.createProduct({ name: "Mock delivery", description: "Isolated integration fixture",
      targetUser: "Test user", problemStatement: "Verify the technical flow", ownerQianjiId: winner.qianjiId });
    const missionDraft = missions.create({ title: "Selected candidate delivery", missionType: "research",
      objective: "Produce a sourced result", acceptanceCriteria: "Owner reviews the saved artifact", budgetTokens: 800,
      roundsLimit: 1, deadlineRound: null, ownerQianjiId: winner.qianjiId,
      participants: [{ qianjiId: winner.qianjiId, bindingId: binding.bindingId, duty: "Research" }] });
    business.linkMission(product.productId, missionDraft.missionId);
    const mission = missions.issue(missionDraft.missionId);
    await missions.start(mission.missionId, 1);
    const executionId = mission.executionId!;
    const activeRunId = runService.getStatus().run_id!;
    const message = store!.messages.listRecentMessages(20).find(item => item.executionId === executionId)!;
    const filename = "delivery.txt";
    const bytes = Buffer.from("synthetic accepted delivery", "utf8");
    const artifact = path.join(root!, "evidence", executionId, "artifacts", binding.pixelId, filename);
    fs.mkdirSync(path.dirname(artifact), { recursive: true }); fs.writeFileSync(artifact, bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    store!.modelCalls.recordModelCall({ callId: "e2e-model-call", runId: activeRunId, executionId, pixelId: binding.pixelId,
      bindingId: binding.bindingId, narrativeRevision: 0, model: "mock-model", promptTokens: 10, completionTokens: 8,
      cachedTokens: null, actualTokens: 18, costCny: 0, outcome: "SUCCESS", createdAt: Date.now() / 1000 });
    store!.toolExecutions.recordStarted({ operation_id: "e2e-save-artifact", run_id: activeRunId, message_id: message.messageId,
      pixel_id: binding.pixelId, op_index: 1, tool: "save_artifact", args_hash: "e2e-hash", model_call_id: "e2e-model-call", started_at: Date.now() / 1000 });
    store!.toolExecutions.recordFinished({ operationId: "e2e-save-artifact", status: "SUCCESS",
      result: JSON.stringify({ filename, sha256: hash, size_bytes: bytes.length }), finishedAt: Date.now() / 1000, costCny: 0 });

    runService.finish("awaiting_review");
    expect(missions.get(mission.missionId)?.status).toBe("awaiting_acceptance");
    const evidence = missions.listEvidence(mission.missionId);
    expect(evidence).toHaveLength(1);
    expect(fs.readFileSync(path.join(root!, ...evidence[0]!.relativePath.split("/")))).toEqual(bytes);
    const accepted = missions.accept({ missionId: mission.missionId, outcome: "completed", note: "Owner verified snapshot",
      evidenceIds: [evidence[0]!.evidenceId], idempotencyKey: "e2e-mission-accept" });
    expect(accepted.status).toBe("completed");
    expect(store!.executions.getOpenExecutionForBinding(binding.bindingId)).toBeNull();

    const delivery = business.createDelivery({ productId: product.productId, missionId: mission.missionId,
      contactAlias: "Synthetic customer", evidenceIds: [evidence[0]!.evidenceId] });
    expect(business.transitionDelivery(delivery.deliveryId, "delivered").status).toBe("delivered");
    expect(business.transitionDelivery(delivery.deliveryId, "accepted", "Synthetic acceptance").status).toBe("accepted");
    business.createFeedback({ productId: product.productId, missionId: mission.missionId, contactAlias: "Synthetic customer",
      source: "test", privateFeedbackText: "Synthetic private feedback", publicSummary: "The result was useful" });
    business.recordRevenue({ externalTxId: "test-only-e2e-receipt", amountFen: 1001, productId: product.productId,
      missionId: mission.missionId, primaryQianjiId: winner.qianjiId, evidenceRef: "test-only:receipt",
      idempotencyKey: "test-only-e2e-revenue" });
    business.recordRefund({ externalTxId: "test-only-e2e-receipt", refundId: "test-only-e2e-refund", amountFen: 300,
      reason: "Synthetic partial refund", evidenceRef: "test-only:refund", idempotencyKey: "test-only-e2e-refund-key" });
    expect(business.getMetrics("product", product.productId)).toMatchObject({
      confirmedRevenueFen: 1001, refundFen: 300, netRevenueFen: 701,
    });
    expect(business.getMetrics("qianji", winner.qianjiId).netRevenueFen).toBe(701);
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const facts = business.exportFacts(from, to);
    expect(facts.businessMetrics).toMatchObject({ confirmedRevenueFen: 1001, refundFen: 300 });
    expect(facts.deliveries[0]?.evidenceIds).toContain(evidence[0]!.evidenceId);
    expect(facts.feedback[0]?.publicSummary).toBe("The result was useful");
    expect(JSON.stringify(facts)).not.toContain("Synthetic private feedback");
  });
});
