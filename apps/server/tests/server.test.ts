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
    runService = new RunService(store, scheduler);
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
    expect(tools).toHaveLength(12);
    expect(tools.map((t: any) => t.name)).toContain("save_artifact");
    expect(tools.map((t: any) => t.name)).toContain("vps_exec");
  });

  it("should return standard 404 with detail for unknown route", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/unknown-endpoint",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().detail).toBeDefined();
  });
});
