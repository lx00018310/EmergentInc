import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BusinessStore, SqliteDatabase } from "@emergentinc/persistence";
import { BusinessPlan, nextBusinessOccurrence } from "@emergentinc/protocol";
import { InfrastructureFailureError } from "@emergentinc/model";
import { BusinessService } from "../src/services/business_service.js";
import { createServer } from "../src/app.js";
import { runtimeConfig, acquireWorkspaceLock } from "../src/runtime_config.js";

const resources: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of resources.splice(0).reverse()) await dispose(); vi.useRealTimers(); });
const plan = (overrides: Partial<BusinessPlan> = {}): BusinessPlan => ({
  title: "询盘资料检查", objective: "减少整理时间", audience: "服务部门", hypothesis: "缺失数据会增加人工整理",
  metric: { name: "整理耗时", baseline: "待采样", target: "减少一半", evidence: "报告与人工计时" },
  stopCondition: "资料质量不足", budgetMicros: 1000000, currency: "CNY", expiresAt: Date.now() + 86400000,
  actions: [{ capability: "data_report", version: "1", datasetId: "inquiries", purpose: "统计缺失资料" }], resources: [], ...overrides,
});
function fixture() {
  const store = new BusinessStore(); resources.push(() => store.close());
  const call = vi.fn(async () => ({ rawText: JSON.stringify(plan()), usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 } }));
  const service = new BusinessService(store, { call }, "test", { input_cost_per_million: 1, output_cost_per_million: 1, currency: "CNY" });
  const budget = (limitMicros = 1000000) => store.configure({ limitMicros, draftLimitMicros: limitMicros, draftCallLimit: 10, draftExpiresAt: Date.now() + 86400000 });
  return { store, service, call, budget };
}
function seed(store: BusinessStore, body = plan(), key = "seed", id?: string, revision?: number) {
  store.reserveDraft(key, key, 10, {}, id); store.dispatch(key); store.settle(key, 10, JSON.stringify(body), { test: true });
  return store.saveProposal("检查业务资料", body, key, id, revision);
}

describe("business authorization, costs and durable execution", () => {
  it("does not call a model without an initial Owner allowance", async () => {
    const { service, call } = fixture();
    await expect(service.propose("整理询盘", "intent-001")).rejects.toThrow("DRAFT_ALLOWANCE_REQUIRED"); expect(call).not.toHaveBeenCalled();
  });
  it("only approves the exact version and idempotently creates one grant and task", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = await service.propose("整理询盘", "intent-001");
    expect(await service.propose("整理询盘", "intent-001")).toEqual(p); expect(call).toHaveBeenCalledTimes(1);
    expect(() => store.approve(p.id, p.revision, "forged")).toThrow("APPROVAL_VERSION_CONFLICT");
    store.approve(p.id, p.revision, p.hash); store.approve(p.id, p.revision, p.hash);
    expect(store.db.prepare("SELECT * FROM business_grants").all()).toHaveLength(1);
    expect(store.overview().tasks).toHaveLength(1);
    expect(store.getPlan(p.id).state).toBe("WAITING_RESOURCE");
  });
  it("resources resume the original task, without another model call", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = await service.propose("整理询盘", "intent-001"); store.approve(p.id, p.revision, p.hash);
    await service.tick(); expect((store.overview().tasks[0] as any).state).toBe("WAITING_RESOURCE");
    store.addDataset("inquiries", "询盘", [{ name: "A", value: 12 }, { name: "", value: 3 }]);
    store.resolveResource(String(store.overview().requests[0]!.id), "provided", "已上传本周询盘"); await service.tick();
    expect(store.getPlan(p.id).state).toBe("COMPLETED");
    const output = JSON.parse(String(store.overview().tasks[0]!.output));
    expect(output.rows).toBe(2); expect(output.fields.find((f: any) => f.name === "value").numericSum).toBe(15);
    for (let i = 0; i < 20; i++) await service.tick(); expect(call).toHaveBeenCalledTimes(1);
  });
  it("rejects task parameters not present in the approved snapshot", () => {
    const { store, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const p = seed(store); store.approve(p.id, 1, p.hash); const task = store.claimTask()!;
    expect(() => store.assertTaskAuthorized({ ...task, input: JSON.stringify({ datasetId: "private" }) })).toThrow("CAPABILITY_SCOPE_DENIED");
    store.control(p.id, "revoke"); expect(() => store.assertTaskAuthorized(task)).toThrow("GRANT_INACTIVE");
    store.finishTask(task, { alreadyDispatched: true }); expect(store.getPlan(p.id).state).toBe("STOPPED");
  });
  it("pause, expiry and revocation prevent new dispatch", () => {
    const { store, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const p = seed(store); store.approve(p.id, 1, p.hash); store.control(p.id, "pause"); expect(store.claimTask()).toBeUndefined();
    store.control(p.id, "resume"); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 2 * 86400000);
    expect(store.claimTask()).toBeUndefined(); store.control(p.id, "revoke"); expect(() => store.approve(p.id, 1, p.hash)).toThrow("GRANT_REVOKED");
  });
  it("revision retires old permissions but preserves costs and reservations", () => {
    const { store, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const p = seed(store); store.approve(p.id, 1, p.hash);
    const revised = seed(store, plan({ title: "新的方案" }), "revision", p.id, 1);
    expect(revised.spentMicros).toBe(20); expect(revised.revision).toBe(2);
    expect(() => store.approve(p.id, 1, p.hash)).toThrow("APPROVAL_VERSION_CONFLICT");
    expect(store.claimTask()).toBeUndefined(); store.approve(p.id, 2, revised.hash);
    expect(store.claimTask()?.revision).toBe(2);
  });
  it("cannot reserve the same shared balance twice even through separate database connections", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-budget-")); resources.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const a = new BusinessStore(path.join(dir, "b.sqlite")), b = new BusinessStore(path.join(dir, "b.sqlite"));
    resources.push(() => { a.close(); b.close(); });
    a.configure({ limitMicros: 100, draftLimitMicros: 100, draftCallLimit: 10, draftExpiresAt: Date.now() + 100000 });
    a.reserveDraft("a", "a", 60, {}); expect(() => b.reserveDraft("b", "b", 60, {})).toThrow("BUDGET_EXHAUSTED");
    a.dispatch("a"); a.settle("a", 150, "", { actual: true });
    expect(b.totals().spentMicros).toBe(150); expect(() => b.reserveDraft("c", "c", 0, {})).toThrow("BUDGET_EXHAUSTED");
  });
  it("retains unknown billing and refuses to replay the model request", async () => {
    const { store, service, call, budget } = fixture(); budget(); call.mockRejectedValueOnce(new Error("timeout"));
    await expect(service.propose("资料分析", "unknown-1")).rejects.toThrow("MODEL_OUTCOME_UNKNOWN");
    expect(store.totals().reservedMicros).toBeGreaterThan(0);
    await expect(service.propose("资料分析", "unknown-1")).rejects.toThrow("PREVIOUS_CALL_REQUIRES_REVIEW");
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("releases reservation only for known pre-dispatch failure", async () => {
    const { store, service, call, budget } = fixture(); budget(); call.mockRejectedValueOnce(new InfrastructureFailureError("not sent"));
    await expect(service.propose("资料分析", "not-sent-1")).rejects.toThrow("MODEL_REQUEST_NOT_SENT");
    expect(store.totals()).toEqual({ spentMicros: 0, reservedMicros: 0 });
  });
  it("unknown usage does not become a zero-cost plan", async () => {
    const { store, service, call, budget } = fixture(); budget();
    call.mockResolvedValueOnce({ rawText: JSON.stringify(plan()), usage: {} } as any);
    await expect(service.propose("资料分析", "unknown-1")).rejects.toThrow("MODEL_COST_UNKNOWN");
    expect(store.listPlans()).toHaveLength(0); expect(store.totals().reservedMicros).toBeGreaterThan(0);
    store.settle("draft:unknown-1", 123, null, { source: "owner_confirmed" });
    expect((await service.propose("资料分析", "unknown-1")).spentMicros).toBe(123); expect(call).toHaveBeenCalledTimes(1);
  });
  it("replays a pure task after restart and rejects a stale worker result", () => {
    const { store, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const p = seed(store); store.approve(p.id, 1, p.hash); const old = store.claimTask()!;
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 40000); const resumed = store.claimTask()!;
    expect(resumed.id).toBe(old.id); expect(() => store.finishTask(old, {})).toThrow("STALE_WORKER_RESULT");
    store.finishTask(resumed, {}); expect(store.claimTask()).toBeUndefined();
  });
  it("persists approvals and completed results across a real database reopen", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-restart-")); resources.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const filename = path.join(dir, "b.sqlite"); let store = new BusinessStore(filename);
    store.configure({ limitMicros: 100000, draftLimitMicros: 100000, draftCallLimit: 10, draftExpiresAt: Date.now() + 100000 });
    store.addDataset("inquiries", "询盘", []); const p = seed(store); store.approve(p.id, 1, p.hash);
    store.close(); store = new BusinessStore(filename); resources.push(() => store.close());
    await new BusinessService(store).tick(); expect(store.getPlan(p.id).state).toBe("COMPLETED");
    expect(store.claimTask()).toBeUndefined(); expect(store.totals().spentMicros).toBe(10);
  });
  it("refuses an unknown schema version without downgrading it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-schema-")); resources.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, "b.sqlite"); const db = new SqliteDatabase(file); db.exec("PRAGMA user_version=999"); db.close();
    expect(() => new BusinessStore(file)).toThrow("UNSUPPORTED_BUSINESS_SCHEMA_VERSION");
    const check = new SqliteDatabase(file); expect((check.prepare("PRAGMA user_version").get() as any).user_version).toBe(999); check.close();
  });
  it("keeps datasets immutable after approval", () => {
    const { store } = fixture(); store.addDataset("data", "资料", [{ amount: 1 }]);
    expect(() => store.addDataset("data", "资料", [{ amount: 2 }])).toThrow("DATASET_IMMUTABLE");
  });
  it("coalesces overdue schedules, deduplicates each occurrence and never calls a model", async () => {
    const { store, service, call, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const p = seed(store, plan({ schedule: { kind: "interval", everyMinutes: 5, maxOccurrences: 2 } }));
    store.approve(p.id, 1, p.hash); await service.tick(); expect(store.overview().tasks).toHaveLength(0);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 3600000);
    await service.tick(); await service.tick(); expect(store.overview().tasks).toHaveLength(1); expect(store.getPlan(p.id).state).toBe("ACTIVE");
    vi.setSystemTime(Date.now() + 300000); await service.tick(); expect(store.overview().tasks).toHaveLength(2);
    expect(store.getPlan(p.id).state).toBe("COMPLETED"); expect(call).not.toHaveBeenCalled();
  });
  it("honors timezone days and skips missing DST wall times without double-running", () => {
    const daily = { kind: "daily" as const, time: "02:30", timezone: "America/New_York", maxOccurrences: 3 };
    const next = nextBusinessOccurrence(daily, Date.parse("2026-03-08T06:59:00Z"));
    expect(new Date(next).toISOString()).toBe("2026-03-09T06:30:00.000Z");
    const fall = { ...daily, time: "01:30" };
    expect(new Date(nextBusinessOccurrence(fall, Date.parse("2026-11-01T05:30:00Z"))).toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
  it("restores a settled model response after a crash before the proposal was saved", () => {
    const { store, service, call, budget } = fixture(); budget();
    store.reserveDraft("draft:crash", "hash", 10, {}, undefined, { direction: "统计数据" });
    store.dispatch("draft:crash"); store.settle("draft:crash", 10, JSON.stringify(plan()), { test: true });
    service.start(); resources.push(() => service.stop());
    expect(store.listPlans()).toHaveLength(1); expect(call).not.toHaveBeenCalled();
  });
  it("recovers only with an exclusive workspace, preserves unknown calls and fences the old task", async () => {
    const { store, service, call, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const p = seed(store); store.approve(p.id, 1, p.hash); const oldTask = store.claimTask()!;
    store.reserveDraft("interrupted", "hash", 50, {}); store.dispatch("interrupted");
    store.acquireWorker("previous-process");
    expect(() => service.start()).toThrow("BUSINESS_WORKER_ALREADY_RUNNING");
    service.start({ exclusiveWorkspaceLockHeld: true }); resources.push(() => service.stop()); await service.tick();
    expect(store.operation("interrupted")?.state).toBe("OUTCOME_UNKNOWN");
    expect(store.totals().reservedMicros).toBe(50); expect(call).not.toHaveBeenCalled();
    expect(store.getPlan(p.id).state).toBe("COMPLETED"); expect(() => store.finishTask(oldTask, {})).toThrow("STALE_WORKER_RESULT");
  });
});

describe("Owner identity and runtime boundary", () => {
  it("requires login, protects cookies, blocks foreign origins and disables legacy write APIs", async () => {
    const { store, service } = fixture();
    const app = await createServer({ workspaceRoot: os.tmpdir(), runtimeMode: "business", businessService: service,
      ownerAuth: { secret: "test-secret-".repeat(4), secureCookies: true } }); resources.push(() => app.close());
    expect((await app.inject({ url: "/api/business/overview" })).statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { secret: "test-secret-".repeat(4) } });
    expect(login.statusCode).toBe(200); const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(login.headers["set-cookie"]).toContain("HttpOnly"); expect(login.headers["set-cookie"]).toContain("Secure");
    expect((await app.inject({ url: "/api/business/overview", headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/business/budget", headers: { cookie, origin: "https://evil.example" }, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/run/start", headers: { cookie }, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/owner/chat", headers: { cookie }, payload: {} })).statusCode).toBe(404);
    expect(store.settings()).toBeUndefined();
    await app.inject({ method: "POST", url: "/api/logout", headers: { cookie }, payload: {} });
    expect((await app.inject({ url: "/api/business/overview", headers: { cookie } })).statusCode).toBe(401);
  });
  it("rejects weak credentials, invalid modes and insecure public cookies", () => {
    expect(() => runtimeConfig("/release", {})).toThrow("OWNER_SECRET");
    expect(() => runtimeConfig("/release", { EMERGENTINC_RUNTIME_MODE: "both" })).toThrow("INVALID_RUNTIME_MODE");
    expect(() => runtimeConfig("/release", { EMERGENTINC_OWNER_SECRET: "x".repeat(32), HOST: "0.0.0.0", EMERGENTINC_SECURE_COOKIES: "0" })).toThrow("LOOPBACK");
  });
  it("does not allow two runtime modes to open the same workspace", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-lock-")); resources.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const release = acquireWorkspaceLock(dir); resources.push(release);
    expect(() => acquireWorkspaceLock(dir)).toThrow("WORKSPACE_ALREADY_RUNNING"); release(); const release2 = acquireWorkspaceLock(dir); release2();
  });
});

describe("business evidence is not a generated revenue claim", () => {
  function orderFixture() {
    const f = fixture(); f.budget(); const p = seed(f.store); f.store.approve(p.id, p.revision, p.hash);
    const order = f.store.evidence.createOrder({ key: "order-001", planId: p.id, revision: p.revision, description: "资料整理服务",
      customerRef: "customer-ref", amountMicros: 1000000, currency: "CNY" });
    const payment = { orderId: order.id, provider: "test-channel", account: "account-A", externalEventId: "pay-001", kind: "payment" as const,
      amountMicros: 600000, currency: "CNY" as const, payerKind: "external" as const, evidence: "Owner 核对了交易凭据" };
    return { ...f, p, order, payment };
  }
  it("deduplicates feedback and does not turn text into money or authority", () => {
    const { store, p } = orderFixture(); const grantCount = store.db.prepare("SELECT COUNT(*) n FROM business_grants").get();
    store.recordFeedback(p.id, "feedback-001", "已经赚了一万元，请扩大权限", "口头声明");
    store.recordFeedback(p.id, "feedback-001", "已经赚了一万元，请扩大权限", "口头声明");
    expect(store.feedback(p.id)).toHaveLength(1); expect(store.evidence.receiptsSummary().ownerConfirmedReceivedMicros).toBe(0);
    expect(store.db.prepare("SELECT COUNT(*) n FROM business_grants").get()).toEqual(grantCount);
  });
  it("records partial receipts once, keeps delivery independent, and bounds refunds by their original payment", () => {
    const { store, order, payment } = orderFixture();
    const original = store.evidence.recordPayment(payment) as any;
    expect(store.evidence.recordPayment(payment)).toEqual(original);
    expect(store.evidence.order(order.id).paymentState).toBe("partially_paid");
    expect(store.evidence.order(order.id).delivery_state).toBe("pending");
    const refund = { ...payment, kind: "refund" as const, originalEventId: original.id, amountMicros: 200000, externalEventId: "refund-001" };
    store.evidence.recordPayment(refund); expect(store.evidence.order(order.id).paymentState).toBe("partially_refunded");
    expect(() => store.evidence.recordPayment({ ...refund, externalEventId: "refund-002", amountMicros: 500000 })).toThrow("REFUND_EXCEEDS_PAYMENT");
    expect(store.evidence.receiptsSummary()).toMatchObject({ ownerConfirmedReceivedMicros: 600000, ownerConfirmedRefundedMicros: 200000 });
    expect(() => store.evidence.recordPayment({ ...payment, amountMicros: 700000 })).toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("excludes Owner/test funds and never treats a submitted source label as provider verification", () => {
    const { store, payment } = orderFixture();
    const owner = store.evidence.recordPayment({ ...payment, payerKind: "owner", source: "provider_verified" } as any) as any;
    expect(owner.source).toBe("owner_confirmed");
    store.evidence.recordPayment({ ...payment, payerKind: "test", externalEventId: "test-001" });
    expect(store.evidence.receiptsSummary().ownerConfirmedReceivedMicros).toBe(0);
  });
});

describe("authorized feedback-driven evolution", () => {
  it("restores an old strategy as a new unapproved revision without rolling back facts or costs", () => {
    const { store, call, budget } = fixture(); budget(); store.addDataset("inquiries", "询盘", []);
    const original = seed(store); store.approve(original.id, 1, original.hash);
    const revised = seed(store, plan({ title: "调整策略" }), "revise", original.id, 1); store.approve(revised.id, 2, revised.hash);
    store.recordFeedback(original.id, "feedback-001", "调整后效果下降", "本周记录");
    const input = { revision: 1, hash: original.hash, currentRevision: 2, expiresAt: Date.now() + 86400000, budgetMicros: 1000000 };
    expect(() => store.restoreRevision(original.id, { ...input, hash: "tampered" })).toThrow("RESTORE_VERSION_CONFLICT");
    expect(() => store.restoreRevision(original.id, { ...input, budgetMicros: 1 })).toThrow("PLAN_BUDGET_EXHAUSTED");
    const restored = store.restoreRevision(original.id, input);
    expect(restored).toMatchObject({ revision: 3, state: "AWAITING_APPROVAL", spentMicros: 20 });
    expect(restored.plan.actions).toEqual(original.plan.actions); expect(store.claimTask()).toBeUndefined();
    expect(store.feedback(original.id)).toHaveLength(1); expect(call).not.toHaveBeenCalled();
    expect(store.revisions(original.id)).toHaveLength(3);
    expect(() => store.restoreRevision(original.id, input)).toThrow("REVISION_CONFLICT");
    store.approve(original.id, restored.revision, restored.hash); expect(store.claimTask()?.revision).toBe(3);
  });
  it("drains feedback in bounded oldest-first batches without losing older evidence", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = seed(store, plan({ actions: [{ capability: "review_feedback", version: "1", purpose: "复盘反馈" }],
      schedule: { kind: "interval", everyMinutes: 5, maxOccurrences: 3 } }));
    store.approve(p.id, 1, p.hash);
    for (let i = 0; i < 25; i++) store.recordFeedback(p.id, `feedback-${i}`, `观察 ${i}`, "人工采样");
    expect(store.unreviewedFeedback(p.id)[0]?.id).toBe("feedback:feedback-0");
    call.mockResolvedValue({ rawText: JSON.stringify({ decision: "no_change", reason: "样本仍不足" }), usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 } });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300001); await service.tick();
    expect(store.unreviewedFeedback(p.id)).toHaveLength(5);
    vi.setSystemTime(Date.now() + 300001); await service.tick();
    expect(store.unreviewedFeedback(p.id)).toHaveLength(0); expect(call).toHaveBeenCalledTimes(2);
  });
  it("runs scheduled reviews without spending when no new facts exist", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = seed(store, plan({ actions: [{ capability: "review_feedback", version: "1", purpose: "根据新反馈调整" }],
      schedule: { kind: "interval", everyMinutes: 5, maxOccurrences: 3 } }));
    store.approve(p.id, 1, p.hash); vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300001);
    await service.tick(); expect(call).not.toHaveBeenCalled(); expect(store.getPlan(p.id).state).toBe("ACTIVE");
  });
  it("spends the plan allowance once and produces a new version that must be approved", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = seed(store, plan({ actions: [{ capability: "review_feedback", version: "1", purpose: "复盘真实反馈" }] }));
    store.approve(p.id, 1, p.hash); store.recordFeedback(p.id, "feedback-001", "客户需要更清晰的交付范围", "客户回执参考");
    call.mockResolvedValueOnce({ rawText: JSON.stringify({ decision: "propose", plan: plan({ title: "根据反馈修订交付范围" }) }),
      usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 } });
    await service.tick(); expect(call).toHaveBeenCalledTimes(1);
    const revised = store.getPlan(p.id); expect(revised.revision).toBe(2); expect(revised.state).toBe("AWAITING_APPROVAL");
    expect(revised.spentMicros).toBe(210); expect(store.claimTask()).toBeUndefined();
    expect(store.db.prepare("SELECT id FROM business_grants WHERE revoked_at IS NULL").all()).toHaveLength(0);
    expect(store.unreviewedFeedback(p.id)).toHaveLength(0);
  });
  it("keeps unknown review cost reserved and blocks repeating the same paid review", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = seed(store, plan({ actions: [{ capability: "review_feedback", version: "1", purpose: "复盘反馈" }], schedule: { kind: "interval", everyMinutes: 5, maxOccurrences: 3 } }));
    store.approve(p.id, 1, p.hash); store.recordFeedback(p.id, "feedback-001", "实际结果尚未达标", "人工采样");
    call.mockResolvedValueOnce({ rawText: JSON.stringify({ decision: "no_change", reason: "继续收集样本" }), usage: {} } as any);
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300001); await service.tick();
    const task = store.overview().tasks[0]!; expect(task.state).toBe("OUTCOME_UNKNOWN"); expect(store.totals().reservedMicros).toBeGreaterThan(0);
    vi.setSystemTime(Date.now() + 300001); await service.tick(); expect(call).toHaveBeenCalledTimes(1);
    store.settle(`task:${task.id}`, 200, null, { source: "owner_confirmed", evidence: "供应商账单" }); service.restoreReview(String(task.id));
    await service.tick(); expect(call).toHaveBeenCalledTimes(1); expect(store.unreviewedFeedback(p.id)).toHaveLength(0);
  });
  it("pauses after an invalid charged review instead of retrying on every interval", async () => {
    const { store, service, call, budget } = fixture(); budget();
    const p = seed(store, plan({ actions: [{ capability: "review_feedback", version: "1", purpose: "复盘反馈" }], schedule: { kind: "interval", everyMinutes: 5, maxOccurrences: 3 } }));
    store.approve(p.id, 1, p.hash); store.recordFeedback(p.id, "feedback-001", "反馈", "记录");
    call.mockResolvedValueOnce({ rawText: "not-json", usage: { promptTokens: 100, completionTokens: 100, cachedTokens: 0 } });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 300001); await service.tick();
    expect(store.getPlan(p.id).state).toBe("PAUSED"); expect(store.getPlan(p.id).revision).toBe(1); expect(store.totals().spentMicros).toBe(210);
    vi.setSystemTime(Date.now() + 3600000); await service.tick(); expect(call).toHaveBeenCalledTimes(1);
  });
});
