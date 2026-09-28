import { FastifyInstance } from "fastify";
import { DrawRequest, GachaService } from "../services/gacha_service.js";
import { CoreStore } from "@emergentinc/persistence";
import { GachaImageService } from "../services/gacha_image.js";

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown, max: number): value is string {
  return typeof value === "string" && Boolean(value.trim()) && Array.from(value).length <= max;
}

function parseDraw(value: unknown): DrawRequest | null {
  if (!record(value) || !validText(value.idempotencyKey, 200) || (value.count !== 1 && value.count !== 10)) return null;
  if (value.mode === "random" && Object.keys(value).every(key => ["mode", "count", "idempotencyKey"].includes(key))) {
    return { mode: "random", count: value.count as 1 | 10, idempotencyKey: value.idempotencyKey };
  }
  if (value.count !== 1) return null;
  if (value.mode === "appointed" && validText(value.role, 80) && validText(value.concept, 500) &&
      (value.name === undefined || value.name === "" || validText(value.name, 80)) &&
      Object.keys(value).every(key => ["mode", "count", "idempotencyKey", "name", "role", "concept"].includes(key))) {
    return { mode: "appointed", count: 1, idempotencyKey: value.idempotencyKey,
      name: typeof value.name === "string" ? value.name : undefined, role: value.role, concept: value.concept };
  }
  if (value.mode === "github" && validText(value.role, 80) &&
      Object.keys(value).every(key => ["mode", "count", "idempotencyKey", "role"].includes(key))) {
    return { mode: "github", count: 1, idempotencyKey: value.idempotencyKey, role: value.role };
  }
  return null;
}

function fail(reply: any, error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return reply.status(detail === "GACHA_DRAW_NOT_FOUND" ? 404 : detail === "GACHA_IMAGE_NOT_CONFIGURED" ? 503 :
    /conflict|already|CONFLICT|NOT_READY/i.test(detail) ? 409 : 400).send({ detail });
}

export async function registerGachaRoutes(server: FastifyInstance, service: GachaService, store: CoreStore,
  images: GachaImageService): Promise<void> {
  server.post("/gacha/draw", async (request, reply) => {
    const input = parseDraw(request.body);
    if (!input) return reply.status(400).send({ detail: "GACHA_DRAW_INPUT_INVALID" });
    try { return reply.status(201).send({ items: service.draw(input) }); }
    catch (error) { return fail(reply, error); }
  });

  server.get("/gacha/history", async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) return reply.status(400).send({ detail: "GACHA_HISTORY_LIMIT_INVALID" });
    const before = query.beforeCreatedAt === undefined && query.beforeId === undefined ? undefined
      : { createdAt: Number(query.beforeCreatedAt), qianjiId: String(query.beforeId ?? "") };
    if (before && (!Number.isFinite(before.createdAt) || before.createdAt < 0 || !/^qj_[\w-]+$/.test(before.qianjiId))) {
      return reply.status(400).send({ detail: "GACHA_HISTORY_CURSOR_INVALID" });
    }
    const rows = store.gacha.list(limit + 1, before);
    const page = rows.slice(0, limit);
    const last = rows.length > limit ? page.at(-1) : null;
    const counts: Record<string, number> = { N: 0, R: 0, SR: 0, SSR: 0 };
    const all = store.db.prepare("SELECT draw_json FROM qianji_draws").all() as Array<{ draw_json: string }>;
    for (const row of all) {
      const rarity = JSON.parse(row.draw_json).rarity;
      if (typeof rarity === "string" && rarity in counts) counts[rarity]++;
    }
    return reply.send({ items: page.map(draw => ({ profile: store.qianji.getProfile(draw.qianjiId), error: store.gacha.getError(draw.qianjiId) })),
      counts, total: all.length, nextCursor: last ? { createdAt: last.createdAt, qianjiId: last.qianjiId } : null });
  });

  server.get("/gacha/:id", async (request, reply) => {
    const id = String((request.params as any).id ?? "");
    try { return reply.send(service.get(id)); }
    catch (error) { return fail(reply, error); }
  });

  server.post("/gacha/:id/retry", async (request, reply) => {
    if (request.body !== undefined && (!record(request.body) || Object.keys(request.body).length)) {
      return reply.status(400).send({ detail: "GACHA_RETRY_INPUT_INVALID" });
    }
    const id = String((request.params as any).id ?? "");
    try { return reply.send(service.retry(id)); }
    catch (error) { return fail(reply, error); }
  });

  server.post("/gacha/:id/complete-prompt", async (request, reply) => {
    if (request.body !== undefined && (!record(request.body) || Object.keys(request.body).length)) {
      return reply.status(400).send({ detail: "GACHA_PROMPT_INPUT_INVALID" });
    }
    const id = String((request.params as any).id ?? "");
    try { service.completePrompt(id); return reply.send(service.get(id)); }
    catch (error) { return fail(reply, error); }
  });

  server.post("/gacha/:id/image", async (request, reply) => {
    if (request.body !== undefined && (!record(request.body) || Object.keys(request.body).length)) {
      return reply.status(400).send({ detail: "GACHA_IMAGE_INPUT_INVALID" });
    }
    const id = String((request.params as any).id ?? "");
    try { images.start(id); return reply.status(202).send(service.get(id)); }
    catch (error) { return fail(reply, error); }
  });
}
