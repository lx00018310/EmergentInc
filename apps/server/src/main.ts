import * as path from "node:path";
import * as fs from "node:fs";
import { createServer } from "./app.js";
import { CoreStore, BusinessStore } from "@emergentinc/persistence";
import { BusinessService } from "./services/business_service.js";
import { BusinessConnections } from "./services/business_connections.js";
import { runtimeConfig, acquireWorkspaceLock } from "./runtime_config.js";
import { LifeContext, readGenome, generationDirectory } from "./services/life_context.js";
import { DreamService } from "./services/dream_service.js";
import { MemoryGate } from "./services/memory_gate.js";
import { BodyGrowthService } from "./services/body_growth_service.js";
import { BodySkillSupervisor } from "./services/automation_supervisor.js";
import { BodySandboxClient } from "@emergentinc/tools";
import {
  ToolRegistry,
  registerAllBuiltinTools,
  ToolRuntime,
} from "@emergentinc/tools";
import {
  PromptBuilder,
  UsageMeter,
  OpenAICompatibleProvider,
  ModelProvider,
} from "@emergentinc/model";
import { AgentStepRunner, RoundScheduler } from "@emergentinc/runtime";
import { WorldService } from "./services/world_service.js";
import { RunService } from "./services/run_service.js";
import { PromptService } from "./services/prompt_service.js";
import { OwnerChatService } from "./services/owner_chat_service.js";
import { OpenAICompatibleImageProvider } from "./services/gacha_image.js";

async function bootstrap() {
  const projectRoot = path.resolve(import.meta.dirname, "../../..");
  const frontendDistDir = path.resolve(projectRoot, "frontend", "dist");

  // 自动安全加载根目录 .env 环境变量配置 (如果存在)
  const envPath = path.resolve(projectRoot, ".env");
  const candidateMode = process.env.EMERGENTINC_CANDIDATE_MODE === "1";
  if (!candidateMode && fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, "utf-8").split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.substring(0, eqIdx).trim();
          const val = trimmed.substring(eqIdx + 1).trim().replace(/^["'](.*)["']$/, "$1");
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch {}
  }

  const config = runtimeConfig(projectRoot);
  const { workspaceRoot } = config;
  const liveDir = path.resolve(workspaceRoot, "live");
  const runtimeDir = path.resolve(workspaceRoot, "runtime");
  const ledgerDir = path.resolve(workspaceRoot, "ledger");
  const privateDir = path.resolve(workspaceRoot, "private");
  const releaseLock = acquireWorkspaceLock(workspaceRoot, process.env.EMERGENTINC_LOCAL_UPGRADE_TOKEN);
  process.once("exit", releaseLock);

  if (config.mode === "business") {
    const { manifest, geneHash } = readGenome(projectRoot);
    const life = LifeContext.open(workspaceRoot, manifest, geneHash, process.env.EMERGENTINC_RELEASE_ID ?? "v22-initial",
      candidateMode ? undefined : process.env.EMERGENTINC_ACTIVE_GENERATION_FILE);
    const store = life.lineage;
    const model = process.env.MCL_DECISION_MODEL || process.env.MCL_MODEL;
    const apiKey = candidateMode ? undefined : process.env.MCL_API_KEY;
    const pricingFile = path.join(privateDir, "business_model_pricing.json");
    const prices = !candidateMode && fs.existsSync(pricingFile) ? JSON.parse(fs.readFileSync(pricingFile, "utf8")) : { models: {} };
    // Business calls require a named model's explicit currency and price, never a default estimate.
    const service = new BusinessService(store, apiKey && model ? new OpenAICompatibleProvider({
      baseUrl: process.env.MCL_BASE_URL || "https://api.openai.com/v1", apiKey, timeoutMs: 120000,
    }) : undefined, model, model ? prices.models?.[model] : undefined,
      candidateMode ? undefined : new BusinessConnections(store, path.join(privateDir, "business-connections")));
    const lifeModel = candidateMode ? undefined : service.lifeModel.bind(service);
    const runner = !candidateMode && process.env.EMERGENTINC_BODY_SANDBOX_SOCKET ? new BodySandboxClient(process.env.EMERGENTINC_BODY_SANDBOX_SOCKET) : undefined;
    const bodySupervisor = runner ? new BodySkillSupervisor(life.current, store, runner,
      path.join(generationDirectory(workspaceRoot, life.current.meta().generation_id), "body/skills")) : undefined;
    const body = new BodyGrowthService(life, bodySupervisor, lifeModel);
    const dream = new DreamService(life, lifeModel, process.env.EMERGENTINC_DREAM_TIME, process.env.EMERGENTINC_DREAM_TIMEZONE);
    const memoryGate = new MemoryGate(store, () => life.current.meta().generation_id);
    memoryGate.syncConfirmedPayments();
    service.attachLife(life, body);
    let quiesced = candidateMode || process.env.EMERGENTINC_START_PAUSED === "1" || store.generation(life.current.meta().generation_id).state !== "ACTIVE";
    const evolution = { life, body, dream, memoryGate, quiesced: () => quiesced,
      quiesce: async () => { quiesced = true; await body.idle(); await dream.stop(); await service.stop(); },
      resume: async () => {
        if (candidateMode || store.activeGeneration()?.id !== life.current.meta().generation_id) throw new Error("GENERATION_NOT_ACTIVE");
        if (!quiesced) return;
        service.start({ exclusiveWorkspaceLockHeld: true }); dream.start(); quiesced = false;
      } };
    const app = await createServer({ workspaceRoot, frontendDistDir, runtimeMode: "business", businessService: service,
      evolution, ownerAuth: config.ownerAuth, trustLoopbackProxy: config.trustLoopbackProxy, development: process.env.EMERGENT_DEV === "1",
      allowedOrigins: (process.env.EMERGENT_ALLOWED_ORIGINS || "").split(",").filter(Boolean) });
    if (!quiesced) { service.start({ exclusiveWorkspaceLockHeld: true }); dream.start(); }
    app.addHook("onClose", async () => { quiesced = true; await body.idle(); await dream.stop(); await service.stop(); life.close(); releaseLock(); });
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close(); });
    await app.listen({ port: Number(process.env.PORT || 8765), host: config.host });
    console.log(`[EmergentInc] business mode listening on port ${process.env.PORT || 8765}`);
    return;
  }

  // 确保工作区目录存在
  [liveDir, runtimeDir, ledgerDir, privateDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 1. 初始化持久层
  const dbPath = path.resolve(ledgerDir, "v9_core.sqlite3");
  const store = new CoreStore(dbPath);

  // 2. 从单一配置装配工具权限；凭据检查只在实际调用时进行
  const toolRegistry = new ToolRegistry();
  const toolsConfigFile = path.resolve(privateDir, "tools.json");
  let toolsConfig: { tools?: Record<string, { enabled?: boolean; timeout_seconds?: number }> } = {};
  if (fs.existsSync(toolsConfigFile)) {
    try {
      toolsConfig = JSON.parse(fs.readFileSync(toolsConfigFile, "utf-8"));
    } catch (e) {
      console.warn("[EmergentInc V10 Server] Failed to parse private/tools.json, using defaults:", e);
    }
  }
  registerAllBuiltinTools(toolRegistry, toolsConfig.tools);
  const toolRuntime = new ToolRuntime(toolRegistry);

  // 3. 模型与定价装配
  const pricingFile = path.resolve(projectRoot, "resources", "config", "model_pricing.json");
  const pricingConfig = fs.existsSync(pricingFile)
    ? JSON.parse(fs.readFileSync(pricingFile, "utf-8"))
    : { models: {} };
  const usageMeter = new UsageMeter(pricingConfig);

  const isMockMode = process.argv.includes("--mock") || process.env.EMERGENT_MOCK_MODE === "1";
  const baseUrl = process.env.MCL_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.MCL_API_KEY || "";
  const modelName = process.env.MCL_DECISION_MODEL || process.env.MCL_MODEL || "gpt-4o-mini";
  const isModelConfigured = Boolean(apiKey && apiKey !== "mock-key" && !apiKey.includes("CONFIGURE_ME"));

  let provider: ModelProvider;
  if (isModelConfigured) {
    const maskedKey = apiKey.length > 8 ? `${apiKey.substring(0, 6)}...${apiKey.slice(-4)}` : "***";
    console.log(`[EmergentInc V10 Server] Model provider configured: model=${modelName}, baseUrl=${baseUrl}, apiKey=${maskedKey}`);
    provider = new OpenAICompatibleProvider({ baseUrl, apiKey });
  } else if (isMockMode) {
    console.warn("[EmergentInc V10 Server] RUNNING IN EXPLICIT --mock SANDBOX MODE");
    provider = {
      async call(req) {
        return {
          rawText: JSON.stringify({
            message_md: "[MOCK_SANDBOX] V10 Small Runtime is running in explicit mock mode.",
            send_to: "STOP",
          }),
          usage: { promptTokens: 50, completionTokens: 20 },
        };
      },
    };
  } else {
    console.warn("[EmergentInc V10 Server] No valid MCL_API_KEY found in .env or environment. Engine runs in guarded mode (Run requests will be blocked).");
    provider = {
      async call(req) {
        throw new Error(
          "MODEL_NOT_CONFIGURED: Valid MCL_API_KEY is not configured. Set environment variable or start server with --mock for sandbox testing."
        );
      },
    };
  }

  // 4. 读取基础系统提示词与生成工具目录
  const systemPromptPath = path.resolve(projectRoot, "resources", "prompts", "v9_system_prompt.md");
  const baseSystemPrompt = fs.existsSync(systemPromptPath)
    ? fs.readFileSync(systemPromptPath, "utf-8")
    : undefined;
  const toolsCatalog = toolRegistry.renderCatalogForPrompt();

  const promptBuilder = new PromptBuilder({
    baseSystemPrompt,
    toolsCatalog,
    modelName,
  });

  const stepRunner = new AgentStepRunner({
    workspaceRoot,
    store,
    provider,
    toolRuntime,
    promptBuilder,
    usageMeter,
  });

  const scheduler = new RoundScheduler({
    workspaceRoot,
    store,
    stepRunner,
  });

  // 5. 初始化应用服务
  const promptService = new PromptService(runtimeDir);
  const worldService = new WorldService(workspaceRoot, store);
  const runService = new RunService({
    workspaceRoot,
    store,
    scheduler,
    promptService,
    isMockMode,
    isModelConfigured,
  });
  const ownerChatService = new OwnerChatService({
    projectRoot, workspaceRoot, store, worldService, runService,
    provider: isModelConfigured
      ? new OpenAICompatibleProvider({ baseUrl, apiKey, timeoutMs: 60 * 60 * 1000 })
      : provider,
    usageMeter, modelName, isModelConfigured,
  });

  const imageModel = process.env.GACHA_IMAGE_MODEL;
  const imageKey = process.env.GACHA_IMAGE_API_KEY;
  const imageProvider = imageModel && imageKey
    ? new OpenAICompatibleImageProvider(imageModel, process.env.GACHA_IMAGE_BASE_URL || "https://api.openai.com/v1", imageKey)
    : undefined;

  // 5. 创建 Fastify 服务器
  const app = await createServer({
    ownerAuth: config.ownerAuth,
    trustLoopbackProxy: config.trustLoopbackProxy,
    runtimeMode: "legacy",
    worldService,
    runService,
    promptService,
    toolRegistry,
    coreStore: store,
    workspaceRoot,
    ownerChatService,
    gachaProvider: isModelConfigured
      ? new OpenAICompatibleProvider({ baseUrl, apiKey, timeoutMs: 10 * 60 * 1000 })
      : undefined,
    gachaUsageMeter: usageMeter,
    gachaModelName: modelName,
    gachaImageProvider: imageProvider,
    frontendDistDir,
    development: process.env.EMERGENT_DEV === "1",
    allowedOrigins: (process.env.EMERGENT_ALLOWED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const port = Number(process.env.PORT || 8765);
  const host = process.env.HOST || "127.0.0.1";

  await app.listen({ port, host });
  app.addHook("onClose", async () => { store.db.close(); releaseLock(); });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close(); });
  console.log(`[EmergentInc V10 Server] Listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal error during EmergentInc V10 bootstrap:", err);
  process.exit(1);
});
