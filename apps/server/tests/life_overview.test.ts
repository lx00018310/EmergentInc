import { afterEach, describe, expect, it, vi } from "vitest";
import { CurrentStore, LineageStore, readGenome } from "@emergentinc/persistence";
import { LifeContext } from "../src/services/life_context.js";
import { createServer } from "../src/app.js";
import { BusinessService } from "../src/services/business_service.js";
import { BodyGrowthService } from "../src/services/body_growth_service.js";
import { DreamService } from "../src/services/dream_service.js";
import { MemoryGate } from "../src/services/memory_gate.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.restoreAllMocks(); });
function fixture() {
  const { manifest, geneHash } = readGenome(process.cwd());
  const lineage = new LineageStore(), current = new CurrentStore();
  const generation = lineage.createGeneration({ id: "G0004", number: 4, geneHash, releaseId: "test", state: "ACTIVE" });
  current.initialize(generation, manifest.body_interface_version);
  const life = new LifeContext("unused", manifest, lineage, current); cleanup.push(() => life.close());
  return life;
}
describe("four-layer life overview", () => {
  it("projects manifest, Lineage evidence and Current separately without changing facts", () => {
    const life = fixture();
    life.current.need("need1", "pixel1", "需要联网", "超出身体契约");
    const proposal = life.lineage.proposeGene("G0004", "dream", { point: "扩展契约", reason: "身体需要", effect: "下一代" }, "body-need:G0004:need1");
    life.lineage.decideProposal(String(proposal.id), "APPROVED");
    life.lineage.remember("G0004", "generation_failure", { point: "出生失败", reason: "检查失败", effect: "旧代继续" }, "failure");
    life.lineage.lifeEvent("G0004", "owner_correction", { point: "纠正" }, "correction");
    const before = life.lineage.db.prepare("SELECT total_changes() n").get()!.n;
    const result = life.overview();
    expect(result.genome).toMatchObject({ generation: life.genome.generation, geneHash: life.current.meta().gene_hash,
      bodyInterfaceVersion: life.genome.body_interface_version, protectedPaths: life.genome.protected_paths,
      capabilityContracts: life.genome.capability_contracts });
    expect(result.trust).toMatchObject({ recovery: { state: "NOT_CONFIGURED" }, control: "NOT_CONNECTED", activeGeneration: "G0004" });
    expect(result.trust.evidence.map(e => e.type)).toEqual(expect.arrayContaining(["owner_gene_decision", "generation_failure"]));
    expect(result.trust.evidence.some(e => e.type === "owner_correction")).toBe(false);
    expect(result.evolution.proposals).toEqual(result.proposals);
    expect(result.genome.events[0]).toMatchObject({ title: "Body Need → Gene Proposal", layer: "GENOME" });
    expect(result.body.current).toEqual(result.current);
    expect(result.body.needs[0]).toMatchObject({ id: "need1" });
    expect(result.body.currentEvents[0]).toMatchObject({ layer: "BODY", type: "body_need" });
    expect(result.body.businessSummary).toMatchObject({ activePlans: 0, runningTasks: 0, waitingResources: 0, datasets: 0, connections: 0 });
    expect(life.lineage.db.prepare("SELECT total_changes() n").get()!.n).toBe(before);
  });
  it("retains separate security-boundary evidence and displays recent Memory by time", () => {
    const life = fixture();
    for (const [ref, importance, time] of [["old", 5, 1000], ["new", 3, 2000]] as const) {
      life.lineage.remember("G0004", "security_boundary", { point: ref, reason: "权限边界", effect: "转提案" }, ref, undefined, importance);
      life.lineage.db.prepare("UPDATE memories SET created_at=? WHERE source_ref=?").run(time, ref);
    }
    const result = life.overview();
    expect(result.trust.evidence.map(e => e.title)).toEqual(["new", "old"]);
    expect(result.evolution.memories.map(m => m.point)).toEqual(["new", "old"]);
    expect(result.memories.map(m => m.point)).toEqual(["old", "new"]);
  });
  it("orders a long-running Dream by completion and resolves body rollback revisions from candidates", () => {
    const life = fixture(); life.lineage.db.prepare("UPDATE generations SET born_at=0").run();
    for (let i = 0; i < 25; i++) life.lineage.db.prepare(`INSERT INTO dream_runs(id,generation_id,from_cursor,to_cursor,status,input_hash,created_at,finished_at,trigger,input_json)
      VALUES(?,'G0004','{}','{}','COMPLETED','hash',?,?,'manual','{"facts":[]}')`).run(`dream${i}`, i, i === 0 ? 2000 : 1000 + i);
    life.current.db.prepare(`INSERT INTO body_candidates(id,skill_id,candidate_json,request_hash,state,created_at,body_revision)
      VALUES('old','skill','{}','hash','ACTIVE',1,3),('failed','skill','{}','hash','ROLLED_BACK',2,4)`).run();
    life.current.event("body_rolled_back", { changeId: "failed", restored: "old", reason: "运行失败" });
    const result = life.overview();
    expect(result.evolution.evolutionEvents[0]).toMatchObject({ id: "dream:dream0", time: 2000, type: "dream_completed" });
    expect(result.body.currentEvents[0]!.detail).toBe("R4 ROLLED_BACK → R3 ACTIVE · 运行失败");
  });
  it("limits event streams to twenty, orders by time and omits executable candidate source", () => {
    const life = fixture();
    life.lineage.db.prepare("UPDATE generations SET born_at=0").run();
    for (let i = 0; i < 25; i++) {
      life.lineage.lifeEvent("G0004", "owner_correction", { point: String(i) }, `event${i}`);
      life.lineage.db.prepare("UPDATE life_events SET created_at=? WHERE source_ref=?").run(1000 + i, `event${i}`);
      life.current.event("body_generated", { changeId: String(i) });
    }
    life.current.db.prepare(`INSERT INTO body_candidates(id,skill_id,candidate_json,request_hash,state,created_at)
      VALUES('candidate1','skill1','{"source":"PRIVATE_SOURCE"}','hash','GENERATED',1)`).run();
    const result = life.overview();
    expect(result.evolution.evolutionEvents).toHaveLength(20);
    expect(result.evolution.evolutionEvents.map(e => e.time)).toEqual(Array.from({ length: 20 }, (_, i) => 1024 - i));
    expect(result.body.currentEvents).toHaveLength(20);
    expect(result.body.bodyCandidates[0]).toMatchObject({ id: "candidate1", state: "GENERATED" });
    expect(JSON.stringify(result.body.bodyCandidates)).not.toContain("PRIVATE_SOURCE");
  });
  it("probes only unauthenticated Recovery liveness and never equates a wrong service with Recovery", async () => {
    const life = fixture();
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({ alive: true, role: "recovery" }) } as Response);
    const app = await createServer({ workspaceRoot: "unused", runtimeMode: "business", businessService: new BusinessService(life.lineage),
      ownerAuth: { secret: "a".repeat(32), secureCookies: false }, evolution: { life, dream: new DreamService(life), body: new BodyGrowthService(life),
        memoryGate: new MemoryGate(life.lineage, () => "G0004"), recoveryOrigin: "http://127.0.0.1:8766" } });
    cleanup.push(() => app.close());
    expect((await app.inject({ url: "/api/evolution/overview" })).statusCode).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { secret: "a".repeat(32) } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const overview = (await app.inject({ url: "/api/evolution/overview", headers: { cookie } })).json();
    expect(overview.trust.recovery.state).toBe("REACHABLE");
    expect(overview.trust.control).toBe("NOT_CONNECTED");
    expect(overview.evolution.dream).toEqual(overview.dream);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8766/health/live", expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty("headers");
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ alive: true }) } as Response);
    expect((await app.inject({ url: "/api/evolution/overview", headers: { cookie } })).json().trust.recovery.state).toBe("UNAVAILABLE");
    fetcher.mockRejectedValue(new Error("offline"));
    expect((await app.inject({ url: "/api/evolution/overview", headers: { cookie } })).json().trust.recovery.state).toBe("UNAVAILABLE");
  });
});
