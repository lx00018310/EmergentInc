import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { CoreStore } from "@emergentinc/persistence";
import { ModelProvider, PromptBuilder, UsageMeter } from "@emergentinc/model";
import type { AgentDecision, MessageEnvelope, PreparedModelRequest } from "@emergentinc/protocol";
import { AgentStepRunner, DecisionCompiler, EffectRuntime } from "../src/index.js";
import {
  ToolRegistry,
  ToolRuntime,
  registerAllBuiltinTools,
  ToolContext,
} from "@emergentinc/tools";

/**
 * 受控计量说明（重要）：
 * 本文件的确定性 Provider 是测试替身，token 计量从实际请求/响应文本长度推导
 * （Unicode 码点数，见 countTokens），用于让 AgentStepRunner→DecisionCompiler→
 * EffectRuntime→持久化 ledger 全链路在受控计量下运行。这不是真实付费 LLM 实验，
 * 任何断言只证明"链路如实记录了计量"，不声称证明现实 LLM 的成本节省。
 */
function countTokens(text: string): number {
  return Array.from(text).length;
}

/** 脚本化确定性 Provider：按触发条件返回固定决策 JSON，计量来自真实请求文本。 */
class ScriptedProvider implements ModelProvider {
  public readonly requests: PreparedModelRequest[] = [];

  constructor(
    private readonly respond: (
      request: PreparedModelRequest
    ) => { decision: AgentDecision; thought?: string }
  ) {}

  public async call(request: PreparedModelRequest) {
    this.requests.push(request);
    const { decision, thought } = this.respond(request);
    const responseText = JSON.stringify({ thought: thought ?? "deterministic", ...decision });
    const promptTokens = countTokens(request.messages.map((m) => m.content).join("\n"));
    const completionTokens = countTokens(responseText);
    return { rawText: responseText, usage: { promptTokens, completionTokens, cachedTokens: 0 } };
  }
}

function makeUsageMeter(): UsageMeter {
  // 测试计量价目：受控常数，不代表真实供应商价格
  return new UsageMeter({
    models: {
      "test-model": {
        input_cost_per_million: 2,
        output_cost_per_million: 8,
        cached_cost_per_million: 1,
        currency: "CNY",
      },
    },
  });
}

/** 组装真实 runner：真实 PromptBuilder/UsageMeter/ToolRuntime + 确定性 Provider + 持久化 CoreStore */
function buildRunner(params: {
  tmpDir: string;
  store: CoreStore;
  toolRuntime: ToolRuntime;
  provider: ModelProvider;
}): AgentStepRunner {
  return new AgentStepRunner({
    workspaceRoot: params.tmpDir,
    store: params.store,
    provider: params.provider,
    toolRuntime: params.toolRuntime,
    promptBuilder: new PromptBuilder({ modelName: "test-model", maxOutputTokens: 256 }),
    usageMeter: makeUsageMeter(),
  });
}

/** 在 live/pixels/<id>/ 写入真实 pixel.md / state.json fixture（artifacts 由 save_artifact 真实落盘） */
function seedLivePixel(tmpDir: string, pixelId: string, pixelMd: string, energy: number): void {
  const pixelDir = path.join(tmpDir, "live", "pixels", pixelId);
  fs.mkdirSync(pixelDir, { recursive: true });
  fs.writeFileSync(path.join(pixelDir, "pixel.md"), pixelMd, "utf-8");
  fs.writeFileSync(
    path.join(pixelDir, "state.json"),
    JSON.stringify({ pixel_id: pixelId, energy, active: true }, null, 2),
    "utf-8"
  );
}

function makePixelState(pixelId: string, energy: number) {
  const [x, y] = pixelId.split("_").map(Number);
  return {
    pixelId,
    position: { x, y },
    energy,
    active: true,
    generation: 1,
    createdAtRound: 0,
    lastActiveRound: 0,
  };
}

/** 从持久化 ledger 读取双向 transfer 流水总额 */
function readLedgerTransferTotals(store: CoreStore): { outTotal: number; inTotal: number } {
  const out = store.db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE entry_type = 'transfer_out'")
    .get() as any;
  const inp = store.db
    .prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM ledger_entries WHERE entry_type = 'transfer_in'")
    .get() as any;
  return { outTotal: Number(out.total), inTotal: Number(inp.total) };
}

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
    seedLivePixel(tmpDir, "0_0_0", "Persistent mind A", 1000);
    seedLivePixel(tmpDir, "0_1_0", "Persistent mind B", 500);
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

  // 4/5 是 compiler/effect 集成测试；完整模型决策链路见 Experiment 2。
  it("Test 4: energy transfer effect 持久化双向守恒账本且重放不重复划转", async () => {
    const effects = DecisionCompiler.compile({
      decision: { energy_transfer: [{ target: "0_1_0", amount: 200 }] },
      pixelId: "0_0_0", messageId: "transfer_ok", currentHop: 1,
    });
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 1, runId: null });
    await runtime.applyEffects(effects);
    await runtime.applyEffects(effects);

    expect(store.pixels.getPixelAccount("0_0_0")!.energy).toBe(800);
    expect(store.pixels.getPixelAccount("0_1_0")!.energy).toBe(700);
    expect(readLedgerTransferTotals(store)).toEqual({ outTotal: -200, inTotal: 200 });
    expect(store.db.prepare("SELECT * FROM ledger_entries").all()).toHaveLength(2);
    expect(store.effects.hasEffectBeenApplied(effects[0].effectId)).toBe(true);
  });

  it("Test 5: 超额 energy transfer effect 失败且账户/账本无划转", async () => {
    const effects = DecisionCompiler.compile({
      decision: { energy_transfer: [{ target: "0_1_0", amount: 1001 }] },
      pixelId: "0_0_0", messageId: "transfer_failed", currentHop: 1,
    });
    await new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 1, runId: null })
      .applyEffects(effects);

    expect(store.pixels.getPixelAccount("0_0_0")!.energy).toBe(1000);
    expect(store.pixels.getPixelAccount("0_1_0")!.energy).toBe(500);
    expect(store.db.prepare("SELECT * FROM ledger_entries").all()).toHaveLength(0);
    expect(store.db.prepare("SELECT status FROM effects WHERE effect_id = ?").get(effects[0].effectId))
      .toMatchObject({ status: "FAILED" });
    expect(store.messages.listRecentMessages().some((message) =>
      message.sourceType === "feedback" && message.content.includes("INSUFFICIENT_ENERGY")))
      .toBe(true);
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
      idempotencyKey: "historical-economy-reward",
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

  // 9. Repository 单元测试：以下是写入/读回 fixture，不代表真实模型调用或费用。
  it("Test 9: cost ledger repository 单元测试记录 usage fixture", () => {
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

describe("EmergentInc V11 — Three Controlled Runner Integration Experiments", () => {
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

    store.runs.createRun({
      run_id: "experiments", start_round: 1, run_limit: 1000000, run_spent: 0, run_reserved: 0,
      global_limit: 1000000, global_spent: 0, global_reserved: 0, genesis_revision: 1,
      status: "RUNNING", created_at: Date.now() / 1000,
    });
    for (const pixelId of ["0_0_0", "0_1_0"]) {
      store.pixels.upsertPixelAccount({ pixelId, energy: 100000, active: true,
        refundDeficitTokens: 0, spendBlockedReason: null });
      seedLivePixel(tmpDir, pixelId, "Persistent autonomous mind", 100000);
    }
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function enqueue(pixelId: string, content: string, round = 1): MessageEnvelope {
    return store.messages.enqueueMessage({ runId: "experiments", roundNum: round,
      sender: "human", recipient: pixelId, content, sourceType: "human" });
  }

  async function step(provider: ScriptedProvider, message: MessageEnvelope) {
    const pixelId = message.recipient;
    const runner = buildRunner({ tmpDir, store, toolRuntime, provider });
    // Same input contract as scheduler: read real pixel.md, then pass its text to runner.
    const result = await runner.execute({
      trace: { runId: "experiments", round: message.roundNum, pixelId, messageId: message.messageId },
      pixelState: makePixelState(pixelId, store.pixels.getPixelAccount(pixelId)!.energy),
      pixelMind: fs.readFileSync(path.join(tmpDir, "live", "pixels", pixelId, "pixel.md"), "utf-8"),
      message, round: message.roundNum,
    });
    expect(store.messages.getMessage(message.messageId)!.status).toBe("COMMITTED");
    expect(result.effects.length).toBeGreaterThan(0);
    for (const effect of result.effects) expect(store.effects.hasEffectBeenApplied(effect.effectId)).toBe(true);
    const record = store.modelCalls.getLatestByMessageId(message.messageId)!;
    const request = provider.requests[provider.requests.length - 1];
    const promptTokens = countTokens(request.messages.map((m) => m.content).join("\n"));
    const completionTokens = countTokens(record.rawResponse!);
    expect(record).toMatchObject({ outcome: "SUCCESS", promptHash: request.promptHash,
      promptTokens, completionTokens, cachedTokens: 0, actualTokens: promptTokens + completionTokens });
    expect(record.costCny).toBe(Math.round(promptTokens * 2 + completionTokens * 8) / 1000000);
    expect(result.usage!.actualTokens).toBe(record.actualTokens);
    return { result, record, request };
  }

  function feedback(pixelId: string, tool: string): MessageEnvelope {
    const messages = store.messages.listRecentMessages(100).filter((m) =>
      m.recipient === pixelId && m.status === "QUEUED" && m.sourceType === "feedback" &&
      m.content.includes(`TOOL_${tool.toUpperCase()}_SUCCESS`));
    expect(messages).toHaveLength(1);
    return messages[0];
  }

  function reopen() {
    store.close();
    store = new CoreStore(path.join(tmpDir, "ledger", "v9_core.sqlite3"));
  }

  it("Experiment 1: 历史经 read_artifact feedback 复用，文本受控计量持久化（非付费LLM实验）", async () => {
    const filename = "postgres_deadlock.md";
    const history = "Check pg_stat_activity and lock tree";
    const task = "Produce a deadlock checklist using private history when available.";
    await step(new ScriptedProvider(() => ({ decision: {
      operations: [{ tool: "save_artifact", args: { filename, content: history } }],
    } })), enqueue("0_0_0", "Archive previous checklist"));

    // One deterministic policy sees actual requests, not pixel IDs. No asserted savings:
    // its fresh/reuse responses are controlled text, not real LLM reasoning evidence.
    const provider = new ScriptedProvider((request) => {
      const prompt = request.messages.map((m) => m.content).join("\n");
      if (prompt.includes("TOOL_READ_ARTIFACT_SUCCESS")) {
        const payload = JSON.parse(prompt.split("TOOL_READ_ARTIFACT_SUCCESS: ")[1].split("\n")[0]);
        return { decision: { operations: [{ tool: "save_artifact",
          args: { filename: "answer.md", content: payload.content } }] } };
      }
      const files = prompt.split("=== YOUR FILES ===")[1].split("=== LOCAL MESSAGES ===")[0];
      if (files.includes(`- ${filename}`)) {
        return { decision: { operations: [{ tool: "read_artifact", args: { filename } }] } };
      }
      return { decision: { operations: [{ tool: "save_artifact",
        args: { filename: "answer.md", content: "Controlled fresh checklist: inspect sessions, locks and waits." } }] } };
    });
    const reuse = await step(provider, enqueue("0_0_0", task, 2));
    const reusePrompt = reuse.request.messages.map((m) => m.content).join("\n");
    expect(reusePrompt).toContain(`- ${filename}`);
    expect(reusePrompt).not.toContain(history);
    const readReceipt = feedback("0_0_0", "read_artifact");
    expect(readReceipt.content).toContain(history);
    const consumed = await step(provider, readReceipt);
    expect(consumed.request.messages.map((m) => m.content).join("\n")).toContain(readReceipt.content);
    const fresh = await step(provider, enqueue("0_1_0", task, 2));
    expect(fresh.request.messages.map((m) => m.content).join("\n")).not.toContain(history);
    expect(fresh.result.decision.operations![0].tool).toBe("save_artifact");
    expect(fs.readFileSync(path.join(tmpDir, "live", "artifacts", "0_0_0", "answer.md"), "utf-8")).toBe(history);

    // Include read AND feedback-consumption costs; archive creation is explicit setup.
    const reuseTokens = reuse.record.actualTokens! + consumed.record.actualTokens!;
    expect(reuseTokens).not.toBe(fresh.record.actualTokens);
    reopen();
    expect(store.modelCalls.getPixelStepCosts("0_0_0")).toHaveLength(3);
    expect(store.modelCalls.getPixelStepCosts("0_1_0")).toHaveLength(1);
    for (const call of [reuse.record, consumed.record, fresh.record]) {
      expect(store.modelCalls.getLatestByMessageId(call.messageId!)!).toMatchObject({
        actualTokens: call.actualTokens, costCny: call.costCny, rawResponse: call.rawResponse });
    }
    expect(store.pixels.getPixelAccount("0_1_0")!.energy).toBe(100000 - fresh.record.actualTokens!);
  });

  it("Experiment 2: 模型决策资料交付及energy支付，双向账本守恒（非跨步原子交换）", async () => {
    const content = '{"endpoint":"/v1"}';
    await step(new ScriptedProvider(() => ({ decision: {
      operations: [{ tool: "save_artifact", args: { filename: "api_spec.json", content } }],
    } })), enqueue("0_0_0", "Archive API specification"));
    const beforeA = store.pixels.getPixelAccount("0_0_0")!.energy;
    const beforeB = store.pixels.getPixelAccount("0_1_0")!.energy;
    const seller = await step(new ScriptedProvider(() => ({ decision: {
      operations: [{ tool: "transfer_artifact", args: { filename: "api_spec.json", target_pixel_id: "0_1_0" } }],
    } })), enqueue("0_0_0", "Deliver agreed API specification"));
    expect(feedback("0_0_0", "transfer_artifact").content).toContain('"copied":true');
    const buyer = new ScriptedProvider((request) => ({ decision:
      request.messages.some((m) => m.content.includes("TOOL_READ_ARTIFACT_SUCCESS"))
        ? { energy_transfer: [{ target: "0_0_0", amount: 150 }] }
        : { operations: [{ tool: "read_artifact", args: { filename: "api_spec.json" } }] },
    }));
    const read = await step(buyer, enqueue("0_1_0", "Read delivery, then pay 150 Energy"));
    const receipt = feedback("0_1_0", "read_artifact");
    expect(receipt.content).toContain("/v1");
    const payment = await step(buyer, receipt);
    const transfer = payment.result.effects.find((effect) => effect.effectType === "TRANSFER_ENERGY")!;
    expect(transfer).toBeDefined();
    // Replay exact compiled effects: no duplicate payment or ledger entries.
    await new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime, round: 1, runId: "experiments" })
      .applyEffects(payment.result.effects);
    reopen();
    const rows = store.db.prepare("SELECT * FROM ledger_entries WHERE entry_type IN ('transfer_in', 'transfer_out') ORDER BY entry_type").all();
    expect(rows).toEqual([
      expect.objectContaining({ entry_id: `${transfer.effectId}_in`, pixel_id: "0_0_0", amount: 150,
        balance_after: beforeA - seller.record.actualTokens! + 150, details: JSON.stringify({ from: "0_1_0" }) }),
      expect.objectContaining({ entry_id: `${transfer.effectId}_out`, pixel_id: "0_1_0", amount: -150,
        balance_after: beforeB - read.record.actualTokens! - payment.record.actualTokens! - 150,
        details: JSON.stringify({ to: "0_0_0" }) }),
    ]);
    expect(readLedgerTransferTotals(store)).toEqual({ outTotal: -150, inTotal: 150 });
    const afterA = store.pixels.getPixelAccount("0_0_0")!.energy;
    const afterB = store.pixels.getPixelAccount("0_1_0")!.energy;
    expect(afterA).toBe(beforeA - seller.record.actualTokens! + 150);
    expect(afterB).toBe(beforeB - read.record.actualTokens! - payment.record.actualTokens! - 150);
    const modelSpend = seller.record.actualTokens! + read.record.actualTokens! + payment.record.actualTokens!;
    expect(afterA + afterB + modelSpend).toBe(beforeA + beforeB);
    for (const pixelId of ["0_0_0", "0_1_0"]) {
      expect(fs.readFileSync(path.join(tmpDir, "live", "artifacts", pixelId, "api_spec.json"), "utf-8")).toBe(content);
    }
    expect(store.modelCalls.getLatestByMessageId(payment.record.messageId!)!.actualTokens).toBe(payment.record.actualTokens);
  });

  it("Experiment 3: 实际runner请求中mandate注入/改变/撤除不改写文件心智和历史", async () => {
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    const mindPath = path.join(pixelDir, "pixel.md");
    const mandatePath = path.join(pixelDir, "mandate.md");
    const mind = "Independent mind loaded from real pixel.md";
    fs.writeFileSync(mindPath, mind, "utf-8");
    await step(new ScriptedProvider(() => ({ decision: {
      operations: [{ tool: "save_artifact", args: { filename: "history.md", content: "Private persistent history" } }],
    } })), enqueue("0_0_0", "Archive independent history"));
    const provider = new ScriptedProvider(() => ({ decision: { send_to: "STOP" } }));
    const mandates = ["负责外部请求受理与任务分发", "改为审查资料质量", null];
    for (const [index, mandate] of mandates.entries()) {
      if (mandate === null) fs.unlinkSync(mandatePath);
      else fs.writeFileSync(mandatePath, mandate, "utf-8");
      const { request } = await step(provider, enqueue("0_0_0", "Inspect current assignment", index + 2));
      const prompt = request.messages.map((m) => m.content).join("\n");
      const external = prompt.split("=== EXTERNAL ===")[1].split("=== PIXEL SELF ===")[0];
      const self = prompt.split("=== PIXEL SELF ===")[1].split("=== YOUR FILES ===")[0];
      expect(self).toContain(mind);
      expect(external).not.toContain(mind);
      for (const candidate of mandates.filter((value) => value !== null)) {
        if (candidate === mandate) expect(external).toContain(`Human Mandate:\n${candidate}`);
        else expect(prompt).not.toContain(candidate);
        expect(self).not.toContain(candidate);
      }
      if (mandate === null) expect(prompt).not.toContain("Human Mandate:");
      expect(prompt).toContain("- history.md");
      expect(fs.readFileSync(mindPath, "utf-8")).toBe(mind);
    }
    expect(provider.requests).toHaveLength(3);
    reopen();
    expect(store.modelCalls.getPixelStepCosts("0_0_0")).toHaveLength(4);
    expect(fs.readFileSync(path.join(tmpDir, "live", "artifacts", "0_0_0", "history.md"), "utf-8"))
      .toBe("Private persistent history");
  });
});
