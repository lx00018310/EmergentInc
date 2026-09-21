import { describe, it, expect, beforeEach } from "vitest";
import {
  ToolRegistry,
  ToolRuntime,
  registerAllBuiltinTools,
  probeVpsAvailability,
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

  it("should register only available native builtin tools", () => {
    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry);

    const registered = registry.listDefinitions();
    expect(registered).toHaveLength(7);

    const registeredNames = registered.map((r) => r.name);
    for (const item of manifest.filter((item: any) => !item.name.startsWith("vps_"))) {
      expect(registeredNames).toContain(item.name);
      const def = registry.get(item.name)?.definition;
      expect(def?.effect).toBe(item.effect);
    }
    expect(registeredNames).toContain("transfer_artifact");
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

  it("should support transfer_artifact (copy to direct neighbor) and preserve original", async () => {
    // 0. 播种接收方为真实活跃元胞 (transfer 校验 SQLite pixel_accounts)
    const { CoreStore } = await import("../../persistence/src/index.js");
    fs.mkdirSync(path.join(tmpDir, "ledger"), { recursive: true });
    const store = new CoreStore(path.join(tmpDir, "ledger", "v9_core.sqlite3"));
    try {
      store.pixels.upsertPixelAccount({ pixelId: "0_1_0", energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
    } finally {
      store.close();
    }

    // 1. 创建源文件
    await runtime.execute(
      "save_artifact",
      { filename: "db_guide.md", content: "# DB Guide Content" },
      ctx
    );

    // 2. 尝试复制给非直接邻居 (例如 5_5_5) 应被拒绝
    const nonNeighborRes = await runtime.execute(
      "transfer_artifact",
      { filename: "db_guide.md", target_pixel_id: "5_5_5" },
      ctx
    );
    expect(nonNeighborRes.status).toBe("FAILED");
    expect(nonNeighborRes.error_code).toBe("NON_NEIGHBOR_TRANSFER");

    // 3. 复制给直接邻居 (0_1_0) 应成功
    const transferRes = await runtime.execute(
      "transfer_artifact",
      { filename: "db_guide.md", target_pixel_id: "0_1_0" },
      ctx
    );
    expect(transferRes.status).toBe("SUCCESS");
    expect(transferRes.output.copied).toBe(true);
    expect(transferRes.output.from_pixel).toBe("0_0_0");
    expect(transferRes.output.to_pixel).toBe("0_1_0");

    // 4. 验证 A 原文件依然存在
    const readA = await runtime.execute(
      "read_artifact",
      { filename: "db_guide.md" },
      ctx
    );
    expect(readA.status).toBe("SUCCESS");
    expect(readA.output.content).toBe("# DB Guide Content");

    // 5. 验证 B 获得了完全相同的副本
    const ctxB = { ...ctx, pixelId: "0_1_0" };
    const readB = await runtime.execute(
      "read_artifact",
      { filename: "db_guide.md" },
      ctxB
    );
    expect(readB.status).toBe("SUCCESS");
    expect(readB.output.content).toBe("# DB Guide Content");
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
    fs.writeFileSync(path.join(privDir, "vps_owner_key"), "TEST_ONLY_PRIVATE_KEY_SENTINEL", "utf-8");

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
    expect(items).toHaveLength(3);

    const profileItem = items.find((i: any) => i.name === "owner_vps_profile.json");
    expect(profileItem.is_sensitive).toBe(true);

    const noteItem = items.find((i: any) => i.name === "notes.txt");
    expect(noteItem.is_sensitive).toBe(false);

    const keyItem = items.find((i: any) => i.name === "vps_owner_key");
    expect(keyItem.is_sensitive).toBe(true);
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

  it("should protect the configured passwordless VPS private key filename", async () => {
    const listRes = await runtime.execute("list_private_files", {}, ctx);
    expect(listRes.status).toBe("SUCCESS");
    const keyItem = listRes.output.items.find((i: any) => i.name === "vps_owner_key");
    expect(keyItem?.is_sensitive).toBe(true);

    const readRes = await runtime.execute(
      "read_private_file",
      { path: "vps_owner_key" },
      ctx
    );
    expect(readRes.status).toBe("FAILED");
    expect(readRes.error_code).toBe("SENSITIVE_FILE_PROTECTED");
    expect(JSON.stringify(readRes)).not.toContain("TEST_ONLY_PRIVATE_KEY_SENTINEL");
  });

  it("should reject sibling paths that only share the private directory prefix", async () => {
    const siblingDir = path.join(tmpDir, "private2");
    fs.mkdirSync(siblingDir, { recursive: true });
    fs.writeFileSync(path.join(siblingDir, "outside.txt"), "OUTSIDE_PRIVATE_ROOT", "utf-8");

    const res = await runtime.execute(
      "read_private_file",
      { path: "../private2/outside.txt" },
      ctx
    );
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("PATH_TRAVERSAL_FORBIDDEN");
    expect(JSON.stringify(res)).not.toContain("OUTSIDE_PRIVATE_ROOT");
  });

  it("allows a contained filename beginning with two dots", async () => {
    fs.writeFileSync(path.join(tmpDir, "private", "..notes.txt"), "contained", "utf-8");
    const result = await runtime.execute("read_private_file", { path: "..notes.txt" }, ctx);
    expect(result.status).toBe("SUCCESS");
    expect(result.output.content).toBe("contained");
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
    expect(res.error_code).toBe("TOOL_NOT_FOUND");
  });

  it("should reject vps_exec when command is empty", async () => {
    const res = await runtime.execute("vps_exec", { command: "" }, ctx);
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("TOOL_NOT_FOUND");
  });

  it("should not expose unimplemented VPS tools even with a mock context", async () => {
    const mockCtx: ToolContext = {
      ...ctx,
      mockVpsHandler: (tool, args) => ({
        exit_code: 0,
        stdout: "Linux mock-vps 5.15.0",
      }),
    };
    const res = await runtime.execute("vps_exec", { command: "uname -a" }, mockCtx);
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("TOOL_NOT_FOUND");
  });

  it("should correctly render prompt catalog and respect tools.json config overrides", () => {
    const initialCatalog = registry.renderCatalogForPrompt();
    expect(initialCatalog).toContain("- **`save_artifact`** (write):");
    expect(initialCatalog).not.toContain("vps_");

    // 禁用 vps_exec
    registry.applyConfigOverrides({
      tools: {
        vps_exec: { enabled: true },
        vps_read_file: { enabled: true },
        vps_write_file: { enabled: true },
        vps_upload_file: { enabled: true },
        vps_download_file: { enabled: true },
        vps_list_files: { enabled: true },
      },
    });

    const updatedCatalog = registry.renderCatalogForPrompt();
    expect(updatedCatalog).not.toContain("- **`vps_exec`**");
    expect(updatedCatalog).toContain("- **`save_artifact`**");
  });

  it("should validate configured vps_list_files without contacting a remote host", async () => {
    registerAllBuiltinTools(registry, undefined, { vpsListFilesAvailable: true });
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

describe("Tools: VPS Native Adapters (offline gates, no socket is opened)", () => {
  let tmpDir: string;
  let keyPath: string;

  const writeProfile = (profile: Record<string, any>) => {
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "private", "owner_vps_profile.json"),
      JSON.stringify(profile),
      "utf-8"
    );
  };

  const baseCtx = (): ToolContext => ({
    workspaceRoot: tmpDir,
    pixelId: "0_0_0",
    runId: "run_test",
    messageId: "msg_1",
    operationId: "op_vps_gate",
  });

  const runtimeWith = (tools: string[]) => {
    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry, undefined, { vpsAvailableTools: tools });
    return new ToolRuntime(registry);
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vps_gate_"));
    fs.mkdirSync(path.join(tmpDir, "live", "artifacts", "0_0_0"), { recursive: true });
    keyPath = path.join(tmpDir, "private", "test_id_ed25519");
    fs.mkdirSync(path.join(tmpDir, "private"), { recursive: true });
    fs.writeFileSync(keyPath, "dummy-private-key-material", "utf-8");
  });

  it("reports an unusable probe when no profile exists", () => {
    const probe = probeVpsAvailability(tmpDir);
    expect(probe.tools).toEqual([]);
    expect(probe.reason).toContain("owner_vps_profile.json");
  });

  it("rejects password-only credentials with an actionable reason instead of pretending to work", async () => {
    writeProfile({ host: "203.0.113.9", username: "root", password: "unused-in-test", allowed_operations: ["ssh_exec"] });
    const probe = probeVpsAvailability(tmpDir);
    expect(probe.tools).toEqual([]);
    expect(probe.reason).toContain("password auth");

    const res = await runtimeWith(["vps_exec"]).execute(
      "vps_exec",
      { command: "uname -a" },
      baseCtx()
    );
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("AUTH_METHOD_UNSUPPORTED");
    expect(res.error_message).toContain("key_path");
  });

  it("narrows advertised tools to the profile's allowed_operations", () => {
    writeProfile({
      host: "203.0.113.9",
      username: "root",
      key_path: keyPath,
      allowed_operations: ["ssh_list_files", "ssh_read_file"],
    });
    const probe = probeVpsAvailability(tmpDir);
    expect(probe.tools).toEqual(["vps_list_files", "vps_read_file"]);
    expect(probe.reason).toBeNull();

    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry, undefined, { vpsAvailableTools: probe.tools });
    const catalog = registry.renderCatalogForPrompt();
    expect(catalog).toContain("- **`vps_list_files`**");
    expect(catalog).toContain("- **`vps_read_file`**");
    expect(catalog).not.toContain("- **`vps_exec`**");
    expect(registry.listDefinitions()).toHaveLength(9);
  });

  it("reports AUTH_KEY_NOT_FOUND before touching the transport", async () => {
    writeProfile({
      host: "203.0.113.9",
      username: "root",
      key_path: path.join(tmpDir, "private", "absent_key"),
    });
    const res = await runtimeWith(["vps_list_files"]).execute(
      "vps_list_files",
      { path: "/var/log" },
      baseCtx()
    );
    expect(res.error_code).toBe("AUTH_KEY_NOT_FOUND");
  });

  it("denies operations the owner did not allow and paths outside remote_root", async () => {
    writeProfile({
      host: "203.0.113.9",
      username: "root",
      key_path: keyPath,
      allowed_operations: ["ssh_list_files", "ssh_read_file", "ssh_write_file"],
      remote_root: "/srv/www",
    });
    const runtime = runtimeWith([
      "vps_list_files",
      "vps_read_file",
      "vps_write_file",
      "vps_exec",
    ]);

    const notAllowed = await runtime.execute("vps_exec", { command: "id" }, baseCtx());
    expect(notAllowed.status).toBe("FAILED");
    expect(notAllowed.error_code).toBe("OPERATION_NOT_ALLOWED");
    expect(notAllowed.error_message).toContain("ssh_exec");

    const outOfScope = await runtime.execute(
      "vps_read_file",
      { path: "/etc/passwd" },
      baseCtx()
    );
    expect(outOfScope.error_code).toBe("PATH_OUT_OF_SCOPE");

    const injected = await runtime.execute(
      "vps_read_file",
      { path: "/srv/www/app.log; rm -rf /" },
      baseCtx()
    );
    expect(injected.error_code).toBe("INVALID_PATH");
  });

  it("fails with CAPABILITY_UNAVAILABLE instead of a forged SUCCESS when the profile disappears", async () => {
    const res = await runtimeWith(["vps_write_file"]).execute(
      "vps_write_file",
      { path: "/srv/www/a.txt", content: "hello" },
      baseCtx()
    );
    expect(res.status).toBe("FAILED");
    expect(res.error_code).toBe("CAPABILITY_UNAVAILABLE");
  });

  it("keeps every write-side adapter mock-testable", async () => {
    const runtime = runtimeWith(["vps_write_file", "vps_upload_file", "vps_download_file"]);
    const mockCtx: ToolContext = {
      ...baseCtx(),
      mockVpsHandler: (tool) => ({ ok: true, tool }),
    };
    for (const [tool, args] of [
      ["vps_write_file", { path: "/srv/www/a.txt", content: "x" }],
      ["vps_upload_file", { artifact_filename: "a.txt", remote_path: "/srv/www/a.txt" }],
      ["vps_download_file", { remote_path: "/srv/www/a.txt", artifact_filename: "a.txt" }],
    ] as [string, Record<string, any>][]) {
      const res = await runtime.execute(tool, args, mockCtx);
      expect(res.status).toBe("SUCCESS");
      expect(res.output.tool).toBe(tool);
    }
  });

  it("refuses artifact filenames that escape the pixel directory", async () => {
    writeProfile({ host: "203.0.113.9", key_path: keyPath });
    const runtime = runtimeWith(["vps_upload_file", "vps_download_file"]);
    const escape = await runtime.execute(
      "vps_download_file",
      { remote_path: "/srv/www/a.txt", artifact_filename: "../outside.txt" },
      baseCtx()
    );
    expect(escape.error_code).toBe("INVALID_ARGS");

    const missing = await runtime.execute(
      "vps_upload_file",
      { artifact_filename: "absent.txt", remote_path: "/srv/www/absent.txt" },
      baseCtx()
    );
    expect(missing.error_code).toBe("ARTIFACT_NOT_FOUND");
  });
});
