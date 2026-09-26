import { afterEach, describe, expect, it } from "vitest";
import { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { ModelProvider, PreparedModelRequest, PromptBuilder, UsageMeter } from "@emergentinc/model";
import { AgentStepRunner, RoundScheduler } from "@emergentinc/runtime";
import { ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "@emergentinc/tools";
import { createServer } from "../src/app.js";
import { WorldService } from "../src/services/world_service.js";
import { RunService } from "../src/services/run_service.js";
import { PromptService } from "../src/services/prompt_service.js";

class ChatProvider implements ModelProvider {
  readonly requests: PreparedModelRequest[] = [];
  async call(request: PreparedModelRequest) {
    this.requests.push(request);
    return {
      rawText: JSON.stringify({ pixel_md: "mind", send_to: "STOP", owner_reply: "我已收到你的问题。" }),
      usage: { promptTokens: 15, completionTokens: 8 },
    };
  }
}

describe("Server: Qianji chat queue and runtime reply", () => {
  let app: FastifyInstance | null = null;
  let store: CoreStore | null = null;
  let runService: RunService | null = null;
  let tempRoot: string | null = null;

  afterEach(async () => {
    if (runService?.getStatus().running) runService.requestStop();
    if (app) await app.close();
    store?.close();
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    app = null; store = null; runService = null; tempRoot = null;
  });

  it("queues idempotently, waits for an explicit Run, and stores the bound reply", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qianji-chat-"));
    fs.mkdirSync(path.join(tempRoot, "live", "pixels", "0_0_0"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "live", "artifacts", "0_0_0"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "runtime"), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, "private"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "live", "world_state.json"), JSON.stringify({ round: 5 }));
    fs.writeFileSync(path.join(tempRoot, "live", "environment.md"), "safe test environment");
    fs.writeFileSync(path.join(tempRoot, "live", "pixels", "0_0_0", "state.json"), JSON.stringify({
      id: "0_0_0", position: [0, 0, 0], active: true, energy: 5000, generation: 0, last_active_round: 5,
    }));
    fs.writeFileSync(path.join(tempRoot, "live", "pixels", "0_0_0", "pixel.md"), "mind");
    fs.writeFileSync(path.join(tempRoot, "live", "pixels", "0_0_0", "tips.md"), "");
    fs.writeFileSync(path.join(tempRoot, "live", "pixels", "0_0_0", "mandate.md"), "");

    store = new CoreStore(":memory:");
    store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 5000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    const profile = store.qianji.createProfile({
      careerStatus: "active",
      narrative: {
        displayName: "求真者", title: "校验师", roleLabel: "研究员", traits: { accuracy: 0.9 },
        behaviorProfile: ["先核验证据"], flaw: null, shortBio: "不可注入 Prompt", appearanceSpec: null,
        portraitAsset: null, contentRevision: null,
      },
    });
    const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1 });
    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    const provider = new ChatProvider();
    const runner = new AgentStepRunner({
      workspaceRoot: tempRoot,
      store,
      provider,
      toolRuntime: new ToolRuntime(registry),
      promptBuilder: new PromptBuilder(),
      usageMeter: new UsageMeter({ models: {} }),
    });
    const scheduler = new RoundScheduler({ workspaceRoot: tempRoot, store, stepRunner: runner });
    const worldService = new WorldService(tempRoot, store);
    runService = new RunService({ workspaceRoot: tempRoot, store, scheduler, isMockMode: true, isModelConfigured: true });
    app = await createServer({
      worldService,
      runService,
      promptService: new PromptService(path.join(tempRoot, "runtime")),
      toolRegistry: registry,
      coreStore: store,
      workspaceRoot: tempRoot,
    });

    const url = `/api/qianji/${profile.qianjiId}/chat`;
    const queued = await app.inject({ method: "POST", url, payload: { content: "请介绍你的工作原则。", idempotencyKey: "chat-1" } });
    expect(queued.statusCode).toBe(202);
    expect(queued.json().status).toBe("queued");
    expect(store.modelCalls.countByRunId("any-run")).toBe(0);
    const message = store.messages.getMessage(queued.json().turn.messageId);
    expect(message).toMatchObject({ status: "QUEUED", recipientBindingId: binding.bindingId, roundNum: 6 });

    const repeated = await app.inject({ method: "POST", url, payload: { content: "请介绍你的工作原则。", idempotencyKey: "chat-1" } });
    expect(repeated.statusCode).toBe(202);
    expect(repeated.json().turn.turnId).toBe(queued.json().turn.turnId);
    const conflict = await app.inject({ method: "POST", url, payload: { content: "不同正文", idempotencyKey: "chat-1" } });
    expect(conflict.statusCode).toBe(409);
    expect(provider.requests).toHaveLength(0);

    await runService.start({ rounds: 1, runBudgetTokens: 5000 });
    for (let i = 0; runService.getStatus().running && i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    expect(runService.getStatus().running).toBe(false);
    expect(provider.requests).toHaveLength(1);
    const prompt = provider.requests[0].messages[1].content;
    expect(prompt.indexOf("=== IDENTITY ===")).toBeLessThan(prompt.indexOf("=== EXTERNAL ==="));
    expect(prompt).toContain("Display name: 求真者");
    expect(prompt).not.toContain("不可注入 Prompt");

    const call = store.modelCalls.getLatestByMessageId(message!.messageId);
    expect(call).toMatchObject({ bindingId: binding.bindingId, narrativeRevision: 0 });
    const history = await app.inject({ method: "GET", url });
    expect(history.statusCode).toBe(200);
    expect(history.json().items[0]).toMatchObject({ status: "replied", reply: "我已收到你的问题。", replyCallId: call!.callId });
    const replyEffects = store.effects.listEffectsByMessage(message!.messageId).filter(effect => effect.effect_type === "OWNER_REPLY");
    expect(replyEffects).toHaveLength(1);
    expect(replyEffects[0].status).toBe("APPLIED");
  });
});
