import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BusinessStore } from "@emergentinc/persistence";
import { BusinessPlan, GithubIssueAction } from "@emergentinc/protocol";
import { GithubIssuesConnector } from "@emergentinc/tools";
import { BusinessConnections } from "../src/services/business_connections.js";
import { BusinessService } from "../src/services/business_service.js";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
const token = "github_pat_test_credential_never_sent_to_a_real_provider";
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "business-connection-"));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new BusinessStore(); cleanup.push(() => store.close());
  const published: any[] = [];
  let loseResponse = false;
  const http = vi.fn(async (url: string, init: RequestInit) => {
    if (url === "https://api.github.com/user") return Response.json({ login: "owner" });
    if (url === "https://api.github.com/repos/owner/business") return Response.json({ full_name: "owner/business", has_issues: true, permissions: { push: true } });
    if (url === "https://api.github.com/repos/owner/business/issues" && init.method === "POST") {
      const issue = { ...JSON.parse(String(init.body)), id: 100, number: 1, html_url: "https://github.com/owner/business/issues/1", user: { login: "owner" } };
      published.push(issue); if (loseResponse) throw new Error("connection lost after remote acceptance"); return Response.json(issue, { status: 201 });
    }
    if (url.startsWith("https://api.github.com/repos/owner/business/issues?") && init.method === "GET") return Response.json(published);
    throw new Error(`UNEXPECTED_TEST_REQUEST ${url}`);
  });
  const connections = new BusinessConnections(store, dir, new GithubIssuesConnector(http));
  const service = new BusinessService(store, undefined, undefined, undefined, connections);
  cleanup.push(() => service.stop());
  store.configure({ limitMicros: 1000000, draftLimitMicros: 1000000, draftCallLimit: 20, draftExpiresAt: Date.now() + 86400000 });
  const action: GithubIssueAction = { capability: "github_issue_create", version: "1", connectionId: "github-main", repository: "owner/business", accountLogin: "owner", title: "交付材料", body: "Owner 批准的具体正文", purpose: "交付反馈" };
  function proposal(key = "plan-001") {
    const plan: BusinessPlan = { title: "交付方案", objective: "完成一次交付", audience: "已有客户", hypothesis: "仓库适合该项目交付",
      metric: { name: "接受", baseline: "尚未交付", target: "客户确认接受", evidence: "客户回应" }, stopCondition: "客户拒绝",
      expiresAt: Date.now() + 86400000, budgetMicros: 1000000, currency: "CNY", actions: [action], resources: [] };
    store.reserveDraft(key, key, 10, {}); store.dispatch(key); store.settle(key, 10, JSON.stringify(plan), {});
    return store.saveProposal("完成交付", plan, key);
  }
  return { store, connections, service, http, published, action, proposal, lose: () => { loseResponse = true; } };
}
describe("bounded GitHub connection and unknown external writes", () => {
  it("keeps credentials out of database, prompts and owner overview", async () => {
    const { connections, store, http } = setup();
    const result = await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(store.overview())).not.toContain(token);
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls.every(([url, init]) => url.startsWith("https://api.github.com/") && init.redirect === "error")).toBe(true);
    await expect(connections.authorizeGithub({ id: "github-main", repository: "owner/business", token })).rejects.toThrow("CONNECTION_IMMUTABLE");
  });
  it("only sends after exact approval and records one provider receipt", async () => {
    const { connections, service, store, published, proposal } = setup();
    await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    const p = proposal(); await service.tick(); expect(published).toHaveLength(0);
    store.approve(p.id, 1, p.hash); await service.tick(); await service.tick(); expect(published).toHaveLength(1);
    expect(store.getPlan(p.id).state).toBe("COMPLETED");
    const task = store.overview().tasks[0]!;
    expect(JSON.parse(String(task.output)).verification).toBe("provider_verified");
    expect(store.operation(`task:${task.id}`)?.state).toBe("SETTLED");
  });
  it("does not resend after remote acceptance and local timeout; can reconcile after revocation", async () => {
    const { connections, service, store, published, proposal, lose } = setup();
    await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    const p = proposal(); store.approve(p.id, 1, p.hash); lose(); await service.tick();
    const task = store.overview().tasks[0]!; expect(task.state).toBe("OUTCOME_UNKNOWN");
    await service.tick(); expect(published).toHaveLength(1);
    store.control(p.id, "revoke"); store.disableConnection("github-main");
    expect(await service.reconcileTask(String(task.id))).toMatchObject({ found: true });
    expect(store.task(String(task.id))?.state).toBe("SUCCEEDED"); expect(store.getPlan(p.id).state).toBe("STOPPED");
    expect(published).toHaveLength(1);
  });
  it("does not infer non-delivery from a missing receipt", async () => {
    const { connections, service, store, proposal, published, lose } = setup();
    await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    const p = proposal(); store.approve(p.id, 1, p.hash); lose(); await service.tick();
    const task = store.overview().tasks[0]!; published.length = 0;
    expect(await service.reconcileTask(String(task.id))).toMatchObject({ found: false });
    expect(store.task(String(task.id))?.state).toBe("OUTCOME_UNKNOWN");
    expect(() => store.retryPureTask(String(task.id), "请重发")).toThrow("TASK_NOT_RETRYABLE");
  });
  it("revoked account and tampered target cannot dispatch", async () => {
    const { connections, service, store, proposal, published, action } = setup();
    await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    expect(() => connections.prepare({ ...action, repository: "stranger/repo" })).toThrow("CONNECTION_SCOPE_DENIED");
    const p = proposal(); store.approve(p.id, 1, p.hash); store.disableConnection("github-main"); await service.tick();
    expect(published).toHaveLength(0);
    expect(store.getPlan(p.id).state).toBe("PAUSED"); expect(store.overview().requests).toHaveLength(1);
    expect(store.overview().tasks[0]?.error).toBe("CONNECTION_SCOPE_DENIED");
  });
  it("turns a pre-dispatch crash into an actionable failure without silently replaying", async () => {
    const { connections, service, store, proposal, published } = setup();
    await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    const p = proposal(); store.approve(p.id, 1, p.hash); const task = store.claimTask()!;
    store.prepareTaskOperation(task);
    service.start({ exclusiveWorkspaceLockHeld: true }); await service.tick();
    expect(store.task(task.id)?.state).toBe("FAILED"); expect(store.getPlan(p.id).state).toBe("PAUSED");
    expect(store.overview().requests[0]?.resource).toBe(`task:${task.id}`); expect(published).toHaveLength(0);
  });
  it("recovers a dispatched write as unknown after a crash without replaying it", async () => {
    const { connections, service, store, proposal, published } = setup();
    await connections.authorizeGithub({ id: "github-main", repository: "owner/business", token });
    const p = proposal(); store.approve(p.id, 1, p.hash); const task = store.claimTask()!;
    const operation = store.prepareTaskOperation(task); store.dispatchTaskOperation(task, operation);
    service.start({ exclusiveWorkspaceLockHeld: true }); await service.tick();
    expect(store.task(task.id)?.state).toBe("OUTCOME_UNKNOWN"); expect(published).toHaveLength(0);
  });
});
