import { describe, expect, it, vi } from "vitest";
import { RootlessSandbox, SandboxCommand } from "../src/business/rootless_sandbox.js";

const config = { dockerPath: "/usr/bin/docker", socket: "unix:///run/user/1001/docker.sock", image: `node@sha256:${"a".repeat(64)}` };
function fixture() {
  const info = { OSType: "linux", SecurityOptions: ["name=rootless", "name=seccomp,profile=builtin"],
    CgroupVersion: "2", CgroupDriver: "systemd", MemoryLimit: true, SwapLimit: true, PidsLimit: true, CpuCfsQuota: true };
  const container = { State: { Running: false }, Config: { Image: config.image, User: "65534:65534" }, Mounts: [], HostConfig: {
    Privileged: false, ReadonlyRootfs: true, NetworkMode: "none", Memory: 268435456, MemorySwap: 268435456,
    NanoCpus: 500000000, PidsLimit: 32, CapAdd: [], CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges=true"], Binds: [], Devices: [],
  } };
  const executor = vi.fn(async (c: SandboxCommand) => {
    const action = c.args[2];
    return { code: 0, stderr: "", stdout: action === "info" ? JSON.stringify(info) : action === "create" ? "b".repeat(64) :
      action === "inspect" ? JSON.stringify(container) : action === "start" ? '{"result":{"rows":2}}' : "" };
  });
  return { info, container, executor, runner: new RootlessSandbox(config, executor, { platform: "linux", uid: 1001 }) };
}
describe("rootless isolation boundary (command contract tests, not Linux acceptance)", () => {
  it("refuses host execution on Windows, root, mutable images or a different daemon", async () => {
    const { executor } = fixture();
    await expect(new RootlessSandbox(config, executor, { platform: "win32", uid: -1 }).run("export default x=>x", {})).rejects.toThrow("ROOTLESS_LINUX_REQUIRED");
    await expect(new RootlessSandbox(config, executor, { platform: "linux", uid: 0 }).probe()).rejects.toThrow("ROOTLESS_LINUX_REQUIRED");
    await expect(new RootlessSandbox({ ...config, image: "node:24" }, executor, { platform: "linux", uid: 1001 }).probe()).rejects.toThrow("INVALID_SANDBOX_CONFIGURATION");
    await expect(new RootlessSandbox({ ...config, socket: "tcp://remote:2375" }, executor, { platform: "linux", uid: 1001 }).probe()).rejects.toThrow("INVALID_SANDBOX_CONFIGURATION");
    expect(executor).not.toHaveBeenCalled();
  });
  it("requires actual rootless, seccomp and delegated resource controllers before creating a container", async () => {
    const { info, runner, executor } = fixture(); info.SecurityOptions = ["name=seccomp,profile=builtin"];
    await expect(runner.run("export default x=>x", {})).rejects.toThrow("ROOTLESS_SECCOMP_REQUIRED");
    info.SecurityOptions.push("name=rootless"); info.MemoryLimit = false;
    await expect(runner.run("export default x=>x", {})).rejects.toThrow("SANDBOX_RESOURCE_ENFORCEMENT_REQUIRED");
    expect(executor.mock.calls.every(([c]) => c.args[2] === "info")).toBe(true);
  });
  it("passes only explicit data through stdin and never mounts host paths or inherits credentials", async () => {
    const { runner, executor } = fixture();
    await expect(runner.run("export default x=>x", { rows: [1, 2] })).resolves.toEqual({ rows: 2 });
    const create = executor.mock.calls.find(([c]) => c.args[2] === "create")![0];
    expect(create.args).toContain("--network=none"); expect(create.args).toContain("--pull=never"); expect(create.args).toContain("--read-only");
    expect(create.args.some(a => /--mount|--volume|--privileged|--env-file/.test(a))).toBe(false);
    expect(Object.keys(create.env).sort()).toEqual(["DOCKER_CONFIG", "HOME", "PATH"]);
    const start = executor.mock.calls.find(([c]) => c.args[2] === "start")![0];
    expect(JSON.parse(start.input!)).toEqual({ source: "export default x=>x", input: { rows: [1, 2] } });
    expect(start.timeoutMs).toBe(15000); expect(start.maxOutputBytes).toBe(65536);
    expect(executor.mock.calls.at(-1)![0].args.slice(2, 4)).toEqual(["rm", "--force"]);
  });
  it("rejects changed daemon mount policy before executing any code", async () => {
    const { container, runner, executor } = fixture(); container.HostConfig.Binds = ["/private:/private"] as never[];
    await expect(runner.run("export default x=>x", {})).rejects.toThrow("SANDBOX_POLICY_MISMATCH");
    expect(executor.mock.calls.some(([c]) => c.args[2] === "start")).toBe(false);
    expect(executor.mock.calls.at(-1)![0].args[2]).toBe("rm");
  });
  it("cleans up after timeout and refuses further runs when cleanup cannot be confirmed", async () => {
    const { runner, executor } = fixture(); const original = executor.getMockImplementation()!;
    executor.mockImplementation(async c => {
      if (c.args[2] === "start") throw new Error("SANDBOX_COMMAND_TIMEOUT");
      if (c.args[2] === "rm") return { code: 1, stdout: "", stderr: "daemon offline" };
      return original(c);
    });
    await expect(runner.run("export default x=>x", {})).rejects.toThrow("SANDBOX_CLEANUP_REQUIRES_REVIEW");
    const count = executor.mock.calls.length;
    await expect(runner.run("export default x=>x", {})).rejects.toThrow("SANDBOX_CLEANUP_REQUIRES_REVIEW");
    expect(executor).toHaveBeenCalledTimes(count);
  });
});
