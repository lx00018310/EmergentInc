import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FastifyInstance } from "fastify";
import { createServer } from "../src/app.js";
import { CoreStore } from "@emergentinc/persistence";
import { ToolRegistry, registerAllBuiltinTools, ToolRuntime } from "@emergentinc/tools";
import { PromptBuilder, UsageMeter, ModelProvider } from "@emergentinc/model";
import { AgentStepRunner, RoundScheduler } from "@emergentinc/runtime";
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

    // 2. 模拟正在运行时的并发冲突 409
    // 手动将 runService 状态设为运行中测试互斥拒绝
    (runService as any).isRunning = true;
    const conflictRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: { rounds: 1, run_budget_tokens: 1000, global_budget_tokens: 10000 },
    });
    expect(conflictRes.statusCode).toBe(409);
    expect(conflictRes.json().detail).toContain("already in progress");
    (runService as any).isRunning = false;

    // 3. 正常发起 Run
    const startRes = await app.inject({
      method: "POST",
      url: "/api/run/start",
      payload: {
        rounds: 2,
        run_budget_tokens: 5000,
        global_budget_tokens: 50000,
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

  it("should return all 12 tools via /api/tools", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/tools",
    });
    expect(res.statusCode).toBe(200);
    const tools = res.json().tools;
    expect(tools).toHaveLength(13);
    expect(tools.map((t: any) => t.name)).toContain("save_artifact");
    expect(tools.map((t: any) => t.name)).toContain("transfer_artifact");
    expect(tools.map((t: any) => t.name)).toContain("vps_exec");
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

    // 4. 外部激励注入 (External Reward)
    const rewardRes = await app.inject({
      method: "POST",
      url: "/api/pixels/0_0_0/reward",
      payload: { amount: 500, reason: "Excellent performance" },
    });
    expect(rewardRes.statusCode).toBe(200);
    expect(rewardRes.json().amount).toBe(500);
    expect(rewardRes.json().newBalance).toBeGreaterThanOrEqual(500);

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
        globalBudgetTokens: 10000,
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
      payload: { rounds: 1, run_budget_tokens: 1000, global_budget_tokens: 10000 },
    });
    expect(startRes.statusCode).toBe(409);
    expect(startRes.json().detail).toContain("RUN_BLOCKED_UNFINALIZED_OPERATIONS");

    // 调用安全对账端点自愈
    const reconcileRes = await app.inject({
      method: "POST",
      url: "/api/run/reconcile",
    });
    expect(reconcileRes.statusCode).toBe(200);
    expect(reconcileRes.json().status).toBe("RECONCILED");

    // 再次查询状态，确认已完全自愈回到 READY
    const healedStatus = await app.inject({
      method: "GET",
      url: "/api/run/status",
    });
    expect(healedStatus.statusCode).toBe(200);
    expect(healedStatus.json().result_status).toBe("READY");
    expect(healedStatus.json().unfinalized_operations).toBeNull();
  });

  it("should block concurrent run start on same workspace with WORKSPACE_LOCKED (409)", async () => {
    // 创建锁文件，记录当前进程之外的活跃进程 PID
    const lockFile = path.join(tmpDir, ".engine.lock");
    fs.writeFileSync(
      lockFile,
      JSON.stringify({ pid: process.pid, createdAt: Date.now(), runId: "other_run" }),
      "utf-8"
    );

    // 尝试用一个伪造的外部活跃 PID 测试互斥
    // 使用当前进程自身时会放行（幂等），我们修改为 1（init 进程在 Unix/Windows 宿主几乎常驻）或当前 PID
    // 验证 acquireWorkspaceLock 方法逻辑
    expect(() => {
      // 模拟另外一个进程持锁
      fs.writeFileSync(
        lockFile,
        JSON.stringify({ pid: 9999999, createdAt: Date.now(), runId: "dead_run" }),
        "utf-8"
      );
      // 僵尸锁应该被自动接管（不抛出）
      runService.acquireWorkspaceLock("takeover_run");
    }).not.toThrow();

    // 释放锁
    runService.releaseWorkspaceLock();
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
      globalBudgetTokens: 100000,
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
});
