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
      tips_md: "owner hint",
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

    // tips_md 随 UPDATE_MIND 携带
    const mindEffect = effects.find((e) => e.effectType === "UPDATE_MIND") as any;
    expect(mindEffect.tipsContent).toBe("owner hint");
  });
});

describe("Runtime: tips.md write semantics", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tips_runtime_test_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "live", "pixels"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });

    store = new CoreStore(":memory:");
    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 5000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });
  });

  afterEach(() => {
    store.close();
  });

  function tipsFile(): string {
    return path.join(tmpDir, "live", "pixels", "0_0_0", "tips.md");
  }

  function compileAndApply(tipsMd: string | undefined): Promise<void> {
    const effectRuntime = new EffectRuntime({
      workspaceRoot: tmpDir,
      store,
      toolRuntime,
      round: 1,
      runId: "run_tips",
    });
    const decision: AgentDecision = { pixel_md: "mind", ...(tipsMd !== undefined ? { tips_md: tipsMd } : {}) };
    const effects = DecisionCompiler.compile({
      decision: decision as AgentDecision,
      pixelId: "0_0_0",
      messageId: `msg_tips_${Math.random()}`,
      currentHop: 1,
    });
    return effectRuntime.applyEffects(effects).then(() => undefined);
  }

  it("writes tips.md when new content provided, clears on empty, skips write when unchanged", async () => {
    // B. 写入
    await compileAndApply("需要 Owner 检查数据源。");
    expect(fs.readFileSync(tipsFile(), "utf-8")).toBe("需要 Owner 检查数据源。");
    const mtime1 = fs.statSync(tipsFile()).mtimeMs;

    // 相同内容 → 不重写（mtime 不变）
    await new Promise((r) => setTimeout(r, 5));
    await compileAndApply("需要 Owner 检查数据源。");
    expect(fs.statSync(tipsFile()).mtimeMs).toBe(mtime1);

    // D. 再次修改
    await compileAndApply("数据源问题已确认，还需要检查 API。");
    expect(fs.readFileSync(tipsFile(), "utf-8")).toBe("数据源问题已确认，还需要检查 API。");

    // E. 清空
    await compileAndApply("");
    expect(fs.readFileSync(tipsFile(), "utf-8")).toBe("");

    // tips_md 缺失 → 不触碰文件
    await compileAndApply("again");
    await compileAndApply(undefined);
    expect(fs.readFileSync(tipsFile(), "utf-8")).toBe("again");
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

  it("lets an active pixel revive an inactive neighbor with one token", async () => {
    store.pixels.upsertPixelAccount({ pixelId: "1_0_0", energy: 0, active: false, refundDeficitTokens: 0, spendBlockedReason: null });
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 7, runId: "r" });
    const effects = DecisionCompiler.compile({
      decision: { energy_transfer: [{ target: "1_0_0", amount: 1 }] },
      pixelId: "0_0_0", messageId: "msg_revive", currentHop: 1,
    });
    await runtime.applyEffects(effects);
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(4999);
    expect(store.pixels.getPixelAccount("1_0_0")).toMatchObject({ energy: 1, active: true });
  });

  it("stops later effects when an active pixel gives away all its energy", async () => {
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 7, runId: "r" });
    const effects = DecisionCompiler.compile({
      decision: { energy_transfer: [{ target: "1_0_0", amount: 5000 }], send_to: "1_0_0", message_md: "late message" },
      pixelId: "0_0_0", messageId: "msg_exhaust", currentHop: 1,
    });
    await runtime.applyEffects(effects);
    expect(store.pixels.getPixelAccount("0_0_0")).toMatchObject({ energy: 0, active: false });
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(6000);
    expect(store.effects.getEffect(effects[1].effectId)).toBeNull();
  });

  it("restarts a dead neighbor as a new life while preserving old files and ledger history", async () => {
    store.pixels.upsertPixelAccount({ pixelId: "1_0_0", energy: 0, active: false, refundDeficitTokens: 0, spendBlockedReason: null });
    const oldDir = path.join(tmpDir, "live", "pixels", "1_0_0");
    const artifactsDir = path.join(tmpDir, "live", "artifacts", "1_0_0");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "pixel.md"), "old mind");
    fs.writeFileSync(path.join(oldDir, "tips.md"), "old tips");
    fs.writeFileSync(path.join(oldDir, "mandate.md"), "old owner task");
    fs.writeFileSync(path.join(oldDir, "state.json"), JSON.stringify({ generation: 2, incarnation: 1 }));
    fs.writeFileSync(path.join(artifactsDir, "old.txt"), "old artifact");
    fs.mkdirSync(path.join(tmpDir, "live", "pixels", "0_0_0"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "live", "pixels", "0_0_0", "state.json"), JSON.stringify({ generation: 3 }));
    const oldMessage = store.messages.enqueueMessage({ sender: "system", recipient: "1_0_0", content: "old task", roundNum: 1 });
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 7, runId: "r" });
    const effects = DecisionCompiler.compile({
      decision: { reproduce: { direction: "1_0_0", initial_energy: 150 } },
      pixelId: "0_0_0", messageId: "msg_reset", currentHop: 1,
    });
    await runtime.applyEffects(effects);
    const history = path.join(tmpDir, "live", "history", "1_0_0", effects[0].effectId);
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(4850);
    expect(store.pixels.getPixelAccount("1_0_0")).toMatchObject({ energy: 150, active: true });
    expect(store.messages.getMessage(oldMessage.messageId)?.status).toBe("ABANDONED");
    expect(fs.readFileSync(path.join(oldDir, "pixel.md"), "utf-8")).toBe("");
    expect(fs.readFileSync(path.join(oldDir, "tips.md"), "utf-8")).toBe("");
    expect(fs.readFileSync(path.join(oldDir, "mandate.md"), "utf-8")).toBe("");
    expect(fs.existsSync(artifactsDir)).toBe(false);
    expect(fs.readFileSync(path.join(history, "pixel", "pixel.md"), "utf-8")).toBe("old mind");
    expect(fs.readFileSync(path.join(history, "artifacts", "old.txt"), "utf-8")).toBe("old artifact");
    expect(JSON.parse(fs.readFileSync(path.join(oldDir, "state.json"), "utf-8"))).toMatchObject({
      id: "1_0_0", parent: "0_0_0", born_round: 7, generation: 4, incarnation: 2,
    });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM ledger_entries WHERE pixel_id = '1_0_0'").get()).toEqual({ n: 1 });
  });

  it("cannot reset an active neighbor", async () => {
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 7, runId: "r" });
    const effects = DecisionCompiler.compile({
      decision: { reproduce: { direction: "1_0_0", initial_energy: 150 } },
      pixelId: "0_0_0", messageId: "msg_alive", currentHop: 1,
    });
    await runtime.applyEffects(effects);
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(5000);
    expect(store.pixels.getPixelAccount("1_0_0")?.energy).toBe(1000);
    expect(store.effects.getEffect(effects[0].effectId)?.status).toBe("FAILED");
  });

  it("restores an inactive neighbor's files if reset accounting rolls back", async () => {
    store.pixels.upsertPixelAccount({ pixelId: "1_0_0", energy: 0, active: false, refundDeficitTokens: 0, spendBlockedReason: null });
    const oldDir = path.join(tmpDir, "live", "pixels", "1_0_0");
    fs.mkdirSync(oldDir, { recursive: true });
    fs.writeFileSync(path.join(oldDir, "pixel.md"), "old mind");
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 7, runId: "r" });
    const effects = DecisionCompiler.compile({
      decision: { reproduce: { direction: "1_0_0", initial_energy: 150 } },
      pixelId: "0_0_0", messageId: "msg_reset_rollback", currentHop: 1,
    });
    store.ledger.appendEntry({
      entry_id: `${effects[0].effectId}_parent`, timestamp: 1, pixel_id: "0_0_0",
      entry_type: "reproduction_out", amount: 0, balance_after: 5000,
    });
    await expect(runtime.applyEffects(effects)).rejects.toThrow();
    expect(fs.readFileSync(path.join(oldDir, "pixel.md"), "utf-8")).toBe("old mind");
    expect(store.pixels.getPixelAccount("0_0_0")?.energy).toBe(5000);
    expect(store.pixels.getPixelAccount("1_0_0")).toMatchObject({ energy: 0, active: false });
  });
});
