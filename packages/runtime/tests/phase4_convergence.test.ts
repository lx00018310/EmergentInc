import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentStepRunner, RoundScheduler } from "../src/index.js";
import { EffectRuntime } from "../src/effects/effect_runtime.js";
import { CoreStore } from "@emergentinc/persistence";
import { PromptBuilder, UsageMeter, ModelProvider } from "@emergentinc/model";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { ToolCallEffect } from "@emergentinc/protocol";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Phase 4 Convergence: Feedback Batching, Queue Fairness & Read-Loop Bounded Halt", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;
  let promptBuilder: PromptBuilder;
  let usageMeter: UsageMeter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase4_test_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts", "0_0_0"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "live", "pixels", "0_0_0"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });

    store = new CoreStore(":memory:");
    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    promptBuilder = new PromptBuilder();
    usageMeter = new UsageMeter({ models: {} });

    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 10000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("should aggregate multiple tool call receipts in a single step into ONE batch feedback message", async () => {
    const effectRuntime = new EffectRuntime({
      workspaceRoot: tmpDir,
      store,
      toolRuntime,
      round: 1,
      runId: "run_batch_test",
    });

    const effects: ToolCallEffect[] = [
      {
        effectId: "eff_1",
        messageId: "msg_1",
        pixelId: "0_0_0",
        effectIndex: 0,
        effectType: "TOOL_CALL",
        payloadHash: "hash1",
        operationId: "op_1",
        toolCall: {
          tool: "save_artifact",
          args: { filename: "test1.txt", content: "hello world" },
        },
      },
      {
        effectId: "eff_2",
        messageId: "msg_1",
        pixelId: "0_0_0",
        effectIndex: 1,
        effectType: "TOOL_CALL",
        payloadHash: "hash2",
        operationId: "op_2",
        toolCall: {
          tool: "read_artifact",
          args: { filename: "test1.txt" },
        },
      },
    ];

    await effectRuntime.applyEffects(effects);

    // 验证：队列中只生成了 1 条反馈消息（包含了两个工具的执行回执），而不是分散的 2 条消息
    const recentMessages = store.messages.listRecentMessages(10);
    const feedbackMsgs = recentMessages.filter((m) => m.isFeedback);
    expect(feedbackMsgs).toHaveLength(1);
    expect(feedbackMsgs[0].content).toContain("BATCH_TOOL_EXECUTIONS (Total: 2)");
    expect(feedbackMsgs[0].content).toContain("1. save_artifact -> SUCCESS");
    expect(feedbackMsgs[0].content).toContain("2. read_artifact -> SUCCESS");
  });

  it("should deduplicate unconsumed environment and SELF messages for the same pixel", async () => {
    // 1. 重复入队未消费的 environment 消息
    const envMsg1 = store.messages.enqueueMessage({
      runId: "run_test",
      roundNum: 1,
      sender: "environment",
      recipient: "0_0_0",
      content: "Sunny weather",
      sourceType: "environment",
      isFeedback: true,
    });

    const envMsg2 = store.messages.enqueueMessage({
      runId: "run_test",
      roundNum: 1,
      sender: "environment",
      recipient: "0_0_0",
      content: "Sunny weather",
      sourceType: "environment",
      isFeedback: true,
    });

    // 验证：直接复用，不重复生成新的消息 ID
    expect(envMsg1.messageId).toBe(envMsg2.messageId);

    // 2. 重复入队未消费的相同 SELF 消息
    const selfMsg1 = store.messages.enqueueMessage({
      runId: "run_test",
      roundNum: 1,
      sender: "0_0_0",
      recipient: "0_0_0",
      content: "Self loop thinking",
      sourceType: "pixel",
    });

    const selfMsg2 = store.messages.enqueueMessage({
      runId: "run_test",
      roundNum: 1,
      sender: "0_0_0",
      recipient: "0_0_0",
      content: "Self loop thinking",
      sourceType: "pixel",
    });

    expect(selfMsg1.messageId).toBe(selfMsg2.messageId);
  });

  it("should dispatch messages in strict FIFO order and not starve normal messages", async () => {
    // 注入普通邻居消息 (先到达)
    const normalMsg = store.messages.enqueueMessage({
      runId: "run_test",
      roundNum: 1,
      sender: "1_0_0",
      recipient: "0_0_0",
      content: "Important business proposal from neighbor",
      sourceType: "pixel",
      isFeedback: false,
    });

    // 稍微延迟 10ms 注入反馈消息 (后到达)
    await new Promise((r) => setTimeout(r, 15));
    const feedbackMsg = store.messages.enqueueMessage({
      runId: "run_test",
      roundNum: 1,
      sender: "system",
      recipient: "0_0_0",
      content: "[ENGINE_FEEDBACK] routine feedback",
      sourceType: "feedback",
      isFeedback: true,
    });

    // 验证 claimNext 严格按 FIFO 顺序，普通消息先被调度，消除饥饿
    const firstClaimed = store.messages.claimNext(1);
    expect(firstClaimed?.messageId).toBe(normalMsg.messageId);

    const secondClaimed = store.messages.claimNext(1);
    expect(secondClaimed?.messageId).toBe(feedbackMsg.messageId);
  });

  it("should trigger bounded halt READ_LOOP_THRESHOLD_REACHED after consecutive identical read-only cycles", async () => {
    // 模拟纯只读响应：每次都只执行 list_artifacts，不写 artifact，不划转能量，不发邻居消息
    const readOnlyProvider: ModelProvider = {
      async call() {
        return {
          rawText: JSON.stringify({
            message_md: "checking artifacts again",
            send_to: ["SELF"],
            environment_read: false,
            energy_transfer: [],
            reproduce: null,
            operations: [{ tool: "list_artifacts", args: {} }],
          }),
          usage: { promptTokens: 20, completionTokens: 10 },
        };
      },
    };

    const stepRunner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider: readOnlyProvider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const scheduler = new RoundScheduler({
      workspaceRoot: tmpDir,
      store,
      stepRunner,
    });

    // 为 0_0_0 初始化自反馈驱动循环
    store.messages.enqueueMessage({
      runId: "run_loop_test",
      roundNum: 1,
      sender: "0_0_0",
      recipient: "0_0_0",
      content: "start inspecting",
      sourceType: "pixel",
    });

    // 执行调度：应当在连续 3 次相同纯只读之后触发 READ_LOOP_THRESHOLD_REACHED 停机
    const summary = await scheduler.executeRound(1, "run_loop_test");
    expect(summary.stopReason).toBe("READ_LOOP_THRESHOLD_REACHED");
    expect(summary.messagesProcessed).toBe(3);

    // 验证：注入了引导停机消息
    const messages = store.messages.listRecentMessages(5);
    const haltMsg = messages.find((m) => m.content.includes("READ_LOOP_THRESHOLD_REACHED"));
    expect(haltMsg).toBeDefined();
  });
});
