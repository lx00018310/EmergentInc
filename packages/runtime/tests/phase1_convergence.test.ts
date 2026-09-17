import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentStepRunner } from "../src/index.js";
import { CoreStore } from "@emergentinc/persistence";
import { PromptBuilder, UsageMeter, ModelProvider, OutcomeUnknownError, InfrastructureFailureError } from "@emergentinc/model";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { PreparedModelRequest, RawModelResponse } from "@emergentinc/protocol";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Phase 1 Convergence: Reliability, Safety & Recovery Guard", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;
  let promptBuilder: PromptBuilder;
  let usageMeter: UsageMeter;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "phase1_test_"));
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

  it("should NOT refund on OutcomeUnknownError and mark message as CALL_OUTCOME_UNKNOWN", async () => {
    // 模拟抛出 OutcomeUnknownError（远端超时、连接中断）
    const timeoutProvider: ModelProvider = {
      async call() {
        throw new OutcomeUnknownError("HTTP_REQUEST_TIMEOUT: Response body stream truncated");
      },
    };

    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider: timeoutProvider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msgId = "msg_timeout_1";
    store.messages.enqueueMessage({
      messageId: msgId,
      recipient: "0_0_0",
      sender: "SYS",
      content: "Hello timeout test",
      roundNum: 1,
      hop: 0,
    });

    // 执行 Step，应抛出 OutcomeUnknownError
    await expect(
      runner.execute({
        trace: { runId: "run_p1", hop: 0 },
        pixelState: {
          pixelId: "0_0_0",
          position: [0, 0, 0],
          energy: 10000,
          active: true,
          generation: 0,
        },
        pixelMind: "# Mind",
        message: {
          messageId: msgId,
          content: "Hello timeout test",
          hop: 0,
        },
        round: 1,
      })
    ).rejects.toThrow("HTTP_REQUEST_TIMEOUT");

    // 验证：绝对不退款！预留保持 OPEN，消息状态变为 CALL_OUTCOME_UNKNOWN
    const msg = store.messages.getMessage(msgId);
    expect(msg?.status).toBe("CALL_OUTCOME_UNKNOWN");

    const unfinalized = store.getUnfinalizedOperations();
    expect(unfinalized.hasUnfinalized).toBe(true);
    expect(unfinalized.unsettledReservations.length).toBe(1);
    expect(unfinalized.unknownCalls.length).toBe(1);
    expect(unfinalized.unknownCalls[0].outcome).toBe("CALL_OUTCOME_UNKNOWN");
  });

  it("should refund and requeue message on InfrastructureFailureError", async () => {
    // 模拟连接前失败（如 DNS 失败）
    const dnsFailProvider: ModelProvider = {
      async call() {
        throw new InfrastructureFailureError("DNS_RESOLUTION_FAILED");
      },
    };

    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider: dnsFailProvider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msgId = "msg_infra_1";
    store.messages.enqueueMessage({
      messageId: msgId,
      recipient: "0_0_0",
      sender: "SYS",
      content: "Hello infra test",
      roundNum: 1,
      hop: 0,
    });

    await expect(
      runner.execute({
        trace: { runId: "run_p1", hop: 0 },
        pixelState: {
          pixelId: "0_0_0",
          position: [0, 0, 0],
          energy: 10000,
          active: true,
          generation: 0,
        },
        pixelMind: "# Mind",
        message: {
          messageId: msgId,
          content: "Hello infra test",
          hop: 0,
        },
        round: 1,
      })
    ).rejects.toThrow("DNS_RESOLUTION_FAILED");

    // 验证：基础设施连接前失败，退还预留，放回 QUEUED 队列
    const msg = store.messages.getMessage(msgId);
    expect(msg?.status).toBe("QUEUED");

    const unfinalized = store.getUnfinalizedOperations();
    expect(unfinalized.unsettledReservations.length).toBe(0);
    expect(unfinalized.unknownCalls.length).toBe(0);
  });

  it("should reuse existing stored model response and not call provider again", async () => {
    let callCount = 0;
    const trackingProvider: ModelProvider = {
      async call() {
        callCount++;
        return {
          rawText: JSON.stringify({ message_md: "reused response", send_to: "STOP" }),
          usage: { promptTokens: 50, completionTokens: 20 },
        };
      },
    };

    const runner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider: trackingProvider,
      toolRuntime,
      promptBuilder,
      usageMeter,
    });

    const msgId = "msg_reuse_1";
    store.messages.enqueueMessage({
      messageId: msgId,
      recipient: "0_0_0",
      sender: "SYS",
      content: "Hello reuse test",
      roundNum: 1,
      hop: 0,
    });

    // 预先向 model_calls 写入一条已经成功的记录（模拟上次执行时已完成模型调用）
    store.modelCalls.recordModelCall({
      callId: "call_existing_1",
      runId: "run_prev",
      pixelId: "0_0_0",
      messageId: msgId,
      model: "gpt-4o-mini",
      promptHash: "hash123",
      rawResponse: JSON.stringify({ message_md: "previously saved response", send_to: "STOP" }),
      promptTokens: 50,
      completionTokens: 20,
      cachedTokens: 0,
      actualTokens: 70,
      costCny: 0.0001,
      outcome: "SUCCESS",
      createdAt: Date.now() / 1000,
    });

    const result = await runner.execute({
      trace: { runId: "run_p1", hop: 0 },
      pixelState: {
        pixelId: "0_0_0",
        position: [0, 0, 0],
        energy: 10000,
        active: true,
        generation: 0,
      },
      pixelMind: "# Mind",
      message: {
        messageId: msgId,
        content: "Hello reuse test",
        hop: 0,
      },
      round: 1,
    });

    // 验证：provider.call 根本未被调用！直接复用了已有记录
    expect(callCount).toBe(0);
    expect(result.decision.message_md).toBe("previously saved response");
    const committedMsg = store.messages.getMessage(msgId);
    expect(committedMsg?.status).toBe("COMMITTED");
  });
});
