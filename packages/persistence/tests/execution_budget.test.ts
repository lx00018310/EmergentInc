import { afterEach, describe, expect, it } from "vitest";
import { CoreStore, BudgetExceededError } from "../src/index.js";

describe("Persistence: scoped token budgets", () => {
  let store: CoreStore | null = null;
  afterEach(() => { store?.close(); store = null; });

  it("shares Trial budget across candidate executions and mirrors settle/refund accounting", () => {
    store = new CoreStore(":memory:");
    const trial = store.trials.createDraft({ challengeText: "fixture", acceptanceCriteria: "fixture evidence",
      totalBudgetTokens: 100, roundsPerCandidate: 1, candidateBudgetTokens: 60,
      allowedTools: ["save_artifact"], modelName: "mock" });
    const candidate = (name: string, pixelId: string) => {
      const profile = store!.qianji.createProfile({ careerStatus: "trial", narrative: {
        displayName: name, traits: {}, behaviorProfile: [], title: null, roleLabel: null,
        flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null,
      } });
      const binding = store!.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId, incarnation: 1 });
      store!.pixels.upsertPixelAccount({ pixelId, energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
      const execution = store!.executions.create({ kind: "trial_candidate", subjectId: trial.trialId, budgetTokens: 60,
        roundsLimit: 1, inputSnapshot: { challengeText: "fixture", acceptanceCriteria: "fixture evidence" },
        toolsSnapshot: ["save_artifact"], bindingIds: [binding.bindingId] });
      store!.trials.addCandidate({ trialId: trial.trialId, qianjiId: profile.qianjiId, bindingId: binding.bindingId,
        executionId: execution.executionId, ordinal: pixelId === "0_0_0" ? 1 : 2 });
      store!.executions.transition(execution.executionId, "ready", "running");
      const runId = `run_${pixelId}`;
      store!.runs.createRun({ run_id: runId, execution_id: execution.executionId, start_round: 1, run_limit: 100,
        run_spent: 0, run_reserved: 0, genesis_revision: 1, status: "RUNNING", created_at: Date.now() / 1000 });
      const message = store!.messages.enqueueMessage({ roundNum: 1, sender: "human", recipient: pixelId,
        content: "trial", executionId: execution.executionId, sourceType: "human" });
      return { binding, execution, runId, message };
    };
    const a = candidate("A", "0_0_0");
    const b = candidate("B", "1_0_0");
    store.budgets.reserve({ callId: "call_a", runId: a.runId, pixelId: "0_0_0", executionId: a.execution.executionId,
      messageId: a.message.messageId, bindingId: a.binding.bindingId, narrativeRevision: 0, estimatedTokens: 45 });
    expect(store.executions.get(a.execution.executionId)).toMatchObject({ spentTokens: 0, reservedTokens: 45 });
    expect(store.budgets.getAvailableTokenCapacity({ runId: b.runId, pixelId: "1_0_0", executionId: b.execution.executionId }))
      .toMatchObject({ availableTokens: 55, limitingKind: "EXECUTION" });
    expect(() => store.budgets.reserve({ callId: "call_b_too_large", runId: b.runId, pixelId: "1_0_0",
      executionId: b.execution.executionId, messageId: b.message.messageId, bindingId: b.binding.bindingId,
      narrativeRevision: 0, estimatedTokens: 56 })).toThrow(BudgetExceededError);

    store.budgets.settle({ callId: "call_a", actualTokens: 50, costCny: null });
    expect(store.executions.get(a.execution.executionId)).toMatchObject({ spentTokens: 50, reservedTokens: 0 });
    expect(store.budgets.getAvailableTokenCapacity({ runId: b.runId, pixelId: "1_0_0", executionId: b.execution.executionId }).availableTokens)
      .toBe(50);
    store.budgets.reserve({ callId: "call_b", runId: b.runId, pixelId: "1_0_0", executionId: b.execution.executionId,
      messageId: b.message.messageId, bindingId: b.binding.bindingId, narrativeRevision: 0, estimatedTokens: 50 });
    store.budgets.refund("call_b");
    expect(store.executions.get(b.execution.executionId)).toMatchObject({ spentTokens: 0, reservedTokens: 0 });
    store.messages.updateStatus(b.message.messageId, "WAITING_EXECUTION_BUDGET");
    store.messages.resetWaitingRunBudgetMessages(b.execution.executionId);
    expect(store.messages.getMessage(b.message.messageId)?.status).toBe("WAITING_EXECUTION_BUDGET");
  });

  it("updates execution spend when an operator resolves an unknown model outcome", () => {
    store = new CoreStore(":memory:");
    const profile = store.qianji.createProfile({ careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const execution = store.executions.create({ kind: "mission", subjectId: "mission_recovery", budgetTokens: 100,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [binding.bindingId] });
    store.executions.transition(execution.executionId, "ready", "running");
    store.runs.createRun({ run_id: "run_recovery", execution_id: execution.executionId, start_round: 1, run_limit: 100,
      run_spent: 0, run_reserved: 0, genesis_revision: 1, status: "RUNNING", created_at: Date.now() / 1000 });
    const message = store.messages.enqueueMessage({ roundNum: 1, sender: "human", recipient: "0_0_0", content: "task",
      executionId: execution.executionId, sourceType: "human" });
    store.budgets.reserve({ callId: "call_unknown", runId: "run_recovery", pixelId: "0_0_0", executionId: execution.executionId,
      messageId: message.messageId, bindingId: binding.bindingId, narrativeRevision: 0, estimatedTokens: 30 });
    store.messages.updateStatus(message.messageId, "CALL_OUTCOME_UNKNOWN");
    store.modelCalls.recordModelCall({ callId: "call_unknown", runId: "run_recovery", executionId: execution.executionId,
      pixelId: "0_0_0", messageId: message.messageId, bindingId: binding.bindingId, narrativeRevision: 0,
      model: "mock", promptTokens: null, completionTokens: null, cachedTokens: null, actualTokens: null, costCny: null,
      outcome: "CALL_OUTCOME_UNKNOWN", createdAt: Date.now() / 1000 });

    store.resolveRecoveryOperation({ kind: "model", id: "call_unknown", decision: "settle_billed", actualTokens: 25,
      reason: "synthetic recovery test", costCny: null });
    expect(store.executions.get(execution.executionId)).toMatchObject({ spentTokens: 25, reservedTokens: 0 });
    expect(store.modelCalls.getModelCall("call_unknown")?.outcome).toBe("CALL_OUTCOME_RECONCILED");
  });
});
