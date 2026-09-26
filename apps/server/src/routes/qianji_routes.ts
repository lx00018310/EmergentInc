import { FastifyInstance } from "fastify";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { CoreStore } from "@emergentinc/persistence";
import { QianjiProfile } from "@emergentinc/protocol";
import { getUnicodeLength } from "@emergentinc/protocol";
import { validateQianjiNarrative } from "@emergentinc/domain";
import { containedPath, validatePathSegment } from "../services/safe_path.js";
import { RunService } from "../services/run_service.js";
import { WorldPresentationService } from "../services/world_presentation_service.js";
import { MissionService } from "../services/mission_service.js";

const MAX_PORTRAIT_BYTES = 2 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export interface QianjiRouteOptions {
  store: CoreStore;
  workspaceRoot: string;
  runService: RunService;
  missionService?: MissionService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every(key => keys.includes(key));
}

function validateImageHeader(mimeType: string, bytes: Buffer): string | null {
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension || bytes.length < 12) return null;
  if (mimeType === "image/png") {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return bytes.subarray(0, 8).equals(signature) && bytes.includes(Buffer.from("IEND")) ? extension : null;
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9 ? extension : null;
  }
  if (mimeType === "image/webp") {
    return bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.readUInt32LE(4) === bytes.length - 8 &&
      bytes.toString("ascii", 8, 12) === "WEBP" ? extension : null;
  }
  return null;
}

function profileDto(store: CoreStore, workspaceRoot: string, profile: QianjiProfile): Record<string, unknown> {
  const currentBinding = store.qianji.getCurrentBindingByQianji(profile.qianjiId);
  let physical: Record<string, unknown> | null = null;
  if (currentBinding) {
    const account = store.pixels.getPixelAccount(currentBinding.pixelId);
    let stateIncarnation: number | null = null;
    try {
      const statePath = containedPath(workspaceRoot, "live", "pixels", currentBinding.pixelId, "state.json");
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
        if (isRecord(state)) {
          if (!Object.prototype.hasOwnProperty.call(state, "incarnation")) stateIncarnation = 1;
          else if (Number.isSafeInteger(state.incarnation) && Number(state.incarnation) > 0) stateIncarnation = Number(state.incarnation);
        }
      }
    } catch {
      stateIncarnation = null;
    }
    physical = {
      accountExists: Boolean(account),
      active: account?.active ?? null,
      energy: account?.energy ?? null,
      refundDeficitTokens: account?.refundDeficitTokens ?? null,
      stateIncarnation,
      bindingConsistent: stateIncarnation === currentBinding.incarnation,
    };
  }
  return {
    profile,
    currentBinding,
    bindingHistory: store.qianji.listBindings(profile.qianjiId),
    physical,
  };
}

function getAssetPath(workspaceRoot: string, qianjiId: string, assetId: string): string | null {
  if (!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(assetId)) return null;
  return containedPath(workspaceRoot, "assets", "qianji", qianjiId, assetId);
}

function listArtifactFiles(directory: string): Array<{ name: string; size: number; modifiedAt: number }> {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && !entry.isSymbolicLink())
    .flatMap(entry => {
      try {
        validatePathSegment(entry.name);
        const filePath = containedPath(directory, entry.name);
        const stat = fs.statSync(filePath);
        return [{ name: entry.name, size: stat.size, modifiedAt: stat.mtimeMs }];
      } catch { return []; }
    });
}

function bindingArtifactDirectory(workspaceRoot: string, binding: ReturnType<CoreStore["qianji"]["listBindings"]>[number]): string | null {
  if (binding.unboundAt === null) return containedPath(workspaceRoot, "live", "artifacts", binding.pixelId);
  if (!binding.archiveRelativePath) return null;
  const segments = String(binding.archiveRelativePath).split("/");
  if (segments[0] !== "live" || segments[1] !== "history" || segments.at(-1) !== "pixel") return null;
  return containedPath(workspaceRoot, ...segments.slice(0, -1), "artifacts");
}

function bindingArtifactHistory(workspaceRoot: string, bindings: ReturnType<CoreStore["qianji"]["listBindings"]>) {
  const current = bindings.find(binding => binding.unboundAt === null) ?? null;
  const currentFiles = current
    ? listArtifactFiles(bindingArtifactDirectory(workspaceRoot, current)!)
    : null;
  const archives = bindings.filter(binding => binding.unboundAt !== null && binding.archiveRelativePath)
    .map(binding => {
      try {
        const segments = String(binding.archiveRelativePath).split("/");
        if (segments[0] !== "live" || segments[1] !== "history" || segments.at(-1) !== "pixel") return null;
        const pixelDirectory = containedPath(workspaceRoot, ...segments);
        const artifactDirectory = bindingArtifactDirectory(workspaceRoot, binding);
        if (!artifactDirectory) return null;
        return { bindingId: binding.bindingId, pixelId: binding.pixelId, files: listArtifactFiles(artifactDirectory),
          archivedPixelDirectoryExists: fs.existsSync(pixelDirectory) };
      } catch { return null; }
    }).filter((item): item is NonNullable<typeof item> => item !== null);
  return {
    current: current ? { bindingId: current.bindingId, pixelId: current.pixelId, files: currentFiles } : null,
    archives,
  };
}

function routeError(reply: any, error: unknown): any {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "REVISION_CONFLICT") return reply.status(409).send({ detail: message });
  if (message === "Qianji not found") return reply.status(404).send({ detail: message });
  return reply.status(400).send({ detail: message });
}

function isRunInProgress(store: CoreStore, runService: RunService): boolean {
  return runService.getStatus().running || store.runs.getActiveRun() !== null;
}

export async function registerQianjiRoutes(server: FastifyInstance, options: QianjiRouteOptions): Promise<void> {
  const { store, workspaceRoot, runService, missionService } = options;
  const presentationService = new WorldPresentationService(workspaceRoot);

  server.get("/qianji/:id/effective-mandate", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    if (!store.qianji.getProfile(id)) return reply.status(404).send({ detail: "Qianji not found" });
    if (!missionService) return reply.status(503).send({ detail: "MISSION_SERVICE_UNAVAILABLE" });
    return reply.send(missionService.getEffectiveMandate(id));
  });

  server.get("/qianji", async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const careerStatus = query.careerStatus;
    if (careerStatus !== undefined && !["candidate", "trial", "active", "retired"].includes(String(careerStatus))) {
      return reply.status(400).send({ detail: "Invalid careerStatus" });
    }
    const profiles = store.qianji.listProfiles({ careerStatus: careerStatus as any, limit: 200 });
    return reply.send({ items: profiles.map(profile => profileDto(store, workspaceRoot, profile)) });
  });

  server.get("/qianji/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    return reply.send(profileDto(store, workspaceRoot, profile));
  });

  server.get("/qianji/:id/history", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      return reply.status(400).send({ detail: "limit must be 1-200" });
    }
    return reply.send({
      qianjiId: id,
      attributed: store.qianji.getHistory(id, limit),
      career: store.qianji.getCareerSummary(id),
      events: store.worldEvents.listRecent({ qianjiId: id, limit }),
      artifacts: bindingArtifactHistory(workspaceRoot, store.qianji.listBindings(id)),
      costSemantics: "Model and tool costs remain nullable; carrierLegacy is reference-only and excluded from attributed totals.",
    });
  });

  server.get("/qianji/:id/history/artifacts/:bindingId/:filename", async (request, reply) => {
    const params = request.params as any;
    const id = String(params.id ?? "");
    const bindingId = String(params.bindingId ?? "");
    const filename = String(params.filename ?? "");
    try { validatePathSegment(id); validatePathSegment(bindingId); validatePathSegment(filename); }
    catch { return reply.status(400).send({ detail: "Invalid artifact path" }); }
    if (!store.qianji.getProfile(id)) return reply.status(404).send({ detail: "Qianji not found" });
    const binding = store.qianji.listBindings(id).find(item => item.bindingId === bindingId);
    if (!binding) return reply.status(404).send({ detail: "Qianji binding not found" });
    let file: string;
    try {
      const directory = bindingArtifactDirectory(workspaceRoot, binding);
      if (!directory) return reply.status(404).send({ detail: "Archived artifact path is unavailable" });
      file = containedPath(directory, filename);
    } catch { return reply.status(404).send({ detail: "Artifact not found" }); }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return reply.status(404).send({ detail: "Artifact not found" });
    reply.header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", "attachment")
      .header("X-Content-Type-Options", "nosniff");
    return reply.send(fs.readFileSync(file));
  });

  server.post("/qianji/:id/chat", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["content", "idempotencyKey"]) ||
        typeof body.content !== "string" || getUnicodeLength(body.content) < 1 || getUnicodeLength(body.content) > 2000 ||
        typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 1 || body.idempotencyKey.length > 128 ||
        /[\x00-\x1f]/.test(body.idempotencyKey)) {
      return reply.status(400).send({ detail: "Expected content (1-2000 Unicode code points) and idempotencyKey (1-128 characters)" });
    }
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    if (profile.careerStatus === "retired") return reply.status(409).send({ detail: "QIANJI_RETIRED" });
    const binding = store.qianji.getCurrentBindingByQianji(id);
    if (!binding) return reply.status(409).send({ detail: "QIANJI_NOT_BOUND" });
    if (store.executions.getOpenExecutionForBinding(binding.bindingId)) return reply.status(409).send({ detail: "QIANJI_OCCUPIED_BY_EXECUTION" });
    const account = store.pixels.getPixelAccount(binding.pixelId);
    if (!account?.active || account.refundDeficitTokens > 0) {
      return reply.status(409).send({ detail: !account?.active ? "PIXEL_INACTIVE" : "PIXEL_REFUND_DEFICIT" });
    }
    if (isRunInProgress(store, runService)) return reply.status(409).send({ detail: "RUN_IN_PROGRESS" });
    try {
      const result = store.qianjiChat.createTurn({
        qianjiId: id,
        bindingId: binding.bindingId,
        pixelId: binding.pixelId,
        requestKey: `${id}:${body.idempotencyKey}`,
        question: body.content,
        roundNum: runService.getWorldRound() + 1,
      });
      return reply.status(202).send({ status: "queued", ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(message === "IDEMPOTENCY_CONFLICT" ? 409 : 400).send({ detail: message });
    }
  });

  server.get("/qianji/:id/chat", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    if (!store.qianji.getProfile(id)) return reply.status(404).send({ detail: "Qianji not found" });
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      return reply.status(400).send({ detail: "limit must be 1-200 and offset a non-negative integer" });
    }
    const items = store.qianjiChat.listTurns(id, limit, offset).map(turn => {
      let status: string;
      if (turn.messageStatus === "COMMITTED") status = turn.reply === null ? "no_reply" : "replied";
      else if (["WAITING_PIXEL_BUDGET", "WAITING_RUN_BUDGET", "CALL_OUTCOME_UNKNOWN", "AWAITING_SETTLEMENT", "ABANDONED"].includes(turn.messageStatus)) status = "blocked";
      else if (["MODEL_RESPONSE_INVALID"].includes(turn.messageStatus)) status = "failed";
      else if (["QUEUED", "PROCESSING", "RESERVED", "CALLING", "RESPONSE_STORED"].includes(turn.messageStatus)) {
        status = turn.messageStatus === "QUEUED" ? "queued" : "processing";
      } else status = "failed";
      const { messageStatus: _messageStatus, modelOutcome, ...publicTurn } = turn;
      return { ...publicTurn, status, modelOutcome };
    });
    return reply.send({ items, limit, offset, nextOffset: items.length === limit ? offset + items.length : null });
  });

  server.put("/qianji/:id/narrative", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    if (isRunInProgress(store, runService)) return reply.status(409).send({ detail: "RUN_IN_PROGRESS" });
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["expectedRevision", "narrative"]) ||
        !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0 ||
        !Object.prototype.hasOwnProperty.call(body, "narrative")) {
      return reply.status(400).send({ detail: "Expected {expectedRevision, narrative}" });
    }
    const validation = validateQianjiNarrative(body.narrative);
    if (!validation.valid) return reply.status(400).send({ detail: "NARRATIVE_INVALID", errors: validation.errors });
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    const binding = store.qianji.getCurrentBindingByQianji(id);
    if (binding && store.executions.getOpenExecutionForBinding(binding.bindingId)) return reply.status(409).send({ detail: "QIANJI_OCCUPIED_BY_EXECUTION" });
    if (validation.value.portraitAsset) {
      let assetPath: string | null = null;
      try { assetPath = getAssetPath(workspaceRoot, id, validation.value.portraitAsset); } catch {}
      if (!assetPath || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
        return reply.status(400).send({ detail: "portraitAsset must refer to an uploaded asset owned by this Qianji" });
      }
    }
    try {
      return reply.send({ profile: store.qianji.updateNarrative(id, Number(body.expectedRevision), validation.value) });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  server.post("/qianji/:id/retire", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["reason", "idempotencyKey"]) || typeof body.reason !== "string" || !body.reason.trim() ||
        typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 200) {
      return reply.status(400).send({ detail: "QIANJI_RETIREMENT_INPUT_INVALID" });
    }
    const retirementReason = body.reason;
    try {
      const previous = store.ownerActions.getPrevious<ReturnType<CoreStore["qianji"]["unbindAndRetire"]>>(
        body.idempotencyKey, `qianji.retire:${id}`, body);
      if (previous) {
        store.pixels.setActive(previous.pixelId, false);
        return reply.send({ binding: previous, profile: store.qianji.getProfile(id) });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(409).send({ detail: message });
    }
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    if (profile.careerStatus !== "active") return reply.status(409).send({ detail: "QIANJI_NOT_ACTIVE" });
    if (runService.getStatus().running || store.getUnfinalizedOperations().hasUnfinalized) return reply.status(409).send({ detail: "RUN_OR_RECOVERY_ACTIVE" });
    const binding = store.qianji.getCurrentBindingByQianji(id);
    if (!binding) return reply.status(409).send({ detail: "QIANJI_NOT_BOUND" });
    if (store.executions.getOpenExecutionForBinding(binding.bindingId)) return reply.status(409).send({ detail: "QIANJI_OCCUPIED_BY_EXECUTION" });
    const openMission = store.db.prepare(`SELECT 1 FROM mission_participants mp JOIN missions m ON m.mission_id=mp.mission_id
      WHERE mp.binding_id=? AND m.status IN ('issued','running','awaiting_acceptance') LIMIT 1`).get(binding.bindingId);
    if (openMission) return reply.status(409).send({ detail: "QIANJI_HAS_OPEN_MISSION" });

    const sourcePixel = containedPath(workspaceRoot, "live", "pixels", binding.pixelId);
    const sourceArtifacts = containedPath(workspaceRoot, "live", "artifacts", binding.pixelId);
    const archiveBase = containedPath(workspaceRoot, "live", "history", binding.bindingId);
    const archivePixel = containedPath(archiveBase, "pixel");
    const archiveArtifacts = containedPath(archiveBase, "artifacts");
    for (const source of [sourcePixel, sourceArtifacts]) {
      if (fs.existsSync(source) && fs.lstatSync(source).isSymbolicLink()) return reply.status(409).send({ detail: "QIANJI_ARCHIVE_SYMLINK_FORBIDDEN" });
    }
    if (fs.existsSync(archivePixel) || fs.existsSync(archiveArtifacts)) return reply.status(409).send({ detail: "QIANJI_ARCHIVE_DESTINATION_EXISTS" });
    let movedPixel = false;
    let movedArtifacts = false;
    try {
      const result = store.ownerActions.execute(body.idempotencyKey, `qianji.retire:${id}`, body, () => {
        fs.mkdirSync(archiveBase, { recursive: true });
        try {
          if (fs.existsSync(sourcePixel)) { fs.renameSync(sourcePixel, archivePixel); movedPixel = true; }
          if (fs.existsSync(sourceArtifacts)) { fs.renameSync(sourceArtifacts, archiveArtifacts); movedArtifacts = true; }
          const retired = store.qianji.unbindAndRetire(binding.bindingId, `live/history/${binding.bindingId}/pixel`, retirementReason.trim());
          store.pixels.setActive(binding.pixelId, false);
          return retired;
        } catch (error) {
          if (movedArtifacts && fs.existsSync(archiveArtifacts)) fs.renameSync(archiveArtifacts, sourceArtifacts);
          if (movedPixel && fs.existsSync(archivePixel)) fs.renameSync(archivePixel, sourcePixel);
          throw error;
        }
      });
      return reply.send({ binding: result, profile: store.qianji.getProfile(id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(/conflict|already|active|RUN/.test(message) ? 409 : 400).send({ detail: message });
    }
  });

  server.post("/qianji/:id/portrait", { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    if (isRunInProgress(store, runService)) return reply.status(409).send({ detail: "RUN_IN_PROGRESS" });
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["mimeType", "dataBase64", "expectedRevision"]) ||
        typeof body.mimeType !== "string" || typeof body.dataBase64 !== "string" ||
        !Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) {
      return reply.status(400).send({ detail: "Expected {mimeType, dataBase64, expectedRevision}" });
    }
    if (!MIME_EXTENSIONS[body.mimeType]) return reply.status(400).send({ detail: "Only PNG, JPEG, and WebP are supported" });
    if (!body.dataBase64 || body.dataBase64.length > 2_796_208 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.dataBase64)) {
      return reply.status(400).send({ detail: "dataBase64 is invalid or exceeds the portrait size limit" });
    }
    const bytes = Buffer.from(body.dataBase64, "base64");
    if (bytes.length === 0 || bytes.length > MAX_PORTRAIT_BYTES || bytes.toString("base64") !== body.dataBase64) {
      return reply.status(400).send({ detail: "Decoded portrait must be at most 2 MiB" });
    }
    const extension = validateImageHeader(body.mimeType, bytes);
    if (!extension) return reply.status(400).send({ detail: "Image header does not match MIME type or file structure" });

    const assetId = createHash("sha256").update(bytes).digest("hex") + "." + extension;
    let assetPath: string;
    let created = false;
    try {
      const directory = containedPath(workspaceRoot, "assets", "qianji", id);
      fs.mkdirSync(directory, { recursive: true });
      assetPath = containedPath(workspaceRoot, "assets", "qianji", id, assetId);
      if (!fs.existsSync(assetPath)) {
        fs.writeFileSync(assetPath, bytes, { flag: "wx" });
        created = true;
      }
    } catch (error) {
      return reply.status(400).send({ detail: error instanceof Error ? error.message : String(error) });
    }
    try {
      const narrative = { ...profile.narrative, portraitAsset: assetId };
      const updated = store.qianji.updateNarrative(id, Number(body.expectedRevision), narrative);
      return reply.send({ profile: updated, assetId });
    } catch (error) {
      if (created) {
        try { fs.rmSync(assetPath!, { force: true }); } catch {}
      }
      return routeError(reply, error);
    }
  });

  server.get("/qianji/:id/portrait", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { validatePathSegment(id); } catch { return reply.status(400).send({ detail: "Invalid qianji id" }); }
    const profile = store.qianji.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Qianji not found" });
    const assetId = profile.narrative.portraitAsset;
    if (!assetId) return reply.status(404).send({ detail: "Portrait not configured" });
    let assetPath: string | null = null;
    try { assetPath = getAssetPath(workspaceRoot, id, assetId); } catch {}
    if (!assetPath || !fs.existsSync(assetPath) || !fs.statSync(assetPath).isFile()) {
      return reply.status(404).send({ detail: "Portrait asset not found" });
    }
    const extension = path.extname(assetPath);
    const mimeType = extension === ".png" ? "image/png" : extension === ".jpg" ? "image/jpeg" : "image/webp";
    reply.header("Content-Type", mimeType).header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-store");
    return reply.send(fs.readFileSync(assetPath));
  });

  server.get("/world/presentation", async (_request, reply) => {
    try { return reply.send(presentationService.get()); }
    catch (error) { return reply.status(500).send({ detail: error instanceof Error ? error.message : String(error) }); }
  });

  server.put("/world/presentation", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body) || !hasOnlyKeys(body, ["expectedRevision", "organizationName", "hallName", "sectionLabels", "eventLabels"]) ||
        !Number.isSafeInteger(body.expectedRevision) || typeof body.organizationName !== "string" ||
        typeof body.hallName !== "string") {
      return reply.status(400).send({ detail: "Expected {expectedRevision, organizationName, hallName}" });
    }
    try { return reply.send(presentationService.update(body as any)); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(message === "REVISION_CONFLICT" ? 409 : 400).send({ detail: message });
    }
  });

  server.get("/world/events", async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    const offset = query.offset === undefined ? 0 : Number(query.offset);
    const qianjiId = query.qianjiId === undefined ? undefined : String(query.qianjiId);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      return reply.status(400).send({ detail: "limit must be 1-200 and offset a non-negative integer" });
    }
    if (qianjiId !== undefined) {
      try { validatePathSegment(qianjiId); } catch { return reply.status(400).send({ detail: "Invalid qianjiId" }); }
    }
    const events = store.worldEvents.listRecent({ limit, offset, qianjiId });
    return reply.send({ items: events, limit, offset, nextOffset: events.length === limit ? offset + events.length : null });
  });
}
