import fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import * as fs from "node:fs";
import { registerApiRoutes, ApiRoutesOptions } from "./routes/api_routes.js";

export interface CreateServerOptions extends ApiRoutesOptions {
  frontendDistDir?: string;
  development?: boolean;
  allowedOrigins?: string[];
}

export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const app = fastify({
    logger: false,
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

  // 2. 注册 API 路由 (/api 前缀)
  await app.register(
    async (api) => {
      await registerApiRoutes(api, options);
    },
    { prefix: "/api" }
  );

  // 3. 前端静态文件托管
  const distDir = options.frontendDistDir || path.resolve(options.workspaceRoot, "..", "frontend", "dist");
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
