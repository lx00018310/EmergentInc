import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CurrentStore, LineageStore, readGenome, SqliteDatabase } from "@emergentinc/persistence";
import { LifeContext } from "../src/services/life_context.js";
import { DreamService } from "../src/services/dream_service.js";
import { BodyGrowthService } from "../src/services/body_growth_service.js";
import { BodySkillSupervisor } from "../src/services/automation_supervisor.js";
import { GenerationSupervisor } from "../../../supervisor/generation_supervisor.js";
import { classifyChange, EvolutionRuntime } from "../../../supervisor/protocol.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
const point = { point: "改进基础接口", reason: "出现重复的边界需求", effect: "新一代继续未结束目标" };
function fixture() {
  const directory = fs.mkdtempSync(join(tmpdir(), "generation-")); cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  const releases = join(directory, "releases"), workspace = join(directory, "workspace"), base = join(releases, "r1");
  const manifest = { schema_version: 1 as const, generation: 1, body_interface_version: "1", protected_paths: ["genome/**", "apps/server/**"], capability_contracts: {} };
  fs.mkdirSync(join(base, "genome"), { recursive: true }); fs.mkdirSync(join(base, "apps/server"), { recursive: true });
  fs.writeFileSync(join(base, "genome/manifest.json"), JSON.stringify(manifest)); fs.writeFileSync(join(base, "apps/server/core.txt"), "V21 core");
  fs.mkdirSync(join(base, "packages/runtime"), { recursive: true });
  fs.writeFileSync(join(base, "packages/runtime/index.ts"), "export const runtime = true;");
  fs.writeFileSync(join(base, ".env"), "DO_NOT_COPY=secret");
  let currentRelease = base;
  const initial = readGenome(base);
  let app: LifeContext | undefined = LifeContext.open(workspace, initial.manifest, initial.geneHash, "r1");
  const lineage = new LineageStore(join(workspace, "lineage/lineage.sqlite3")); cleanup.push(() => lineage.close());
  const finalDream = vi.fn(async () => { if (app) await new DreamService(app, async () => JSON.stringify({ memories: [], gene_proposals: [] })).finalDream(); });
  const runtime: EvolutionRuntime = {
    validateRelease: vi.fn(async candidate => { fs.mkdirSync(join(candidate, "apps/server/dist"), { recursive: true }); fs.writeFileSync(join(candidate, "apps/server/dist/main.js"), "trusted build output"); }),
    quiesce: vi.fn(async () => {}), finalDream,
    smoke: vi.fn(async (release, candidateWorkspace, generation) => {
      expect(fs.readFileSync(join(release, "packages/runtime/index.ts"), "utf8")).toBe("export const runtime = true;");
      expect(candidateWorkspace).not.toBe(workspace); expect(fs.existsSync(join(candidateWorkspace, "private"))).toBe(false);
      expect(fs.existsSync(join(release, ".env"))).toBe(false);
      const genome = readGenome(release), candidate = LifeContext.open(candidateWorkspace, genome.manifest, genome.geneHash, "candidate");
      try {
        expect(candidate.current.meta().generation_id).toBe(generation);
        candidate.lineage.event(null, "candidate-only", {});
      } finally { candidate.close(); }
    }),
    stop: vi.fn(async () => { app?.close(); app = undefined; }),
    switchRelease: vi.fn(async release => { currentRelease = release; }),
    start: vi.fn(async () => { const genome = readGenome(currentRelease); app = LifeContext.open(workspace, genome.manifest, genome.geneHash, currentRelease.split(/[\\/]/).at(-1)!); }),
    healthy: vi.fn(async generation => { expect(app!.current.meta().generation_id).toBe(generation); }),
    resume: vi.fn(async () => {}),
    postRollbackDream: vi.fn(async input => { await new DreamService(app!, async () => JSON.stringify({
      memories: [{ point: "失败后经验", reason: "冻结的 Current 证据", effect: "后续避免" }], gene_proposals: [] })).postRollback(input); }),
  };
  const supervisor = new GenerationSupervisor(join(directory, "trusted"), workspace, releases, lineage, runtime, true);
  cleanup.push(() => { app?.close(); supervisor.close(); });
  const prepare = async (id: string, interfaceVersion = "1") => {
    const active = lineage.activeGeneration()!, number = Number(lineage.generations()[0]!.generation_no) + 1;
    const p = lineage.proposeGene(active.id, "owner", point); lineage.decideProposal(p.id, "APPROVED");
    supervisor.submit({ id, base_generation: active.id, base_release: active.release_id, proposal_id: p.id,
      patch: [{ path: "genome/manifest.json", content: JSON.stringify({ ...manifest, generation: number, body_interface_version: interfaceVersion }) },
        { path: "apps/server/core.txt", content: `changed ${id}` }] });
    const c = await supervisor.validate(id); return c;
  };
  return { directory, releases, workspace, lineage, runtime, supervisor, prepare, app: () => app! };
}
describe("trusted Generation lifecycle (local runtime contract doubles)", () => {
  it("runs the complete local life cycle: grow, remember, approve exact Gene, birth, migrate and retire", async () => {
    const f = fixture(), life = f.app();
    life.current.setObjective("keep", "business", "继续目标", "OPEN", true); life.current.setObjective("scratch", "business", "临时目标");
    life.current.setWorkingState("business", { stage: "alive" }, true);
    const runner = { probe: vi.fn(async () => ({ rootless: true, seccomp: "builtin", cgroup: 2, image: `node@sha256:${"a".repeat(64)}` })),
      recoverInterrupted: vi.fn(async () => ({ removed: 0 })), runBody: vi.fn(async (_source: string, input: any) => ({ count: input.rows.length })) };
    const body = new BodySkillSupervisor(life.current, life.lineage, runner, join(f.workspace, "generations/G0001/body/skills"));
    await new BodyGrowthService(life, body, async () => JSON.stringify({ skill_id: "summary", purpose: "汇总", interface_version: "1",
      source: "export default x=>({count:x.rows.length});", tests: [{ input: { rows: [1] }, expected: { count: 1 } }] }))
      .grow({ id: "need1", pixel_id: "business", need: "统计行数", evidence: "确有缺失" });
    expect((await body.run("summary", { rows: [1, 2] })).result).toEqual({ count: 2 });
    expect(life.current.meta().body_revision).toBe(1); expect(f.lineage.activeGeneration()!.id).toBe("G0001");
    await new DreamService(life, async () => JSON.stringify({ memories: [{ point: "汇总已成功", reason: "有执行回执", effect: "后续复用" }], gene_proposals: [point] })).run();
    const p = f.lineage.proposals()[0]!; f.lineage.decideProposal(String(p.id), "APPROVED");
    const manifest = readGenome(join(f.releases, "r1")).manifest;
    f.supervisor.submit({ id: "r2", base_generation: "G0001", base_release: "r1", proposal_id: String(p.id), patch: [
      { path: "genome/manifest.json", content: JSON.stringify({ ...manifest, generation: 2 }) }, { path: "apps/server/core.txt", content: "new interface" }] });
    const validated = await f.supervisor.validate("r2"); f.supervisor.approve("r2", validated.candidate.candidate_hash);
    expect((await f.supervisor.birth("r2")).state).toBe("BORN");
    expect(f.lineage.generation("G0001").state).toBe("RETIRED"); expect(f.lineage.activeGeneration()!.id).toBe("G0002");
    expect(f.app().current.objectives("business").map(o => o.id)).toEqual(["keep"]);
    expect(f.app().current.state("business")).toBeTruthy(); expect(f.app().current.skills()[0]!.state).toBe("ACTIVE");
    expect(f.app().lineage.relevantMemories({ kind: "dream" })).toHaveLength(1);
    expect(f.lineage.db.prepare("SELECT id FROM business_events WHERE kind='candidate-only'").all()).toHaveLength(0);
    expect(f.runtime.finalDream).toHaveBeenCalledTimes(1);
    expect((await f.supervisor.birth("r2")).state).toBe("BORN"); expect(f.runtime.switchRelease).toHaveBeenCalledTimes(1);
  });
  it("requires separate direction and exact candidate hash approval and checks immutable artifacts again at birth", async () => {
    const f = fixture(), c = await f.prepare("r2");
    await expect(f.supervisor.birth("r2")).rejects.toThrow("EXACT_CANDIDATE_APPROVAL_REQUIRED");
    expect(() => f.supervisor.approve("r2", "forged")).toThrow("HASH_CONFLICT");
    f.supervisor.approve("r2", c.candidate.candidate_hash);
    fs.writeFileSync(join(c.directory, "apps/server/dist/main.js"), "tampered output");
    await expect(f.supervisor.birth("r2")).rejects.toThrow("INTEGRITY_CONFLICT");
    expect(f.runtime.quiesce).not.toHaveBeenCalled();
  });
  it("rejects root changes, traversal, stale bases and unapproved directions", () => {
    const f = fixture(), p = f.lineage.proposeGene("G0001", "owner", point);
    const request = { id: "bad", base_generation: "G0001", base_release: "r1", proposal_id: p.id,
      patch: [{ path: "apps/server/core.txt", content: "new" }] };
    expect(() => f.supervisor.submit(request)).toThrow("DIRECTION_APPROVAL_REQUIRED"); f.lineage.decideProposal(p.id, "APPROVED");
    expect(() => f.supervisor.submit({ ...request, patch: [{ path: "supervisor/protocol.ts", content: "bypass" }] })).toThrow("ROOT_OF_TRUST_CHANGE_FORBIDDEN");
    expect(() => f.supervisor.submit({ ...request, patch: [{ path: "../private/key", content: "bypass" }] })).toThrow("INVALID_GENE_PATCH_PATH");
    expect(() => f.supervisor.submit({ ...request, base_release: "old" })).toThrow("BASE_CONFLICT");
    expect(classifyChange(["workspace/generations/G0001/body/skills/test.json"])).toBe("BODY");
    expect(classifyChange(["package.json"])).toBe("GENE");
    expect(classifyChange(["apps/recovery/src/server.ts"])).toBe("ROOT");
    expect(classifyChange(["scripts/local-upgrade.mjs"])).toBe("ROOT");
    for (const entry of ["scripts/local-release.mjs", "scripts/launch-approved.mjs", "scripts/v23-migration-dry-run.mjs", "EmergentInc_UI.bat", "EmergentInc_UI.ps1"])
      expect(() => f.supervisor.submit({ ...request, patch: [{ path: entry, content: "self approve" }] })).toThrow("ROOT_OF_TRUST_CHANGE_FORBIDDEN");
    expect(() => f.supervisor.submit({ ...request, patch: [{ path: "apps/recovery/src/server.ts", content: "self approve" }] })).toThrow("ROOT_OF_TRUST_CHANGE_FORBIDDEN");
  });
  it("keeps the old generation active when candidate smoke fails", async () => {
    const f = fixture(), c = await f.prepare("r2"); f.supervisor.approve("r2", c.candidate.candidate_hash);
    vi.mocked(f.runtime.smoke).mockRejectedValueOnce(new Error("CANDIDATE_READY_FAILED"));
    await expect(f.supervisor.birth("r2")).rejects.toThrow("CANDIDATE_READY_FAILED");
    expect(f.lineage.activeGeneration()!.id).toBe("G0001"); expect(f.lineage.generation("G0002").state).toBe("FAILED");
    expect(f.lineage.relevantMemories({ kind: "generation_failure" })).toHaveLength(1); expect(f.runtime.switchRelease).not.toHaveBeenCalled();
  });
  it("restores the preceding release and Current after formal health failure while preserving Lineage", async () => {
    const f = fixture(), c = await f.prepare("r2"); f.supervisor.approve("r2", c.candidate.candidate_hash);
    vi.mocked(f.runtime.healthy).mockImplementationOnce(async () => { f.app().lineage.remember("G0002", "experience", { point: "夭折前事实", reason: "有证据", effect: "仍保留" }, "before-fail");
      f.app().current.setWorkingState("business", { failed: true }); throw new Error("GENERATION_HEALTH_FAILED"); });
    await expect(f.supervisor.birth("r2")).rejects.toThrow("GENERATION_HEALTH_FAILED");
    expect(f.app().current.meta().generation_id).toBe("G0001"); expect(f.lineage.activeGeneration()!.id).toBe("G0001");
    expect(f.lineage.generation("G0002").state).toBe("FAILED"); expect(f.lineage.relevantMemories({ kind: "experience" })).toHaveLength(1);
    const pending = f.lineage.db.prepare("SELECT * FROM life_events WHERE kind='POST_ROLLBACK_DREAM_REQUIRED'").get()!;
    const frozen = JSON.parse(String(pending.payload)); expect(fs.existsSync(frozen.frozen_current)).toBe(true); expect(frozen.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rolls back a born generation without undoing memory, business cost, order or payment history", async () => {
    const f = fixture(), c = await f.prepare("r2"); f.supervisor.approve("r2", c.candidate.candidate_hash); await f.supervisor.birth("r2");
    f.lineage.remember("G0002", "experience", { point: "G2 的重要经历", reason: "实际发生", effect: "继续存在" }, "g2-fact");
    // Seed confirmed immutable facts in the real Lineage DB, including foreign-key-linked ledger rows.
    f.lineage.db.prepare("INSERT INTO business_plans VALUES('p','test',1,'COMPLETED',?)").run(Date.now());
    f.lineage.db.prepare("INSERT INTO business_plan_revisions VALUES('p',1,'h','{}',?)").run(Date.now());
    f.lineage.db.prepare("INSERT INTO business_operations VALUES('cost','draft','p','test','h','{}',0,'SETTLED',NULL,?,NULL)").run(Date.now());
    f.lineage.db.prepare("INSERT INTO business_cost_entries VALUES('cost',123,'{}',?)").run(Date.now());
    f.lineage.db.prepare("INSERT INTO business_orders VALUES('order','p',1,'delivery','customer',100,'CNY','confirmed','accepted',1,'evidence',?)").run(Date.now());
    f.lineage.db.prepare("INSERT INTO business_payment_events VALUES('payment','order','provider','account','event','payment',100,'CNY',NULL,'external','owner_confirmed','evidence','h',?)").run(Date.now());
    await f.supervisor.rollback("r2", "Owner requested controlled rollback");
    expect(f.app().current.meta().generation_id).toBe("G0001"); expect(f.lineage.generation("G0002").state).toBe("ROLLED_BACK");
    expect(f.lineage.totals().spentMicros).toBe(123); expect(f.lineage.evidence.order("order").paidMicros).toBe(100);
    expect(f.lineage.relevantMemories({ kind: "experience" })).toHaveLength(1); expect(f.lineage.generations()).toHaveLength(2);
    expect(f.runtime.finalDream).toHaveBeenCalledTimes(1); // No Dream blocks the emergency rollback.
  });
  it("marks inherited skills for revalidation when the Body interface changes", async () => {
    const f = fixture(), life = f.app();
    const source = JSON.stringify({ skill_id: "skill", purpose: "skill", source: "export default x=>x;", interface_version: "1", tests: [{ input: {}, expected: {} }] });
    const skills = join(f.workspace, "generations/G0001/body/skills/skill"); fs.mkdirSync(skills, { recursive: true }); fs.writeFileSync(join(skills, "change.json"), source);
    life.current.db.prepare("INSERT INTO body_candidates(id,skill_id,candidate_json,request_hash,state,created_at) VALUES('change','skill',?,'hash','ACTIVE',?)").run(source, Date.now());
    life.current.db.prepare("INSERT INTO body_skills VALUES('skill','skill','change','1','ACTIVE',0,0,?)").run(Date.now());
    const c = await f.prepare("r2", "2"); f.supervisor.approve("r2", c.candidate.candidate_hash); await f.supervisor.birth("r2");
    expect(f.app().current.skills()[0]!.state).toBe("REVALIDATION_REQUIRED");
  });
  it("fails G0003 after G0002 was born, restores G0002 and later dreams from the frozen failed Current", async () => {
    const f = fixture(), second = await f.prepare("r2"); f.supervisor.approve("r2", second.candidate.candidate_hash); await f.supervisor.birth("r2");
    const third = await f.prepare("r3"); f.supervisor.approve("r3", third.candidate.candidate_hash);
    vi.mocked(f.runtime.healthy).mockImplementationOnce(async () => { f.app().current.setWorkingState("business", { failure: "startup" }); throw new Error("G3_START_FAILED"); });
    await expect(f.supervisor.birth("r3")).rejects.toThrow("G3_START_FAILED");
    expect(f.lineage.activeGeneration()!.id).toBe("G0002"); expect(f.lineage.generation("G0003").state).toBe("FAILED");
    await f.supervisor.postRollbackDream("r3"); await f.supervisor.postRollbackDream("r3");
    expect(f.lineage.relevantMemories({ kind: "dream", generationId: "G0003" })).toHaveLength(1);
    expect(f.lineage.db.prepare("SELECT id FROM dream_runs WHERE trigger='post_rollback' AND status='COMPLETED'").all()).toHaveLength(1);
  });
  it("uses its durable journal to restore after a process interruption at the release switch", async () => {
    const f = fixture(), c = await f.prepare("r2"); f.supervisor.approve("r2", c.candidate.candidate_hash); await f.supervisor.birth("r2");
    const journal = new SqliteDatabase(join(f.directory, "trusted/evolution.sqlite3"));
    journal.prepare("UPDATE candidates SET state='BIRTHING',phase='STARTING' WHERE id='r2'").run(); journal.close();
    await f.supervisor.recover();
    expect(f.app().current.meta().generation_id).toBe("G0001"); expect(f.lineage.generation("G0002").state).toBe("FAILED");
    expect(f.supervisor.get("r2").phase).toBe("RESTORED");
  });
  it.each(["before_generation", "before_current", "partial_current"])("abandons interrupted migration %s without stopping the old service or requiring a new Current", async stage => {
    const f = fixture(), c = await f.prepare("r2"); f.supervisor.approve("r2", c.candidate.candidate_hash);
    f.app().current.setWorkingState("business", { keep: "old service" }, true);
    const journal = new SqliteDatabase(join(f.directory, "trusted/evolution.sqlite3"));
    journal.prepare("UPDATE candidates SET state='BIRTHING',phase='MIGRATING',target_generation='G0002',previous_release='r1' WHERE id='r2'").run(); journal.close();
    if (stage !== "before_generation") {
      const g2 = f.lineage.createGeneration({ id: "G0002", number: 2, parentId: "G0001", geneHash: c.candidate.gene_hash, releaseId: "r2" });
      if (stage === "partial_current") { const partial = new CurrentStore(join(f.workspace, "generations/G0002/current.sqlite3")); partial.initialize(g2, "1"); partial.close(); }
    }
    vi.mocked(f.runtime.resume).mockRejectedValueOnce(new Error("RESUME_RESPONSE_LOST"));
    await expect(f.supervisor.recover()).rejects.toThrow("RESUME_RESPONSE_LOST");
    expect(f.supervisor.get("r2").state).toBe("BIRTHING");
    await f.supervisor.recover(); await f.supervisor.recover();
    expect(f.runtime.stop).not.toHaveBeenCalled(); expect(f.runtime.start).not.toHaveBeenCalled(); expect(f.runtime.switchRelease).not.toHaveBeenCalled();
    expect(f.app().current.state("business")!.state_json).toContain("old service");
    expect(f.lineage.activeGeneration()!.id).toBe("G0001"); expect(f.supervisor.get("r2").phase).toBe("RESTORED");
    expect(f.lineage.relevantMemories({ kind: "generation_failure" })).toHaveLength(stage === "before_generation" ? 0 : 1);
    expect(f.lineage.db.prepare("SELECT * FROM life_events WHERE kind='POST_ROLLBACK_DREAM_REQUIRED'").all()).toHaveLength(0);
  });
  it("journals birth intent before creating the generation and restores after a lost stop response", async () => {
    const f = fixture(), c = await f.prepare("r2"); f.supervisor.approve("r2", c.candidate.candidate_hash);
    const create = f.lineage.createGeneration.bind(f.lineage);
    vi.spyOn(f.lineage, "createGeneration").mockImplementationOnce(input => {
      expect(f.supervisor.get("r2")).toMatchObject({ state: "BIRTHING", phase: "MIGRATING", target_generation: "G0002" });
      return create(input);
    });
    const stop = vi.mocked(f.runtime.stop).getMockImplementation()!;
    vi.mocked(f.runtime.stop).mockImplementationOnce(async () => {
      expect(f.supervisor.get("r2").phase).toBe("SWITCHING"); await stop(); throw new Error("STOP_RESPONSE_LOST");
    });
    await expect(f.supervisor.birth("r2")).rejects.toThrow("STOP_RESPONSE_LOST");
    expect(f.app().current.meta().generation_id).toBe("G0001");
    expect(f.lineage.activeGeneration()!.id).toBe("G0001"); expect(f.supervisor.get("r2").state).toBe("FAILED");
    expect(f.runtime.start).toHaveBeenCalledTimes(1);
  });
});
