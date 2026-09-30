import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LifeContext } from "../src/services/life_context.js";
import { DreamService } from "../src/services/dream_service.js";
import { MemoryGate } from "../src/services/memory_gate.js";
import { BusinessService } from "../src/services/business_service.js";
import { CurrentStore } from "@emergentinc/persistence";

const cleanup: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); for (const fn of cleanup.splice(0).reverse()) fn(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dream-")); cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const life = LifeContext.open(root, { schema_version: 1, generation: 1, body_interface_version: "1", protected_paths: ["genome/**"], capability_contracts: {} }, "a".repeat(64), "r1");
  cleanup.push(() => life.close());
  const point = { point: "新能力成功运行", reason: "有执行回执", effect: "可继续使用" };
  const model = vi.fn(async () => JSON.stringify({ memories: [point], gene_proposals: [{ point: "改进基础接口", reason: "重复边界需求", effect: "下一代可支持" }] }));
  const dream = new DreamService(life, model), gate = new MemoryGate(life.lineage, () => life.current.meta().generation_id);
  return { life, model, dream, gate };
}
describe("selective memory and Dream", () => {
  it("makes zero model calls without new facts, and advances cursors after strict output", async () => {
    const f = fixture(); expect((await f.dream.run()).status).toBe("SKIPPED"); expect(f.model).not.toHaveBeenCalled();
    f.life.current.event("body_run_succeeded", { skillId: "summary", outputHash: "receipt" }, "business");
    expect((await f.dream.run()).status).toBe("COMPLETED");
    expect(f.life.lineage.proposals()[0]!.state).toBe("PROPOSED"); expect(f.life.current.meta().gene_hash).toBe("a".repeat(64));
    expect((await f.dream.run()).status).toBe("SKIPPED"); expect(f.model).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid JSON atomically without consuming its input cursor", async () => {
    const f = fixture(); f.life.current.event("body_need", { need: "能力" });
    f.model.mockResolvedValueOnce(JSON.stringify({ memories: [{ point: "缺原因" }], gene_proposals: [] }));
    await expect(f.dream.run()).rejects.toThrow("INVALID_MEMORY_POINT");
    expect(f.life.lineage.relevantMemories({ kind: "dream" })).toHaveLength(0);
    expect((await f.dream.run()).status).toBe("COMPLETED");
  });
  it("blocks automatic replay after an unknown model outcome", async () => {
    const f = fixture(); f.life.current.event("body_need", { need: "能力" });
    f.model.mockRejectedValueOnce(new Error("MODEL_OUTCOME_UNKNOWN_REVIEW_REQUIRED"));
    await expect(f.dream.run()).rejects.toThrow("OUTCOME_UNKNOWN");
    f.life.current.event("body_need", { need: "另一个新事实" });
    await expect(f.dream.run()).rejects.toThrow("OUTCOME_REQUIRES_REVIEW"); expect(f.model).toHaveBeenCalledTimes(1);
  });
  it("drains Final Dream batches without treating its own proposals as new evidence", async () => {
    const f = fixture(); for (let i = 0; i < 95; i++) f.life.current.event("body_need", { i });
    await f.dream.finalDream(); expect(f.model).toHaveBeenCalledTimes(3);
    expect((await f.dream.run()).status).toBe("SKIPPED");
  });
  it("schedules one daily Dream in the configured timezone and does not loop model calls", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-29T18:59:50Z"));
    const f = fixture(); f.life.current.event("body_need", { need: "能力" }); f.dream.start();
    await vi.advanceTimersByTimeAsync(30000); expect(f.model).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60000); expect(f.model).toHaveBeenCalledTimes(1); await f.dream.stop();
  });
  it("allows only explicit immediate-memory events and deduplicates Owner corrections", () => {
    const f = fixture(); const point = { point: "纠正判断", reason: "证据不成立", effect: "改变做法" };
    f.gate.ownerCorrection("correction1", point); f.gate.ownerCorrection("correction1", point);
    expect(f.life.lineage.relevantMemories({ kind: "owner_correction" })).toHaveLength(1);
    expect(() => f.gate.record("generated_copy", point, "copy")).toThrow("MEMORY_GATE_EVENT_DENIED");
  });
  it("charges life calls against the existing allowance, preserves actual cost, and reuses a settled response", async () => {
    const f = fixture(), call = vi.fn(async () => ({ rawText: '{"memories":[],"gene_proposals":[]}', usage: { promptTokens: 10, completionTokens: 10 } }));
    const service = new BusinessService(f.life.lineage, { call }, "model", { currency: "CNY", input_cost_per_million: 1, output_cost_per_million: 1 });
    service.attachLife(f.life);
    await expect(service.lifeModel("dream", "run1", {})).rejects.toThrow("DRAFT_ALLOWANCE_REQUIRED"); expect(call).not.toHaveBeenCalled();
    f.life.lineage.configure({ limitMicros: 1000000, draftLimitMicros: 1000000, draftCallLimit: 10, draftExpiresAt: Date.now() + 100000 });
    await service.lifeModel("dream", "run1", {}); await service.lifeModel("dream", "run1", {});
    expect(call).toHaveBeenCalledTimes(1); expect(f.life.lineage.totals().spentMicros).toBe(20);
    expect(f.life.lineage.overview().proposalProblems).toHaveLength(0);
  });
  it("retries a reconciled response with its original frozen input and without another paid call", async () => {
    const f = fixture(), call = vi.fn(async () => ({ rawText: JSON.stringify({ memories: [{ point: "需保留", reason: "证据", effect: "复用" }], gene_proposals: [] }), usage: {} }));
    f.life.lineage.configure({ limitMicros: 1000000, draftLimitMicros: 1000000, draftCallLimit: 10, draftExpiresAt: Date.now() + 100000 });
    const service = new BusinessService(f.life.lineage, { call }, "model", { currency: "CNY", input_cost_per_million: 1, output_cost_per_million: 1 }); service.attachLife(f.life);
    const dream = new DreamService(f.life, service.lifeModel.bind(service)); f.life.current.event("body_need", { need: "能力" });
    await expect(dream.run()).rejects.toThrow("MODEL_COST_UNKNOWN");
    const run = f.life.lineage.db.prepare("SELECT * FROM dream_runs").get()!, operation = f.life.lineage.overview().unknownOperations[0]!;
    f.life.current.event("body_need", { need: "稍后发生的新事实" });
    await expect(dream.run()).rejects.toThrow("OUTCOME_REQUIRES_REVIEW");
    f.life.lineage.settle(String(operation.id), 42, null, { source: "owner_confirmed" });
    expect((await dream.retry(String(run.id))).status).toBe("COMPLETED"); expect(call).toHaveBeenCalledTimes(1);
    expect(f.life.lineage.relevantMemories({ kind: "dream" })).toHaveLength(1); expect(f.life.lineage.totals().spentMicros).toBe(42);
  });
  it("recovers a reconciled G2 Dream after rollback, without another model call or reusing G2's Current cursor", async () => {
    const f = fixture(), lineage = f.life.lineage;
    f.life.current.event("body_need", { need: "G1 已整理的事实" }); await f.dream.run();
    const g2 = lineage.createGeneration({ id: "G0002", number: 2, parentId: "G0001", geneHash: "b".repeat(64), releaseId: "r2" });
    const current2 = new CurrentStore(); current2.initialize(g2, "1"); cleanup.push(() => current2.close());
    lineage.db.transaction(() => { lineage.db.prepare("UPDATE generations SET state='RETIRED' WHERE id='G0001'").run(); lineage.db.prepare("UPDATE generations SET state='ACTIVE' WHERE id='G0002'").run(); });
    const life2 = new LifeContext(f.life.workspaceRoot, { ...f.life.genome, generation: 2 }, lineage, current2);
    const call = vi.fn(async () => ({ rawText: JSON.stringify({ memories: [{ point: "G2 经验", reason: "真实事实", effect: "保留" }],
      gene_proposals: [{ point: "后续接口", reason: "G2 失败经验", effect: "由当前代决定" }] }), usage: {} }));
    lineage.configure({ limitMicros: 1000000, draftLimitMicros: 1000000, draftCallLimit: 10, draftExpiresAt: Date.now() + 100000 });
    const service = new BusinessService(lineage, { call }, "model", { currency: "CNY", input_cost_per_million: 1, output_cost_per_million: 1 }); service.attachLife(life2);
    for (let i = 0; i < 4; i++) current2.event("body_need", { i });
    await expect(new DreamService(life2, service.lifeModel.bind(service)).run()).rejects.toThrow("MODEL_COST_UNKNOWN");
    const run = lineage.db.prepare("SELECT * FROM dream_runs WHERE generation_id='G0002'").get()!, operation = lineage.overview().unknownOperations[0]!;
    lineage.db.transaction(() => { lineage.db.prepare("UPDATE generations SET state='ROLLED_BACK' WHERE id='G0002'").run(); lineage.db.prepare("UPDATE generations SET state='ACTIVE' WHERE id='G0001'").run(); });
    f.life.current.event("body_need", { need: "G1 回退后的新事实" });
    await expect(f.dream.run()).rejects.toThrow("OUTCOME_REQUIRES_REVIEW");
    await expect(f.dream.retry(String(run.id))).rejects.toThrow("SETTLED_RESPONSE_REQUIRED");
    lineage.settle(String(operation.id), 42, null, { source: "owner_confirmed" });
    expect((await f.dream.retry(String(run.id))).status).toBe("COMPLETED");
    expect(call).toHaveBeenCalledTimes(1); expect(f.model).toHaveBeenCalledTimes(1);
    expect(lineage.relevantMemories({ kind: "dream", generationId: "G0002" })).toHaveLength(1);
    expect(lineage.db.prepare("SELECT generation_id FROM gene_proposals WHERE source_ref=?").get(`${run.id}:proposal:0`)!.generation_id).toBe("G0001");
    const after = await f.dream.run(); expect(after.status).toBe("COMPLETED");
    expect(JSON.parse(String(after.from_cursor)).current).toBe(1); expect(JSON.parse(String(after.to_cursor)).current).toBe(2);
    expect(lineage.totals().spentMicros).toBe(42);
  });
});
