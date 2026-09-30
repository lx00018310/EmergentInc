import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { EvolutionRuntime } from "./protocol.js";

export interface LinuxEvolutionConfig {
  releases: string; workspace: string; currentLink: string; trustedRoot: string; unit: string;
  activePointer: string;
  appUrl: string; ownerSecret: string; validatorUser: string; pnpmPath: string; pnpmStore: string;
}
const execute = (executable: string, args: string[], timeoutMs = 30000) => new Promise<void>((resolve, reject) => {
  const child = spawn(executable, args, { shell: false, env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: "ignore" });
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.on("error", () => { clearTimeout(timer); reject(new Error("EVOLUTION_COMMAND_UNAVAILABLE")); });
  child.on("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("EVOLUTION_COMMAND_FAILED")); });
});
export class LinuxEvolutionRuntime implements EvolutionRuntime {
  private cookie?: string;
  constructor(readonly config: LinuxEvolutionConfig) {
    if (process.platform !== "linux" || process.getuid?.() !== 0) throw new Error("TRUSTED_ROOT_LINUX_REQUIRED");
    for (const p of [config.releases, config.workspace, config.currentLink, config.activePointer, config.trustedRoot, config.pnpmPath, config.pnpmStore])
      if (!/^\/[A-Za-z0-9_./-]+$/.test(p) || p.split("/").includes("..")) throw new Error("INVALID_EVOLUTION_PATH");
    if (!/^emergentinc[a-z0-9_-]*\.service$/.test(config.unit) || !/^[a-z][a-z0-9_-]*$/.test(config.validatorUser) ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.appUrl) || config.ownerSecret.length < 32) throw new Error("INVALID_EVOLUTION_CONFIGURATION");
    const trusted = fs.statSync(config.trustedRoot);
    if (trusted.uid !== 0 || trusted.mode & 0o022 || fs.realpathSync(config.trustedRoot) !== config.trustedRoot)
      throw new Error("ROOT_OF_TRUST_INSTALLATION_INVALID");
    if (!path.relative(config.workspace, config.activePointer).startsWith("..")) throw new Error("ACTIVE_POINTER_MUST_BE_OUTSIDE_APP_WORKSPACE");
  }
  private inside(directory: string) {
    const relative = path.relative(this.config.releases, directory);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("RELEASE_PATH_OUTSIDE_ROOT");
  }
  private async isolate(action: string, directory: string, workspace = "/nonexistent", generation = "") {
    this.inside(directory);
    const c = this.config;
    // A dedicated unprivileged validator receives no production credentials and its own network namespace.
    await execute("/usr/bin/systemd-run", ["--quiet", "--wait", "--pipe", "--collect",
      `--property=User=${c.validatorUser}`, `--property=Group=${c.validatorUser}`, "--property=PrivateNetwork=yes",
      "--property=NoNewPrivileges=yes", "--property=ProtectSystem=strict", "--property=ProtectHome=yes",
      "--property=ProtectProc=invisible", "--property=PrivateTmp=yes", "--property=KillMode=control-group",
      "--property=MemoryMax=2G", "--property=TasksMax=256", "--property=CPUQuota=200%",
      `--property=ReadWritePaths=${action === "build" ? directory : workspace}`,
      `--property=InaccessiblePaths=${c.workspace} /etc/emergentinc`,
      `--setenv=EMERGENTINC_PNPM_PATH=${c.pnpmPath}`, "/usr/bin/node", path.join(c.trustedRoot, "candidate_harness.mjs"),
      action, directory, workspace, generation], 1800000);
  }
  async validateRelease(directory: string) {
    this.inside(directory);
    const store = path.join(directory, ".build-store");
    if (fs.existsSync(store)) throw new Error("BUILD_STORE_TARGET_MUST_BE_NEW");
    fs.cpSync(this.config.pnpmStore, store, { recursive: true });
    await execute("/usr/bin/chown", ["-R", `${this.config.validatorUser}:${this.config.validatorUser}`, directory]);
    await this.isolate("build", directory);
    const relative = path.relative(directory, store);
    if (relative !== ".build-store") throw new Error("BUILD_STORE_PATH_INVALID");
    fs.rmSync(store, { recursive: true });
    await execute("/usr/bin/chown", ["-R", "root:root", directory]);
    // Seal outputs before Owner approval. Symlinks are hashed and checked to stay inside this release.
    const seal = (file: string) => {
      const stat = fs.lstatSync(file); if (stat.isSymbolicLink()) return;
      fs.chmodSync(file, stat.isDirectory() || stat.mode & 0o111 ? 0o555 : 0o444);
      if (stat.isDirectory()) for (const name of fs.readdirSync(file)) seal(path.join(file, name));
    }; seal(directory);
  }
  private async owner(pathname: string, body?: unknown) {
    if (!this.cookie) {
      const login = await fetch(`${this.config.appUrl}/api/login`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: this.config.ownerSecret }), redirect: "error", signal: AbortSignal.timeout(10000) });
      this.cookie = login.headers.get("set-cookie")?.split(";")[0];
      if (login.status !== 200 || !this.cookie) throw new Error("EVOLUTION_OWNER_AUTH_FAILED");
    }
    const response = await fetch(`${this.config.appUrl}/api/evolution/${pathname}`, { method: "POST", headers: { cookie: this.cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      redirect: "error", signal: AbortSignal.timeout(300000) });
    if (!response.ok) throw new Error("EVOLUTION_OWNER_ACTION_FAILED");
  }
  async quiesce() { await this.owner("quiesce"); }
  async finalDream() { await this.owner("final-dream"); }
  async resume() { await this.owner("resume"); }
  async prepareCurrent(directory: string) {
    if (!path.relative(path.join(this.config.workspace, "generations"), directory).match(/^G\d{4,}$/)) throw new Error("INVALID_CURRENT_PATH");
    await execute("/usr/bin/chown", ["-R", "emergentinc:emergentinc", directory]);
  }
  async postRollbackDream(input: unknown) { await this.owner("post-rollback-dream", input); }
  async smoke(directory: string, workspace: string, generation: string) {
    await execute("/usr/bin/chown", ["-R", `${this.config.validatorUser}:${this.config.validatorUser}`, workspace]);
    await this.isolate("smoke", directory, workspace, generation);
  }
  async stop() { await execute("/usr/bin/systemctl", ["stop", this.config.unit], 180000); this.cookie = undefined; }
  async start() { await execute("/usr/bin/systemctl", ["start", this.config.unit], 180000); this.cookie = undefined; }
  async switchRelease(directory: string) {
    this.inside(directory);
    const target = fs.realpathSync(directory); this.inside(target);
    const next = `${this.config.currentLink}.${randomUUID()}.next`;
    fs.symlinkSync(target, next); fs.renameSync(next, this.config.currentLink);
  }
  activeRelease() { return fs.realpathSync(this.config.currentLink); }
  async healthy(generation: string) {
    for (let i = 0; i < 100; i++) {
      try {
        const live = await fetch(`${this.config.appUrl}/health/live`, { redirect: "error", signal: AbortSignal.timeout(2000) });
        const ready = await fetch(`${this.config.appUrl}/health/ready`, { redirect: "error", signal: AbortSignal.timeout(2000) });
        const result = await ready.json() as any;
        if (live.status === 200 && ready.status === 200 && result.ready === true && result.generation === generation) return;
      } catch { /* Bounded startup health polling, not candidate execution or replay. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error("GENERATION_HEALTH_FAILED");
  }
}
