import * as path from "node:path";
import * as fs from "node:fs";
import { createServer } from "./app.js";
import { CoreStore } from "@emergentinc/persistence";
import { ToolRegistry, registerAllBuiltinTools, ToolRuntime } from "@emergentinc/tools";
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

  // 确保工作区目录存在
  [liveDir, runtimeDir, ledgerDir, privateDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  // 1. 初始化持久层
  const dbPath = path.resolve(ledgerDir, "v9_core.sqlite3");
  const store = new CoreStore(dbPath);

  // 2. 初始化工具
  const toolRegistry = new ToolRegistry();
  registerAllBuiltinTools(toolRegistry);
  const toolRuntime = new ToolRuntime(toolRegistry);

  // 3. 模型与定价装配
  const pricingFile = path.resolve(projectRoot, "resources", "config", "model_pricing.json");
  const pricingConfig = fs.existsSync(pricingFile)
    ? JSON.parse(fs.readFileSync(pricingFile, "utf-8"))
    : { models: {} };
  const usageMeter = new UsageMeter(pricingConfig);

  const baseUrl = process.env.MCL_BASE_URL || "https://api.openai.com/v1";
  const apiKey = process.env.MCL_API_KEY || "mock-key";
  const modelName = process.env.MCL_DECISION_MODEL || process.env.MCL_MODEL || "gpt-4o-mini";

  let provider: ModelProvider;
  if (apiKey !== "mock-key" && !baseUrl.includes("CONFIGURE_ME")) {
    provider = new OpenAICompatibleProvider({ baseUrl, apiKey });
  } else {
    // 离线/开发安全 Mock
    provider = {
      async call(req) {
        return {
          rawText: JSON.stringify({
            message_md: "V10 Small Runtime is running safely in offline mode.",
            send_to: "STOP",
          }),
          usage: { promptTokens: 50, completionTokens: 20 },
        };
      },
    };
  }

  const promptBuilder = new PromptBuilder({ modelName });
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

  // 4. 初始化应用服务
  const worldService = new WorldService(workspaceRoot, store);
  const runService = new RunService(store, scheduler);
  const promptService = new PromptService(runtimeDir);

  // 5. 创建 Fastify 服务器
  const app = await createServer({
    worldService,
    runService,
    promptService,
    toolRegistry,
    coreStore: store,
    workspaceRoot,
    frontendDistDir,
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
