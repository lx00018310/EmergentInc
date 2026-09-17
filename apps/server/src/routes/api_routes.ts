import { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { WorldService } from "../services/world_service.js";
import { RunService } from "../services/run_service.js";
import { PromptService } from "../services/prompt_service.js";
import { ToolRegistry } from "@emergentinc/tools";
import { CoreStore } from "@emergentinc/persistence";

export interface ApiRoutesOptions {
  worldService: WorldService;
  runService: RunService;
  promptService: PromptService;
  toolRegistry: ToolRegistry;
  coreStore: CoreStore;
  workspaceRoot: string;
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
  } = options;

  // 1. World
  server.get("/world", async (_req, reply) => {
    return reply.send(worldService.getWorldDto());
  });

  // 2. Run
  server.get("/run/status", async (_req, reply) => {
    return reply.send(runService.getStatus());
  });

  server.post("/run/start", async (req, reply) => {
    const body: any = req.body || {};
    const rounds = Number(body.rounds ?? 1);
    const runBudgetTokens = Number(body.run_budget_tokens ?? 1000000);
    const globalBudgetTokens = Number(body.global_budget_tokens ?? 10000000);

    if (runService.getStatus().running) {
      return reply.status(409).send({ detail: "Run is already in progress." });
    }

    try {
      const res = await runService.start({
        rounds,
        commandText: body.command,
        runBudgetTokens,
        globalBudgetTokens,
      });
      return reply.send(res);
    } catch (err: any) {
      return reply.status(400).send({ detail: err.message });
    }
  });

  server.post("/run/stop", async (_req, reply) => {
    return reply.send(runService.requestStop());
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
    const allowlist = ["pixel.md", "state.json"];
    if (!allowlist.includes(params.doc_name)) {
      return reply.status(403).send({ detail: `Document '${params.doc_name}' is not in the allowlist` });
    }

    const docPath = path.resolve(workspaceRoot, "live", "pixels", params.pixel_id, params.doc_name);
    if (!fs.existsSync(docPath)) {
      return reply.status(404).send({ detail: "Document not found" });
    }
    return reply.send({
      pixel_id: params.pixel_id,
      document: params.doc_name,
      content: fs.readFileSync(docPath, "utf-8"),
    });
  });

  // 5. Artifacts
  server.get("/pixels/:pixel_id/artifacts", async (req, reply) => {
    const params: any = req.params;
    const dir = path.resolve(workspaceRoot, "live", "artifacts", params.pixel_id);
    if (!fs.existsSync(dir)) {
      return reply.send({ pixel_id: params.pixel_id, artifacts: [] });
    }
    const files = fs.readdirSync(dir);
    const items = files.map((file) => {
      const stat = fs.statSync(path.resolve(dir, file));
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
    const targetDir = subPath ? path.resolve(privDir, subPath) : privDir;

    if (!targetDir.startsWith(privDir)) {
      return reply.status(403).send({ detail: "PATH_TRAVERSAL_FORBIDDEN" });
    }
    if (!fs.existsSync(targetDir)) {
      return reply.status(404).send({ detail: "Directory not found" });
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items = entries.map((ent) => {
      const full = path.resolve(targetDir, ent.name);
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
    const target = path.resolve(privDir, subPath);

    if (!target.startsWith(privDir)) {
      return reply.status(403).send({ detail: "PATH_TRAVERSAL_FORBIDDEN" });
    }
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
    if (runService.getStatus().running) {
      return reply.send({
        audit_status: "DEFERRED_RUNNING",
        allowed_to_start: false,
        recovery_required: false,
        block_reasons: ["RUN_IN_PROGRESS"],
      });
    }
    return reply.send({
      audit_status: "OK",
      allowed_to_start: true,
      recovery_required: false,
    });
  });
}
