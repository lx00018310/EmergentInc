import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { readGenome } from "@emergentinc/persistence";
import { LifeContext } from "../src/services/life_context.js";
import { BusinessService } from "../src/services/business_service.js";
import { BodyGrowthService } from "../src/services/body_growth_service.js";
import { DreamService } from "../src/services/dream_service.js";
import { MemoryGate } from "../src/services/memory_gate.js";
import { createServer } from "../src/app.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
describe("V22 Owner API and real candidate server", () => {
  it("authenticates Evolution requests and approves direction without offering a release/hash bypass", async () => {
    const root = mkdtempSync(join(tmpdir(), "evolution-api-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const genome = readGenome(resolve(".")), life = LifeContext.open(root, genome.manifest, genome.geneHash, "r1"); cleanup.push(() => life.close());
    const business = new BusinessService(life.lineage), body = new BodyGrowthService(life), dream = new DreamService(life);
    const app = await createServer({ workspaceRoot: root, runtimeMode: "business", businessService: business,
      ownerAuth: { secret: "a".repeat(32), secureCookies: false }, evolution: { life, body, dream, memoryGate: new MemoryGate(life.lineage, () => "G0001") } });
    cleanup.push(() => app.close());
    expect((await app.inject({ url: "/api/evolution/overview" })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { secret: "a".repeat(32) } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const created = await app.inject({ method: "POST", url: "/api/evolution/proposals", headers: { cookie }, payload: { key: "owner-change", proposal: { point: "调整基础接口", reason: "需要", effect: "下一代" } } });
    expect(created.statusCode).toBe(200); const proposal = created.json();
    expect((await app.inject({ method: "POST", url: `/api/evolution/proposals/${proposal.id}/decision`, headers: { cookie }, payload: { decision: "APPROVED" } })).json().state).toBe("APPROVED");
    expect(life.lineage.activeGeneration()!.id).toBe("G0001");
    expect((await app.inject({ method: "POST", url: "/api/evolution/birth", headers: { cookie }, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/evolution/dream", headers: { cookie }, payload: {} })).statusCode).toBe(400);
  });
  it("accepts a pinned one-click decision while rejecting a stale generation or state", async () => {
    const root = mkdtempSync(join(tmpdir(), "evolution-guard-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const genome = readGenome(resolve(".")), life = LifeContext.open(root, genome.manifest, genome.geneHash, "r1"); cleanup.push(() => life.close());
    const business = new BusinessService(life.lineage);
    const app = await createServer({ workspaceRoot: root, runtimeMode: "business", businessService: business,
      ownerAuth: { secret: "a".repeat(32), secureCookies: false }, evolution: { life, body: new BodyGrowthService(life), dream: new DreamService(life), memoryGate: new MemoryGate(life.lineage, () => "G0001") } });
    cleanup.push(() => app.close());
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { secret: "a".repeat(32) } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const created = await app.inject({ method: "POST", url: "/api/evolution/proposals", headers: { cookie }, payload: { key: "guard-check", proposal: { point: "方向", reason: "测试", effect: "下一代" } } });
    const proposal = created.json() as { id: string };
    // Wrong generation pin is refused before any decision.
    expect((await app.inject({ method: "POST", url: `/api/evolution/proposals/${proposal.id}/decision`, headers: { cookie },
      payload: { decision: "APPROVED", expectedGeneration: "G0002", expectedState: "PROPOSED" } })).json().detail).toBe("PROPOSAL_GENERATION_CHANGED");
    // Wrong state pin is refused (already APPROVED path also covered below), then the correct pin passes.
    const approved = await app.inject({ method: "POST", url: `/api/evolution/proposals/${proposal.id}/decision`, headers: { cookie },
      payload: { decision: "APPROVED", expectedGeneration: "G0001", expectedState: "PROPOSED" } });
    expect(approved.json().state).toBe("APPROVED");
    // Deciding again with the old PROPOSED pin now reports the state moved.
    expect((await app.inject({ method: "POST", url: `/api/evolution/proposals/${proposal.id}/decision`, headers: { cookie },
      payload: { decision: "REJECTED", expectedGeneration: "G0001", expectedState: "PROPOSED" } })).json().detail).toBe("PROPOSAL_NOT_PENDING");
    // The GENE page request without pins stays compatible: idempotent same-decision returns APPROVED.
    const idempotent = await app.inject({ method: "POST", url: `/api/evolution/proposals/${proposal.id}/decision`, headers: { cookie }, payload: { decision: "APPROVED" } });
    expect(idempotent.json().state).toBe("APPROVED");
  });
  it("starts the actual compiled candidate with isolated dual databases, auth and side-effect gates", async () => {
    const root = mkdtempSync(join(tmpdir(), "real-candidate-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const release = resolve("."), genome = readGenome(release), life = LifeContext.open(root, genome.manifest, genome.geneHash, "v22-initial");
    life.close();
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [resolve("supervisor/candidate_harness.mjs"), "smoke", release, root, "G0001"], {
        shell: false, windowsHide: true, env: { SystemRoot: process.env.SystemRoot ?? "", PATH: process.env.PATH ?? "" }, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = ""; child.stderr.on("data", b => { stderr += b; });
      const timer = setTimeout(() => child.kill(), 20000);
      child.on("error", e => { clearTimeout(timer); reject(e); });
      child.on("exit", code => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error(stderr || "REAL_CANDIDATE_SMOKE_FAILED")); });
    });
  }, 25000);
  it("offers Owner recovery of a previous generation's saved Dream response with no configured model", async () => {
    const root = mkdtempSync(join(tmpdir(), "dream-retry-api-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const genome = readGenome(resolve(".")), life = LifeContext.open(root, genome.manifest, genome.geneHash, "r1"); cleanup.push(() => life.close());
    life.lineage.createGeneration({ id: "G0002", number: 2, parentId: "G0001", geneHash: "b".repeat(64), releaseId: "r2", state: "ROLLED_BACK" });
    const cursor = JSON.stringify({ current: 0, lineage: 0, business: 0 });
    const input = { generation: "G0002", from: JSON.parse(cursor), to: { current: 4, lineage: 0, business: 0 }, facts: [{ kind: "body_need" }] };
    life.lineage.db.prepare(`INSERT INTO dream_runs(id,generation_id,from_cursor,to_cursor,status,input_hash,created_at,trigger,input_json)
      VALUES('old-dream','G0002',?,?,'OUTCOME_UNKNOWN','hash',?,'manual',?)`).run(cursor, JSON.stringify(input.to), Date.now(), JSON.stringify(input));
    life.lineage.db.prepare("INSERT INTO business_operations VALUES('life:G0002:dream:old-dream','draft',NULL,'dream','hash','{}',0,'SETTLED',?, ?,NULL)")
      .run(JSON.stringify({ memories: [{ point: "旧代经验", reason: "已保存响应", effect: "仍可读取" }], gene_proposals: [] }), Date.now());
    const app = await createServer({ workspaceRoot: root, runtimeMode: "business", businessService: new BusinessService(life.lineage),
      ownerAuth: { secret: "a".repeat(32), secureCookies: false }, evolution: { life, body: new BodyGrowthService(life), dream: new DreamService(life),
        memoryGate: new MemoryGate(life.lineage, () => "G0001") } }); cleanup.push(() => app.close());
    expect((await app.inject({ method: "POST", url: "/api/evolution/dream/old-dream/retry", payload: {} })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { secret: "a".repeat(32) } });
    const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    const overview = await app.inject({ url: "/api/evolution/overview", headers: { cookie } });
    expect(overview.json().dreamRuns[0]).toMatchObject({ generation_id: "G0002", retry_available: 1 });
    const retry = await app.inject({ method: "POST", url: "/api/evolution/dream/old-dream/retry", headers: { cookie }, payload: {} });
    expect(retry.statusCode).toBe(200); expect(retry.json().status).toBe("COMPLETED");
    expect(life.lineage.relevantMemories({ kind: "dream", generationId: "G0002" })).toHaveLength(1);
  });
});
