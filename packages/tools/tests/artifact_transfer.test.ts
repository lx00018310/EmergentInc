import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { CoreStore } from "../../persistence/src/core_store.js";
import { ToolContext, ToolRegistry, ToolRuntime, registerAllBuiltinTools } from "../src/index.js";

describe("transfer_artifact: canonical recipients and atomic name rejection", () => {
  let root: string;
  let store: CoreStore;
  let runtime: ToolRuntime;
  let ctx: ToolContext;
  const sender = "0_0_0";
  const recipient = "0_1_0";
  const filename = "history.txt";
  const content = "Immutable knowledge — 历史\n";
  const artifactDir = (id: string) => path.join(root, "live", "artifacts", id);
  const artifact = (id: string) => path.join(artifactDir(id), filename);
  const transfer = (target = recipient, context = ctx) => runtime.execute(
    "transfer_artifact", { filename, target_pixel_id: target }, context,
  );
  const saveSource = () => runtime.execute("save_artifact", { filename, content }, ctx);
  const addRecipient = (active = true) => store.pixels.upsertPixelAccount({
    pixelId: recipient, energy: 100, active, refundDeficitTokens: 0, spendBlockedReason: null,
  });
  const writeDiskState = (active: boolean) => {
    const dir = path.join(root, "live", "pixels", recipient);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "state.json"), JSON.stringify({ pixel_id: recipient, active }));
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact_transfer_"));
    store = new CoreStore(path.join(root, "ledger", "v9_core.sqlite3"));
    store.pixels.upsertPixelAccount({
      pixelId: sender, energy: 100, active: true, refundDeficitTokens: 0, spendBlockedReason: null,
    });
    const registry = new ToolRegistry();
    registerAllBuiltinTools(registry);
    runtime = new ToolRuntime(registry);
    ctx = { workspaceRoot: root, pixelId: sender, runId: "run", messageId: "msg", operationId: "op" };
  });

  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("copies to an active canonical neighbor without requiring a pixel directory", async () => {
    addRecipient();
    await saveSource();
    expect(fs.existsSync(path.join(root, "live", "pixels", recipient))).toBe(false);
    const result = await transfer();
    expect(result.status).toBe("SUCCESS");
    expect(result.output).toMatchObject({
      from_pixel: sender, to_pixel: recipient, filename, copied: true,
      size_bytes: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
    expect(fs.readFileSync(artifact(sender), "utf8")).toBe(content);
    expect(fs.readFileSync(artifact(recipient), "utf8")).toBe(content);
  });

  it("rejects a nonexistent neighbor despite a live disk state, without creating artifacts", async () => {
    writeDiskState(true);
    expect((await transfer()).error_code).toBe("TARGET_PIXEL_NOT_FOUND");
    expect(fs.existsSync(path.join(root, "live", "artifacts"))).toBe(false);
    expect(store.pixels.getPixelAccount(recipient)).toBeNull();
  });

  it("does not treat an existing artifact directory as a real Pixel", async () => {
    await saveSource();
    fs.mkdirSync(artifactDir(recipient), { recursive: true });
    expect((await transfer()).error_code).toBe("TARGET_PIXEL_NOT_FOUND");
    expect(fs.readdirSync(artifactDir(recipient))).toEqual([]);
    expect(fs.readFileSync(artifact(sender), "utf8")).toBe(content);
  });

  it("rejects a canonically inactive Pixel despite an active disk state", async () => {
    addRecipient(false);
    writeDiskState(true);
    await saveSource();
    expect((await transfer()).error_code).toBe("TARGET_PIXEL_INACTIVE");
    expect(fs.existsSync(artifactDir(recipient))).toBe(false);
    expect(fs.readFileSync(artifact(sender), "utf8")).toBe(content);
  });

  it("accepts an active account despite an inactive disk state", async () => {
    addRecipient();
    writeDiskState(false);
    await saveSource();
    expect((await transfer()).status).toBe("SUCCESS");
  });

  it("rechecks canonical liveness on every transfer", async () => {
    addRecipient();
    await saveSource();
    expect((await transfer()).status).toBe("SUCCESS");
    store.pixels.setActive(recipient, false);
    expect((await transfer()).error_code).toBe("TARGET_PIXEL_INACTIVE");
    expect(fs.readFileSync(artifact(recipient), "utf8")).toBe(content);
  });

  it.each(["Recipient's different history", content])("rejects existing same-name history (%s) untouched", async (history) => {
    addRecipient();
    await saveSource();
    fs.mkdirSync(artifactDir(recipient), { recursive: true });
    fs.writeFileSync(artifact(recipient), history);
    const before = fs.statSync(artifact(recipient));
    const result = await transfer();
    expect(result.status).toBe("FAILED");
    expect(result.error_code).toBe("ARTIFACT_NAME_CONFLICT");
    expect(fs.readFileSync(artifact(recipient), "utf8")).toBe(history);
    expect(fs.statSync(artifact(recipient)).mtimeMs).toBe(before.mtimeMs);
    expect(fs.readFileSync(artifact(sender), "utf8")).toBe(content);
    expect(fs.readdirSync(artifactDir(recipient))).toEqual([filename]);
  });

  it("allows only one of competing same-name transfers", async () => {
    addRecipient();
    await saveSource();
    const other = { ...ctx, pixelId: "1_1_0", operationId: "other" };
    await runtime.execute("save_artifact", { filename, content: "Other history" }, other);
    const results = await Promise.all([transfer(), transfer(recipient, other)]);
    expect(results.filter((r) => r.status === "SUCCESS")).toHaveLength(1);
    expect(results.filter((r) => r.error_code === "ARTIFACT_NAME_CONFLICT")).toHaveLength(1);
    expect(fs.readFileSync(artifact(recipient), "utf8")).toBe(content);
    expect(fs.readFileSync(artifact(sender), "utf8")).toBe(content);
    expect(fs.readFileSync(artifact(other.pixelId), "utf8")).toBe("Other history");
  });

  it("rejects a missing source without creating either artifact directory", async () => {
    addRecipient();
    expect((await transfer()).error_code).toBe("FILE_NOT_FOUND");
    expect(fs.existsSync(path.join(root, "live", "artifacts"))).toBe(false);
  });

  it("fails closed on a missing database without creating a database or ghost directories", async () => {
    const emptyRoot = path.join(root, "empty_workspace");
    fs.mkdirSync(emptyRoot);
    const result = await transfer(recipient, { ...ctx, workspaceRoot: emptyRoot });
    expect(result.status).toBe("FAILED");
    expect(result.error_code).toBe("TARGET_STATE_UNAVAILABLE");
    expect(fs.readdirSync(emptyRoot)).toEqual([]);
  });

  it("fails closed on corrupt canonical storage without falling back to disk state", async () => {
    const corruptRoot = path.join(root, "corrupt_workspace");
    fs.mkdirSync(path.join(corruptRoot, "ledger"), { recursive: true });
    const dbPath = path.join(corruptRoot, "ledger", "v9_core.sqlite3");
    fs.writeFileSync(dbPath, "not a database");
    const result = await transfer(recipient, { ...ctx, workspaceRoot: corruptRoot });
    expect(result.error_code).toBe("TARGET_STATE_UNAVAILABLE");
    expect(fs.existsSync(path.join(corruptRoot, "live"))).toBe(false);
    expect(fs.readFileSync(dbPath, "utf8")).toBe("not a database");
  });

  it.each([
    [sender, "SELF_TRANSFER_DISALLOWED"],
    ["0_2_0", "NON_NEIGHBOR_TRANSFER"],
    ["../bad", "INVALID_TARGET_ID"],
  ])("preserves validation for target %s without creating directories", async (target, error) => {
    expect((await transfer(target)).error_code).toBe(error);
    expect(fs.existsSync(path.join(root, "live"))).toBe(false);
  });
});
