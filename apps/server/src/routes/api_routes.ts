import { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { WorldService } from "../services/world_service.js";
import { RunService } from "../services/run_service.js";
import { PromptService } from "../services/prompt_service.js";
import { containedPath, validatePathSegment } from "../services/safe_path.js";
import { ToolRegistry } from "@emergentinc/tools";
import { CoreStore } from "@emergentinc/persistence";
import { OwnerChatService } from "../services/owner_chat_service.js";

export interface ApiRoutesOptions {
  worldService: WorldService;
  runService: RunService;
  promptService: PromptService;
  toolRegistry: ToolRegistry;
  coreStore: CoreStore;
  workspaceRoot: string;
  ownerChatService?: OwnerChatService;
}

export async function registerApiRoutes(
  server: FastifyInstance,
  options: ApiRoutesOptions
): Promise<void> {
  const {
    worldService,
    runService,
    promptService,
    toolRegistry,
    coreStore,
    workspaceRoot,
    ownerChatService,
  } = options;

  server.addHook("preHandler", async (req, reply) => {
    const pixelId = (req.params as any)?.pixel_id;
    if (pixelId !== undefined) {
      validatePathSegment(String(pixelId));
      if (!worldService.getPixel(String(pixelId))) {
        return reply.status(404).send({ detail: "Pixel not found" });
      }
    }
  });

  // 1. World
  server.get("/world", async (_req, reply) => {
    return reply.send(worldService.getWorldDto());
  });

  server.post("/owner/chat", async (req, reply) => {
    if (!ownerChatService) return reply.status(503).send({ detail: "老板窗口未配置模型服务。" });
    const body = (req.body ?? {}) as { question?: unknown; history?: unknown };
    if (typeof body.question !== "string" || !body.question.trim() || body.question.length > 2000 ||
        (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 12 ||
          body.history.some((t: any) => !t || !["user", "assistant"].includes(t.role) || typeof t.content !== "string" || t.content.length > 4000)))) {
      return reply.status(400).send({ detail: "问题或对话历史格式无效。" });
    }
    try {
      return reply.send(await ownerChatService.ask(body.question, body.history as any[] | undefined));
    } catch (err: any) {
      const code = err.message?.includes("需要配置真实模型") ? 503 : 502;
      return reply.status(code).send({ detail: err.message || "老板窗口回答失败。" });
    }
  });

  // 2. Run
  server.get("/run/status", async (_req, reply) => {
    return reply.send(runService.getStatus());
  });

  server.post("/run/start", async (req, reply) => {
    const body: any = req.body || {};
    const rounds = Number(body.rounds ?? 1);
    const runBudgetTokens = Number(body.run_budget_tokens ?? 1000000);

    try {
      const res = await runService.start({
        rounds,
        runBudgetTokens,
      });
      return reply.send(res);
    } catch (err: any) {
      const isConflict =
        err.message?.startsWith("RUN_BLOCKED_UNFINALIZED_OPERATIONS");
      return reply.status(isConflict ? 409 : 400).send({ detail: err.message });
    }
  });

  server.post("/run/stop", async (_req, reply) => {
    return reply.send(runService.requestStop());
  });

  server.post("/run/reconcile", async (_req, reply) => {
    try {
      return reply.send(runService.reconcile());
    } catch (err: any) {
      return reply.status(400).send({ detail: err.message });
    }
  });

  server.post("/run/recovery/resolve", async (req, reply) => {
    const body: any = req.body || {};
    if (runService.getStatus().running) return reply.status(409).send({ detail: "Run in progress" });
    if (!["model", "tool", "run", "message"].includes(body.kind) || typeof body.id !== "string" || !body.id ||
        !["confirm_not_billed", "settle_billed", "settle_reserved", "abandon", "acknowledge"].includes(body.decision)) {
      return reply.status(400).send({ detail: "Operation and explicit decision are required" });
    }
    const safeReason = (typeof body.reason === "string" && body.reason.trim())
      ? body.reason.trim()
      : (body.decision === "abandon" ? "操作人审批拒绝 (abandon)" : "操作人审批通过 (approved)");
    const payload = { ...body, reason: safeReason };
    try {
      return reply.send((coreStore as any).resolveRecoveryOperation(payload));
    } catch (err: any) {
      return reply.status(400).send({ detail: err.message });
    }
  });

  // 3. Environment
  server.get("/environment", async (_req, reply) => {
    return reply.send(worldService.getEnvironment());
  });

  server.post("/environment", async (req, reply) => {
    const body: any = req.body || {};
    const content = String(body.content || "");
    return reply.send(worldService.updateEnvironment(content));
  });

  // 4. Pixels
  server.get("/pixels/:pixel_id", async (req, reply) => {
    const params: any = req.params;
    const pixel = worldService.getPixel(params.pixel_id);
    if (!pixel) {
      return reply.status(404).send({ detail: "Pixel not found" });
    }
    return reply.send(pixel);
  });

  server.get("/pixels/:pixel_id/document/:doc_name", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    const docName = String(params.doc_name || "");

    let pixelDir: string;
    try {
      pixelDir = containedPath(workspaceRoot, "live", "pixels", pixelId);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ detail: "Invalid pixel_id" });
    }
    validatePathSegment(docName);
    if (!fs.existsSync(pixelDir)) {
      return reply.status(404).send({ detail: `Pixel '${pixelId}' not found` });
    }

    // 1. pixel.md 别名与全名支持
    if (docName === "pixel" || docName === "pixel.md") {
      const docPath = containedPath(pixelDir, "pixel.md");
      if (!fs.existsSync(docPath)) {
        return reply.status(404).send({ detail: "Document not found" });
      }
      return reply.send({
        pixel_id: pixelId,
        document: "pixel.md",
        content: fs.readFileSync(docPath, "utf-8"),
      });
    }

    // 2. state.json 别名与全名支持 (融合权威账户状态，避免旧磁盘数据)
    if (docName === "state" || docName === "state.json") {
      const pixel = worldService.getPixel(pixelId);
      if (!pixel) {
        return reply.status(404).send({ detail: "Document not found" });
      }
      const stateFile = containedPath(pixelDir, "state.json");
      let diskState: any = {};
      if (fs.existsSync(stateFile)) {
        try {
          diskState = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
        } catch {}
      }
      const authoritativeState = {
        ...diskState,
        ...pixel.state,
      };
      return reply.send({
        pixel_id: pixelId,
        document: "state.json",
        content: JSON.stringify(authoritativeState, null, 2),
      });
    }

    // 3. environment.md 别名与全名支持 (读取权威全局环境)
    if (docName === "environment" || docName === "environment.md") {
      const env = worldService.getEnvironment();
      return reply.send({
        pixel_id: pixelId,
        document: "environment.md",
        content: env.content,
      });
    }

    // 4. mandate.md 别名与全名支持 (Human Mandate 独立外部输入)
    if (docName === "mandate" || docName === "mandate.md") {
      const mandatePath = containedPath(pixelDir, "mandate.md");
      return reply.send({
        pixel_id: pixelId,
        document: "mandate.md",
        content: fs.existsSync(mandatePath) ? fs.readFileSync(mandatePath, "utf-8") : "",
      });
    }

    // 5. tips.md 别名与全名支持 (Pixel 公开提醒)
    if (docName === "tips" || docName === "tips.md") {
      const tipsPath = containedPath(pixelDir, "tips.md");
      return reply.send({
        pixel_id: pixelId,
        document: "tips.md",
        content: fs.existsSync(tipsPath) ? fs.readFileSync(tipsPath, "utf-8") : "",
      });
    }

    // 非法/未授权文档拒绝
    return reply.status(403).send({ detail: `Document '${docName}' is not in the allowlist` });
  });

  server.get("/pixels/:pixel_id/mandate", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    let mandatePath: string;
    try {
      mandatePath = containedPath(workspaceRoot, "live", "pixels", pixelId, "mandate.md");
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ detail: "Invalid pixel_id" });
    }
    if (!fs.existsSync(mandatePath)) {
      return reply.send({ pixel_id: pixelId, mandate: null });
    }
    return reply.send({
      pixel_id: pixelId,
      mandate: fs.readFileSync(mandatePath, "utf-8"),
    });
  });

  server.put("/pixels/:pixel_id/mandate", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    let pixelDir: string;
    try {
      pixelDir = containedPath(workspaceRoot, "live", "pixels", pixelId);
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ detail: "Invalid pixel_id" });
    }
    if (!fs.existsSync(pixelDir)) {
      return reply.status(404).send({ detail: `Pixel '${pixelId}' not found` });
    }
    const body: any = req.body || {};
    const content = String(body.mandate ?? body.content ?? "");
    const mandatePath = containedPath(pixelDir, "mandate.md");
    // 独立 External Input：绝对禁止修改 pixel.md，仅写入 mandate.md
    fs.writeFileSync(mandatePath, content, "utf-8");
    return reply.send({
      pixel_id: pixelId,
      mandate: content,
    });
  });

  server.delete("/pixels/:pixel_id/mandate", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    if (pixelId.includes("..") || pixelId.includes("/") || pixelId.includes("\\")) {
      return reply.status(400).send({ detail: "Invalid pixel_id" });
    }
    const mandatePath = containedPath(workspaceRoot, "live", "pixels", pixelId, "mandate.md");
    if (fs.existsSync(mandatePath)) {
      fs.unlinkSync(mandatePath);
    }
    return reply.send({
      pixel_id: pixelId,
      status: "DELETED",
    });
  });

  server.post("/pixels/:pixel_id/reward", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    if (pixelId.includes("..") || pixelId.includes("/") || pixelId.includes("\\")) {
      return reply.status(400).send({ detail: "Invalid pixel_id" });
    }
    const pixel = worldService.getPixel(pixelId);
    if (!pixel) {
      return reply.status(404).send({ detail: `Pixel '${pixelId}' not found` });
    }
    const body: any = req.body || {};
    const amount = Number(body.amount);
    if (!amount || amount <= 0 || !Number.isSafeInteger(amount)) {
      return reply.status(400).send({ detail: "Amount must be a positive integer" });
    }
    if (typeof body.idempotency_key !== "string" || !body.idempotency_key.trim() || body.idempotency_key.length > 200) {
      return reply.status(400).send({ detail: "idempotency_key is required (1-200 characters)" });
    }
    const currentRound = runService.getWorldRound();
    const result = coreStore.applyExternalReward({
      pixelId,
      idempotencyKey: body.idempotency_key,
      amount,
      round: currentRound,
      source: String(body.source || "human"),
      reason: String(body.reason || "External Reward"),
    });

    const statePath = containedPath(workspaceRoot, "live", "pixels", pixelId, "state.json");
    if (fs.existsSync(statePath)) {
      try {
        const stateObj = JSON.parse(fs.readFileSync(statePath, "utf-8"));
        stateObj.energy = result.newBalance;
        stateObj.active = coreStore.pixels.getPixelAccount(pixelId)?.active ?? stateObj.active;
        fs.writeFileSync(statePath, JSON.stringify(stateObj, null, 2), "utf-8");
      } catch {}
    }

    return reply.send(result);
  });

  // Rewards / Step Costs 观察 (V11)
  server.get("/pixels/:pixel_id/rewards", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    if (pixelId.includes("..") || pixelId.includes("/") || pixelId.includes("\\")) {
      return reply.status(400).send({ detail: "Invalid pixel_id" });
    }
    const entries = coreStore.ledger.listEntriesByPixel(pixelId).filter((e) => e.entry_type === "external_reward");
    const rewards = entries.map((e) => {
      let details: any = {};
      try { details = JSON.parse(e.details || "{}"); } catch {}
      return {
        event_id: e.entry_id,
        pixel_id: e.pixel_id,
        round: Number(details.round ?? 0),
        amount: Number(e.amount),
        source: String(details.source ?? "human"),
        reason: String(details.reason ?? ""),
        created_at: Number(e.timestamp),
      };
    });
    return reply.send({ rewards });
  });

  server.get("/pixels/:pixel_id/step-costs", async (req, reply) => {
    const params: any = req.params;
    const pixelId = String(params.pixel_id || "");
    if (pixelId.includes("..") || pixelId.includes("/") || pixelId.includes("\\")) {
      return reply.status(400).send({ detail: "Invalid pixel_id" });
    }
    const costs = coreStore.modelCalls.getPixelStepCosts(pixelId);
    return reply.send({ costs });
  });

  // 5. Artifacts
  server.get("/pixels/:pixel_id/artifacts", async (req, reply) => {
    const params: any = req.params;
    const dir = containedPath(workspaceRoot, "live", "artifacts", params.pixel_id);
    if (!fs.existsSync(dir)) {
      return reply.send({ pixel_id: params.pixel_id, artifacts: [] });
    }
    const files = fs.readdirSync(dir);
    const items = files.map((file) => {
      const stat = fs.statSync(containedPath(dir, file));
      return {
        filename: file,
        size_bytes: stat.size,
        updated_at: stat.mtimeMs / 1000,
      };
    });
    return reply.send({ pixel_id: params.pixel_id, artifacts: items });
  });

  server.get("/pixels/:pixel_id/artifacts/:filename", async (req, reply) => {
    const params: any = req.params;
    try {
      const filePath = worldService.getPixelArtifactPath(params.pixel_id, params.filename);
      const content = fs.readFileSync(filePath, "utf-8");
      return reply.send({
        pixel_id: params.pixel_id,
        filename: params.filename,
        content,
      });
    } catch (err: any) {
      return reply.status(404).send({ detail: err.message });
    }
  });

  server.get("/pixels/:pixel_id/artifacts/:filename/download", async (req, reply) => {
    const params: any = req.params;
    try {
      const filePath = worldService.getPixelArtifactPath(params.pixel_id, params.filename);
      const buffer = fs.readFileSync(filePath);
      reply.header("Content-Disposition", `attachment; filename="${params.filename}"`);
      reply.header("Content-Type", "application/octet-stream");
      return reply.send(buffer);
    } catch (err: any) {
      return reply.status(404).send({ detail: err.message });
    }
  });

  // 6. Prompts
  server.get("/genesis-prompt", async (_req, reply) => {
    return reply.send(promptService.getPrompt("genesis_prompt.json"));
  });

  server.put("/genesis-prompt", async (req, reply) => {
    if (runService.getStatus().running) {
      return reply.status(409).send({ detail: "Cannot update genesis prompt while run is in progress." });
    }
    const body: any = req.body || {};
    if (typeof body.content !== "string") {
      return reply.status(422).send({ detail: "Genesis prompt content must be a string." });
    }
    try {
      return reply.send(promptService.updatePrompt("genesis_prompt.json", body.content));
    } catch (err: any) {
      return reply.status(400).send({ detail: err.message });
    }
  });

  server.get("/temporary-prompt", async (_req, reply) => {
    return reply.send(promptService.getPrompt("temporary_prompt.json"));
  });

  server.put("/temporary-prompt", async (req, reply) => {
    if (runService.getStatus().running) {
      return reply.status(409).send({ detail: "Cannot update temporary prompt while run is in progress." });
    }
    const body: any = req.body || {};
    if (typeof body.content !== "string") {
      return reply.status(422).send({ detail: "Temporary prompt content must be a string." });
    }
    try {
      return reply.send(promptService.updatePrompt("temporary_prompt.json", body.content));
    } catch (err: any) {
      return reply.status(400).send({ detail: err.message });
    }
  });

  // 7. Tools
  server.get("/tools", async (_req, reply) => {
    return reply.send({
      tools: toolRegistry.listDefinitions().map((def) => ({
        name: def.name,
        description: def.description,
        effect: def.effect,
        enabled: def.enabled,
        timeout_seconds: def.timeout_seconds,
        input_schema: def.input_schema,
      })),
    });
  });

  server.get("/tool-executions", async (req, reply) => {
    const query: any = req.query || {};
    const limit = Math.min(Math.max(Number(query.limit ?? 50), 1), 200);

    let sql = "SELECT * FROM tool_executions";
    const conditions: string[] = [];
    const params: any[] = [];

    if (query.run_id) {
      conditions.push("run_id = ?");
      params.push(query.run_id);
    }
    if (query.pixel_id) {
      conditions.push("pixel_id = ?");
      params.push(query.pixel_id);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }
    sql += " ORDER BY started_at DESC LIMIT ?";
    params.push(limit);

    const stmt = coreStore.db.prepare(sql);
    const rows = stmt.all(...params);
    return reply.send({ executions: rows });
  });

  // 8. Private Files
  server.get("/private-files", async (req, reply) => {
    const query: any = req.query || {};
    const subPath = String(query.path || "").trim();
    const privDir = path.resolve(workspaceRoot, "private");
    const targetDir = containedPath(privDir, ...(subPath ? subPath.split("/") : []));

    
    if (!fs.existsSync(targetDir)) {
      return reply.status(404).send({ detail: "Directory not found" });
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = entries.map((ent) => {
      const full = containedPath(targetDir, ent.name);
      const isDir = ent.isDirectory();
      const stat = fs.statSync(full);
      return {
        name: ent.name,
        type: isDir ? "directory" : "file",
        size_bytes: isDir ? 0 : stat.size,
        path: path.relative(privDir, full).replace(/\\/g, "/"),
        is_sensitive: ["owner_vps_profile.json", "known_hosts"].includes(ent.name),
      };
    });

    return reply.send({ files: items, base_path: subPath });
  });

  server.get("/private-files/preview", async (req, reply) => {
    const query: any = req.query || {};
    const subPath = String(query.path || "").trim();
    const privDir = path.resolve(workspaceRoot, "private");
    const target = containedPath(privDir, ...subPath.split("/"));

    
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return reply.status(404).send({ detail: "File not found" });
    }
    if (["owner_vps_profile.json", "known_hosts"].includes(path.basename(target))) {
      return reply.status(403).send({ detail: "Access to credentials forbidden" });
    }

    const ext = path.extname(target).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext)) {
      return reply.status(400).send({ detail: "Preview only supported for images" });
    }

    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".bmp": "image/bmp",
    };
    reply.header("Content-Type", mimeMap[ext] || "application/octet-stream");
    return reply.send(fs.readFileSync(target));
  });

  // 9. 兼容只读接口
  server.get("/loops", async (_req, reply) => {
    return reply.send({ loops: [], branches: [], manifest: {} });
  });

  server.get("/owner/requests", async (_req, reply) => {
    return reply.send([]);
  });

  server.get("/audit/workspace", async (_req, reply) => {
    const status = runService.getStatus();
    if (status.running) {
      return reply.send({
        audit_status: "DEFERRED_RUNNING",
        allowed_to_start: false,
        recovery_required: false,
        block_reasons: ["RUN_IN_PROGRESS"],
      });
    }
    if (status.unfinalized_operations) {
      const ops = status.unfinalized_operations;
      const reasons: string[] = [];
      if (ops?.unsettledReservations?.length) {
        reasons.push(`UNSETTLED_RESERVATIONS: ${ops.unsettledReservations.length} 笔未决预留`);
      }
      if (ops?.unknownCalls?.length) {
        reasons.push(`UNKNOWN_CALLS: ${ops.unknownCalls.length} 笔未知结果调用`);
      }
      if (ops?.callingMessages?.length) {
        reasons.push(`CALLING_MESSAGES: ${ops.callingMessages.length} 条未决消息`);
      }
      if (ops?.pendingRuns?.length) reasons.push(`PENDING_RUNS: ${ops.pendingRuns.length}`);
      if (ops?.startedToolExecutions?.length) reasons.push(`STARTED_TOOLS: ${ops.startedToolExecutions.length}`);
      if (reasons.length === 0) {
        reasons.push("PAUSED_RECOVERY_REQUIRED: 存在未决操作需要安全对账自愈");
      }
      return reply.send({
        audit_status: "RECOVERY_REQUIRED",
        allowed_to_start: false,
        recovery_required: true,
        block_reasons: reasons,
      });
    }
    return reply.send({
      audit_status: "OK",
      allowed_to_start: true,
      recovery_required: false,
    });
  });
}
