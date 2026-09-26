import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { MissionService } from "../src/services/mission_service.js";
import { RunService } from "../src/services/run_service.js";

describe("MissionService", () => {
  let store: CoreStore | null = null;
  let root: string | null = null;

  afterEach(() => {
    store?.close();
    store = null;
    if (root) fs.rmSync(root, { recursive: true, force: true });
    root = null;
  });

  function setup() {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mission-service-"));
    fs.mkdirSync(path.join(root, "live", "pixels", "0_0_0"), { recursive: true });
    fs.writeFileSync(path.join(root, "live", "world_state.json"), JSON.stringify({ round: 3 }));
    store = new CoreStore(":memory:");
    const qianji = store.qianji.createProfile({ qianjiId: "qj_owner", careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: qianji.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 10000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    fs.writeFileSync(path.join(root, "live", "pixels", "0_0_0", "mandate.md"), "original manual mandate\n", "utf8");
    const scheduler = {
      async executeRound(round: number) { return { round, messagesProcessed: 0, activePixelsCount: 1, stopReason: "NO_ACTIVE_MESSAGES" }; },
    };
    const runService = new RunService({ workspaceRoot: root, store, scheduler: scheduler as any, isMockMode: true, isModelConfigured: true });
    const service = new MissionService({ store, workspaceRoot: root, runService, enabledTools: ["save_artifact"], modelName: "mock-model" });
    return { service, qianji, binding, runService };
  }

  function draft(bindingId: string) {
    return {
      title: "Prepare a sample", missionType: "research", objective: "Write a short research note",
      acceptanceCriteria: "The note is readable", budgetTokens: 1000, roundsLimit: 3,
      deadlineRound: null, ownerQianjiId: "qj_owner",
      participants: [{ qianjiId: "qj_owner", bindingId, duty: "Research" }],
    };
  }

  it("freezes issued inputs and serves the mission mandate while preserving the manual file", () => {
    const { service, binding } = setup();
    const mission = service.create(draft(binding.bindingId));
    const issued = service.issue(mission.missionId);
    expect(issued.status).toBe("issued");
    const execution = store!.executions.get(issued.executionId!)!;
    expect(execution.inputSnapshot).toMatchObject({ title: "Prepare a sample", objective: "Write a short research note", modelName: "mock-model" });
    expect(service.getEffectiveMandate("qj_owner")).toMatchObject({ source: "mission", relatedId: mission.missionId });
    expect(fs.readFileSync(path.join(root!, "live", "pixels", "0_0_0", "mandate.md"), "utf8")).toBe("original manual mandate\n");
  });

  it("starts in the execution scope and requires owner acceptance after the Run ends", async () => {
    const { service, binding, runService } = setup();
    const mission = service.issue(service.create(draft(binding.bindingId)).missionId);
    const started = await service.start(mission.missionId, 1) as { run_id: string };
    for (let i = 0; i < 100 && runService.getStatus().running; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(runService.getStatus().running).toBe(false);
    expect(store!.runs.getRun(started.run_id)?.execution_id).toBe(mission.executionId);
    expect(store!.messages.listRecentMessages(10).filter(message => message.executionId === mission.executionId)).toHaveLength(1);
    expect(service.get(mission.missionId)?.status).toBe("awaiting_acceptance");
    const accepted = service.accept({ missionId: mission.missionId, outcome: "completed", note: "Owner reviewed the result", evidenceIds: [], idempotencyKey: "accept-one" });
    expect(accepted.status).toBe("completed");
    expect(store!.executions.get(mission.executionId!)?.status).toBe("closed");
    expect(store!.executions.getOpenExecutionForBinding(binding.bindingId)).toBeNull();
    expect(service.getEffectiveMandate("qj_owner")).toMatchObject({ source: "manual", content: "original manual mandate\n" });
  });

  it("rejects disconnected participants before creating an execution", () => {
    const { service, binding } = setup();
    const other = store!.qianji.createProfile({ qianjiId: "qj_other", careerStatus: "active" });
    const otherBinding = store!.qianji.createBinding({ qianjiId: other.qianjiId, pixelId: "9_9_9", incarnation: 1 });
    store!.pixels.upsertPixelAccount({ pixelId: "9_9_9", energy: 10000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const mission = service.create({ ...draft(binding.bindingId), participants: [
      { qianjiId: "qj_owner", bindingId: binding.bindingId }, { qianjiId: "qj_other", bindingId: otherBinding.bindingId },
    ] });
    expect(() => service.issue(mission.missionId)).toThrow("MISSION_PARTICIPANTS_NOT_CONNECTED");
    expect(store!.executions.listBySubject("mission", mission.missionId)).toHaveLength(0);
    expect(service.get(mission.missionId)?.status).toBe("draft");
  });

  it("rejects non-existent evidence without closing or releasing the mission", async () => {
    const { service, binding, runService } = setup();
    const mission = service.issue(service.create(draft(binding.bindingId)).missionId);
    await service.start(mission.missionId, 1);
    for (let i = 0; i < 100 && runService.getStatus().running; i++) await new Promise(resolve => setTimeout(resolve, 5));
    expect(() => service.accept({ missionId: mission.missionId, outcome: "completed", note: "Checked", evidenceIds: ["missing"], idempotencyKey: "accept-invalid" }))
      .toThrow("MISSION_EVIDENCE_NOT_FOUND:missing");
    expect(service.get(mission.missionId)?.status).toBe("awaiting_acceptance");
    expect(store!.executions.getOpenExecutionForBinding(binding.bindingId)).not.toBeNull();
  });
});
