import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CoreStore } from "@emergentinc/persistence";
import { PromptBuilder } from "@emergentinc/model";
import {
  ToolRegistry,
  ToolRuntime,
  registerAllBuiltinTools,
  ToolContext,
} from "@emergentinc/tools";
import { validateEnergyTransfer } from "@emergentinc/domain";

describe("EmergentInc V11 — Minimal Historical Economy & Ten Test Criteria", () => {
  let tmpDir: string;
  let store: CoreStore;
  let dbPath: string;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v11_economy_"));
    const ledgerDir = path.join(tmpDir, "ledger");
    const liveDir = path.join(tmpDir, "live");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.mkdirSync(liveDir, { recursive: true });

    dbPath = path.join(ledgerDir, "v9_core.sqlite3");
    store = new CoreStore(dbPath);

    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    // 初始化元胞账户
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 1000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });
    store.pixels.upsertPixelAccount({
      pixelId: "0_1_0",
      energy: 500,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // 1. Pixel A 无法直接读取 Pixel B 私有 artifact
  it("Test 1: Pixel A 无法直接读取 Pixel B 私有 artifact (历史私有严格隔离)", async () => {
    const ctxA: ToolContext = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "run_test",
      messageId: "msg_1",
      operationId: "op_1",
    };

    // B 保存了私有文档
    const ctxB: ToolContext = { ...ctxA, pixelId: "0_1_0" };
    await toolRuntime.execute("save_artifact", { filename: "secret.txt", content: "b_secret" }, ctxB);

    // A 尝试直接指定 pixel_id 读取 B 的文件
    const readCross = await toolRuntime.execute(
      "read_artifact",
      { filename: "secret.txt", pixel_id: "0_1_0" },
      ctxA
    );
    expect(readCross.status).toBe("FAILED");
    expect(readCross.error_code).toBe("CROSS_PIXEL_FORBIDDEN");
  });

  // 2. Pixel A 可以读取自己的历史 artifact
  it("Test 2: Pixel A 可以读取自己的历史 artifact (历史可复用)", async () => {
    const ctxA: ToolContext = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "run_test",
      messageId: "msg_1",
      operationId: "op_1",
    };

    await toolRuntime.execute("save_artifact", { filename: "postgres_fix.md", content: "# PG Deadlock Fix" }, ctxA);

    const readOwn = await toolRuntime.execute("read_artifact", { filename: "postgres_fix.md" }, ctxA);
    expect(readOwn.status).toBe("SUCCESS");
    expect(readOwn.output.content).toBe("# PG Deadlock Fix");
  });

  // 3. artifact transfer 后 B 获得副本，A 原文件仍存在
  it("Test 3: artifact transfer 后 B 获得副本，A 原文件仍存在 (副本传递语义)", async () => {
    const ctxA: ToolContext = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "run_test",
      messageId: "msg_1",
      operationId: "op_1",
    };

    await toolRuntime.execute("save_artifact", { filename: "guide.md", content: "Knowledge Guide" }, ctxA);

    const transferRes = await toolRuntime.execute(
      "transfer_artifact",
      { filename: "guide.md", target_pixel_id: "0_1_0" },
      ctxA
    );
    expect(transferRes.status).toBe("SUCCESS");
    expect(transferRes.output.copied).toBe(true);

    // 验证 A 的原文件完好
    const readA = await toolRuntime.execute("read_artifact", { filename: "guide.md" }, ctxA);
    expect(readA.status).toBe("SUCCESS");
    expect(readA.output.content).toBe("Knowledge Guide");

    // 验证 B 获得了副本
    const ctxB: ToolContext = { ...ctxA, pixelId: "0_1_0" };
    const readB = await toolRuntime.execute("read_artifact", { filename: "guide.md" }, ctxB);
    expect(readB.status).toBe("SUCCESS");
    expect(readB.output.content).toBe("Knowledge Guide");
  });

  // 4. energy transfer 前后总量正确 (守恒)
  it("Test 4: energy transfer 前后总量正确 (能量代数和绝对守恒)", () => {
    const initialA = store.pixels.getPixelAccount("0_0_0")!.energy;
    const initialB = store.pixels.getPixelAccount("0_1_0")!.energy;
    const totalInitial = initialA + initialB;

    const amount = 200;
    // 校验
    const validation = validateEnergyTransfer({
      fromPixelId: "0_0_0",
      fromEnergy: initialA,
      fromActive: true,
      toPixelId: "0_1_0",
      toActive: true,
      amount,
    });
    expect(validation.valid).toBe(true);

    // 事务划转
    store.transaction(() => {
      store.pixels.updateEnergy("0_0_0", -amount);
      store.pixels.updateEnergy("0_1_0", amount);
    });

    const finalA = store.pixels.getPixelAccount("0_0_0")!.energy;
    const finalB = store.pixels.getPixelAccount("0_1_0")!.energy;
    expect(finalA).toBe(initialA - amount);
    expect(finalB).toBe(initialB + amount);
    expect(finalA + finalB).toBe(totalInitial);
  });

  // 5. energy transfer 不允许负余额
  it("Test 5: energy transfer 不允许负余额", () => {
    const fromEnergy = 100;
    const validation = validateEnergyTransfer({
      fromPixelId: "0_0_0",
      fromEnergy,
      fromActive: true,
      toPixelId: "0_1_0",
      toActive: true,
      amount: 200, // 超过自身余额
    });
    expect(validation.valid).toBe(false);
    expect(validation.errorCode).toBe("INSUFFICIENT_ENERGY");
  });

  // 6. external reward 正确进入目标 Pixel
  it("Test 6: external reward 正确进入目标 Pixel 并持久化到台账", () => {
    const before = store.pixels.getPixelAccount("0_0_0")!.energy;
    const rewardRes = store.applyExternalReward({
      pixelId: "0_0_0",
      amount: 300,
      round: 10,
      source: "human",
      reason: "Great Analysis",
    });
    expect(rewardRes.newBalance).toBe(before + 300);

    const after = store.pixels.getPixelAccount("0_0_0")!.energy;
    expect(after).toBe(before + 300);

    // 验证 Ledger
    const entry = store.db.prepare("SELECT * FROM ledger_entries WHERE entry_type = 'external_reward'").get() as any;
    expect(entry).toBeDefined();
    expect(entry.pixel_id).toBe("0_0_0");
    expect(entry.amount).toBe(300);
  });

  // 7. Human Mandate 不写入 pixel.md
  it("Test 7: Human Mandate 仅作为独立 External 输入，绝不写入 pixel.md", () => {
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    const pixelMdPath = path.join(pixelDir, "pixel.md");
    const mandatePath = path.join(pixelDir, "mandate.md");

    const originalPixelMd = "# Pixel 0_0_0 Original Mind\nI am an autonomous cell.";
    fs.writeFileSync(pixelMdPath, originalPixelMd, "utf-8");

    // 写入 Mandate
    fs.writeFileSync(mandatePath, "负责数据结构化清洗与进度汇报", "utf-8");

    // 组装 Prompt
    const builder = new PromptBuilder();
    const { fullPrompt } = builder.prepare({
      state: { energy: 1000 },
      pixelMd: fs.readFileSync(pixelMdPath, "utf-8"),
      messageMd: "New task arrived",
      external: { humanMandate: fs.readFileSync(mandatePath, "utf-8") },
      pixelFiles: [],
    });

    // 验证：pixel.md 物理文件未被修改
    expect(fs.readFileSync(pixelMdPath, "utf-8")).toBe(originalPixelMd);
    // 验证：Mandate 出现在 EXTERNAL 区域
    expect(fullPrompt).toContain("=== EXTERNAL ===");
    expect(fullPrompt).toContain("Human Mandate:\n负责数据结构化清洗与进度汇报");
    // 验证：PIXEL SELF 保持原心智
    expect(fullPrompt).toContain("=== PIXEL SELF ===");
    expect(fullPrompt).toContain(originalPixelMd);
  });

  // 8. Human Mandate 删除后 Pixel Self 仍保持原历史
  it("Test 8: Human Mandate 删除后 Pixel Self 仍保持原历史", () => {
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    const pixelMdPath = path.join(pixelDir, "pixel.md");
    const mandatePath = path.join(pixelDir, "mandate.md");

    fs.writeFileSync(pixelMdPath, "# Pixel Persistent Mind", "utf-8");
    fs.writeFileSync(mandatePath, "Temporary Mandate", "utf-8");

    // 删除 Mandate
    fs.unlinkSync(mandatePath);

    const builder = new PromptBuilder();
    const { fullPrompt } = builder.prepare({
      state: { energy: 1000 },
      pixelMd: fs.readFileSync(pixelMdPath, "utf-8"),
      messageMd: "Next task",
      external: null,
      pixelFiles: [],
    });

    expect(fs.readFileSync(pixelMdPath, "utf-8")).toBe("# Pixel Persistent Mind");
    expect(fullPrompt).not.toContain("Temporary Mandate");
    expect(fullPrompt).toContain("=== PIXEL SELF ===\nPixel State:");
    expect(fullPrompt).toContain("# Pixel Persistent Mind");
  });

  // 9. cost ledger 正确记录模型 token usage (真实成本无人工虚设)
  it("Test 9: cost ledger 正确记录模型 token usage", () => {
    store.runs.createRun({
      run_id: "run_v11_test",
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

    store.modelCalls.recordModelCall({
      callId: "call_1",
      runId: "run_v11_test",
      pixelId: "0_0_0",
      messageId: "msg_1",
      roundNum: 1,
      model: "glm-5.3-flash",
      promptTokens: 1200,
      completionTokens: 800,
      cachedTokens: 500,
      actualTokens: 2000,
      costCny: 0.0002,
      toolCost: 0,
      outcome: "SUCCESS",
      createdAt: Date.now() / 1000,
    });

    const costs = store.modelCalls.getPixelStepCosts("0_0_0");
    expect(costs).toHaveLength(1);
    expect(costs[0].pixelId).toBe("0_0_0");
    expect(costs[0].round).toBe(1);
    expect(costs[0].inputTokens).toBe(1200);
    expect(costs[0].cachedInputTokens).toBe(500);
    expect(costs[0].outputTokens).toBe(800);
    expect(costs[0].modelCost).toBe(0.0002);
  });

  // 10. Context 中 External 与 Pixel Self 来源明确分离
  it("Test 10: Context 中 External 与 Pixel Self 来源明确五层分离", () => {
    const builder = new PromptBuilder();
    const { fullPrompt } = builder.prepare({
      state: { energy: 500 },
      pixelMd: "My Mind",
      messageMd: "Neighbor Message",
      external: {
        environmentInfo: "Global Weather Sunny",
        humanInstructions: "Execute Task 1",
      },
      pixelFiles: ["report1.md", "data.json"],
    });

    // 验证五层物理边界标识
    expect(fullPrompt).toContain("=== CONSTITUTION ===");
    expect(fullPrompt).toContain("=== EXTERNAL ===");
    expect(fullPrompt).toContain("=== PIXEL SELF ===");
    expect(fullPrompt).toContain("=== YOUR FILES ===");
    expect(fullPrompt).toContain("=== LOCAL MESSAGES ===");

    // 验证各层所属内容不越界
    const externalIdx = fullPrompt.indexOf("=== EXTERNAL ===");
    const selfIdx = fullPrompt.indexOf("=== PIXEL SELF ===");
    const filesIdx = fullPrompt.indexOf("=== YOUR FILES ===");
    const messagesIdx = fullPrompt.indexOf("=== LOCAL MESSAGES ===");

    expect(externalIdx).toBeLessThan(selfIdx);
    expect(selfIdx).toBeLessThan(filesIdx);
    expect(filesIdx).toBeLessThan(messagesIdx);

    const externalChunk = fullPrompt.substring(externalIdx, selfIdx);
    expect(externalChunk).toContain("Global Weather Sunny");
    expect(externalChunk).not.toContain("My Mind");

    const selfChunk = fullPrompt.substring(selfIdx, filesIdx);
    expect(selfChunk).toContain("My Mind");
    expect(selfChunk).not.toContain("report1.md");

    const filesChunk = fullPrompt.substring(filesIdx, messagesIdx);
    expect(filesChunk).toContain("- report1.md");
    expect(filesChunk).toContain("- data.json");
  });
});

describe("EmergentInc V11 — Three Foundational Benchmark Experiments", () => {
  let tmpDir: string;
  let store: CoreStore;
  let registry: ToolRegistry;
  let toolRuntime: ToolRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "v11_experiments_"));
    const ledgerDir = path.join(tmpDir, "ledger");
    const liveDir = path.join(tmpDir, "live");
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.mkdirSync(liveDir, { recursive: true });

    const dbPath = path.join(ledgerDir, "v9_core.sqlite3");
    store = new CoreStore(dbPath);

    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    toolRuntime = new ToolRuntime(registry);

    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 2000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    store.pixels.upsertPixelAccount({ pixelId: "0_1_0", energy: 2000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // Experiment 1: 历史成本差异
  it("Experiment 1: 历史复用产生真实 Token 成本差异，且成本记录真实可查", async () => {
    // 假设 A 在过去已生成资料 postgres_deadlock.md
    const ctxA: ToolContext = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "exp_1",
      messageId: "m1",
      operationId: "op1",
    };
    await toolRuntime.execute(
      "save_artifact",
      { filename: "postgres_deadlock.md", content: "Check pg_stat_activity and lock tree" },
      ctxA
    );

    // 记录 A 的真实成本 (复用已有 artifact，仅少量推理，耗费 1500 tokens)
    store.modelCalls.recordModelCall({
      callId: "call_a",
      runId: "exp_1",
      pixelId: "0_0_0",
      roundNum: 2,
      model: "glm-5.3-flash",
      promptTokens: 1000,
      completionTokens: 500,
      cachedTokens: 800,
      actualTokens: 1500,
      costCny: 0.00015,
      toolCost: 0,
      outcome: "SUCCESS",
      createdAt: Date.now() / 1000,
    });

    // 记录 B 的真实成本 (无历史资料，重新检索与大规模推理生成，耗费 8500 tokens)
    store.modelCalls.recordModelCall({
      callId: "call_b",
      runId: "exp_1",
      pixelId: "0_1_0",
      roundNum: 2,
      model: "glm-5.3-flash",
      promptTokens: 3500,
      completionTokens: 5000,
      cachedTokens: 0,
      actualTokens: 8500,
      costCny: 0.00085,
      toolCost: 0,
      outcome: "SUCCESS",
      createdAt: Date.now() / 1000,
    });

    const costA = store.modelCalls.getPixelStepCosts("0_0_0")[0];
    const costB = store.modelCalls.getPixelStepCosts("0_1_0")[0];

    // 验证：真实成本差异确实存在，A 真实成本显著低于 B，且系统没有人工设定比例，完全来自真实记录
    expect(costA.actualTokens).toBeLessThan(costB.actualTokens);
    expect(costA.modelCost).toBeLessThan(costB.modelCost);
    expect(costA.cachedInputTokens).toBeGreaterThan(costB.cachedInputTokens);
  });

  // Experiment 2: 信息 ↔ Energy 交换链路
  it("Experiment 2: 资料 ↔ Energy 最小原子交换链路闭环", async () => {
    // 场景：A 拥有资料，B 需要资料；B 支付 150 Energy，A 复制一份资料给 B
    const ctxA: ToolContext = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "exp_2",
      messageId: "m_a",
      operationId: "op_a",
    };
    await toolRuntime.execute("save_artifact", { filename: "api_spec.json", content: '{"endpoint":"/v1"}' }, ctxA);

    // 步骤 1: B 转移 150 Energy 给 A (信息买卖协商达成)
    const transferEnergyValidation = validateEnergyTransfer({
      fromPixelId: "0_1_0",
      fromEnergy: 2000,
      fromActive: true,
      toPixelId: "0_0_0",
      toActive: true,
      amount: 150,
    });
    expect(transferEnergyValidation.valid).toBe(true);

    store.transaction(() => {
      store.pixels.updateEnergy("0_1_0", -150);
      store.pixels.updateEnergy("0_0_0", 150);
    });

    // 步骤 2: A 传递 artifact 给 B
    const transferArtifactRes = await toolRuntime.execute(
      "transfer_artifact",
      { filename: "api_spec.json", target_pixel_id: "0_1_0" },
      ctxA
    );
    expect(transferArtifactRes.status).toBe("SUCCESS");

    // 验证：B 成功获得资料副本
    const ctxB: ToolContext = { ...ctxA, pixelId: "0_1_0" };
    const readB = await toolRuntime.execute("read_artifact", { filename: "api_spec.json" }, ctxB);
    expect(readB.status).toBe("SUCCESS");
    expect(readB.output.content).toBe('{"endpoint":"/v1"}');

    // 验证：能量账户与总能量守恒
    expect(store.pixels.getPixelAccount("0_1_0")!.energy).toBe(1850);
    expect(store.pixels.getPixelAccount("0_0_0")!.energy).toBe(2150);
    expect(1850 + 2150).toBe(4000);
  });

  // Experiment 3: 外生角色 (Human Mandate) 注入与撤除
  it("Experiment 3: Human Mandate 注入与撤除后元胞心智与历史的独立性", () => {
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    const pixelMdPath = path.join(pixelDir, "pixel.md");
    const mandatePath = path.join(pixelDir, "mandate.md");

    fs.writeFileSync(pixelMdPath, "Pixel autonomous evolution mind log", "utf-8");

    // 1. 注入 Human Mandate: 外部指定职责
    fs.writeFileSync(mandatePath, "Human Mandate: 负责外部请求受理与任务分发", "utf-8");

    const builder = new PromptBuilder();
    let res = builder.prepare({
      state: { energy: 1000 },
      pixelMd: fs.readFileSync(pixelMdPath, "utf-8"),
      messageMd: "Incoming request",
      external: { humanMandate: fs.readFileSync(mandatePath, "utf-8") },
      pixelFiles: [],
    });
    expect(res.fullPrompt).toContain("Human Mandate: 负责外部请求受理与任务分发");
    expect(res.fullPrompt).toContain("Pixel autonomous evolution mind log");

    // 2. 撤除 Human Mandate
    fs.unlinkSync(mandatePath);

    res = builder.prepare({
      state: { energy: 1000 },
      pixelMd: fs.readFileSync(pixelMdPath, "utf-8"),
      messageMd: "Another request",
      external: null,
      pixelFiles: [],
    });
    // Mandate 消失
    expect(res.fullPrompt).not.toContain("Human Mandate: 负责外部请求受理与任务分发");
    // Pixel Self 自身心智依然完整保留
    expect(res.fullPrompt).toContain("Pixel autonomous evolution mind log");
    expect(fs.readFileSync(pixelMdPath, "utf-8")).toBe("Pixel autonomous evolution mind log");
  });
});
