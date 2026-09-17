import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  DecisionCompiler,
  EffectRuntime,
} from "../src/index.js";
import { CoreStore } from "@emergentinc/persistence";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { AgentDecision } from "@emergentinc/protocol";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Runtime: Decision Compiler", () => {
  it("should compile AgentDecision in strictly fixed sequential order", () => {
    const decision: AgentDecision = {
      pixel_md: "new mind",
      owner_request: { type: "need_vps" },
      environment_read: true,
      operations: [
        { tool: "read_artifact", args: { filename: "a.txt" } },
        { tool: "save_artifact", args: { filename: "b.txt", content: "ok" } },
      ],
      energy_transfer: [{ target: "1_0_0", amount: 100 }],
      reproduce: { direction: "UP", initial_energy: 300 },
      send_to: "1_0_0",
      message_md: "hello child",
    };

    const effects = DecisionCompiler.compile({
      decision,
      pixelId: "0_0_0",
      messageId: "msg_comp_1",
      currentHop: 1,
    });

    const types = effects.map((e) => e.effectType);
    expect(types).toEqual([
      "UPDATE_MIND",
      "CAPABILITY_UNAVAILABLE",
      "READ_ENVIRONMENT",
      "TOOL_CALL",
      "TOOL_CALL",
      "TRANSFER_ENERGY",
      "REPRODUCE",
      "ROUTE_MESSAGE",
    ]);

    // 检查索引连续递增
    effects.forEach((eff, idx) => {
      expect(eff.effectIndex).toBe(idx);
    });
  });
});

describe("Runtime: EffectRuntime Execution & Short-circuiting", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "effect_runtime_test_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "live", "pixels"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });

    store = new CoreStore(":memory:");
    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    // 初始化元胞 0_0_0 (父) 与 1_0_0 (邻居)
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 5000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    store.pixels.upsertPixelAccount({
      pixelId: "1_0_0",
      energy: 1000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });
  });

  afterEach(() => {
    store.close();
  });

  it("should short-circuit subsequent tools on tool failure, but still execute energy transfer and routing", async () => {
    const effectRuntime = new EffectRuntime({
      workspaceRoot: tmpDir,
      store,
      toolRuntime,
      round: 1,
      runId: "run_test",
    });

    // 编译一个包含：工具1(失败) -> 工具2 -> 能量转账 -> 路由 的决策
    const decision: AgentDecision = {
      operations: [
        // 不存在的工具，将执行失败
        { tool: "non_existent_tool", args: {} },
        // 后续工具应当被 SKIPPED
        { tool: "save_artifact", args: { filename: "skip.txt", content: "skip" } },
      ],
      energy_transfer: [{ target: "1_0_0", amount: 200 }],
      send_to: "1_0_0",
      message_md: "transfer done",
    };

    const effects = DecisionCompiler.compile({
      decision,
      pixelId: "0_0_0",
      messageId: "msg_short_circuit",
      currentHop: 1,
    });

    await effectRuntime.applyEffects(effects);

    // 1. 验证第一个工具记录为 FAILED
    const op1 = effects[0];
    const rec1 = store.effects.getEffect(op1.effectId);
    expect(rec1?.status).toBe("FAILED");

    // 2. 验证第二个工具被标记为 SKIPPED
    const op2 = effects[1];
    const rec2 = store.effects.getEffect(op2.effectId);
    expect(rec2?.status).toBe("SKIPPED");
    expect(rec2?.details).toContain("PRIOR_TOOL_FAILED");

    // 3. 验证转账依然成功执行 (5000 - 200 = 4800, 1000 + 200 = 1200)
    const acc0 = store.pixels.getPixelAccount("0_0_0");
    const acc1 = store.pixels.getPixelAccount("1_0_0");
    expect(acc0?.energy).toBe(4800);
    expect(acc1?.energy).toBe(1200);

    // 4. 验证转账的 effect 状态为 APPLIED
    const effTransfer = effects[2];
    expect(store.effects.hasEffectBeenApplied(effTransfer.effectId)).toBe(true);

    // 5. 验证消息成功入队
    const routedMsg = store.messages.claimNext(1);
    // 队列中可能先有工具执行反馈，继续取直到取到转账消息或路由消息
    expect(routedMsg).not.toBeNull();
  });

  it("should guarantee Exactly-Once and not duplicate energy transfers on re-run", async () => {
    const effectRuntime = new EffectRuntime({
      workspaceRoot: tmpDir,
      store,
      toolRuntime,
      round: 1,
      runId: "run_test",
    });

    const decision: AgentDecision = {
      energy_transfer: [{ target: "1_0_0", amount: 500 }],
    };

    const effects = DecisionCompiler.compile({
      decision,
      pixelId: "0_0_0",
      messageId: "msg_idempotent",
      currentHop: 1,
    });

    // 第一次执行
    await effectRuntime.applyEffects(effects);
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(4500);
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(1500);

    // 重复执行同一批 effects
    await effectRuntime.applyEffects(effects);
    // 能量不应再次扣减！
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(4500);
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(1500);
  });
});
