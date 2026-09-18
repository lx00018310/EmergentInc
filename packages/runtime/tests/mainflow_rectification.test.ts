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
});
