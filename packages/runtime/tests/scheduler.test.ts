import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AgentStepRunner,
  RoundScheduler,
} from "../src/index.js";
import { CoreStore } from "@emergentinc/persistence";
import { PromptBuilder, UsageMeter, ModelProvider } from "@emergentinc/model";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { PreparedModelRequest, RawModelResponse } from "@emergentinc/protocol";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// 模拟 ModelProvider
class MockModelProvider implements ModelProvider {
  constructor(private responseText: string) {}

  public async call(request: PreparedModelRequest): Promise<RawModelResponse> {
    return {
      rawText: this.responseText,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
      },
    };
  }
}

describe("Runtime: AgentStepRunner & RoundScheduler End-to-End", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;
  let promptBuilder: PromptBuilder;
  let usageMeter: UsageMeter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "scheduler_test_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "live", "pixels"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });

    store = new CoreStore(":memory:");
    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    promptBuilder = new PromptBuilder();
    usageMeter = new UsageMeter({
      models: {
        "gpt-4o-mini": {
          input_cost_per_million: 1.5,
          output_cost_per_million: 6.0,
        },
      },
    });

    // 初始化测试元胞
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 10000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    store.pixels.upsertPixelAccount({
      pixelId: "1_0_0",
      energy: 2000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    // 初始化 Run
    store.runs.createRun({
      run_id: "run_sched_1",
      start_round: 1,
      run_limit: 100000,
      run_spent: 0,
      run_reserved: 0,
      global_limit: 1000000,
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

  it("should execute an AgentStep and commit all durable effects into SQLite", async () => {
    const mockDecisionText = JSON.stringify({
      pixel_md: "I am thinking clearly now.",
      operations: [
        {
          tool: "save_artifact",
          args: { filename: "thought.txt", content: "Great discovery" },
        },
      ],
      energy_transfer: [{ target: "1_0_0", amount: 300 }],
      send_to: "1_0_0",
      message_md: "Greetings neighbor",
    });

    const provider = new MockModelProvider(mockDecisionText);
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msg = store.messages.enqueueMessage({
      runId: "run_sched_1",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Hello pixel",
    });

    const claimed = store.messages.claimNext(1);
    expect(claimed?.messageId).toBe(msg.messageId);

    const result = await runner.execute({
      trace: { runId: "run_sched_1", round: 1, pixelId: "0_0_0", messageId: claimed!.messageId },
      pixelState: {
        pixelId: "0_0_0",
        position: { x: 0, y: 0 },
        energy: 10000,
        active: true,
        generation: 0,
        createdAtRound: 0,
        lastActiveRound: 1,
      },
      pixelMind: "Initial state",
      message: claimed!,
      round: 1,
    });

    // 1. 验证决策返回
    expect(result.decision.pixel_md).toBe("I am thinking clearly now.");

    // 2. 验证消息已被标记为 COMMITTED
    const finalMsg = store.messages.getMessage(claimed!.messageId);
    expect(finalMsg?.status).toBe("COMMITTED");

    // 3. 验证产物已写入
    const artifactFile = path.resolve(tmpDir, "live", "artifacts", "0_0_0", "thought.txt");
    expect(fs.existsSync(artifactFile)).toBe(true);
    expect(fs.readFileSync(artifactFile, "utf-8")).toBe("Great discovery");

    // 4. 验证能量转账已落库
    // 0_0_0: 10000 - 150(actualTokens) - 300(transfer) = 9550
    const acc0 = store.pixels.getPixelAccount("0_0_0");
    const acc1 = store.pixels.getPixelAccount("1_0_0");
    expect(acc0?.energy).toBe(9550);
    expect(acc1?.energy).toBe(2300);
  });

  it("should schedule a full round and respect stop signals", async () => {
    const mockDecisionText = JSON.stringify({
      message_md: "round active",
      send_to: "STOP",
    });

    const provider = new MockModelProvider(mockDecisionText);
    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const scheduler = new RoundScheduler({
      workspaceRoot: tmpDir,
      store,
      stepRunner: runner,
    });

    // 入队 2 条消息
    store.messages.enqueueMessage({
      runId: "run_sched_1",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Task 1",
    });
    store.messages.enqueueMessage({
      runId: "run_sched_1",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "Task 2",
    });

    // 运行一轮
    const summary = await scheduler.executeRound(1, "run_sched_1");
    expect(summary.round).toBe(1);
    expect(summary.messagesProcessed).toBe(2);

    // 验证无未决消息
    const remaining = store.messages.claimNext(1);
    expect(remaining).toBeNull();
  });
});
