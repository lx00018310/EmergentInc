import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CoreStore, BudgetExceededError } from "@emergentinc/persistence";
import { ToolRegistry, registerAllBuiltinTools, ToolRuntime } from "@emergentinc/tools";
import {
  PromptBuilder,
  UsageMeter,
  ModelProvider,
  parseAndNormalizeResponse,
} from "@emergentinc/model";
import {
  AgentStepRunner,
  RoundScheduler,
  DecisionCompiler,
  EffectRuntime,
} from "@emergentinc/runtime";
import { PreparedModelRequest, RawModelResponse, AgentDecision } from "@emergentinc/protocol";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

class ScenarioMockProvider implements ModelProvider {
  constructor(private handler: (req: PreparedModelRequest) => string) {}

  async call(req: PreparedModelRequest): Promise<RawModelResponse> {
    return {
      rawText: this.handler(req),
      usage: { promptTokens: 100, completionTokens: 50 },
    };
  }
}

describe("Phase 10: Golden Parity Scenarios (A - J)", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;
  let promptBuilder: PromptBuilder;
  let usageMeter: UsageMeter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "parity_scenarios_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "live", "pixels"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });

    store = new CoreStore(":memory:");
    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    promptBuilder = new PromptBuilder();
    usageMeter = new UsageMeter({ models: {} });

    // 初始化元胞 0_0_0 与 1_0_0
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 100000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });
    store.pixels.upsertPixelAccount({
      pixelId: "1_0_0",
      energy: 5000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    store.runs.createRun({
      run_id: "run_parity",
      start_round: 1,
      run_limit: 1000000,
      run_spent: 0,
      run_reserved: 0,
      global_limit: 10000000,
      global_spent: 0,
      global_reserved: 0,
      genesis_revision: 1,
      status: "RUNNING",
      created_at: Date.now() / 1000,
    });
  });

  afterEach(() => {
    store.close();
  });

  // Scenario A: 普通 Message -> Model -> STOP
  it("Scenario A: Normal Message -> Model -> STOP", async () => {
    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({ pixel_md: "idle mind", send_to: "STOP" })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Wake up",
    });

    const claimed = store.messages.claimNext(1);
    const res = await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "old mind",
      message: claimed!,
      round: 1,
    });

    expect(res.decision.send_to).toBe("STOP");
    expect(store.messages.getMessage(claimed!.messageId)?.status).toBe("COMMITTED");
    expect(store.messages.claimNext(1)).toBeNull(); // STOP 后不再生成下一跳消息
  });

  // Scenario B: Pixel A -> message -> Pixel B
  it("Scenario B: Pixel A routes message to Pixel B", async () => {
    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({ message_md: "hello neighbor", send_to: "1_0_0" })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Ping",
    });

    const claimed = store.messages.claimNext(1);
    await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "",
      message: claimed!,
      round: 1,
    });

    // 验证给 1_0_0 的消息成功入队
    const nextMsg = store.messages.claimNext(1);
    expect(nextMsg).not.toBeNull();
    expect(nextMsg?.recipient).toBe("1_0_0");
    expect(nextMsg?.sender).toBe("0_0_0");
    expect(nextMsg?.content).toBe("hello neighbor");
  });

  // Scenario C: Energy Transfer
  it("Scenario C: Energy Transfer conserving balance", async () => {
    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({
        energy_transfer: [{ target: "1_0_0", amount: 1500 }],
        send_to: "STOP",
      })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Do transfer",
    });

    const claimed = store.messages.claimNext(1);
    await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "",
      message: claimed!,
      round: 1,
    });

    const acc0 = store.pixels.getPixelAccount("0_0_0");
    const acc1 = store.pixels.getPixelAccount("1_0_0");
    expect(acc0?.energy).toBe(100000 - 150 - 1500); // 扣除 token 和转账
    expect(acc1?.energy).toBe(5000 + 1500);
  });

  // Scenario D: Reproduction
  it("Scenario D: Reproduction to empty direct neighbor", async () => {
    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({
        reproduce: { direction: "UP", initial_energy: 800 },
        send_to: "STOP",
      })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Reproduce now",
    });

    const claimed = store.messages.claimNext(1);
    await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "",
      message: claimed!,
      round: 1,
    });

    // 验证新元胞 0_1_0 诞生
    const child = store.pixels.getPixelAccount("0_1_0");
    expect(child).not.toBeNull();
    expect(child?.energy).toBe(800);
    expect(child?.active).toBe(true);
  });

  // Scenario E: save_artifact
  it("Scenario E: save_artifact creates verified physical file", async () => {
    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({
        operations: [
          { tool: "save_artifact", args: { filename: "golden.txt", content: "GOLDEN_DATA" } },
        ],
        send_to: "STOP",
      })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Save artifact",
    });

    const claimed = store.messages.claimNext(1);
    await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "",
      message: claimed!,
      round: 1,
    });

    const artifactFile = path.resolve(tmpDir, "live", "artifacts", "0_0_0", "golden.txt");
    expect(fs.existsSync(artifactFile)).toBe(true);
    expect(fs.readFileSync(artifactFile, "utf-8")).toBe("GOLDEN_DATA");
  });

  // Scenario F: environment_read
  it("Scenario F: environment_read triggers ENVIRONMENT feedback message", async () => {
    fs.writeFileSync(path.resolve(tmpDir, "live", "environment.md"), "Global Environment Data", "utf-8");

    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({ environment_read: true, send_to: "STOP" })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Read env",
    });

    const claimed = store.messages.claimNext(1);
    await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "",
      message: claimed!,
      round: 1,
    });

    const envMsg = store.messages.claimNext(1);
    expect(envMsg).not.toBeNull();
    expect(envMsg?.sender).toBe("environment");
    expect(envMsg?.content).toBe("Global Environment Data");
  });

  // Scenario G: Budget Exhausted
  it("Scenario G: Budget Exhausted throws and suspends message", async () => {
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 10, // 能量仅剩 10，低于预估 tokens
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    const provider = new ScenarioMockProvider(() => JSON.stringify({ send_to: "STOP" }));
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Run task",
    });

    const claimed = store.messages.claimNext(1);
    await expect(
      runner.execute({
        trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
        pixelState: {
          pixelId: "0_0_0",
          position: { x: 0, y: 0 },
          energy: 10,
          active: true,
          generation: 0,
          createdAtRound: 0,
          lastActiveRound: 1,
        },
        pixelMind: "",
        message: claimed!,
        round: 1,
      })
    ).rejects.toThrow(BudgetExceededError);

    // 消息状态转为 WAITING_PIXEL_BUDGET
    const suspended = store.messages.getMessage(claimed!.messageId);
    expect(suspended?.status).toBe("WAITING_PIXEL_BUDGET");
  });

  // Scenario H: Invalid Model Response
  it("Scenario H: Invalid Model Response fallback and normalizes safely", () => {
    const raw = "Here is some gibberish: ```json { \"unknown_key\": 123 } ```";
    const decision = parseAndNormalizeResponse(raw, "fallback_mind");
    expect(decision.pixel_md).toBe("fallback_mind");
    expect(decision.send_to).toBe("STOP");
  });

  // Scenario I: Tool Failure Short-circuiting
  it("Scenario I: First tool failure skips subsequent tool but allows transfer", async () => {
    const provider = new ScenarioMockProvider(() =>
      JSON.stringify({
        operations: [
          { tool: "invalid_tool_name" },
          { tool: "save_artifact", args: { filename: "should_skip.txt", content: "x" } },
        ],
        energy_transfer: [{ target: "1_0_0", amount: 100 }],
        send_to: "STOP",
      })
    );
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_parity",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Run ops",
    });

    const claimed = store.messages.claimNext(1);
    await runner.execute({
      trace: { runId: "run_parity", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 100000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "",
      message: claimed!,
      round: 1,
    });

    // 验证跳过的文件未写入
    const skippedFile = path.resolve(tmpDir, "live", "artifacts", "0_0_0", "should_skip.txt");
    expect(fs.existsSync(skippedFile)).toBe(false);

    // 验证转账依然生效
    const acc1 = store.pixels.getPixelAccount("1_0_0");
    expect(acc1?.energy).toBe(5100);
  });

  // Scenario J: Crash Recovery & Replay (Idempotent replay)
  it("Scenario J: Replay does not duplicate effects", async () => {
    const decision: AgentDecision = {
      energy_transfer: [{ target: "1_0_0", amount: 600 }],
    };

    const effects = DecisionCompiler.compile({
      decision,
      pixelId: "0_0_0",
      messageId: "msg_replay_crash",
      currentHop: 1,
    });

    const effectRuntime = new EffectRuntime({
      workspaceRoot: tmpDir,
      store,
      toolRuntime,
      round: 1,
      runId: "run_parity",
    });

    // 第一次应用
    await effectRuntime.applyEffects(effects);
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(5600);

    // 模拟故障恢复，再次回放
    await effectRuntime.applyEffects(effects);
    // 不应重复给 1_0_0 转账！
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(5600);
  });
});
