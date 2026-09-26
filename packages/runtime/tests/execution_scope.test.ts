import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CoreStore } from "@emergentinc/persistence";
import { ToolRegistry, ToolRuntime, handleSaveArtifact, handleTransferArtifact } from "@emergentinc/tools";
import { RoundScheduler } from "../src/index.js";

const narrative = (displayName: string) => ({
  displayName, title: null, roleLabel: null, traits: {}, behaviorProfile: [], flaw: null,
  shortBio: null, appearanceSpec: null, portraitAsset: null, contentRevision: null,
});

describe("Runtime: execution scope", () => {
  let store: CoreStore | null = null;
  let workspaceRoot: string | null = null;
  afterEach(() => {
    store?.close(); store = null;
    if (workspaceRoot) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = null;
  });

  it("executes only messages from the selected task or ordinary world queue", async () => {
    store = new CoreStore(":memory:");
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "execution-scope-"));
    const addMember = (name: string, pixelId: string) => {
      const profile = store!.qianji.createProfile({ careerStatus: "active", narrative: narrative(name) });
      const binding = store!.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId, incarnation: 1 });
      store!.pixels.upsertPixelAccount({ pixelId, energy: 1000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
      return binding;
    };
    const bindingA = addMember("A", "0_0_0");
    const bindingB = addMember("B", "1_0_0");
    const bindingWorld = addMember("World", "4_0_0");
    const execA = store.executions.create({ kind: "mission", subjectId: "mission_a", budgetTokens: 100,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [bindingA.bindingId] });
    const execB = store.executions.create({ kind: "mission", subjectId: "mission_b", budgetTokens: 100,
      roundsLimit: 1, inputSnapshot: {}, toolsSnapshot: [], bindingIds: [bindingB.bindingId] });
    store.executions.transition(execA.executionId, "ready", "running");
    store.executions.transition(execB.executionId, "ready", "running");
    store.messages.enqueueMessage({ roundNum: 1, sender: "system", recipient: "0_0_0", content: "world for occupied A" });
    const taskA = store.messages.enqueueMessage({ roundNum: 1, sender: "human", recipient: "0_0_0", content: "task A",
      sourceType: "human", executionId: execA.executionId });
    const taskB = store.messages.enqueueMessage({ roundNum: 1, sender: "human", recipient: "1_0_0", content: "task B",
      sourceType: "human", executionId: execB.executionId });
    const worldOnly = store.messages.enqueueMessage({ roundNum: 1, sender: "system", recipient: "4_0_0", content: "world only" });
    const processed: string[] = [];
    const fakeRunner = {
      async execute(input: any) {
        processed.push(input.message.messageId);
        store!.messages.commitMessage(input.message.messageId);
        return { decision: { send_to: "STOP", operations: [] } };
      },
      isReadOnlyTool: () => false,
    } as any;
    const scheduler = new RoundScheduler({ workspaceRoot, store, stepRunner: fakeRunner });
    await scheduler.executeRound(1, "run-a", undefined, execA.executionId);
    expect(processed).toEqual([taskA.messageId]);
    expect(store.messages.getMessage(taskB.messageId)?.status).toBe("QUEUED");
    expect(store.messages.getMessage(worldOnly.messageId)?.status).toBe("QUEUED");

    await scheduler.executeRound(1, "run-world");
    expect(processed).toEqual([taskA.messageId, worldOnly.messageId]);
  });

  it("denies tools outside the snapshot and blocks global private files even if listed", async () => {
    let invoked = 0;
    const registry = new ToolRegistry();
    const handler = async (_args: Record<string, any>, ctx: any) => {
      invoked++;
      return { operation_id: ctx.operationId, tool: "read_private_file", status: "SUCCESS", output: {}, duration_ms: 0, truncated: false };
    };
    registry.register({ name: "extra_tool", description: "", input_schema: { type: "object" }, effect: "read", enabled: true }, handler);
    registry.register({ name: "read_private_file", description: "", input_schema: { type: "object" }, effect: "read", enabled: true }, handler);
    const runtime = new ToolRuntime(registry);
    const base = { workspaceRoot: os.tmpdir(), pixelId: "0_0_0", runId: "r", messageId: "m", operationId: "o",
      executionScope: { executionId: "exec", kind: "mission" as const, allowedTools: ["read_private_file"],
        allowedRecipients: [], inputSnapshot: {} } };

    expect((await runtime.execute("extra_tool", {}, base)).error_code).toBe("EXECUTION_TOOL_NOT_ALLOWED");
    expect((await runtime.execute("read_private_file", {}, base)).error_code).toBe("EXECUTION_GLOBAL_PRIVATE_ACCESS_DENIED");
    expect(invoked).toBe(0);
  });

  it("writes execution artifacts into an isolated root and refuses trial transfers", async () => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "execution-artifacts-"));
    const context: any = { workspaceRoot, pixelId: "0_0_0", runId: "r", messageId: "m", operationId: "o",
      executionScope: { executionId: "exec_test", kind: "trial_candidate", allowedTools: ["save_artifact", "transfer_artifact"],
        allowedRecipients: ["1_0_0"], inputSnapshot: {} } };
    const saved = await handleSaveArtifact({ filename: "answer.txt", content: "synthetic" }, context);
    expect(saved.status).toBe("SUCCESS");
    expect(fs.readFileSync(path.join(workspaceRoot, "evidence", "exec_test", "artifacts", "0_0_0", "answer.txt"), "utf8"))
      .toBe("synthetic");
    const transfer = await handleTransferArtifact({ filename: "answer.txt", target_pixel_id: "1_0_0" }, context);
    expect(transfer).toMatchObject({ status: "FAILED", error_code: "EXECUTION_SCOPE_DENIED" });
  });
});
