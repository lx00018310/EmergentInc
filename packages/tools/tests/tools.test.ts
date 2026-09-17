import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolRegistry,
  ToolRuntime,
  registerAllBuiltinTools,
  ToolContext,
} from "../src/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Tools: Registry & Manifest Baseline", () => {
  const manifestPath = path.resolve(
    __dirname,
    "../../../tests/fixtures/golden/tools_manifest.json"
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  it("should register all 12 builtin tools matching the V9 manifest", () => {
    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry);

    const registered = registry.listDefinitions();
    expect(registered).toHaveLength(12);

    const registeredNames = registered.map((r) => r.name);
    for (const item of manifest) {
      expect(registeredNames).toContain(item.name);
      const def = registry.get(item.name)?.definition;
      expect(def?.effect).toBe(item.effect);
    }
  });
});

describe("Tools: Artifact Tools (save_artifact, read_artifact, list_artifacts)", () => {
  let tmpDir: string;
  let registry: ToolRegistry;
  let runtime: ToolRuntime;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tools_test_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });

    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    runtime = new ToolRuntime(registry);

    ctx = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "run_test",
      messageId: "msg_1",
      operationId: "op_1",
    };
  });

  it("should save, list, and read artifacts successfully", async () => {
    // 1. save_artifact
    const saveRes = await runtime.execute(
      "save_artifact",
      { filename: "report.txt", content: "Analysis complete." },
      ctx
    );
    expect(saveRes.status).toBe("SUCCESS");
    expect(saveRes.output.filename).toBe("report.txt");
    expect(saveRes.output.sha256).toBeDefined();

    // 2. list_artifacts
    const listRes = await runtime.execute("list_artifacts", {}, ctx);
    expect(listRes.status).toBe("SUCCESS");
    expect(listRes.output.artifacts).toHaveLength(1);
    expect(listRes.output.artifacts[0].filename).toBe("report.txt");

    // 3. read_artifact
    const readRes = await runtime.execute(
      "read_artifact",
      { filename: "report.txt" },
      ctx
    );
    expect(readRes.status).toBe("SUCCESS");
    expect(readRes.output.content).toBe("Analysis complete.");
  });

  it("should prevent directory traversal attacks on artifacts", async () => {
    const res = await runtime.execute(
      "save_artifact",
      { filename: "../hack.txt", content: "malicious" },
      ctx
    );
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("INVALID_FILENAME");
  });

  it("should forbid cross-pixel reading", async () => {
    const res = await runtime.execute(
      "read_artifact",
      { filename: "report.txt", pixel_id: "1_0_0" },
      ctx
    );
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("CROSS_PIXEL_FORBIDDEN");
  });
});

describe("Tools: Private Files & Security Masking", () => {
  let tmpDir: string;
  let registry: ToolRegistry;
  let runtime: ToolRuntime;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tools_priv_"));
    const privDir = path.join(tmpDir, "private");
    fs.mkdirSync(privDir, { recursive: true });

    // 创建测试文件与凭据文件
    fs.writeFileSync(path.join(privDir, "notes.txt"), "Secret business idea", "utf-8");
    fs.writeFileSync(
      path.join(privDir, "owner_vps_profile.json"),
      JSON.stringify({ host: "1.2.3.4", password: "SUPER_SECRET_PASSWORD" }),
      "utf-8"
    );

    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    runtime = new ToolRuntime(registry);

    ctx = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "run_test",
      messageId: "msg_1",
      operationId: "op_1",
    };
  });

  it("should list private files and mark sensitive files", async () => {
    const res = await runtime.execute("list_private_files", {}, ctx);
    expect(res.status).toBe("SUCCESS");
    const items = res.output.items;
    expect(items).toHaveLength(2);

    const profileItem = items.find((i: any) => i.name === "owner_vps_profile.json");
    expect(profileItem.is_sensitive).toBe(true);

    const noteItem = items.find((i: any) => i.name === "notes.txt");
    expect(noteItem.is_sensitive).toBe(false);
  });

  it("should mask credentials when reading sensitive profile json", async () => {
    const res = await runtime.execute(
      "read_private_file",
      { path: "owner_vps_profile.json" },
      ctx
    );
    expect(res.status).toBe("SUCCESS");
    expect(res.output.is_masked).toBe(true);
    expect(res.output.content).not.toContain("SUPER_SECRET_PASSWORD");
    expect(res.output.content).toContain("[CREDENTIAL_MASKED]");
  });
});

describe("Tools: VPS Execution & Prompt Catalog", () => {
  let tmpDir: string;
  let registry: ToolRegistry;
  let runtime: ToolRuntime;
  let ctx: ToolContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vps_test_"));
    registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    runtime = new ToolRuntime(registry);

    ctx = {
      workspaceRoot: tmpDir,
      pixelId: "0_0_0",
      runId: "run_test",
      messageId: "msg_1",
      operationId: "op_vps_1",
    };
  });

  it("should fail gracefully when VPS profile/credentials are missing, without forging SUCCESS", async () => {
    const res = await runtime.execute("vps_exec", { command: "ls -la" }, ctx);
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("CAPABILITY_UNAVAILABLE");
    expect(res.error_message).toContain("unavailable");
  });

  it("should reject vps_exec when command is empty", async () => {
    const res = await runtime.execute("vps_exec", { command: "" }, ctx);
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("INVALID_COMMAND");
  });

  it("should successfully execute VPS operation when mock handler is injected in test context", async () => {
    const mockCtx: ToolContext = {
      ...ctx,
      mockVpsHandler: (tool, args) => ({
        exit_code: 0,
        stdout: "Linux mock-vps 5.15.0",
      }),
    };
    const res = await runtime.execute("vps_exec", { command: "uname -a" }, mockCtx);
    expect(res.status).toBe("SUCCESS");
    expect(res.output.stdout).toContain("Linux mock-vps");
  });

  it("should correctly render prompt catalog and respect tools.json config overrides", () => {
    const initialCatalog = registry.renderCatalogForPrompt();
    expect(initialCatalog).toContain("- **`save_artifact`** (write):");
    expect(initialCatalog).toContain("- **`vps_exec`** (write):");

    // 禁用 vps_exec
    registry.applyConfigOverrides({
      tools: {
        vps_exec: { enabled: false },
      },
    });

    const updatedCatalog = registry.renderCatalogForPrompt();
    expect(updatedCatalog).not.toContain("- **`vps_exec`**");
    expect(updatedCatalog).toContain("- **`save_artifact`**");
  });

  it("should validate path and prevent injection attacks on vps_list_files", async () => {
    // 1. 空路径校验
    const emptyRes = await runtime.execute("vps_list_files", { path: "" }, ctx);
    expect(emptyRes.status).toBe("FAILED");
    expect(emptyRes.error_code).toBe("INVALID_PATH");

    // 2. 注入字符拦截
    const injectionRes = await runtime.execute(
      "vps_list_files",
      { path: "/var/log; rm -rf /" },
      ctx
    );
    expect(injectionRes.status).toBe("FAILED");
    expect(injectionRes.error_code).toBe("INVALID_PATH");
    expect(injectionRes.error_message).toContain("prohibited");

    // 3. 管道符拦截
    const pipeRes = await runtime.execute(
      "vps_list_files",
      { path: "/var/log | cat" },
      ctx
    );
    expect(pipeRes.status).toBe("FAILED");
    expect(pipeRes.error_code).toBe("INVALID_PATH");

    // 4. Mock 适配器正常工作
    const mockCtx: ToolContext = {
      ...ctx,
      mockVpsHandler: (tool, args) => `total 4\n-rw-r--r-- 1 root root 123 test.txt`,
    };
    const okRes = await runtime.execute("vps_list_files", { path: "/var/log" }, mockCtx);
    expect(okRes.status).toBe("SUCCESS");
    expect(okRes.output).toContain("test.txt");
  });
});
