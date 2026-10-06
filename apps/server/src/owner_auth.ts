import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { FastifyInstance } from "fastify";
import { isAnonymousStoreRoute } from './routes/public_routes.js';

export interface OwnerAuthOptions { secret: string; secureCookies: boolean }
const digest = (value: string) => createHash("sha256").update(value).digest();
export function registerOwnerAuth(app: FastifyInstance, options: OwnerAuthOptions | undefined, mode: string, worldsEnabled = false) {
  // Existing integration tests construct the server without a production bootstrap.
  if (!options && process.env.NODE_ENV === "test") return;
  if (!options || options.secret.length < 32) throw new Error("OWNER_SECRET_REQUIRED_MIN_32_CHARS");
  const secret = digest(options.secret);
  const sessions = new Map<string, number>();
  let attempts = 0, windowStart = Date.now();
  const cookieName = options.secureCookies ? "__Host-emergent_owner" : "emergent_owner";
  const token = (cookie: string | undefined) => cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const valid = (cookie: string | undefined) => (sessions.get(token(cookie) ?? "") ?? 0) > Date.now();
  const cookie = (value: string, age: number) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${options.secureCookies ? "; Secure" : ""}`;
  app.addHook("onRequest", async (req, reply) => {
    const route = req.url.split("?")[0];
    if (route.startsWith("/api/") && route !== "/api/session" && route !== "/api/login" && !isAnonymousStoreRoute(req.method,route!) && !valid(req.headers.cookie)) {
      return reply.status(401).send({ detail: "OWNER_LOGIN_REQUIRED" });
    }
  });
  app.get("/api/session", async req => ({ authenticated: valid(req.headers.cookie), mode, worldsEnabled }));
  app.post("/api/login", async (req, reply) => {
    const now = Date.now();
    if (now - windowStart > 60000) { attempts = 0; windowStart = now; }
    if (++attempts > 10) return reply.status(429).send({ detail: "LOGIN_RATE_LIMITED" });
    const body = req.body as { secret?: unknown } | null;
    if (typeof body?.secret !== "string" || body.secret.length > 1024 || !timingSafeEqual(digest(body.secret), secret)) {
      return reply.status(401).send({ detail: "INVALID_OWNER_SECRET" });
    }
    for (const [id, expires] of sessions) if (expires <= now) sessions.delete(id);
    if (sessions.size >= 20) sessions.delete(sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex");
    sessions.set(id, now + 8 * 3600000);
    return reply.header("set-cookie", cookie(id, 8 * 3600)).send({ authenticated: true, mode, worldsEnabled });
  });
  app.post("/api/logout", async (req, reply) => {
    sessions.delete(token(req.headers.cookie) ?? "");
    return reply.header("set-cookie", cookie("", 0)).send({ authenticated: false });
  });
}
