import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FastifyInstance } from "fastify";
import { createServer } from "../src/app.js";
import { CoreStore } from "@emergentinc/persistence";
import { ToolRegistry, registerAllBuiltinTools, ToolRuntime } from "@emergentinc/tools";
import { PromptBuilder, UsageMeter, ModelProvider } from "@emergentinc/model";
import { AgentStepRunner, DecisionCompiler, EffectRuntime, RoundScheduler } from "@emergentinc/runtime";
import { WorldService } from "../src/services/world_service.js";
import { RunService } from "../src/services/run_service.js";
import { PromptService } from "../src/services/prompt_service.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

class MockProvider implements ModelProvider {
  async call() {
    return {
      rawText: JSON.stringify({ message_md: "ok", send_to: "STOP" }),
      usage: { promptTokens: 10, completionTokens: 10 },
    };
  }
}

describe("Server: API Contract Integration Tests", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let store: CoreStore;
  let runService: RunService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "server_api_test_"));
    const liveDir = path.join(tmpDir, "live");
    const runtimeDir = path.join(tmpDir, "runtime");
    const privDir = path.join(tmpDir, "private");
    fs.mkdirSync(liveDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(privDir, { recursive: true });

    // 写入 world_state.json 基础数据
    fs.writeFileSync(
      path.join(liveDir, "world_state.json"),
      JSON.stringify({ round: 5, counters: { external_requests: 0 } }),
      "utf-8"
    );

    // 写入 environment.md
    fs.writeFileSync(path.join(liveDir, "environment.md"), "Sunny day in world.", "utf-8");

    store = new CoreStore(":memory:");
    const toolRegistry = new ToolRegistry();
    registerAllBuiltinTools(toolRegistry);
    const toolRuntime = new ToolRuntime(toolRegistry);

    const promptBuilder = new PromptBuilder();
    const usageMeter = new UsageMeter({ models: {} });
    const provider = new MockProvider();

    const stepRunner = new AgentStepRunner({
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
      stepRunner,
    });

    const worldService = new WorldService(tmpDir, store);
    runService = new RunService({
      workspaceRoot: tmpDir,
      store,
      scheduler,
      isMockMode: true,
      isModelConfigured: true,
    });
    const promptService = new PromptService(runtimeDir);

    app = await createServer({
      worldService,
      runService,
      promptService,
      toolRegistry,
      coreStore: store,
      workspaceRoot: tmpDir,
    });
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  it("should return world DTO with /api/world", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/world",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.round).toBe(5);
    expect(body.pixels).toBeInstanceOf(Array);
    expect(body.external_accounting).toBeDefined();
  });

  it("should query run status and manage run lifecycle", async () => {
    // 1. 获取初始状态
    const statusRes = await app.inject({
      method: "GET",
      url: "/api/run/status",
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().running).toBe(false);

    // 2. 数据库中已有运行中的 Run 时由唯一互斥入口拒绝
    store.runs.createRun({
      run_id: "existing_run", start_round: 6, end_round: 6,
      run_limit: 1000, run_spent: 0, run_reserved: 0,
      global_limit: 10000, global_spent: 0, global_reserved: 0,
      genesis_revision: 1, status: "RUNNING", created_at: Date.now() / 1000,
    });
    const conflictRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: { rounds: 1, run_budget_tokens: 1000 },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().detail).toContain("RUN_BLOCKED_UNFINALIZED_OPERATIONS");
    store.runs.updateRunStatus("existing_run", "STOPPED", "USER_STOPPED");

    // 3. 正常发起 Run
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        rounds: 2,
        run_budget_tokens: 5000,
      },
    });
    expect(startRes.statusCode).toBe(200);
    expect(startRes.json().status).toBe("STARTED");

    // 4. 停止 Run
    const stopRes = await app.inject({
      method: "POST",
      url: "/api/run/stop",
    });
    expect(stopRes.statusCode).toBe(200);
  });

  it("should read and update environment via /api/environment", async () => {
    const getRes = await app.inject({
      method: "GET",
      url: "/api/environment",
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().content).toBe("Sunny day in world.");

    const postRes = await app.inject({
      method: "POST",
      url: "/api/environment",
      payload: { content: "Rainy day in world." },
    });
    expect(postRes.statusCode).toBe(200);
    expect(postRes.json().status).toBe("UPDATED");
  });

  it("lists all tools and their effective authorization in /api/tools", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tools",
    });
    expect(res.statusCode).toBe(200);
    const tools = res.json().tools;
    expect(tools).toHaveLength(15);
    expect(tools.map((t: any) => t.name)).toContain("save_artifact");
    expect(tools.map((t: any) => t.name)).toContain("transfer_artifact");
    expect(tools.map((t: any) => t.name)).toContain("webfetch");
    expect(tools.map((t: any) => t.name)).toContain("github_repo");
    expect(tools.find((t: any) => t.name === "vps_exec")?.enabled).toBe(false);
  });

  it("should support Human Mandate and External Reward APIs", async () => {
    // 准备测试元胞
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({ id: "0_0_0", energy: 100 }), "utf-8");
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 100,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    // 1. 设置 Mandate
    const putMandate = await app.inject({
      method: "PUT",
      url: "/api/pixels/0_0_0/mandate",
      payload: { mandate: "Lead project coordination" },
    });
    expect(putMandate.statusCode).toBe(200);
    expect(putMandate.json().mandate).toBe("Lead project coordination");

    // 2. 获取 Mandate
    const getMandate = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/mandate",
    });
    expect(getMandate.statusCode).toBe(200);
    expect(getMandate.json().mandate).toBe("Lead project coordination");

    // 3. 删除 Mandate
    const delMandate = await app.inject({
      method: "DELETE",
      url: "/api/pixels/0_0_0/mandate",
    });
    expect(delMandate.statusCode).toBe(200);

    const getMandateAfter = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/mandate",
    });
    expect(getMandateAfter.json().mandate).toBeNull();

    // 4. 外部激励注入 (External Reward) — requires idempotency key; replay returns first result
    const rewardRes = await app.inject({
      method: "POST",
      url: "/api/pixels/0_0_0/reward",
      payload: { amount: 500, reason: "Excellent performance", idempotency_key: "test-key-1" },
    });
    expect(rewardRes.statusCode).toBe(200);
    expect(rewardRes.json().amount).toBe(500);
    expect(rewardRes.json().newBalance).toBeGreaterThanOrEqual(500);
    const rewardReplay = await app.inject({
      method: "POST",
      url: "/api/pixels/0_0_0/reward",
      payload: { amount: 500, reason: "Excellent performance", idempotency_key: "test-key-1" },
    });
    expect(rewardReplay.statusCode).toBe(200);
    expect(rewardReplay.json().eventId).toBe(rewardRes.json().eventId);
    const rewardNoKey = await app.inject({
      method: "POST",
      url: "/api/pixels/0_0_0/reward",
      payload: { amount: 100, reason: "missing key" },
    });
    expect(rewardNoKey.statusCode).toBe(400);

    // 5. Rewards 观察端点
    const rewardsRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/rewards",
    });
    expect(rewardsRes.statusCode).toBe(200);
    const rewards = rewardsRes.json().rewards;
    expect(rewards).toBeInstanceOf(Array);
    expect(rewards).toHaveLength(1);
    expect(rewards[0]).toMatchObject({ pixel_id: "0_0_0", amount: 500, source: "human", reason: "Excellent performance" });
    expect(rewards[0].event_id).toBeDefined();

    // 6. Step Costs 观察端点 (无调用记录时为空数组)
    const costsRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/step-costs",
    });
    expect(costsRes.statusCode).toBe(200);
    expect(costsRes.json().costs).toBeInstanceOf(Array);

    // 7. 路径穿越防护
    const traversalRewards = await app.inject({
      method: "GET",
      url: "/api/pixels/..%2Fetc/rewards",
    });
    expect(traversalRewards.statusCode).toBe(400);
  });

  it("should support document short aliases (pixel, state, environment) with authoritative data and safety checks", async () => {
    // 准备测试元胞数据与文件
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    fs.writeFileSync(path.join(pixelDir, "pixel.md"), "I am pixel 0_0_0 mind.", "utf-8");
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({ id: "0_0_0", energy: 9999 }), "utf-8");
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 9999,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    // 1. 短别名 'pixel'
    const pixelRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/document/pixel",
    });
    expect(pixelRes.statusCode).toBe(200);
    expect(pixelRes.json().document).toBe("pixel.md");
    expect(pixelRes.json().content).toBe("I am pixel 0_0_0 mind.");

    // 2. 短别名 'state' (返回权威数据)
    const stateRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/document/state",
    });
    expect(stateRes.statusCode).toBe(200);
    expect(stateRes.json().document).toBe("state.json");
    const parsedState = JSON.parse(stateRes.json().content);
    expect(parsedState.energy).toBeDefined();

    // 3. 短别名 'environment'
    const envRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/document/environment",
    });
    expect(envRes.statusCode).toBe(200);
    expect(envRes.json().document).toBe("environment.md");

    // 4. 未知文档返回 403
    const unknownRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/document/confidential.txt",
    });
    expect(unknownRes.statusCode).toBe(403);
    expect(unknownRes.json().detail).toContain("allowlist");

    // 5. 路径穿越返回 400
    const traversalRes = await app.inject({
      method: "GET",
      url: "/api/pixels/0_0_0/document/..%2F..%2Fsecret",
    });
    expect(traversalRes.statusCode).toBe(400);
  });

  it("should prevent starting run without valid model configuration or explicit mock mode", async () => {
    const unconfiguredRunService = new RunService({
      workspaceRoot: tmpDir,
      store,
      scheduler: (runService as any).scheduler,
      isModelConfigured: false,
      isMockMode: false,
    });

    await expect(
      unconfiguredRunService.start({
        rounds: 1,
        runBudgetTokens: 1000,
      })
    ).rejects.toThrow("MODEL_NOT_CONFIGURED");
  });

  it("should return standard 404 with detail for unknown route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/unknown-endpoint",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBeDefined();
  });

  it("should block run start when unfinalized operations exist in store (409 Conflict)", async () => {
    // 确保 0_0_0 账户存在
    store.pixels.upsertPixelAccount({
      pixelId: "0_0_0",
      energy: 10000,
      active: true,
      refundDeficitTokens: 0,
      spendBlockedReason: null,
    });

    // 注入一条悬挂的 OPEN 预留
    store.budgets.reserve({
      callId: "call_hanging_test",
      runId: "run_prev",
      pixelId: "0_0_0",
      estimatedTokens: 500,
    });

    // 查询状态，应指示 PAUSED_RECOVERY_REQUIRED
    const statusRes = await app.inject({
      method: "GET",
      url: "/api/run/status",
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().result_status).toBe("PAUSED_RECOVERY_REQUIRED");
    expect(statusRes.json().unfinalized_operations).toBeDefined();

    // 发起 Run，应被门禁阻断，返回 409
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: { rounds: 1, run_budget_tokens: 1000 },
    });
    expect(startRes.statusCode).toBe(409);
    expect(startRes.json().detail).toContain("RUN_BLOCKED_UNFINALIZED_OPERATIONS");

    // 调用安全对账端点：uncertain billing requires explicit operator decisions, so
    // reconcile no longer auto-clears anything — it reports items needing review.
    const reconcileRes = await app.inject({
      method: "POST",
      url: "/api/run/reconcile",
    });
    expect(reconcileRes.statusCode).toBe(200);
    expect(reconcileRes.json().status).toBe("REVIEW_REQUIRED");

    // 再次查询状态，未决项仍在，READY 不应自动恢复
    const healedStatus = await app.inject({
      method: "GET",
      url: "/api/run/status",
    });
    expect(healedStatus.statusCode).toBe(200);
    expect(healedStatus.json().result_status).toBe("PAUSED_RECOVERY_REQUIRED");
    expect(healedStatus.json().unfinalized_operations).toBeDefined();

    store.resolveRecoveryOperation({ kind: "model", id: "call_hanging_test", decision: "confirm_not_billed" });
    const resolvedStatus = await app.inject({ method: "GET", url: "/api/run/status" });
    expect(resolvedStatus.json().result_status).toBe("RECOVERY_RESOLVED");
    const audit = await app.inject({ method: "GET", url: "/api/audit/workspace" });
    expect(audit.json().allowed_to_start).toBe(true);
  });

  it("stops when no processable messages remain, but advances to queued future messages", async () => {
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const pixelDir = path.join(tmpDir, "live", "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({ last_active_round: 5 }));
    const waitUntilStopped = async () => {
      for (let i = 0; runService.getStatus().running && i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };

    const first = await runService.start({ rounds: 1000, runBudgetTokens: 10000 });
    await waitUntilStopped();
    expect(runService.getStatus()).toMatchObject({
      running: false, current_round: 6, completed_rounds: 1,
      stop_reason: "NO_ACTIVE_MESSAGES", result_status: "STOPPED",
    });
    expect(store.runs.getRun(first.run_id)).toMatchObject({ status: "STOPPED", stop_reason: "NO_ACTIVE_MESSAGES" });

    store.messages.enqueueMessage({ roundNum: 8, sender: "system", recipient: "2_0_0", content: "future", sourceType: "system" });
    await runService.start({ rounds: 1000, runBudgetTokens: 10000 });
    await waitUntilStopped();
    expect(runService.getStatus()).toMatchObject({
      running: false, current_round: 8, completed_rounds: 2, messages_processed: 1,
      stop_reason: "NO_ACTIVE_MESSAGES", result_status: "STOPPED",
    });
  });

  it("rolls back a failed start without leaving an in-memory or database lock", async () => {
    const failOnce = vi.spyOn(store.messages, "resetWaitingRunBudgetMessages")
      .mockImplementationOnce(() => { throw new Error("startup failed"); });
    const service = new RunService({
      workspaceRoot: tmpDir, store,
      scheduler: { executeRound: async () => ({ round: 6, messagesProcessed: 0, activePixelsCount: 0 }) } as any,
      isMockMode: true, isModelConfigured: true,
    });
    try {
      await expect(service.start({ rounds: 1, runBudgetTokens: 1000 }))
        .rejects.toThrow("startup failed");
      expect(store.getUnfinalizedOperations().hasUnfinalized).toBe(false);
      expect(service.getStatus().running).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, ".engine.lock"))).toBe(false);
    } finally {
      failOnce.mockRestore();
    }
  });

  it("uses the database to exclude a second RunService on the same workspace", async () => {
    const dbPath = path.join(tmpDir, "shared.sqlite3");
    const firstStore = new CoreStore(dbPath);
    const secondStore = new CoreStore(dbPath);
    let releaseRound!: () => void;
    const waitingRound = new Promise<void>((resolve) => { releaseRound = resolve; });
    const first = new RunService({
      workspaceRoot: tmpDir, store: firstStore,
      scheduler: { executeRound: async () => {
        await waitingRound;
        return { round: 6, messagesProcessed: 0, activePixelsCount: 0 };
      } } as any,
      isMockMode: true, isModelConfigured: true,
    });
    const second = new RunService({
      workspaceRoot: tmpDir, store: secondStore,
      scheduler: { executeRound: async () => ({ round: 6, messagesProcessed: 0, activePixelsCount: 0 }) } as any,
      isMockMode: true, isModelConfigured: true,
    });
    try {
      await first.start({ rounds: 1, runBudgetTokens: 1000 });
      await expect(second.start({ rounds: 1, runBudgetTokens: 1000 }))
        .rejects.toThrow("RUN_BLOCKED_UNFINALIZED_OPERATIONS");
      expect(fs.existsSync(path.join(tmpDir, ".engine.lock"))).toBe(false);
    } finally {
      releaseRound();
      for (let i = 0; first.getStatus().running && i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      firstStore.close();
      secondStore.close();
    }
  });

  it("should not advance world round when execution fails mid-way and unify terminal status as FAILED", async () => {
    // 构造一个在第 1 轮调度时模拟基础设施故障的调度器
    const failingScheduler: any = {
      executeRound: async () => {
        return {
          round: 6,
          messagesProcessed: 0,
          activePixelsCount: 1,
          stopReason: "INFRASTRUCTURE_FAILURE",
        };
      },
    };

    const guardedRunService = new RunService({
      workspaceRoot: tmpDir,
      store,
      scheduler: failingScheduler,
      isModelConfigured: true,
      isMockMode: true,
    });

    const initialRound = guardedRunService.getWorldRound();
    expect(initialRound).toBe(5);

    const runRes = await guardedRunService.start({
      rounds: 5,
      runBudgetTokens: 10000,
    });

    // 等待异步 runLoop 完成
    let attempts = 0;
    while (guardedRunService.getStatus().running && attempts < 20) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      attempts++;
    }

    const status = guardedRunService.getStatus();
    // 验证：世界轮次绝对不虚增！
    expect(status.current_round).toBe(initialRound);
    expect(status.last_completed_round).toBe(initialRound);
    expect(status.completed_rounds).toBe(0);
    // 验证：终态统一为 FAILED
    expect(status.result_status).toBe("FAILED");
    expect(status.stop_reason).toBe("INFRASTRUCTURE_FAILURE");

    // 验证：SQLite runs 记录终态同样统一为 FAILED
    const runRecord = store.runs.getRun(runRes.run_id);
    expect(runRecord?.status).toBe("FAILED");
    expect(runRecord?.stop_reason).toBe("INFRASTRUCTURE_FAILURE");
  });

  it("atomically starts scoped Runs and counts task rounds without advancing the world", async () => {
    const profile = store.qianji.createProfile({ careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const execution = store.executions.create({ kind: "mission", subjectId: "mission_atomic", budgetTokens: 1000,
      roundsLimit: 2, inputSnapshot: { title: "测试任务" }, toolsSnapshot: [], bindingIds: [binding.bindingId] });
    const service = new RunService({
      workspaceRoot: tmpDir, store,
      scheduler: { executeRound: async (round: number) => ({ round, messagesProcessed: 0, activePixelsCount: 1, stopReason: "NO_ACTIVE_MESSAGES" }) } as any,
      isMockMode: true, isModelConfigured: true,
    });

    await expect(service.start({ rounds: 1, runBudgetTokens: 1000, executionId: execution.executionId,
      onRunCreated: () => { store.executions.transition(execution.executionId, "ready", "running"); throw new Error("mission startup failed"); } }))
      .rejects.toThrow("mission startup failed");
    expect(store.executions.get(execution.executionId)?.status).toBe("ready");
    expect(store.db.prepare("SELECT COUNT(*) AS count FROM runs WHERE execution_id=?").get(execution.executionId)).toEqual({ count: 0 });

    const started = await service.start({ rounds: 1, runBudgetTokens: 1000, executionId: execution.executionId,
      onRunCreated: () => { store.executions.transition(execution.executionId, "ready", "running"); } });
    for (let i = 0; service.getStatus().running && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(store.runs.getRun(started.run_id)).toMatchObject({ execution_id: execution.executionId, last_scope_round: 6 });
    expect(store.executions.get(execution.executionId)).toMatchObject({ status: "awaiting_review", roundsUsed: 1 });
    expect(service.getWorldRound()).toBe(5);
  });

  it("blocks an execution when measured usage exceeds its token budget", async () => {
    const profile = store.qianji.createProfile({ careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 500, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const execution = store.executions.create({ kind: "mission", subjectId: "mission_overrun", budgetTokens: 50,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [binding.bindingId] });
    const scheduler = {
      executeRound: async (round: number, runId: string, _signal: AbortSignal, executionId: string) => {
        const message = store.messages.enqueueMessage({ runId, executionId, roundNum: round, sender: "human",
          recipient: "0_0_0", content: "synthetic billing record", sourceType: "human" });
        store.budgets.reserve({ callId: "call_overrun", runId, pixelId: "0_0_0", executionId,
          messageId: message.messageId, bindingId: binding.bindingId, narrativeRevision: 0, estimatedTokens: 50 });
        store.budgets.settle({ callId: "call_overrun", actualTokens: 51, costCny: null });
        return { round, messagesProcessed: 1, activePixelsCount: 1, stopReason: "NO_ACTIVE_MESSAGES" };
      },
    };
    const service = new RunService({ workspaceRoot: tmpDir, store, scheduler: scheduler as any,
      isMockMode: true, isModelConfigured: true });
    const started = await service.start({ rounds: 1, runBudgetTokens: 50, executionId: execution.executionId,
      onRunCreated: () => { store.executions.transition(execution.executionId, "ready", "running"); } });
    for (let i = 0; service.getStatus().running && i < 20; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(store.executions.get(execution.executionId)).toMatchObject({ status: "blocked", spentTokens: 51, reservedTokens: 0 });
    expect(store.runs.getRun(started.run_id)?.run_spent).toBe(51);
  });

  it("lists Qianji identity separately from physical carrier state and edits by revision", async () => {
    const profile = store.qianji.createProfile();
    store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const list = await app.inject({ method: "GET", url: "/api/qianji?careerStatus=candidate" });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0]).toMatchObject({
      profile: { qianjiId: profile.qianjiId, careerStatus: "candidate" },
      currentBinding: { pixelId: "0_0_0", incarnation: 1 },
      physical: { accountExists: false, active: null, energy: null },
    });

    const narrative = {
      displayName: "新名字",
      title: null,
      roleLabel: null,
      traits: {},
      behaviorProfile: [],
      flaw: null,
      shortBio: null,
      appearanceSpec: null,
      portraitAsset: null,
      contentRevision: "manual-v1",
    };
    const updated = await app.inject({
      method: "PUT",
      url: "/api/qianji/" + profile.qianjiId + "/narrative",
      payload: { expectedRevision: 0, narrative },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().profile).toMatchObject({ qianjiId: profile.qianjiId, narrativeRevision: 1 });
    const stale = await app.inject({
      method: "PUT",
      url: "/api/qianji/" + profile.qianjiId + "/narrative",
      payload: { expectedRevision: 0, narrative: { ...narrative, displayName: "覆盖" } },
    });
    expect(stale.statusCode).toBe(409);
    const unknownField = await app.inject({
      method: "PUT",
      url: "/api/qianji/" + profile.qianjiId + "/narrative",
      payload: { expectedRevision: 1, narrative: { ...narrative, surprise: "field" } },
    });
    expect(unknownField.statusCode).toBe(400);

    store.runs.createRun({
      run_id: "qianji_edit_block", start_round: 1, run_limit: 1000, run_spent: 0, run_reserved: 0,
      global_limit: 1000, global_spent: 0, global_reserved: 0, genesis_revision: 1,
      status: "RUNNING", created_at: Date.now() / 1000,
    });
    const blocked = await app.inject({
      method: "PUT",
      url: "/api/qianji/" + profile.qianjiId + "/narrative",
      payload: { expectedRevision: 1, narrative },
    });
    expect(blocked.statusCode).toBe(409);
    store.runs.updateRunStatus("qianji_edit_block", "STOPPED", "USER_STOPPED");
  });

  it("stores Qianji portraits by content hash and serves only the owned asset", async () => {
    const profile = store.qianji.createProfile();
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/N7sAAAAASUVORK5CYII=", "base64");
    const upload = await app.inject({
      method: "POST",
      url: "/api/qianji/" + profile.qianjiId + "/portrait",
      payload: { mimeType: "image/png", dataBase64: image.toString("base64"), expectedRevision: 0 },
    });
    expect(upload.statusCode).toBe(200);
    expect(upload.json().assetId).toMatch(/^[a-f0-9]{64}\.png$/);
    const assetPath = path.join(tmpDir, "assets", "qianji", profile.qianjiId, upload.json().assetId);
    expect(fs.existsSync(assetPath)).toBe(true);
    const served = await app.inject({ method: "GET", url: "/api/qianji/" + profile.qianjiId + "/portrait" });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(served.rawPayload.equals(image)).toBe(true);

    const other = store.qianji.createProfile();
    const forged = await app.inject({
      method: "PUT",
      url: "/api/qianji/" + other.qianjiId + "/narrative",
      payload: {
        expectedRevision: 0,
        narrative: {
          displayName: "另一角色", title: null, roleLabel: null, traits: {}, behaviorProfile: [],
          flaw: null, shortBio: null, appearanceSpec: null, portraitAsset: upload.json().assetId, contentRevision: null,
        },
      },
    });
    expect(forged.statusCode).toBe(400);

    const wrongMime = await app.inject({
      method: "POST",
      url: "/api/qianji/" + other.qianjiId + "/portrait",
      payload: { mimeType: "image/jpeg", dataBase64: image.toString("base64"), expectedRevision: 0 },
    });
    expect(wrongMime.statusCode).toBe(400);
    expect(fs.readdirSync(path.dirname(assetPath))).toEqual([upload.json().assetId]);
  });

  it("paginates facts and updates neutral world presentation with revision checks", async () => {
    const first = store.qianji.createProfile();
    store.qianji.createProfile();
    const events = await app.inject({ method: "GET", url: "/api/world/events?limit=1&offset=1&qianjiId=" + first.qianjiId });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toMatchObject({ limit: 1, offset: 1, items: [] });
    const allEvents = await app.inject({ method: "GET", url: "/api/world/events?limit=1&offset=1" });
    expect(allEvents.json().items).toHaveLength(1);

    const initial = await app.inject({ method: "GET", url: "/api/world/presentation" });
    expect(initial.json()).toMatchObject({ hallName: "天机阁", revision: 0 });
    const changed = await app.inject({
      method: "PUT",
      url: "/api/world/presentation",
      payload: { expectedRevision: 0, organizationName: "EmergentInc", hallName: "天机阁", eventLabels: { QIANJI_PROFILE_CREATED: "新成员" } },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({ organizationName: "EmergentInc", revision: 1, eventLabels: { QIANJI_PROFILE_CREATED: "新成员" } });
    const executableLabel = await app.inject({
      method: "PUT", url: "/api/world/presentation",
      payload: { expectedRevision: 1, organizationName: "EmergentInc", hallName: "天机阁", eventLabels: { QIANJI_PROFILE_CREATED: "<script>" } },
    });
    expect(executableLabel.statusCode).toBe(400);
    const conflict = await app.inject({
      method: "PUT",
      url: "/api/world/presentation",
      payload: { expectedRevision: 0, organizationName: "Other", hallName: "Other" },
    });
    expect(conflict.statusCode).toBe(409);
  });

  it("returns identity history and server-resolved archived artifacts", async () => {
    const profile = store.qianji.createProfile({ createdAt: 1000 });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1, boundAt: 2000 });
    store.modelCalls.recordModelCall({
      callId: "history_attributed", runId: "r1", pixelId: "0_0_0", bindingId: binding.bindingId,
      narrativeRevision: 0, model: "test", promptTokens: 5, completionTokens: 2,
      cachedTokens: null, actualTokens: 7, costCny: null, outcome: "SUCCESS", createdAt: 2500,
    });
    store.modelCalls.recordModelCall({
      callId: "history_legacy", runId: "r0", pixelId: "0_0_0", model: "test", promptTokens: null,
      completionTokens: null, cachedTokens: null, actualTokens: null, costCny: null, outcome: "SUCCESS", createdAt: 1500,
    });
    const archiveBase = path.join(tmpDir, "live", "history", "0_0_0", "effect_history");
    fs.mkdirSync(path.join(archiveBase, "pixel"), { recursive: true });
    fs.mkdirSync(path.join(archiveBase, "artifacts"), { recursive: true });
    fs.writeFileSync(path.join(archiveBase, "artifacts", "deliverable.txt"), "archived");
    store.qianji.unbindAndRetire(binding.bindingId, "live/history/0_0_0/effect_history/pixel", "test", 3000);

    const response = await app.inject({ method: "GET", url: `/api/qianji/${profile.qianjiId}/history` });
    expect(response.statusCode).toBe(200);
    expect(response.json().attributed.modelCalls.map((item: any) => item.callId)).toEqual(["history_attributed"]);
    expect(response.json().attributed.modelCalls[0].costCny).toBeNull();
    expect(response.json().attributed.carrierLegacy.modelCalls.map((item: any) => item.callId)).toEqual(["history_legacy"]);
    expect(response.json().artifacts.archives[0].files).toMatchObject([{ name: "deliverable.txt", size: 8 }]);
    const artifact = await app.inject({
      method: "GET", url: `/api/qianji/${profile.qianjiId}/history/artifacts/${binding.bindingId}/deliverable.txt`,
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.rawPayload.toString("utf8")).toBe("archived");
  });

  it("reports missing and invalid Mission fields for both create and update", async () => {
    const payload = { missionType: "research", objective: "report", acceptanceCriteria: "readable", budgetTokens: 0,
      roundsLimit: 1, ownerQianjiId: "qj-owner", participants: [{ qianjiId: "qj-owner" }] };
    for (const request of [{ method: "POST", url: "/api/missions" }, { method: "PUT", url: "/api/missions/missing" }] as const) {
      const response = await app.inject({ ...request, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("MISSION_INPUT_INVALID");
      expect(response.json().errors.map((issue: any) => issue.path)).toEqual(["title", "budgetTokens", "participants.0.bindingId"]);
      expect(response.json().detail).toContain("participants.0.bindingId must be a non-blank string");
    }
    expect(store.missions.list()).toEqual([]);
  });

  it("reports which candidate narrative and nested field need correction", async () => {
    const response = await app.inject({ method: "POST", url: "/api/trials/missing/candidates", payload: {
      pixelId: "1_0_0", initialEnergyTokens: 1000, idempotencyKey: "invalid-narrative",
      formalNarrative: { traits: {}, behaviorProfile: [] },
      testNarrative: { displayName: "Test", traits: {}, behaviorProfile: [42] },
    } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("CANDIDATE_NARRATIVE_INVALID");
    expect(response.json().errors).toEqual([
      { path: "formalNarrative.displayName", message: "is required" },
      { path: "testNarrative.behaviorProfile.0", message: "must be a string" },
    ]);
    expect(response.json().detail).toContain("formalNarrative.displayName is required");
    expect(store.qianji.listProfiles()).toEqual([]);
  });

  it("reports candidate request fields missing before narrative validation", async () => {
    const response = await app.inject({ method: "POST", url: "/api/trials/missing/candidates", payload: { pixelId: "1_0_0" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors.map((issue: any) => issue.path)).toEqual([
      "initialEnergyTokens", "idempotencyKey", "formalNarrative", "testNarrative",
    ]);
  });

  it("replays retirement without deactivating a new incarnation at the same coordinate", async () => {
    const profile = store.qianji.createProfile({ careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "1_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "1_0_0", energy: 0, active: false, refundDeficitTokens: 0, spendBlockedReason: null });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const pixelDir = path.join(tmpDir, "live", "pixels", "1_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({ incarnation: 1 }));
    const payload = { reason: "retire old carrier", idempotencyKey: "retire-before-rebirth" };
    const retired = await app.inject({ method: "POST", url: `/api/qianji/${profile.qianjiId}/retire`, payload });
    expect(retired.statusCode).toBe(200);

    const message = store.messages.enqueueMessage({ roundNum: 6, sender: "human", recipient: "0_0_0", content: "reproduce" });
    const runtime = new EffectRuntime({ workspaceRoot: tmpDir, store, toolRuntime: new ToolRuntime(new ToolRegistry()), round: 6, runId: null });
    await runtime.applyEffects(DecisionCompiler.compile({ pixelId: "0_0_0", messageId: message.messageId,
      currentHop: 0, decision: { reproduce: { direction: "1_0_0", initial_energy: 150 } } }));
    const successor = store.qianji.getCurrentBindingByPixel("1_0_0")!;
    expect(successor).toMatchObject({ incarnation: 2 });
    expect(successor.qianjiId).not.toBe(profile.qianjiId);
    const accountBeforeRetry = store.pixels.getPixelAccount("1_0_0");
    expect(accountBeforeRetry).toMatchObject({ active: true, energy: 150 });
    const retry = await app.inject({ method: "POST", url: `/api/qianji/${profile.qianjiId}/retire`, payload });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().binding).toEqual(retired.json().binding);
    expect(retry.json().binding.bindingId).toBe(binding.bindingId);
    expect(store.pixels.getPixelAccount("1_0_0")).toEqual(accountBeforeRetry);
    expect(store.qianji.getCurrentBindingByPixel("1_0_0")).toEqual(successor);
  });

  it("blocks retirement while a mission is open, archives the binding, and rejects retired chat", async () => {
    const profile = store.qianji.createProfile({ careerStatus: "active" });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const pixelDirectory = path.join(tmpDir, "live", "pixels", "0_0_0");
    const artifactDirectory = path.join(tmpDir, "live", "artifacts", "0_0_0");
    fs.mkdirSync(pixelDirectory, { recursive: true }); fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(path.join(pixelDirectory, "pixel.md"), "test identity");
    fs.writeFileSync(path.join(artifactDirectory, "result.txt"), "test artifact");
    const mission = store.missions.createDraft({ title: "Open work", missionType: "test", objective: "Finish it",
      acceptanceCriteria: "Owner review", budgetTokens: 100, roundsLimit: 1, ownerQianjiId: profile.qianjiId,
      participants: [{ qianjiId: profile.qianjiId, bindingId: binding.bindingId, duty: null }] });
    store.missions.transition(mission.missionId, "draft", "issued");

    const payload = { reason: "No longer participating", idempotencyKey: "retire-qianji-once" };
    const blocked = await app.inject({ method: "POST", url: `/api/qianji/${profile.qianjiId}/retire`, payload });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().detail).toBe("QIANJI_HAS_OPEN_MISSION");
    expect(fs.existsSync(pixelDirectory)).toBe(true);

    store.missions.transition(mission.missionId, "issued", "cancelled");
    const retired = await app.inject({ method: "POST", url: `/api/qianji/${profile.qianjiId}/retire`, payload });
    expect(retired.statusCode).toBe(200);
    expect(retired.json().profile.careerStatus).toBe("retired");
    const archive = path.join(tmpDir, "live", "history", binding.bindingId);
    expect(fs.readFileSync(path.join(archive, "pixel", "pixel.md"), "utf8")).toBe("test identity");
    expect(fs.readFileSync(path.join(archive, "artifacts", "result.txt"), "utf8")).toBe("test artifact");
    const retry = await app.inject({ method: "POST", url: `/api/qianji/${profile.qianjiId}/retire`, payload });
    expect(retry.statusCode).toBe(200);
    const chat = await app.inject({ method: "POST", url: `/api/qianji/${profile.qianjiId}/chat`, payload: { content: "Continue work", idempotencyKey: "retired-chat" } });
    expect(chat.statusCode).toBe(409);
    expect(chat.json().detail).toBe("QIANJI_RETIRED");
  });
});
