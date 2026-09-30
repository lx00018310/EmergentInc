import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BusinessStore, LineageStore, CurrentStore, migrateCurrentState, SqliteDatabase, writeGenerationPointer } from "../src/index.js";
import { LifeContext, readGenome } from "../../../apps/server/src/services/life_context.js";
import { migrateLifeWorkspace } from "../../../scripts/life-migrate.mjs";
import { inspectDatabase } from "../../../scripts/business-maintenance.mjs";

const cleanup: (() => void)[] = [];
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, chmodSync: vi.fn(actual.chmodSync) };
});
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "life-data-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "genome"));
  writeFileSync(join(root, "genome/manifest.json"), JSON.stringify({ schema_version: 1, generation: 1,
    body_interface_version: "1", protected_paths: ["genome/**"], capability_contracts: { "body_skill@1": {} } }));
  return root;
}
function stores(version = "1") {
  const lineage = new LineageStore(); cleanup.push(() => lineage.close());
  const old = new CurrentStore(), next = new CurrentStore(); cleanup.push(() => { old.close(); next.close(); });
  const g1 = lineage.createGeneration({ id: "G0001", number: 1, geneHash: "a".repeat(64), releaseId: "r1", state: "ACTIVE" });
  const g2 = lineage.createGeneration({ id: "G0002", number: 2, parentId: g1.id, geneHash: "b".repeat(64), releaseId: "r2" });
  old.initialize(g1, "1"); next.initialize(g2, version);
  return { lineage, old, next };
}
describe("V22 life data boundary", () => {
  it("keeps the atomic generation pointer readable under a private supervisor umask", () => {
    const root = workspace(), file = join(root, "active-generation.json"), previousMask = process.umask(0o077);
    try {
      writeGenerationPointer(root, "G0001"); chmodSync(file, 0o600);
      writeGenerationPointer(root, "G0002");
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ generation_id: "G0002" });
      // Windows cannot model POSIX identities; verify the OS permission request here and actual mode on POSIX.
      expect(chmodSync).toHaveBeenLastCalledWith(expect.stringContaining(`${file}.`), 0o644);
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o644);
    } finally { process.umask(previousMask); }
  });
  it("migrates an offline V21 snapshot with counts and SHA evidence while retaining the source", async () => {
    const root = workspace(), source = join(root, "ledger/business.sqlite3");
    const business = new BusinessStore(source); business.addDataset("ancestor", "历史", [{ a: 1 }]); business.close();
    const before = inspectDatabase(source);
    const report = await migrateLifeWorkspace(root, root, "test-release");
    expect(report.backup.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(report.after.counts.business_datasets).toBe(1); expect(report.after.schemaVersion).toBe(2);
    expect(inspectDatabase(source)).toEqual(before);
    expect(existsSync(join(root, "lineage/migration-report.json"))).toBe(true);
    const { manifest, geneHash } = readGenome(root); const life = LifeContext.open(root, manifest, geneHash, "test-release");
    expect(life.lineage.dataset("ancestor")).toBeTruthy(); expect(life.current.meta().generation_id).toBe("G0001"); life.close();
    await expect(migrateLifeWorkspace(root, root)).rejects.toThrow("TARGET_MUST_BE_NEW");
  });
  it("adds life tables without rebuilding V21 tables and rejects unknown versions", () => {
    const root = workspace(), file = join(root, "business.sqlite3");
    const business = new BusinessStore(file); business.addDataset("dataset", "祖先资料", [{ amount: 8 }]);
    const schema = business.db.prepare("SELECT sql FROM sqlite_master WHERE name='business_datasets'").get()!.sql;
    business.close();
    const lineage = new LineageStore(file);
    expect(lineage.dataset("dataset")?.content).toBe('[{"amount":8}]');
    expect(lineage.db.prepare("SELECT sql FROM sqlite_master WHERE name='business_datasets'").get()!.sql).toBe(schema);
    expect(lineage.db.prepare("PRAGMA user_version").get()!.user_version).toBe(2); lineage.close();
    const db = new SqliteDatabase(file); db.exec("PRAGMA user_version=999"); db.close();
    expect(() => new LineageStore(file)).toThrow("UNSUPPORTED_LINEAGE_SCHEMA_VERSION");
  });
  it("opens exactly one active Current plus Lineage, bounds retrieval, and detects pointer mismatch", () => {
    const root = workspace(), { manifest, geneHash } = readGenome(root);
    const life = LifeContext.open(root, manifest, geneHash, "r1");
    for (let i = 0; i < 30; i++) life.lineage.remember("G0001", "experience", { point: `事实 ${i}`, reason: "理由", effect: "影响" }, `fact:${i}`);
    life.current.setWorkingState("business", { stage: "alive" }, true);
    expect(life.load("business", "task").memories).toHaveLength(20);
    expect(life.current.meta().body_revision).toBe(0); life.close();
    const reopened = LifeContext.open(root, manifest, geneHash, "r1"); expect(reopened.current.state("business")!.carry_forward).toBe(1); reopened.close();
    writeFileSync(join(root, "active-generation.json"), '{"generation_id":"G0002"}');
    expect(() => LifeContext.open(root, manifest, geneHash, "r1")).toThrow("POINTER_MISMATCH");
  });
  it("does not silently migrate an existing business workspace", () => {
    const root = workspace(); const b = new BusinessStore(join(root, "ledger/business.sqlite3")); b.close();
    const { manifest, geneHash } = readGenome(root);
    expect(() => LifeContext.open(root, manifest, geneHash, "r1")).toThrow("EXPLICIT_MIGRATION_REQUIRED");
    expect(existsSync(join(root, "lineage/lineage.sqlite3"))).toBe(false);
  });
  it("copies only explicitly carried open state, never business data or event cursors", () => {
    const { old, next, lineage } = stores();
    old.setWorkingState("keep", { stage: 1 }, true); old.setWorkingState("scratch", { stage: 2 });
    old.setObjective("keep", "business", "继续目标", "OPEN", true);
    old.setObjective("closed", "business", "已结束", "COMPLETED", true);
    old.setObjective("temporary", "business", "临时目标", "OPEN");
    old.need("keep-need", "business", "待补能力", "实际缺失", true); old.need("temporary-need", "business", "临时", "证据");
    lineage.remember("G0001", "experience", { point: "祖先记忆", reason: "经历", effect: "保留" }, "memory:1");
    migrateCurrentState(old, next);
    expect(next.state("keep")).toBeTruthy(); expect(next.state("scratch")).toBeNull();
    expect(next.objectives("business").map(r => r.id)).toEqual(["keep"]);
    expect(next.db.prepare("SELECT id FROM body_needs").all().map(r => r.id)).toEqual(["keep-need"]);
    expect(next.db.prepare("SELECT * FROM current_events").all()).toHaveLength(0);
    expect(next.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'business_%'").all()).toHaveLength(0);
    expect(lineage.relevantMemories()).toHaveLength(1);
  });
  it("preserves memory after abandoning a failed Current database", () => {
    const { old, next, lineage } = stores();
    next.setWorkingState("business", { failed: true });
    lineage.remember("G0002", "generation_failure", { point: "失败", reason: "启动失败", effect: "改正" }, "failure:2");
    expect(old.state("business")).toBeNull();
    expect(lineage.relevantMemories()[0]!.generation_id).toBe("G0002");
    expect(lineage.generations()).toHaveLength(2);
  });
  it("requires an explicit Owner direction decision and refuses a changed decision", () => {
    const { lineage } = stores();
    const proposal = lineage.proposeGene("G0001", "owner", { point: "新增能力契约", reason: "身体受限", effect: "下一代可用" });
    expect(proposal.state).toBe("PROPOSED");
    lineage.decideProposal(proposal.id, "APPROVED");
    expect(() => lineage.decideProposal(proposal.id, "REJECTED")).toThrow("NOT_APPROVABLE");
  });
});
