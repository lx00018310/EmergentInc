import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LifeContext } from "../src/services/life_context.js";
import { BodySkillSupervisor } from "../src/services/automation_supervisor.js";
import { BodyGrowthService } from "../src/services/body_growth_service.js";
import { bodyCandidate } from "@emergentinc/tools";
import { GenomeManifest } from "@emergentinc/protocol";
import { BusinessService } from "../src/services/business_service.js";
import { CurrentStore, migrateCurrentState } from "@emergentinc/persistence";

const disposers: (() => void)[] = [];
afterEach(() => { for (const fn of disposers.splice(0).reverse()) fn(); });
export const candidate = (id = "summary") => ({ skill_id: id, purpose: "统计资料", source: "export default input => ({ count: input.rows.length });",
  interface_version: "1", tests: [{ input: { rows: [1, 2] }, expected: { count: 2 } }] });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "body-growth-")); disposers.push(() => rmSync(dir, { recursive: true, force: true }));
  const genome: GenomeManifest = { schema_version: 1, generation: 1, body_interface_version: "1", protected_paths: ["genome/**"], capability_contracts: {} };
  const life = LifeContext.open(dir, genome, "a".repeat(64), "r1"); disposers.push(() => life.close());
  const env = { rootless: true, seccomp: "builtin", cgroup: 2, image: `node@sha256:${"a".repeat(64)}` };
  // Contract double only. Never evaluate source on Windows/the host.
  const runner = { probe: vi.fn(async () => env), recoverInterrupted: vi.fn(async () => ({ removed: 0 })),
    runBody: vi.fn(async (_source: string, input: any) => ({ count: input.rows.length })) };
  const supervisor = new BodySkillSupervisor(life.current, life.lineage, runner, join(dir, "generations/G0001/body/skills"));
  const generate = vi.fn(async () => JSON.stringify(candidate()));
  const service = new BodyGrowthService(life, supervisor, generate);
  const grow = (id = "need1") => service.grow({ id, pixel_id: "business", need: "缺少行数统计", evidence: "当前报表没有行数" });
  return { dir, life, runner, supervisor, generate, service, grow, env };
}
async function businessPlan(f: ReturnType<typeof fixture>) {
  const plan = { title: "统计", objective: "整理资料", audience: "Owner", hypothesis: "资料可整理", metric: { name: "产物", baseline: "0", target: "1", evidence: "回执" },
    stopCondition: "一次后停止", expiresAt: Date.now() + 100000, budgetMicros: 100000, currency: "CNY", resources: ["body:缺少行数统计"],
    actions: [{ capability: "data_report", version: "1", datasetId: "data", purpose: "报告" }] };
  f.life.lineage.addDataset("data", "资料", [{ value: 1 }]);
  f.life.lineage.configure({ limitMicros: 1000000, draftLimitMicros: 1000000, draftCallLimit: 10, draftExpiresAt: Date.now() + 100000 });
  const business = new BusinessService(f.life.lineage, { call: vi.fn(async () => ({ rawText: JSON.stringify(plan), usage: { promptTokens: 10, completionTokens: 10 } })) },
    "model", { currency: "CNY", input_cost_per_million: 1, output_cost_per_million: 1 });
  business.attachLife(f.life, f.service);
  const view = await business.propose("整理资料", "body-plan-test"), need = f.life.current.db.prepare("SELECT * FROM body_needs WHERE state='NEED'").get()!;
  const grow = () => f.service.grow({ id: String(need.id), pixel_id: "business", need: String(need.need), evidence: String(need.evidence), carry_forward: true });
  return { business, view, grow, need };
}
describe("autonomous Body candidate pipeline (sandbox contract doubles)", () => {
  it("grows Need to a tested active skill, increments only Body revision, and does not ask for Owner approval", async () => {
    const f = fixture(); const result = await f.grow();
    expect(result.state).toBe("ACTIVE"); expect(f.life.current.meta().body_revision).toBe(1);
    expect(f.life.lineage.activeGeneration()!.id).toBe("G0001"); expect(f.life.lineage.proposals()).toHaveLength(0);
    expect(await f.supervisor.run("summary", { rows: [1, 2, 3] })).toMatchObject({ result: { count: 3 } });
    await f.grow(); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.life.current.meta().body_revision).toBe(1);
  });
  it("supports independent slots without retiring another skill", async () => {
    const f = fixture(); await f.supervisor.recover();
    for (const slot of ["summary", "cleaner"]) {
      f.supervisor.submit(slot, candidate(slot)); await f.supervisor.validateBodyCandidate(slot); await f.supervisor.policyAutoActivate(slot);
    }
    expect(f.life.current.skills().filter(s => s.state === "ACTIVE")).toHaveLength(2);
    expect(f.life.current.meta().body_revision).toBe(2);
  });
  it("imports source as a candidate through the same trusted tests and activation without calling the generator", async () => {
    const f = fixture(); const imported = await f.service.grow({ id: "external", pixel_id: "business", need: "外部能力", evidence: "已有源码候选", candidate: candidate() });
    expect(imported.state).toBe("ACTIVE"); expect(f.generate).not.toHaveBeenCalled(); expect(f.runner.runBody).toHaveBeenCalled();
    await expect(f.service.grow({ id: "external", pixel_id: "business", need: "外部能力", evidence: "已有源码候选",
      candidate: { ...candidate(), source: "export default x=>({count:0})" } })).rejects.toThrow("BODY_IDEMPOTENCY_CONFLICT");
  });
  it("restores the preceding version on runtime failure and preserves a Lineage memory without replaying input", async () => {
    const f = fixture(); await f.supervisor.recover();
    for (const id of ["r1", "r2"]) { f.supervisor.submit(id, { ...candidate(), source: `${candidate().source} // ${id}` });
      await f.supervisor.validateBodyCandidate(id); await f.supervisor.policyAutoActivate(id); }
    f.runner.runBody.mockRejectedValueOnce(new Error("AUTOMATION_EXECUTION_FAILED"));
    const before = f.runner.runBody.mock.calls.length;
    await expect(f.supervisor.run("summary", { rows: [] })).rejects.toThrow("EXECUTION_FAILED");
    expect(f.runner.runBody).toHaveBeenCalledTimes(before + 1);
    expect(f.supervisor.get("r2").state).toBe("ROLLED_BACK"); expect(f.supervisor.get("r1").state).toBe("ACTIVE");
    expect(f.life.current.meta().body_revision).toBe(1);
    expect(f.life.lineage.relevantMemories({ kind: "body_rollback" })).toHaveLength(1);
    expect((await f.supervisor.policyAutoActivate("r2")).state).toBe("ROLLED_BACK");
  });
  it.each(["import fs from 'node:fs'; export default x=>x", "export default x=>fetch('https://example.com')",
    "export default x=>process.env.private", "export default x=>require('child_process')", "export default x=>({mount:'/host'})",
    "export default x=>({genome: 'modified'})"])("rejects source beyond the pure Body contract: %s", source => {
    expect(() => bodyCandidate({ ...candidate(), source }, "1")).toThrow("BODY_SECURITY_BOUNDARY");
  });
  it("routes requested permissions to an unapproved Gene proposal without invoking a generator", async () => {
    const f = fixture(); const p = await f.service.grow({ id: "network", pixel_id: "business", need: "新的网络接口", evidence: "无网络权限", required_capabilities: ["network"] });
    expect(p.state).toBe("PROPOSED"); expect(f.generate).not.toHaveBeenCalled(); expect(f.runner.runBody).not.toHaveBeenCalled();
    expect(f.life.lineage.relevantMemories({ kind: "security_boundary" })).toHaveLength(1);
  });
  it("rejects a failed data test and binds activation to the tested image and source", async () => {
    const f = fixture(); await f.supervisor.recover(); f.supervisor.submit("bad", candidate());
    f.runner.runBody.mockResolvedValueOnce({ count: 9 }); expect((await f.supervisor.validateBodyCandidate("bad")).state).toBe("VALIDATION_FAILED");
    await expect(f.supervisor.policyAutoActivate("bad")).rejects.toThrow("BODY_VALIDATION_INVALID");
    f.supervisor.submit("good", candidate()); await f.supervisor.validateBodyCandidate("good"); f.env.image = `node@sha256:${"b".repeat(64)}`;
    await expect(f.supervisor.policyAutoActivate("good")).rejects.toThrow("BODY_RUNTIME_CHANGED");
  });
  it("refuses stale interface, programmatic tests and mutation of an activated artifact", async () => {
    expect(() => bodyCandidate({ ...candidate(), tests: "test program" }, "1")).toThrow();
    expect(() => bodyCandidate(candidate(), "2")).toThrow("INVALID_BODY_INTERFACE");
    const f = fixture(); const grown = await f.grow();
    writeFileSync(join(f.dir, `generations/G0001/body/skills/summary/${grown.id}.json`), "{}");
    await expect(f.supervisor.run("summary", { rows: [] })).rejects.toThrow("BODY_ARTIFACT_CONFLICT");
    expect(f.life.current.skills()[0]!.state).toBe("RECOVERY_REQUIRED");
  });
  it.each(["before_approval", "after_approval"])("resolves exactly the plan's Body resource when its Need grows %s", async timing => {
    const f = fixture(), p = await businessPlan(f);
    if (timing === "before_approval") await p.grow();
    expect(f.life.lineage.approve(p.view.id, p.view.revision, p.view.hash).state).toBe("WAITING_RESOURCE");
    await p.business.tick();
    expect(f.life.lineage.getPlan(p.view.id).state).not.toBe("WAITING_RESOURCE");
    expect(f.life.lineage.db.prepare("SELECT * FROM business_requests WHERE state='OPEN'").all()).toHaveLength(0);
    await p.business.tick(); expect(f.life.lineage.getPlan(p.view.id).state).toBe("COMPLETED");
    expect(f.life.current.meta().body_revision).toBe(1); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it("does not release a plan for an unrelated Need with the same text or for a failed Body test", async () => {
    const f = fixture(), p = await businessPlan(f); f.life.lineage.approve(p.view.id, p.view.revision, p.view.hash);
    await f.grow(); expect(f.life.lineage.getPlan(p.view.id).state).toBe("WAITING_RESOURCE");
    f.runner.runBody.mockResolvedValueOnce({ count: 999 });
    expect((await p.grow()).state).toBe("VALIDATION_FAILED");
    await p.business.tick(); expect(f.life.lineage.getPlan(p.view.id).state).toBe("WAITING_RESOURCE");
    expect(f.life.lineage.db.prepare("SELECT * FROM business_requests WHERE state='OPEN'").all()).toHaveLength(1);
  });
  it.each(["1", "2"])("preserves the inherited Skill's resource binding and requires compatible interface %s", async version => {
    const f = fixture(), p = await businessPlan(f); await p.grow();
    const g2 = f.life.lineage.createGeneration({ id: "G0002", number: 2, parentId: "G0001", geneHash: "b".repeat(64), releaseId: "r2" });
    const current2 = new CurrentStore(); current2.initialize(g2, version); disposers.push(() => current2.close());
    migrateCurrentState(f.life.current, current2);
    f.life.lineage.db.transaction(() => { f.life.lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run();
      f.life.lineage.db.prepare("UPDATE generations SET state='ACTIVE' WHERE id='G0002'").run(); });
    f.life.lineage.approve(p.view.id, p.view.revision, p.view.hash);
    const body2 = new BodyGrowthService(new LifeContext(f.dir, { ...f.life.genome, generation: 2, body_interface_version: version }, f.life.lineage, current2));
    body2.syncBusinessResources();
    expect(f.life.lineage.getPlan(p.view.id).state).toBe(version === "1" ? "ACTIVE" : "WAITING_RESOURCE");
    expect(current2.db.prepare("SELECT state FROM body_needs WHERE id=?").get(p.need.id)!.state).toBe(version === "1" ? "SATISFIED" : "NEED");
    expect(current2.skills()[0]!.state).toBe(version === "1" ? "ACTIVE" : "REVALIDATION_REQUIRED");
  });
});
