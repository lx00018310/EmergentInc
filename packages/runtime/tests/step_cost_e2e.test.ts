import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AgentStepRunner } from "../src/index.js";
import { CoreStore } from "@emergentinc/persistence";
import { PromptBuilder, UsageMeter } from "@emergentinc/model";
import { ToolRegistry, ToolRuntime } from "@emergentinc/tools";

it("records provider usage and tool-reported cost through a complete AgentStep", async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "step_cost_e2e_"));
  const store = new CoreStore(":memory:");
  try {
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 10000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    store.runs.createRun({ run_id: "run_cost", start_round: 1, end_round: 1, run_limit: 10000, run_spent: 0, run_reserved: 0, global_limit: 10000, global_spent: 0, global_reserved: 0, genesis_revision: 1, status: "RUNNING", created_at: 1 });
    const registry = new ToolRegistry();
    let toolCalls = 0;
    registry.register({ name: "priced_tool", description: "Metered test tool", input_schema: { type: "object" }, effect: "read", enabled: true, timeout_seconds: 1 }, async (_args, ctx) => {
      toolCalls++;
      return { operation_id: ctx.operationId, tool: "priced_tool", status: "SUCCESS", output: "done", duration_ms: 0, truncated: false, costCny: 0.125 };
    });
    let modelCalls = 0;
    const runner = new AgentStepRunner({ workspaceRoot, store, toolRuntime: new ToolRuntime(registry), promptBuilder: new PromptBuilder({ modelName: "metered-test" }), usageMeter: new UsageMeter({ models: { "metered-test": { input_cost_per_million: 2, output_cost_per_million: 4, cached_cost_per_million: 1, currency: "CNY" } } }), provider: {
      async call() {
        modelCalls++;
        return { rawText: JSON.stringify({ pixel_md: "metered mind", operations: [{ tool: "priced_tool", args: {} }] }), usage: { promptTokens: 100, cachedTokens: 20, completionTokens: 30 } };
      },
    } });
    const message = store.messages.enqueueMessage({ messageId: "msg_cost", runId: "run_cost", roundNum: 1, sender: "human", recipient: "0_0_0", content: "Use the metered tool", sourceType: "system", hop: 0 });
    const input = { trace: { runId: "run_cost", pixelId: "0_0_0", messageId: message.messageId, round: 1 }, pixelState: { pixelId: "0_0_0", position: { x: 0, y: 0 }, energy: 10000, active: true, generation: 0, createdAtRound: 0, lastActiveRound: 0, refundDeficitTokens: 0, spendBlockedReason: null }, pixelMind: "original mind", message, round: 1 };
    await runner.execute(input);
    expect(modelCalls).toBe(1);
    expect(toolCalls).toBe(1);
    expect(store.messages.getMessage(message.messageId)?.status).toBe("COMMITTED");
    expect(fs.readFileSync(path.join(workspaceRoot, "live", "pixels", "0_0_0", "pixel.md"), "utf8")).toBe("metered mind");
    expect(store.modelCalls.getPixelStepCosts("0_0_0")).toEqual([expect.objectContaining({ round: 1, inputTokens: 100, cachedInputTokens: 20, outputTokens: 30, actualTokens: 130, modelCost: 0.0003, toolCost: 0.125 })]);
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(9870);
    await runner.execute(input);
    expect(modelCalls).toBe(1);
    expect(toolCalls).toBe(1);
    expect(store.modelCalls.getPixelStepCosts("0_0_0")).toHaveLength(1);
  } finally {
    store.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
