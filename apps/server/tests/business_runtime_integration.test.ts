import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreStore } from "@emergentinc/persistence";
import { ModelProvider, PreparedModelRequest, PromptBuilder, UsageMeter } from "@emergentinc/model";
import { AgentStepRunner, RoundScheduler } from "@emergentinc/runtime";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { BusinessService } from "../src/services/business_service.js";
import { MissionService } from "../src/services/mission_service.js";
import { RunService } from "../src/services/run_service.js";

class ArtifactProvider implements ModelProvider {
  requests = 0;

  async call(_request: PreparedModelRequest) {
    this.requests++;
    return {
      rawText: JSON.stringify(this.requests === 1 ? {
        pixel_md: "Synthetic research completed.",
        operations: [{ tool: "save_artifact", args: { filename: "delivery.txt", content: "Synthetic accepted delivery" } }],
        send_to: "STOP",
        message_md: "Saved the delivery artifact.",
      } : { pixel_md: "Synthetic follow-up completed.", send_to: "STOP", message_md: "Confirmed the tool receipt." }),
      usage: { promptTokens: 12, completionTokens: 9 },
    };
  }
}

describe("Business flow through the mock model runtime", () => {
  let root: string | null = null;
  let store: CoreStore | null = null;
  let runService: RunService | null = null;

  afterEach(() => {
    if (runService?.getStatus().running) runService.requestStop();
    store?.close();
    store = null;
    runService = null;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  it("runs Product → Mission → evidence → delivery → feedback → partial refund → facts export", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "business-runtime-integration-"));
    const pixelId = "0_0_0";
    const pixelDir = path.join(root, "live", "pixels", pixelId);
    fs.mkdirSync(pixelDir, { recursive: true });
    fs.mkdirSync(path.join(root, "live", "artifacts", pixelId), { recursive: true });
    fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
    fs.writeFileSync(path.join(root, "live", "world_state.json"), JSON.stringify({ round: 4 }));
    fs.writeFileSync(path.join(root, "live", "environment.md"), "Isolated integration workspace");
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({
      id: pixelId, position: [0, 0, 0], active: true, energy: 100000, generation: 0, last_active_round: 4,
    }));
    fs.writeFileSync(path.join(pixelDir, "pixel.md"), "Researcher");
    fs.writeFileSync(path.join(pixelDir, "tips.md"), "");
    fs.writeFileSync(path.join(pixelDir, "mandate.md"), "");

    store = new CoreStore(":memory:");
    const profile = store.qianji.createProfile({
      careerStatus: "active",
      narrative: { displayName: "Researcher", title: null, roleLabel: null, traits: {}, behaviorProfile: [],
        flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: 0 },
    });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId, incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId, energy: 100000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });

    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    const provider = new ArtifactProvider();
    const runner = new AgentStepRunner({ workspaceRoot: root, store, provider, toolRuntime: new ToolRuntime(registry),
      promptBuilder: new PromptBuilder(), usageMeter: new UsageMeter({ models: {} }) });
    const scheduler = new RoundScheduler({ workspaceRoot: root, store, stepRunner: runner });
    runService = new RunService({ workspaceRoot: root, store, scheduler, isMockMode: true, isModelConfigured: true });
    const missionService = new MissionService({ store, workspaceRoot: root, runService,
      enabledTools: registry.listDefinitions().filter(tool => tool.enabled).map(tool => tool.name), modelName: "mock-provider" });
    const business = new BusinessService(store, root);

    const product = business.createProduct({ name: "Synthetic product", description: "Test only", targetUser: "Test user",
      problemStatement: "Verify the complete technical flow", ownerQianjiId: profile.qianjiId });
    const mission = missionService.create({ title: "Synthetic delivery", missionType: "research", objective: "Create one artifact",
      acceptanceCriteria: "Owner validates the artifact", budgetTokens: 100000, roundsLimit: 1, deadlineRound: null,
      ownerQianjiId: profile.qianjiId, participants: [{ qianjiId: profile.qianjiId, bindingId: binding.bindingId, duty: "Research" }] });
    business.linkMission(product.productId, mission.missionId);
    missionService.issue(mission.missionId);

    await missionService.start(mission.missionId, 1);
    for (let attempt = 0; runService.getStatus().running && attempt < 100; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(runService.getStatus().running).toBe(false);
    expect(provider.requests).toBe(2);
    expect(missionService.get(mission.missionId)?.status).toBe("awaiting_acceptance");
    const evidence = missionService.listEvidence(mission.missionId);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);

    missionService.accept({ missionId: mission.missionId, outcome: "completed", note: "Synthetic evidence accepted",
      evidenceIds: [evidence[0]!.evidenceId], idempotencyKey: "business-runtime-accept" });
    const delivery = business.createDelivery({ productId: product.productId, missionId: mission.missionId,
      contactAlias: "Synthetic customer", evidenceIds: [evidence[0]!.evidenceId] });
    business.transitionDelivery(delivery.deliveryId, "delivered");
    business.transitionDelivery(delivery.deliveryId, "accepted", "Synthetic acceptance");
    business.createFeedback({ productId: product.productId, missionId: mission.missionId, contactAlias: "Synthetic customer",
      source: "test", privateFeedbackText: "Synthetic private feedback", publicSummary: "The delivery was useful" });
    business.recordRevenue({ externalTxId: "test-only-runtime-receipt", amountFen: 1001, productId: product.productId,
      missionId: mission.missionId, primaryQianjiId: profile.qianjiId, evidenceRef: "test-only:receipt",
      idempotencyKey: "test-only-runtime-revenue" });
    business.recordRefund({ externalTxId: "test-only-runtime-receipt", refundId: "test-only-runtime-refund", amountFen: 300,
      reason: "Synthetic partial refund", evidenceRef: "test-only:refund", idempotencyKey: "test-only-runtime-refund-key" });

    expect(business.getMetrics("product", product.productId)).toMatchObject({ confirmedRevenueFen: 1001, refundFen: 300, netRevenueFen: 701 });
    expect(business.getMetrics("qianji", profile.qianjiId).netRevenueFen).toBe(701);
    const facts = business.exportFacts(new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 60_000).toISOString());
    expect(facts.businessMetrics).toMatchObject({ confirmedRevenueFen: 1001, refundFen: 300 });
    expect(facts.deliveries[0]?.evidenceIds).toContain(evidence[0]!.evidenceId);
    expect(facts.feedback[0]?.publicSummary).toBe("The delivery was useful");
    expect(JSON.stringify(facts)).not.toContain("Synthetic private feedback");
  });
});
