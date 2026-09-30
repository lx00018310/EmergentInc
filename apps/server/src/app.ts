import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import * as fs from "node:fs";
import { registerApiRoutes, ApiRoutesOptions } from "./routes/api_routes.js";
import { OwnerAuthOptions, registerOwnerAuth } from "./owner_auth.js";
import { BusinessService } from "./services/business_service.js";
import { registerBusinessRoutes } from "./routes/business_routes.js";
import { EvolutionServices, registerEvolutionRoutes } from "./routes/evolution_routes.js";

export interface CreateServerOptions extends Partial<ApiRoutesOptions> {
  workspaceRoot: string;
  runtimeMode?: "legacy" | "business";
  businessService?: BusinessService;
  evolution?: EvolutionServices;
  ownerAuth?: OwnerAuthOptions;
  trustLoopbackProxy?: boolean;
  frontendDistDir?: string;
  development?: boolean;
  allowedOrigins?: string[];
}

export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
    trustProxy: options.trustLoopbackProxy ? ["127.0.0.1", "::1"] : false,
  });

  // Reject cross-origin requests before handlers, including simple mutation requests.
  const allowedOrigins = new Set(options.development ? options.allowedOrigins ?? [] : []);
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    const sameOrigin = `${req.protocol}://${req.headers.host}`;
    if ((origin && origin !== sameOrigin && !allowedOrigins.has(origin)) ||
        (!origin && req.headers["sec-fetch-site"] === "cross-site")) {
      return reply.status(403).send({ detail: "ORIGIN_FORBIDDEN" });
    }
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, Boolean(origin && allowedOrigins.has(origin))),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  const mode = options.runtimeMode ?? "legacy";
  registerOwnerAuth(app, options.ownerAuth, mode);
  app.addHook("onRequest", async (req, reply) => {
    if (options.evolution?.quiesced?.() && req.method !== "GET" && req.url.startsWith("/api/") &&
        !["/api/login", "/api/logout", "/api/evolution/final-dream", "/api/evolution/quiesce", "/api/evolution/resume"].includes(req.url.split("?")[0]!))
      return reply.status(409).send({ detail: "EVOLUTION_QUIESCED" });
  });
  app.get("/health/live", async () => ({ alive: true }));
  app.get("/health/ready", async (_req, reply) => {
    const ready = !options.businessService?.status().schedulerFailure;
    return reply.status(ready ? 200 : 503).send({ ready, mode, version: options.evolution ? "v22-life-1" : "v21-business-1",
      ...(options.evolution ? { generation: options.evolution.life.current.meta().generation_id,
        geneHash: options.evolution.life.current.meta().gene_hash, bodyRevision: options.evolution.life.current.meta().body_revision } : {}) });
  });
  app.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Cache-Control", "no-store");
    reply.header("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  });

  // 2. 注册 API 路由 (/api 前缀)
  await app.register(
    async (api) => {
      if (mode === "business") {
        if (!options.businessService) throw new Error("BUSINESS_SERVICE_REQUIRED");
        await registerBusinessRoutes(api, options.businessService, options.evolution?.memoryGate);
        if (options.evolution) await registerEvolutionRoutes(api, options.evolution);
      } else {
        if (!options.coreStore || !options.worldService || !options.runService || !options.promptService || !options.toolRegistry) throw new Error("LEGACY_SERVICES_REQUIRED");
        await registerApiRoutes(api, options as ApiRoutesOptions);
      }
    },
    { prefix: "/api" }
  );

  // 3. 前端静态文件托管
  const distDir = options.frontendDistDir || path.resolve(import.meta.dirname, "../../../frontend/dist");
  if (fs.existsSync(distDir)) {
    await app.register(fastifyStatic, {
      root: distDir,
      prefix: "/",
    });

    // SPA fallback: 非 /api 路径回退到 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.status(404).send({ detail: `Route ${req.method} ${req.url} not found` });
      }
      return reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api")) {
        return reply.status(404).send({ detail: `Route ${req.method} ${req.url} not found` });
      }
      return reply.status(503).send("Frontend build not found. Run 'pnpm --filter emergentinc-frontend build' first.");
    });
  }

  // 4. 全局错误捕获 (保持与 FastAPI 的 detail 契约一致)
  app.setErrorHandler((error: any, _req, reply) => {
    const statusCode = error.statusCode || 500;
    return reply.status(statusCode).send({ detail: error.message || String(error) });
  });

  return app;
}
