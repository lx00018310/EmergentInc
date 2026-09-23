import * as path from "node:path";
import * as fs from "node:fs";
import { createServer } from "./app.js";
import { CoreStore } from "@emergentinc/persistence";
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

async function bootstrap() {
  const projectRoot = path.resolve(import.meta.dirname, "../../..");
  const workspaceRoot = path.resolve(projectRoot, "workspace");
  const liveDir = path.resolve(workspaceRoot, "live");
  const runtimeDir = path.resolve(workspaceRoot, "runtime");
  const ledgerDir = path.resolve(workspaceRoot, "ledger");
  const privateDir = path.resolve(workspaceRoot, "private");
  const frontendDistDir = path.resolve(projectRoot, "frontend", "dist");

  // 自动安全加载根目录 .env 环境变量配置 (如果存在)
  const envPath = path.resolve(projectRoot, ".env");
  if (fs.existsSync(envPath)) {
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

  // 5. 创建 Fastify 服务器
  const app = await createServer({
    worldService,
    runService,
    promptService,
    toolRegistry,
    coreStore: store,
    workspaceRoot,
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
  console.log(`[EmergentInc V10 Server] Listening on http://${host}:${port}`);
}

bootstrap().catch((err) => {
  console.error("Fatal error during EmergentInc V10 bootstrap:", err);
  process.exit(1);
});
