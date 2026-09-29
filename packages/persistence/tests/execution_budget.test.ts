import { afterEach, describe, expect, it } from "vitest";
import { CoreStore } from "../src/index.js";

describe("Persistence: scoped token budgets", () => {
  let store: CoreStore | null = null;
  afterEach(() => { store?.close(); store = null; });

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
