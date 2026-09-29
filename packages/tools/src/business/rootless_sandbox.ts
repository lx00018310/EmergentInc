import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export interface SandboxCommand {
  executable: string; args: string[]; input?: string; timeoutMs: number; maxOutputBytes: number;
  env: Record<string, string>;
}
export interface SandboxCommandResult { code: number; stdout: string; stderr: string }
export type SandboxExecutor = (command: SandboxCommand) => Promise<SandboxCommandResult>;
export interface RootlessSandboxConfig { dockerPath: string; socket: string; image: string }

const execute: SandboxExecutor = command => new Promise((resolve, reject) => {
  const child = spawn(command.executable, command.args, { shell: false, windowsHide: true,
    env: command.env, stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  let bytes = 0, failure: string | undefined;
  const stop = (reason: string) => { failure ??= reason; child.kill("SIGKILL"); };
  const timer = setTimeout(() => stop("SANDBOX_COMMAND_TIMEOUT"), command.timeoutMs);
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > command.maxOutputBytes) stop("SANDBOX_OUTPUT_LIMIT");
    else target.push(chunk);
  };
  child.stdout.on("data", collect(stdout)); child.stderr.on("data", collect(stderr));
  child.once("error", () => { clearTimeout(timer); reject(new Error("SANDBOX_EXECUTOR_UNAVAILABLE")); });
  child.once("close", code => {
    clearTimeout(timer);
    if (failure) reject(new Error(failure));
    else resolve({ code: code ?? -1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
  });
  child.stdin.on("error", () => { /* A rejected/finished container may close stdin before the client. */ });
  child.stdin.end(command.input);
});

// This loader is evaluated ONLY inside the container; no host eval/import of candidate code.
// The container receives only the supplied JSON. It has no host paths, secrets or Docker socket.
const loader = `
import fs from 'node:fs';
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const module = await import('data:text/javascript;base64,' + Buffer.from(request.source).toString('base64'));
if (typeof module.default !== 'function') throw new Error('AUTOMATION_DEFAULT_FUNCTION_REQUIRED');
const result = await module.default(request.input);
process.stdout.write(JSON.stringify({result}));
`;

/** Trusted, serial host-side adapter. Not a supervisor and not proof of kernel-level isolation by itself. */
export class RootlessSandbox {
  private busy = false;
  private cleanupRequired = false;
  constructor(private config: RootlessSandboxConfig, private command: SandboxExecutor = execute,
    private host = { platform: process.platform as string, uid: process.getuid?.() ?? -1 }) {}
  private checkHost() {
    if (this.host.platform !== "linux" || this.host.uid <= 0) throw new Error("ROOTLESS_LINUX_REQUIRED");
    if (!/^\/[A-Za-z0-9_./-]+$/.test(this.config.dockerPath) || !this.config.dockerPath.endsWith("/docker") ||
        this.config.socket !== `unix:///run/user/${this.host.uid}/docker.sock` ||
        !/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(this.config.image)) throw new Error("INVALID_SANDBOX_CONFIGURATION");
  }
  private cli(args: string[], input?: string, timeoutMs = 10000, maxOutputBytes = 65536) {
    return this.command({ executable: this.config.dockerPath, args: ["--host", this.config.socket, ...args], input,
      timeoutMs, maxOutputBytes, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/nonexistent", DOCKER_CONFIG: "/nonexistent" } });
  }
  async probe() {
    this.checkHost();
    const response = await this.cli(["info", "--format", "{{json .}}"]);
    if (response.code !== 0) throw new Error("ROOTLESS_DOCKER_UNAVAILABLE");
    let info: any; try { info = JSON.parse(response.stdout); } catch { throw new Error("INVALID_DOCKER_INFO"); }
    const options = info.SecurityOptions;
    if (info.OSType !== "linux" || !Array.isArray(options) || !options.includes("name=rootless") ||
        !options.some((s: string) => s.startsWith("name=seccomp,") && s.includes("profile=builtin"))) throw new Error("ROOTLESS_SECCOMP_REQUIRED");
    if (String(info.CgroupVersion) !== "2" || info.CgroupDriver !== "systemd" ||
        info.MemoryLimit !== true || info.SwapLimit !== true || info.PidsLimit !== true || info.CpuCfsQuota !== true)
      throw new Error("SANDBOX_RESOURCE_ENFORCEMENT_REQUIRED");
    return { rootless: true, seccomp: "builtin", cgroup: 2, image: this.config.image };
  }
  async recoverInterrupted(options: { exclusiveSupervisorLockHeld: true }) {
    this.checkHost();
    if (!options.exclusiveSupervisorLockHeld || this.busy) throw new Error("EXCLUSIVE_SUPERVISOR_LOCK_REQUIRED");
    await this.probe();
    const result = await this.cli(["ps", "--all", "--filter", "label=emergentinc.sandbox=1", "--format", "{{.Names}}"]);
    if (result.code !== 0) throw new Error("SANDBOX_RECOVERY_REQUIRES_REVIEW");
    const names = result.stdout.split(/\r?\n/).filter(Boolean);
    for (const name of names) {
      if (!/^emergentinc-sandbox-[a-f0-9-]{36}$/.test(name)) throw new Error("SANDBOX_RECOVERY_REQUIRES_REVIEW");
      if ((await this.cli(["rm", "--force", name])).code !== 0) throw new Error("SANDBOX_RECOVERY_REQUIRES_REVIEW");
    }
    this.cleanupRequired = false;
    return { removed: names.length };
  }
  async run(source: string, input: unknown): Promise<unknown> {
    this.checkHost();
    if (this.cleanupRequired) throw new Error("SANDBOX_CLEANUP_REQUIRES_REVIEW");
    if (typeof source !== "string" || !source.trim() || Buffer.byteLength(source) > 65536) throw new Error("INVALID_AUTOMATION_SOURCE");
    const payload = JSON.stringify({ source, input });
    if (Buffer.byteLength(payload) > 600000) throw new Error("SANDBOX_INPUT_LIMIT");
    if (this.busy) throw new Error("SANDBOX_ALREADY_RUNNING");
    this.busy = true;
    const name = `emergentinc-sandbox-${randomUUID()}`;
    let created = false;
    try {
      await this.probe();
      // --pull=never and the digest prevent an implicit install or a mutable image tag.
      created = true; // Even a lost create response may have created a container.
      const result = await this.cli(["create", "--name", name, "--label", "emergentinc.sandbox=1", "--pull=never",
        "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
        "--user=65534:65534", "--pids-limit=32", "--memory=256m", "--memory-swap=256m", "--cpus=0.5",
        "--ulimit=nofile=64:64", "--ulimit=core=0:0", "--log-driver=none", "--restart=no", "--init",
        "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777", "--workdir=/tmp",
        "--env=NODE_OPTIONS=", "--env=NODE_PATH=", "--entrypoint=/usr/local/bin/node", "--interactive",
        this.config.image, "--input-type=module", "-e", loader]);
      if (result.code !== 0 || !/^[a-f0-9]{64}$/.test(result.stdout.trim())) throw new Error("SANDBOX_CREATE_FAILED");
      const receipt = await this.cli(["inspect", "--format", "{{json .}}", name]);
      if (receipt.code !== 0) throw new Error("SANDBOX_INSPECTION_FAILED");
      const container = JSON.parse(receipt.stdout), limits = container.HostConfig, config = container.Config;
      if (container.State?.Running || !limits || !config || !Array.isArray(container.Mounts) ||
          container.Mounts?.some((m: any) => m.Type !== "tmpfs" || m.Destination !== "/tmp" || m.Source) || config.Image !== this.config.image ||
          config.User !== "65534:65534" || limits.Privileged || !limits.ReadonlyRootfs || limits.NetworkMode !== "none" ||
          limits.Memory !== 268435456 || limits.MemorySwap !== 268435456 || limits.NanoCpus !== 500000000 || limits.PidsLimit !== 32 ||
          limits.CapAdd?.length || !limits.CapDrop?.includes("ALL") ||
          !limits.SecurityOpt?.includes("no-new-privileges=true") || limits.Binds?.length || limits.Devices?.length)
        throw new Error("SANDBOX_POLICY_MISMATCH");
      const output = await this.cli(["start", "--attach", "--interactive", name], payload, 15000, 65536);
      if (output.code !== 0) throw new Error("AUTOMATION_EXECUTION_FAILED");
      let parsed: any; try { parsed = JSON.parse(output.stdout); } catch { throw new Error("AUTOMATION_OUTPUT_INVALID"); }
      if (!parsed || !Object.hasOwn(parsed, "result")) throw new Error("AUTOMATION_OUTPUT_INVALID");
      return parsed.result;
    } finally {
      try {
        // A kill of the CLI is not a kill of the container. Always remove the exact container we created.
        if (created) {
          const removed = await this.cli(["rm", "--force", name]);
          if (removed.code !== 0) { this.cleanupRequired = true; throw new Error("SANDBOX_CLEANUP_REQUIRES_REVIEW"); }
        }
      } catch { this.cleanupRequired = true; throw new Error("SANDBOX_CLEANUP_REQUIRES_REVIEW"); }
      finally { this.busy = false; }
    }
  }
}
