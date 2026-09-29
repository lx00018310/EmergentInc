import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutomationSupervisor } from "../src/services/automation_supervisor.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "automation-supervisor-")); disposers.push(() => rmSync(dir, { recursive: true, force: true }));
  let fail = false;
  const env = { rootless: true, seccomp: "builtin", cgroup: 2, image: `node@sha256:${"a".repeat(64)}` };
  // Executor contract double only; candidate JavaScript is never evaluated by the host test.
  const runner = { probe: vi.fn(async () => env), recoverInterrupted: vi.fn(async () => ({ removed: 0 })),
    run: vi.fn(async (_source: string, input: any) => {
      if (fail) throw new Error("AUTOMATION_EXECUTION_FAILED");
      const totals: Record<string, number> = {}, invalid: Record<string, number> = {};
      for (const field of input.numericFields) {
        totals[field] = 0; invalid[field] = 0;
        for (const row of input.rows) {
          const value = row[field];
          if ((typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value))) totals[field] += Number(value);
          else invalid[field]++;
        }
      }
      return { rows: input.rows.length, totals, invalid };
    }) };
  const filename = join(dir, "changes.sqlite3");
  const service = new AutomationSupervisor(filename, runner, true); let closed = false;
  disposers.push(() => { if (!closed) service.close(); });
  const submit = (id: string) => service.submit({ id, source: `export default input => input; // ${id}`, problem: "CSV 金额未汇总", evidence: "复现：文本 12.50 未被统计" });
  return { service, runner, env, submit, filename, fail: () => { fail = true; }, close: () => { service.close(); closed = true; } };
}
describe("durable automation supervisor (mock executor, not deployment acceptance)", () => {
  it("deduplicates requests, persists across restart, and refuses a changed source under the same id", () => {
    const f = fixture(); const created = f.submit("change-001"); expect(f.submit("change-001").id).toBe(created.id);
    expect(() => f.service.submit({ id: "change-001", source: "different", problem: "same", evidence: "same" })).toThrow("IDEMPOTENCY_CONFLICT");
    f.close(); const reopened = new AutomationSupervisor(f.filename, f.runner, true); disposers.push(() => reopened.close());
    expect(reopened.get("change-001").state).toBe("PROPOSED"); expect(reopened.list()).toHaveLength(1);
  });
  it("requires recovery, trusted validation, and approval of the exact candidate hash before activation", async () => {
    const f = fixture(); f.submit("change-001");
    await expect(f.service.validate("change-001")).rejects.toThrow("RECOVERY_REQUIRED");
    await f.service.recover(); const validated = await f.service.validate("change-001");
    expect(validated.state).toBe("AWAITING_APPROVAL"); expect(validated.validation.passed).toBe(true);
    await expect(f.service.activate("change-001")).rejects.toThrow("OWNER_CANDIDATE_APPROVAL_REQUIRED");
    expect(() => f.service.approve("change-001", "forged")).toThrow("HASH_CONFLICT");
    f.service.approve("change-001", validated.candidate_hash); await f.service.activate("change-001"); await f.service.activate("change-001");
    expect(f.service.get("change-001").history.filter((e: any) => e.kind === "automation_activated")).toHaveLength(1);
    expect(await f.service.run({ rows: [{ amount: "2.5" }], numericFields: ["amount"] })).toMatchObject({ changeId: "change-001", result: { totals: { amount: 2.5 } } });
  });
  it("rejects a failed candidate and never allows a validation receipt to approve itself", async () => {
    const f = fixture(); f.submit("change-001"); await f.service.recover(); f.fail();
    const failed = await f.service.validate("change-001"); expect(failed.state).toBe("REJECTED");
    expect(() => f.service.approve("change-001", failed.candidate_hash)).toThrow("VALIDATION_INVALID");
    await expect(f.service.activate("change-001")).rejects.toThrow("VALIDATION_INVALID");
  });
  it("rolls back the failed program without replaying its invocation or resurrecting it on activation retry", async () => {
    const f = fixture(); await f.service.recover();
    for (const id of ["change-001", "change-002"]) {
      f.submit(id); const v = await f.service.validate(id); f.service.approve(id, v.candidate_hash); await f.service.activate(id);
    }
    f.fail(); const count = f.runner.run.mock.calls.length;
    await expect(f.service.run({ rows: [], numericFields: [] })).rejects.toThrow("AUTOMATION_EXECUTION_FAILED");
    expect(f.runner.run).toHaveBeenCalledTimes(count + 1); expect(f.service.get("change-002").state).toBe("ROLLED_BACK");
    expect(f.service.get("change-001").state).toBe("ACTIVE");
    expect((await f.service.activate("change-002")).state).toBe("ROLLED_BACK");
  });
  it("stops when the runtime image changes and keeps the condition actionable", async () => {
    const f = fixture(); f.submit("change-001"); await f.service.recover(); const v = await f.service.validate("change-001");
    f.service.approve("change-001", v.candidate_hash); await f.service.activate("change-001"); f.env.image = `node@sha256:${"b".repeat(64)}`;
    await expect(f.service.run({ rows: [], numericFields: [] })).rejects.toThrow("APPROVED_RUNTIME_CHANGED");
    expect(f.service.get("change-001").state).toBe("RECOVERY_REQUIRED");
    await expect(f.service.run({ rows: [], numericFields: [] })).rejects.toThrow("APPROVED_AUTOMATION_REQUIRED");
  });
});
