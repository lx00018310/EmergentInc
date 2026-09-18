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

describe("Server rectification: containment, CORS, control plane, reward idempotency", () => {
  let app: FastifyInstance;
  let tmpDir: string;
  let store: CoreStore;
  let runService: RunService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "server_rectify_"));
    const liveDir = path.join(tmpDir, "live");
    const runtimeDir = path.join(tmpDir, "runtime");
    const privDir = path.join(tmpDir, "private");
    fs.mkdirSync(liveDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.mkdirSync(privDir, { recursive: true });
    fs.writeFileSync(path.join(liveDir, "world_state.json"), JSON.stringify({ round: 3 }), "utf-8");
    fs.writeFileSync(path.join(liveDir, "environment.md"), "env", "utf-8");

    const pixelDir = path.join(liveDir, "pixels", "0_0_0");
    fs.mkdirSync(pixelDir, { recursive: true });
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({ id: "0_0_0", energy: 10 }), "utf-8");

    store = new CoreStore(":memory:");
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 10, active: true, refundDeficitTokens: 0, spendBlockedReason: null });

    const toolRegistry = new ToolRegistry();
    registerAllBuiltinTools(toolRegistry);
    const toolRuntime = new ToolRuntime(toolRegistry);
    const stepRunner = new AgentStepRunner({
      workspaceRoot: tmpDir,
      store,
      provider: new MockProvider(),
      toolRuntime,
      promptBuilder: new PromptBuilder(),
      usageMeter: new UsageMeter({ models: {} }),
    });
    const scheduler = new RoundScheduler({ workspaceRoot: tmpDir, store, stepRunner });
    const worldService = new WorldService(tmpDir, store);
    runService = new RunService({ workspaceRoot: tmpDir, store, scheduler, isMockMode: true, isModelConfigured: true });

    app = await createServer({
      worldService,
      runService,
      promptService: new PromptService(runtimeDir),
      toolRegistry,
      coreStore: store,
      workspaceRoot: tmpDir,
    });
  });

  afterEach(async () => {
    await app.close();
    store.close();
  });

  it("same-origin requests are served without CORS headers", async () => {
    const res = await app.inject({ method: "GET", url: "/api/world" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects cross-origin requests for reads and writes", async () => {
    const read = await app.inject({ method: "GET", url: "/api/world", headers: { origin: "http://evil.example" } });
    expect(read.statusCode).toBe(403);
    const write = await app.inject({ method: "POST", url: "/api/run/start", headers: { origin: "http://evil.example" }, payload: { rounds: 1 } });
    expect(write.statusCode).toBe(403);
  });

  it("allows explicitly allowlisted origins only in development mode", async () => {
    const runtimeDir = path.join(tmpDir, "runtime");
    const devApp = await createServer({
      worldService: new WorldService(tmpDir, store),
      runService,
      promptService: new PromptService(runtimeDir),
      toolRegistry: new ToolRegistry(),
      coreStore: store,
      workspaceRoot: tmpDir,
      development: true,
      allowedOrigins: ["http://localhost:5173"],
    });
    const allowed = await devApp.inject({ method: "GET", url: "/api/world", headers: { origin: "http://localhost:5173" } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const denied = await devApp.inject({ method: "GET", url: "/api/world", headers: { origin: "http://evil.example" } });
    expect(denied.statusCode).toBe(403);
    await devApp.close();
  });

  it("serves only allowlisted pixel documents for existing pixels", async () => {
    const ok = await app.inject({ method: "GET", url: "/api/pixels/0_0_0/document/state" });
    expect(ok.statusCode).toBe(200);
    const missing = await app.inject({ method: "GET", url: "/api/pixels/9_9_9/document/state" });
    expect(missing.statusCode).toBe(404);
    const forbidden = await app.inject({ method: "GET", url: "/api/pixels/0_0_0/document/other.md" });
    expect(forbidden.statusCode).toBe(403);
  });

  it("control-plane rounds do not enqueue agent messages", async () => {
    await app.inject({ method: "POST", url: "/api/run/start", payload: { rounds: 1, run_budget_tokens: 1000, global_budget_tokens: 10000, command: "跑1轮" } });
    await new Promise((r) => setTimeout(r, 50));
    const messages = store.messages.listRecentMessages(50);
    expect(messages.filter((m: any) => m.sender === "human")).toHaveLength(0);
  });

  it("external reward requires an idempotency key and replays the same key once", async () => {
    const missing = await app.inject({ method: "POST", url: "/api/pixels/0_0_0/reward", payload: { amount: 5 } });
    expect(missing.statusCode).toBe(400);

    const key = `test-${Date.now()}`;
    const first = await app.inject({ method: "POST", url: "/api/pixels/0_0_0/reward", payload: { amount: 5, idempotency_key: key } });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/api/pixels/0_0_0/reward", payload: { amount: 5, idempotency_key: key } });
    expect(replay.statusCode).toBe(200);
    const rewards = (await app.inject({ method: "GET", url: "/api/pixels/0_0_0/rewards" })).json().rewards;
    expect(rewards.filter((r: any) => r.amount === 5)).toHaveLength(1);
  });

  it("recovery resolve requires kind, decision and reason", async () => {
    const res = await app.inject({ method: "POST", url: "/api/run/recovery/resolve", payload: { kind: "model", id: "x", decision: "abandon" } });
    expect(res.statusCode).toBe(400);
  });

  it("world total cost is unknown until a real ledger summary exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/world" });
    expect([null, 0]).toContain(res.json().metrics.total_spent_cny);
  });
});
