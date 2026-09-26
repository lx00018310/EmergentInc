import { afterEach, describe, expect, it } from "vitest";
import { CoreStore } from "../src/index.js";
import { QianjiNarrativeSpec } from "@emergentinc/protocol";

const narrative = (displayName: string): QianjiNarrativeSpec => ({
  displayName, traits: {}, behaviorProfile: [], title: null, roleLabel: null,
  flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null,
});

describe("Persistence: organization records", () => {
  let store: CoreStore | null = null;
  afterEach(() => { store?.close(); store = null; });

  it("creates draft Missions with immutable participant bindings and source-keyed state events", () => {
    store = new CoreStore(":memory:");
    const owner = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("Owner") });
    const member = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("Member") });
    const ownerBinding = store.qianji.createBinding({ qianjiId: owner.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const memberBinding = store.qianji.createBinding({ qianjiId: member.qianjiId, pixelId: "1_0_0", incarnation: 1 });
    const mission = store.missions.createDraft({ title: "核对需求", missionType: "research", objective: "核对假设",
      acceptanceCriteria: "给出可追溯证据", budgetTokens: 400, roundsLimit: 2, ownerQianjiId: owner.qianjiId,
      participants: [{ qianjiId: owner.qianjiId, bindingId: ownerBinding.bindingId },
        { qianjiId: member.qianjiId, bindingId: memberBinding.bindingId, duty: "查找证据" }] });
    expect(mission).toMatchObject({ status: "draft", budgetTokens: 400 });
    expect(mission.participants.map(participant => participant.duty)).toEqual(expect.arrayContaining([null, "查找证据"]));
    const issued = store.missions.transition(mission.missionId, "draft", "issued");
    expect(issued.status).toBe("issued");
    expect(store.worldEvents.listRecent().some(event => event.eventType === "MISSION_ISSUED" && event.subjectId === mission.missionId)).toBe(true);
    expect(() => store.missions.updateDraft(mission.missionId, { title: "改写", missionType: "research", objective: "x",
      acceptanceCriteria: "y", budgetTokens: 1, roundsLimit: 1, ownerQianjiId: owner.qianjiId,
      participants: [{ qianjiId: owner.qianjiId, bindingId: ownerBinding.bindingId }] })).toThrow("MISSION_NOT_DRAFT");
    expect(() => store.missions.createDraft({ title: "重复", missionType: "x", objective: "x", acceptanceCriteria: "x",
      budgetTokens: 1, roundsLimit: 1, ownerQianjiId: owner.qianjiId,
      participants: [{ qianjiId: owner.qianjiId, bindingId: ownerBinding.bindingId },
        { qianjiId: owner.qianjiId, bindingId: ownerBinding.bindingId }] })).toThrow();
  });

  it("stores recruitments, trial candidates, execution snapshots, and enforces active binding ownership", () => {
    store = new CoreStore(":memory:");
    const profileA = store.qianji.createProfile({ narrative: narrative("候选A") });
    const profileB = store.qianji.createProfile({ narrative: narrative("候选B") });
    const bindingA = store.qianji.createBinding({ qianjiId: profileA.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const bindingB = store.qianji.createBinding({ qianjiId: profileB.qianjiId, pixelId: "1_0_0", incarnation: 1 });
    const recruitment = store.trials.createRecruitment("研究员", "核验公开资料");
    const trial = store.trials.createDraft({ recruitmentId: recruitment.recruitmentId, challengeText: "列出证据",
      acceptanceCriteria: "每项都附来源", totalBudgetTokens: 200, roundsPerCandidate: 1,
      candidateBudgetTokens: 100, allowedTools: ["save_artifact"], modelName: "fake" });
    const executionA = store.executions.create({ kind: "trial_candidate", subjectId: trial.trialId,
      budgetTokens: 100, roundsLimit: 1, inputSnapshot: { prompt: "fixture" }, toolsSnapshot: ["save_artifact"],
      bindingIds: [bindingA.bindingId] });
    const executionB = store.executions.create({ kind: "trial_candidate", subjectId: trial.trialId,
      budgetTokens: 100, roundsLimit: 1, inputSnapshot: { prompt: "fixture" }, toolsSnapshot: ["save_artifact"],
      bindingIds: [bindingB.bindingId] });
    store.trials.addCandidate({ trialId: trial.trialId, qianjiId: profileA.qianjiId, bindingId: bindingA.bindingId, executionId: executionA.executionId, ordinal: 1 });
    store.trials.addCandidate({ trialId: trial.trialId, qianjiId: profileB.qianjiId, bindingId: bindingB.bindingId, executionId: executionB.executionId, ordinal: 2 });
    expect(store.trials.get(trial.trialId)?.candidates.map(candidate => candidate.ordinal)).toEqual([1, 2]);
    expect(() => store.executions.create({ kind: "mission", subjectId: "another", budgetTokens: 100,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [bindingA.bindingId] })).toThrow();
    store.executions.transition(executionA.executionId, "ready", "running");
    store.executions.reserveTokens(executionA.executionId, 80);
    expect(store.executions.get(executionA.executionId)).toMatchObject({ spentTokens: 0, reservedTokens: 80 });
    store.executions.settleTokens(executionA.executionId, -80, 75);
    expect(store.executions.startNextRound(executionA.executionId)).toBe(1);
    expect(store.executions.get(executionA.executionId)).toMatchObject({ spentTokens: 75, reservedTokens: 0, roundsUsed: 1 });
  });

  it("isolates world and execution queues and leaves occupied members' world messages queued", () => {
    store = new CoreStore(":memory:");
    const addMember = (name: string, pixelId: string) => {
      const profile = store!.qianji.createProfile({ careerStatus: "active", narrative: narrative(name) });
      const binding = store!.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId, incarnation: 1 });
      store!.pixels.upsertPixelAccount({ pixelId, energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
      return { profile, binding };
    };
    const a = addMember("A", "0_0_0");
    const b = addMember("B", "1_0_0");
    const worldOnly = addMember("World", "4_0_0");
    const executionA = store.executions.create({ kind: "mission", subjectId: "mission_a", budgetTokens: 100,
      roundsLimit: 2, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [a.binding.bindingId] });
    const executionB = store.executions.create({ kind: "mission", subjectId: "mission_b", budgetTokens: 100,
      roundsLimit: 2, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [b.binding.bindingId] });
    store.executions.transition(executionA.executionId, "ready", "running");
    store.executions.transition(executionB.executionId, "ready", "running");
    const queuedWorldForA = store.messages.enqueueMessage({ roundNum: 1, sender: "system", recipient: "0_0_0", content: "world A" });
    const queuedA = store.messages.enqueueMessage({ roundNum: 1, sender: "human", recipient: "0_0_0", content: "task A",
      executionId: executionA.executionId, sourceType: "human" });
    const queuedB = store.messages.enqueueMessage({ roundNum: 1, sender: "human", recipient: "1_0_0", content: "task B",
      executionId: executionB.executionId, sourceType: "human" });
    const queuedWorld = store.messages.enqueueMessage({ roundNum: 1, sender: "system", recipient: "4_0_0", content: "world only" });

    expect(store.messages.claimNext(1, executionA.executionId)?.messageId).toBe(queuedA.messageId);
    expect(store.messages.getMessage(queuedB.messageId)?.status).toBe("QUEUED");
    expect(store.messages.getMessage(queuedWorldForA.messageId)?.status).toBe("QUEUED");
    expect(store.messages.claimNext(1)?.messageId).toBe(queuedWorld.messageId);
    expect(store.messages.getMessage(queuedWorldForA.messageId)?.status).toBe("QUEUED");
    expect(store.executions.isWorldPixelEligible("0_0_0")).toBe(false);
    expect(store.executions.isWorldPixelEligible("4_0_0")).toBe(true);
  });

  it("scopes SELF deduplication and abandons queued messages after their recipient binding changes", () => {
    store = new CoreStore(":memory:");
    const profile = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("A") });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const execution = store.executions.create({ kind: "mission", subjectId: "mission_a", budgetTokens: 100,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [binding.bindingId] });
    const worldSelf = store.messages.enqueueMessage({ roundNum: 1, sender: "0_0_0", recipient: "0_0_0", content: "same", sourceType: "pixel" });
    const taskSelf = store.messages.enqueueMessage({ roundNum: 1, sender: "0_0_0", recipient: "0_0_0", content: "same", sourceType: "pixel", executionId: execution.executionId });
    expect(taskSelf.messageId).not.toBe(worldSelf.messageId);

    const stale = store.messages.enqueueMessage({ roundNum: 1, sender: "system", recipient: "0_0_0", content: "stale" });
    store.qianji.unbindAndRetire(binding.bindingId, "archive/0_0_0", "test", binding.boundAt + 1);
    expect(store.messages.claimNext(1)).toBeNull();
    expect(store.messages.getMessage(stale.messageId)?.status).toBe("ABANDONED");
    expect((store.db.prepare("SELECT abandoned_reason FROM messages WHERE message_id=?").get(stale.messageId) as any).abandoned_reason)
      .toBe("RECIPIENT_BINDING_CHANGED");
  });

  it("counts an execution round once per Run even if its scheduler entry point is retried", () => {
    store = new CoreStore(":memory:");
    const profile = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("A") });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const execution = store.executions.create({ kind: "mission", subjectId: "mission_round", budgetTokens: 100,
      roundsLimit: 2, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [binding.bindingId] });
    store.executions.transition(execution.executionId, "ready", "running");
    store.runs.createRun({ run_id: "run_scoped_round", execution_id: execution.executionId, start_round: 8, end_round: 8,
      run_limit: 100, run_spent: 0, run_reserved: 0, genesis_revision: 1, status: "RUNNING", created_at: 1 });
    expect(store.executions.beginScopeRound(execution.executionId, "run_scoped_round", 8)).toBe(1);
    expect(store.executions.beginScopeRound(execution.executionId, "run_scoped_round", 8)).toBe(1);
    expect(store.executions.get(execution.executionId)?.roundsUsed).toBe(1);
    expect(store.runs.getRun("run_scoped_round")?.last_scope_round).toBe(8);
  });
});
