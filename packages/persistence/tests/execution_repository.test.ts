import { afterEach, describe, expect, it } from "vitest";
import { CoreStore } from "../src/index.js";
import { QianjiNarrativeSpec } from "@emergentinc/protocol";

const narrative = (displayName: string): QianjiNarrativeSpec => ({
  displayName, traits: {}, behaviorProfile: [], title: null, roleLabel: null,
  flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null,
});

describe("Persistence: execution records", () => {
  let store: CoreStore | null = null;
  afterEach(() => { store?.close(); store = null; });

  it("enforces one open execution per binding and tracks execution budget, reservations, and rounds", () => {
    store = new CoreStore(":memory:");
    const profileA = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("成员A") });
    const profileB = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("成员B") });
    const bindingA = store.qianji.createBinding({ qianjiId: profileA.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const bindingB = store.qianji.createBinding({ qianjiId: profileB.qianjiId, pixelId: "1_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    store.pixels.upsertPixelAccount({ pixelId: "1_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const executionA = store.executions.create({ kind: "mission", subjectId: "subject_fixture",
      budgetTokens: 100, roundsLimit: 1, inputSnapshot: { prompt: "fixture" }, toolsSnapshot: ["save_artifact"],
      bindingIds: [bindingA.bindingId] });
    expect(store.executions.getOpenExecutionForBinding(bindingA.bindingId)?.executionId).toBe(executionA.executionId);
    expect(() => store.executions.create({ kind: "mission", subjectId: "another", budgetTokens: 100,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [bindingA.bindingId] })).toThrow();
    store.executions.transition(executionA.executionId, "ready", "running");
    store.executions.reserveTokens(executionA.executionId, 80);
    expect(store.executions.get(executionA.executionId)).toMatchObject({ spentTokens: 0, reservedTokens: 80 });
    store.executions.settleTokens(executionA.executionId, -80, 75);
    expect(store.executions.startNextRound(executionA.executionId)).toBe(1);
    expect(store.executions.get(executionA.executionId)).toMatchObject({ spentTokens: 75, reservedTokens: 0, roundsUsed: 1 });
    expect(store.executions.listEligibleMembers(executionA.executionId).map(member => member.bindingId)).toEqual([bindingA.bindingId]);
    expect(bindingB.bindingId).not.toBe(bindingA.bindingId);
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
    const executionA = store.executions.create({ kind: "mission", subjectId: "subject_a", budgetTokens: 100,
      roundsLimit: 2, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [a.binding.bindingId] });
    const executionB = store.executions.create({ kind: "mission", subjectId: "subject_b", budgetTokens: 100,
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
    expect(store.executions.isWorldPixelEligible(worldOnly.binding.pixelId)).toBe(true);
  });

  it("scopes SELF deduplication and abandons queued messages after their recipient binding changes", () => {
    store = new CoreStore(":memory:");
    const profile = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("A") });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const execution = store.executions.create({ kind: "mission", subjectId: "subject_self", budgetTokens: 100,
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
    const execution = store.executions.create({ kind: "mission", subjectId: "subject_round", budgetTokens: 100,
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