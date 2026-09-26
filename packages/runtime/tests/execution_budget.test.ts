import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { PreparedModelRequest, RawModelResponse } from "@emergentinc/protocol";
import { ModelProvider, PromptBuilder, UsageMeter } from "@emergentinc/model";
import { ToolRegistry, ToolRuntime } from "@emergentinc/tools";
import { AgentStepRunner } from "../src/index.js";

class CapturingProvider implements ModelProvider {
  public request: PreparedModelRequest | null = null;
  public async call(request: PreparedModelRequest): Promise<RawModelResponse> {
    this.request = request;
    return { rawText: JSON.stringify({ send_to: "STOP" }), usage: { promptTokens: 2, completionTokens: 1 } };
  }
}

describe("Runtime: scoped budget limits", () => {
  let store: CoreStore | null = null;
  let workspaceRoot: string | null = null;
  let priorMaxTokens: string | undefined;
  afterEach(() => {
    store?.close(); store = null;
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = null;
    if (priorMaxTokens === undefined) delete process.env.MCL_MAX_TOKENS;
    else process.env.MCL_MAX_TOKENS = priorMaxTokens;
    priorMaxTokens = undefined;
  });

  it("caps the final prepared output limit by the scoped capacity and filters the prompt tool catalog", async () => {
    store = new CoreStore(":memory:");
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "execution-budget-"));
    priorMaxTokens = process.env.MCL_MAX_TOKENS;
    process.env.MCL_MAX_TOKENS = "9000";
    const profile = store.qianji.createProfile({ careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 5000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const execution = store.executions.create({ kind: "mission", subjectId: "mission_budget", budgetTokens: 2500,
      roundsLimit: 1, inputSnapshot: { title: "fixture", objective: "fixture objective", acceptanceCriteria: "fixture proof" },
      toolsSnapshot: ["allowed_tool"], bindingIds: [binding.bindingId] });
    store.executions.transition(execution.executionId, "ready", "running");
    store.runs.createRun({ run_id: "run_budget_scope", execution_id: execution.executionId, start_round: 1,
      run_limit: 2500, run_spent: 0, run_reserved: 0, genesis_revision: 1, status: "RUNNING", created_at: Date.now() / 1000 });
    const message = store.messages.enqueueMessage({ runId: "run_budget_scope", roundNum: 1, sender: "human",
      recipient: "0_0_0", content: "synthetic task", sourceType: "human", executionId: execution.executionId });
    const claimed = store.messages.claimNext(1, execution.executionId)!;
    const registry = new ToolRegistry();
    const handler = async (_args: Record<string, any>, ctx: any) => ({ operation_id: ctx.operationId, tool: "fixture", status: "SUCCESS" as const, duration_ms: 0, truncated: false });
    registry.register({ name: "allowed_tool", description: "allowed fixture", input_schema: { type: "object" }, effect: "read", enabled: true }, handler);
    registry.register({ name: "extra_tool", description: "out of scope fixture", input_schema: { type: "object" }, effect: "read", enabled: true }, handler);
    const provider = new CapturingProvider();
    const runner = new AgentStepRunner({ workspaceRoot, store, provider, toolRuntime: new ToolRuntime(registry),
      promptBuilder: new PromptBuilder({ baseSystemPrompt: "fixture constitution", modelName: "fixture-model", maxOutputTokens: 10000 }),
      usageMeter: new UsageMeter({ models: {} }) });

    await runner.execute({ trace: { runId: "run_budget_scope", executionId: execution.executionId, round: 1,
        pixelId: "0_0_0", messageId: message.messageId },
      pixelState: { pixelId: "0_0_0", position: { x: 0, y: 0 }, energy: 5000, active: true, generation: 0,
        createdAtRound: 0, lastActiveRound: 1 },
      pixelMind: "fixture mind", message: claimed, round: 1 });

    expect(provider.request?.maxTokens).toBeLessThan(9000);
    expect(Number(provider.request?.estimatedTokens) + Number(provider.request?.maxTokens)).toBeLessThanOrEqual(2500);
    expect(provider.request?.messages[0].content).toContain("allowed_tool");
    expect(provider.request?.messages[0].content).not.toContain("extra_tool");
    expect(store.modelCalls.getLatestByMessageId(message.messageId)).toMatchObject({ executionId: execution.executionId, actualTokens: 3 });
    expect(store.executions.get(execution.executionId)).toMatchObject({ spentTokens: 3, reservedTokens: 0 });
  });
});
