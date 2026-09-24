import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { PromptBuilder, UsageMeter, OutcomeUnknownError } from "@emergentinc/model";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { AgentStepRunner, RoundScheduler } from "../src/index.js";

let root: string;
let store: CoreStore;
let call: ReturnType<typeof vi.fn>;
let runner: AgentStepRunner;
const paid = (rawText = '{}') => ({ rawText, usage: { promptTokens: 10, completionTokens: 10, actualTokens: 20 } });
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mainflow_runtime_"));
  fs.mkdirSync(path.join(root, "live", "pixels", "0_0_0"), { recursive: true });
  fs.writeFileSync(path.join(root, "live", "environment.md"), "ON_DEMAND_ENV_SENTINEL");
  store = new CoreStore(":memory:");
  store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 100000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
  call = vi.fn().mockResolvedValue(paid());
  const registry = new ToolRegistry(); registerAllBuiltinTools(registry);
  runner = new AgentStepRunner({ workspaceRoot: root, store, provider: { call }, toolRuntime: new ToolRuntime(registry), promptBuilder: new PromptBuilder(), usageMeter: new UsageMeter({ models: { "gpt-4o-mini": { input_cost_per_million: 1, output_cost_per_million: 2 } } }) });
});
afterEach(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
function input(sourceType: any = "pixel", content = "PEER_SENTINEL") {
  const messageId = `message_${sourceType}`;
  store.messages.enqueueMessage({ messageId, sender: sourceType === "pixel" ? "0_1_0" : sourceType, recipient: "0_0_0", sourceType, content, roundNum: 1 });
  return { trace: { runId: "run_fixture", round: 1, pixelId: "0_0_0", messageId }, pixelState: { pixelId: "0_0_0", position: { x: 0, y: 0 }, energy: 100000, active: true, generation: 0, createdAtRound: 0, lastActiveRound: 0, refundDeficitTokens: 0, spendBlockedReason: null }, pixelMind: "# Mind", message: store.messages.getMessage(messageId)!, round: 1 };
}

describe("Mainflow rectification: real runner requests and lifecycle", () => {
  it.each(["human", "material", "environment", "feedback", "system"])("routes %s only to EXTERNAL without auto-reading environment", async (sourceType) => {
    await runner.execute(input(sourceType, "SOURCE_SENTINEL"));
    const prompt = call.mock.calls[0][0].messages[1].content;
    expect(prompt.split("=== PIXEL SELF ===")[0]).toContain("SOURCE_SENTINEL");
    expect(prompt.split("=== LOCAL MESSAGES ===")[1]).not.toContain("SOURCE_SENTINEL");
    expect(prompt).not.toContain("ON_DEMAND_ENV_SENTINEL");
  });
  it("keeps neighbor messages local", async () => {
    await runner.execute(input());
    const prompt = call.mock.calls[0][0].messages[1].content;
    expect(prompt.split("=== PIXEL SELF ===")[0]).not.toContain("PEER_SENTINEL");
    expect(prompt.split("=== LOCAL MESSAGES ===")[1]).toContain("PEER_SENTINEL");
  });
  it("does not execute a paid response's effects after model tokens deactivate the pixel", async () => {
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 2000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    store.pixels.upsertPixelAccount({ pixelId: "1_0_0", energy: 100, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    fs.writeFileSync(path.join(root, "live", "pixels", "0_0_0", "state.json"), JSON.stringify({ active: true, energy: 2000 }));
    call.mockResolvedValue({
      rawText: '{"pixel_md":"should not be written","energy_transfer":[{"to":"1_0_0","amount":10}]}',
      usage: { promptTokens: 1000, completionTokens: 1000, actualTokens: 2000 },
    });
    const step = await runner.execute(input());
    expect(step.effects).toHaveLength(0);
    expect(store.pixels.getPixelAccount("0_0_0")).toMatchObject({ energy: 0, active: false });
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(100);
    expect(store.messages.getMessage("message_pixel")?.status).toBe("COMMITTED");
    expect(fs.existsSync(path.join(root, "live", "pixels", "0_0_0", "pixel.md"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(root, "live", "pixels", "0_0_0", "state.json"), "utf-8"))).toMatchObject({ active: false, energy: 0 });
  });
  it("exposes environment only in the next-hop environment response", async () => {
    call.mockResolvedValueOnce(paid('{"environment_read":true}')).mockResolvedValue(paid());
    const step = input();
    await runner.execute(step);
    const next = store.messages.claimNext(2)!;
    expect(next.sourceType).toBe("environment");
    expect(call.mock.calls[0][0].messages[1].content).not.toContain("ON_DEMAND_ENV_SENTINEL");
    await runner.execute({ ...step, trace: { ...step.trace, round: 2, messageId: next.messageId }, message: next, round: 2 });
    expect(call.mock.calls[1][0].messages[1].content.split("=== PIXEL SELF ===")[0]).toContain("ON_DEMAND_ENV_SENTINEL");
  });
  it("caps paid invalid responses at two across runner calls", async () => {
    call.mockResolvedValue(paid("not json"));
    const step = input();
    await expect(runner.execute(step)).rejects.toThrow();
    expect(store.messages.getMessage(step.message.messageId)?.status).toBe("QUEUED");
    await expect(runner.execute(step)).rejects.toThrow();
    expect(store.messages.getMessage(step.message.messageId)?.status).toBe("MODEL_RESPONSE_INVALID");
    await expect(runner.execute(step)).rejects.toThrow("retry limit");
    expect(call).toHaveBeenCalledTimes(2);
    expect(store.modelCalls.countInvalidResponses(step.message.messageId)).toBe(2);
    expect(store.modelCalls.getLatestByMessageId(step.message.messageId)?.rawResponse).toBe("not json");
  });
  it("blocks effects and repeat calls until missing usage is settled", async () => {
    call.mockResolvedValue({ rawText: '{"pixel_md":"SHOULD_NOT_BE_WRITTEN"}' });
    const step = input();
    await expect(runner.execute(step)).rejects.toMatchObject({ code: "PAUSED_RECOVERY_REQUIRED" });
    expect(store.messages.getMessage(step.message.messageId)?.status).toBe("AWAITING_SETTLEMENT");
    expect(fs.existsSync(path.join(root, "live", "pixels", "0_0_0", "pixel.md"))).toBe(false);
    await expect(runner.execute(step)).rejects.toThrow("operator");
    expect(call).toHaveBeenCalledTimes(1);
    expect(store.getUnfinalizedOperations().unsettledReservations).toHaveLength(1);
  });
  it("never refunds unclassified provider errors", async () => {
    call.mockRejectedValue(new Error("unexpected adapter error"));
    const step = input();
    await expect(runner.execute(step)).rejects.toBeInstanceOf(OutcomeUnknownError);
    expect(store.messages.getMessage(step.message.messageId)?.status).toBe("CALL_OUTCOME_UNKNOWN");
    expect(store.getUnfinalizedOperations().unsettledReservations).toHaveLength(1);
  });
  it("scheduler preserves transport diagnostics and unknown stop reason", async () => {
    input();
    call.mockRejectedValue(new OutcomeUnknownError("Socket closed; billing unknown", undefined, "UND_ERR_SOCKET", "dispatch"));
    const scheduler = new RoundScheduler({ workspaceRoot: root, store, stepRunner: runner });
    expect(await scheduler.executeRound(1, "run_fixture")).toMatchObject({ stopReason: "CALL_OUTCOME_UNKNOWN", errorCode: "UND_ERR_SOCKET", errorSummary: "Socket closed; billing unknown", errorPhase: "dispatch" });
  });

  it("run budget exhaustion is a clean guard stop without misleading infrastructure diagnostics", async () => {
    input();
    // Seed a run row with a small budget, pre-spent so the next reserve must exceed it.
    store.runs.createRun({
      run_id: "run_fixture", start_round: 1, run_limit: 1000, run_spent: 990, run_reserved: 0,
      global_limit: 1000000, global_spent: 0, global_reserved: 0, genesis_revision: 1,
      status: "RUNNING", created_at: Date.now() / 1000,
    });
    const scheduler = new RoundScheduler({ workspaceRoot: root, store, stepRunner: runner });
    const summary = await scheduler.executeRound(1, "run_fixture");
    expect(summary.stopReason).toBe("RUN_BUDGET_EXHAUSTED");
    // Budget guard is a normal stop: it must NOT carry INFRASTRUCTURE_FAILURE diagnostics
    // (which previously mislabeled runs as FAILED in the UI).
    expect(summary.errorCode).toBeNull();
    expect(summary.errorSummary).toBeNull();
    expect(summary.errorPhase).toBeNull();
    // The message waits on run budget, not destroyed or retried into spend.
    expect(store.messages.getMessage("message_pixel")?.status).toBe("WAITING_RUN_BUDGET");
  });
});
