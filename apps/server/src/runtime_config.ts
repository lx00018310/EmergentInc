import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

export function runtimeConfig(projectRoot: string, env = process.env) {
  const mode = env.EMERGENTINC_RUNTIME_MODE ?? "business";
  if (mode !== "business" && mode !== "legacy") throw new Error("INVALID_RUNTIME_MODE");
  const workspaceRoot = path.resolve(env.EMERGENTINC_WORKSPACE_ROOT ?? path.join(projectRoot, "workspace"));
  const secret = env.EMERGENTINC_OWNER_SECRET ?? "";
  if (secret.length < 32) throw new Error("Set EMERGENTINC_OWNER_SECRET to a random secret of at least 32 characters.");
  const host = env.HOST ?? "127.0.0.1";
  const secureCookies = env.EMERGENTINC_SECURE_COOKIES !== "0";
  if (!secureCookies && !["127.0.0.1", "::1", "localhost"].includes(host)) throw new Error("INSECURE_COOKIES_REQUIRE_LOOPBACK");
  return { mode, workspaceRoot, host, trustLoopbackProxy: env.EMERGENTINC_TRUST_LOOPBACK_PROXY === "1", ownerAuth: { secret, secureCookies } };
}

/** One process per workspace across both modes. Never remove a live process's lock. */
export function acquireWorkspaceLock(workspaceRoot: string, localUpgradeToken?: string): () => void {
  fs.mkdirSync(path.join(workspaceRoot, "runtime"), { recursive: true });
  const pending = path.join(workspaceRoot, "runtime/local-upgrade-pending.json");
  if (fs.existsSync(pending)) {
    const expected = JSON.parse(fs.readFileSync(pending, "utf8")).token;
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/.test(expected) || expected !== localUpgradeToken)
      throw new Error("LOCAL_UPGRADE_RECOVERY_REQUIRED");
  }
  const file = path.join(workspaceRoot, "runtime", "instance.lock");
  const token = randomUUID();
  if (fs.existsSync(file)) {
    const contents = fs.readFileSync(file, "utf8");
    const previous = JSON.parse(contents);
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error("INVALID_WORKSPACE_LOCK_REQUIRES_REVIEW");
    try { process.kill(previous.pid, 0); throw new Error("WORKSPACE_ALREADY_RUNNING"); }
    catch (e) {
      // A live same-user server is always signalable; on Windows a reused PID held
      // by a protected system process reports EPERM instead of ESRCH, so EPERM
      // also identifies a stale lock left behind by a dead server.
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "ESRCH" && !(process.platform === "win32" && code === "EPERM")) throw e;
    }
    if (fs.readFileSync(file, "utf8") !== contents) throw new Error("WORKSPACE_LOCK_CHANGED");
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }), { flag: "wx", mode: 0o600 });
  return () => {
    if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).token === token) fs.unlinkSync(file);
  };
}
