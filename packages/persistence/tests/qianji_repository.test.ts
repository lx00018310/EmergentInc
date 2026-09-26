import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CoreStore, initSchema, SqliteDatabase } from "../src/index.js";
import { QianjiNarrativeSpec } from "@emergentinc/protocol";

const narrative = (displayName: string): QianjiNarrativeSpec => ({
  displayName,
  title: null,
  roleLabel: null,
  traits: {},
  behaviorProfile: [],
  flaw: null,
  shortBio: null,
  appearanceSpec: null,
  portraitAsset: null,
  contentRevision: null,
});

describe("Persistence: Qianji identity and events", () => {
  const temporaryDirectories: string[] = [];
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates an identity and initial narrative revision in the same fact stream", () => {
    const store = new CoreStore(":memory:");
    try {
      const profile = store.qianji.createProfile({ narrative: narrative("未命名角色") });
      expect(profile).toMatchObject({ careerStatus: "candidate", narrativeRevision: 0, retiredAt: null });
      expect(store.qianji.getNarrativeRevision(profile.qianjiId, 0)?.narrative.displayName).toBe("未命名角色");
      expect(store.worldEvents.listRecent()).toMatchObject([{
        eventType: "QIANJI_PROFILE_CREATED",
        qianjiId: profile.qianjiId,
        payload: { careerStatus: "candidate", narrativeRevision: 0 },
      }]);
    } finally {
      store.close();
    }
  });

  it("migrates schema idempotently and persists identities across database reopen", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "qianji-schema-"));
    temporaryDirectories.push(directory);
    const dbPath = path.join(directory, "test.sqlite");
    const first = new SqliteDatabase(dbPath);
    initSchema(first);
    first.close();

    const store = new CoreStore(dbPath);
    const profile = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("旧成员") });
    store.close();

    const reopened = new CoreStore(dbPath);
    try {
      expect(reopened.qianji.getProfile(profile.qianjiId)?.narrative.displayName).toBe("旧成员");
      expect(reopened.db.prepare("SELECT value FROM schema_meta WHERE key = 'qianji_schema_version'").get())
        .toEqual({ value: "3" });
      expect(reopened.db.prepare("SELECT COUNT(*) AS count FROM qianji_profiles").get()).toEqual({ count: 1 });
      expect(reopened.db.prepare("SELECT COUNT(*) AS count FROM world_events").get()).toEqual({ count: 1 });
    } finally {
      reopened.close();
    }
  });

  it("upgrades a legacy nullable-cost model_calls table without attributing its old row", () => {
    const db = new SqliteDatabase(":memory:");
    try {
      db.exec(`
        CREATE TABLE model_calls (
          call_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, pixel_id TEXT NOT NULL, message_id TEXT,
          model TEXT NOT NULL, pricing_revision TEXT, prompt_hash TEXT, raw_response TEXT, normalized_response TEXT,
          prompt_tokens INTEGER, completion_tokens INTEGER, cached_tokens INTEGER, actual_tokens INTEGER,
          cost_cny REAL NOT NULL DEFAULT 0, tool_cost REAL NOT NULL DEFAULT 0,
          round_num INTEGER NOT NULL DEFAULT 0, outcome TEXT NOT NULL DEFAULT 'SUCCESS', created_at REAL NOT NULL
        );
        INSERT INTO model_calls (call_id, run_id, pixel_id, model, prompt_tokens, completion_tokens, actual_tokens, cost_cny, tool_cost, round_num, created_at)
        VALUES ('legacy_migration_call', 'legacy_run', '0_0_0', 'test', 8, 2, 10, 0.25, 0, 0, 100);
      `);
      initSchema(db);
      initSchema(db);
      const upgraded = db.prepare("SELECT binding_id, narrative_revision, cost_cny, tool_cost, round_num FROM model_calls WHERE call_id = ?")
        .get("legacy_migration_call");
      expect(upgraded).toEqual({ binding_id: null, narrative_revision: null, cost_cny: 0.25, tool_cost: null, round_num: null });
      expect(db.prepare("SELECT value FROM schema_meta WHERE key = 'qianji_schema_version'").get()).toEqual({ value: "3" });
    } finally { db.close(); }
  });

  it("uses compare-and-swap for narrative edits and keeps the stable identity ID", () => {
    const store = new CoreStore(":memory:");
    try {
      const profile = store.qianji.createProfile({ narrative: narrative("初始名") });
      const changed = store.qianji.updateNarrative(profile.qianjiId, 0, narrative("新名字"));
      expect(changed.qianjiId).toBe(profile.qianjiId);
      expect(changed.narrativeRevision).toBe(1);
      expect(store.qianji.getNarrativeRevision(profile.qianjiId, 0)?.narrative.displayName).toBe("初始名");
      expect(store.qianji.getNarrativeRevision(profile.qianjiId, 1)?.narrative.displayName).toBe("新名字");
      expect(() => store.qianji.updateNarrative(profile.qianjiId, 0, narrative("覆盖"))).toThrow("REVISION_CONFLICT");
      expect(store.worldEvents.listRecent({ limit: 10 })).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  it("enforces one current binding per person and pixel while preserving ended history", () => {
    const store = new CoreStore(":memory:");
    try {
      const first = store.qianji.createProfile({ narrative: narrative("甲") });
      const second = store.qianji.createProfile({ narrative: narrative("乙") });
      const binding = store.qianji.createBinding({
        qianjiId: first.qianjiId, pixelId: "0_0_0", incarnation: 1, boundAt: 10,
      });
      expect(() => store.qianji.createBinding({
        qianjiId: first.qianjiId, pixelId: "0_1_0", incarnation: 1, boundAt: 11,
      })).toThrow();
      expect(() => store.qianji.createBinding({
        qianjiId: second.qianjiId, pixelId: "0_0_0", incarnation: 1, boundAt: 11,
      })).toThrow();

      store.qianji.unbindAndRetire(binding.bindingId, "live/history/0_0_0/effect-1/pixel", "body_replaced", 20);
      const next = store.qianji.createProfile({ narrative: narrative("丙") });
      store.qianji.createBinding({ qianjiId: next.qianjiId, pixelId: "0_0_0", incarnation: 2, boundAt: 21 });
      expect(store.qianji.getCurrentBindingByPixel("0_0_0")?.qianjiId).toBe(next.qianjiId);
      expect(store.qianji.listBindings(first.qianjiId)[0]).toMatchObject({
        bindingId: binding.bindingId,
        unboundAt: 20,
        archiveRelativePath: "live/history/0_0_0/effect-1/pixel",
      });
      expect(store.qianji.getProfile(first.qianjiId)).toMatchObject({
        careerStatus: "retired", retiredAt: 20, retiredReason: "body_replaced",
      });
      expect(() => store.qianji.createBinding({
        qianjiId: second.qianjiId, pixelId: "0_0_0", incarnation: 1, boundAt: 22,
      })).toThrow();
    } finally {
      store.close();
    }
  });

  it("makes source-keyed events and Owner actions idempotent and rejects conflicting replays", () => {
    const store = new CoreStore(":memory:");
    try {
      const profile = store.qianji.createProfile({ narrative: narrative("甲") });
      const event = store.worldEvents.append({
        eventType: "QIANJI_BOUND", subjectType: "qianji", subjectId: profile.qianjiId,
        qianjiId: profile.qianjiId, sourceKey: "test:binding", payload: { incarnation: 1 }, createdAt: 1,
      });
      expect(store.worldEvents.append({
        eventType: "QIANJI_BOUND", subjectType: "qianji", subjectId: profile.qianjiId,
        qianjiId: profile.qianjiId, sourceKey: "test:binding", payload: { incarnation: 1 }, createdAt: 2,
      }).eventId).toBe(event.eventId);
      expect(() => store.worldEvents.append({
        eventType: "QIANJI_BOUND", subjectType: "qianji", subjectId: profile.qianjiId,
        qianjiId: profile.qianjiId, sourceKey: "test:binding", payload: { incarnation: 2 },
      })).toThrow("different facts");

      let writes = 0;
      const work = () => ({ value: ++writes });
      expect(store.ownerActions.execute("request-1", "test", { qianjiId: profile.qianjiId }, work)).toEqual({ value: 1 });
      expect(store.ownerActions.execute("request-1", "test", { qianjiId: profile.qianjiId }, work)).toEqual({ value: 1 });
      expect(writes).toBe(1);
      expect(() => store.ownerActions.execute("request-1", "test", { qianjiId: "other" }, work)).toThrow("different owner action");
    } finally {
      store.close();
    }
  });

  it("freezes message bindings and call narrative revision, and attributes only current ledger writes", () => {
    const store = new CoreStore(":memory:");
    try {
      store.pixels.upsertPixelAccount({ pixelId: "0_0_0", energy: 5000, active: true, refundDeficitTokens: 0, spendBlockedReason: null });
      const sender = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("发送者") });
      const receiver = store.qianji.createProfile({ careerStatus: "active", narrative: narrative("初始名") });
      store.qianji.createBinding({ qianjiId: sender.qianjiId, pixelId: "1_0_0", incarnation: 1 });
      const binding = store.qianji.createBinding({ qianjiId: receiver.qianjiId, pixelId: "0_0_0", incarnation: 1 });
      const queued = store.messages.enqueueMessage({
        sender: "1_0_0", recipient: "0_0_0", content: "hello", roundNum: 1,
      });
      expect(queued).toMatchObject({
        senderBindingId: store.qianji.getCurrentBindingByPixel("1_0_0")?.bindingId,
        recipientBindingId: binding.bindingId,
        bindingSnapshotCaptured: true,
        identitySnapshotCaptured: false,
      });
      store.messages.updateStatus(queued.messageId, "COMMITTED");

      const legacy = store.messages.enqueueMessage({
        sender: "system", recipient: "0_0_0", content: "legacy queued", roundNum: 1,
      });
      store.db.prepare("UPDATE messages SET recipient_binding_id = NULL, binding_snapshot_captured = 0 WHERE message_id = ?")
        .run(legacy.messageId);
      const claimed = store.messages.claimNext(1)!;
      expect(claimed).toMatchObject({ messageId: legacy.messageId, recipientBindingId: binding.bindingId, bindingSnapshotCaptured: true });

      store.qianji.updateNarrative(receiver.qianjiId, 0, narrative("调用时名字"));
      store.budgets.reserve({
        callId: "qianji-call-1", runId: "qianji-run", pixelId: "0_0_0", estimatedTokens: 100,
        messageId: legacy.messageId, bindingId: binding.bindingId, narrativeRevision: 1,
      });
      expect(store.messages.getMessage(legacy.messageId)).toMatchObject({
        recipientBindingId: binding.bindingId,
        narrativeRevision: 1,
        identitySnapshotCaptured: true,
      });
      store.modelCalls.recordModelCall({
        callId: "qianji-call-1", runId: "qianji-run", pixelId: "0_0_0", messageId: legacy.messageId,
        bindingId: binding.bindingId, narrativeRevision: 1,
        model: "fixture", promptTokens: 10, completionTokens: 5, cachedTokens: null, actualTokens: 15,
        costCny: null, outcome: "SUCCESS", createdAt: 10,
      });
      store.qianji.updateNarrative(receiver.qianjiId, 1, narrative("后来改名"));
      expect(store.modelCalls.getModelCall("qianji-call-1")).toMatchObject({
        bindingId: binding.bindingId,
        narrativeRevision: 1,
      });

      store.ledger.appendEntry({
        entry_id: "bound-write", timestamp: 11, pixel_id: "0_0_0", entry_type: "fixture",
        amount: -1, balance_after: 4999,
      });
      store.ledger.appendEntry({
        entry_id: "legacy-null", timestamp: 1, pixel_id: "0_0_0", entry_type: "fixture",
        amount: -2, balance_after: 5000, binding_id: null,
      });
      expect(store.db.prepare("SELECT binding_id FROM ledger_entries WHERE entry_id = 'bound-write'").get())
        .toEqual({ binding_id: binding.bindingId });
      expect(store.db.prepare("SELECT binding_id FROM ledger_entries WHERE entry_id = 'legacy-null'").get())
        .toEqual({ binding_id: null });
    } finally {
      store.close();
    }
  });

  it("separates identity-attributed history from old carrier records and preserves unknown cost", () => {
    const store = new CoreStore(":memory:");
    try {
      const profile = store.qianji.createProfile({ createdAt: 1000, narrative: narrative("履历成员") });
      const binding = store.qianji.createBinding({ qianjiId: profile.qianjiId, pixelId: "0_0_0", incarnation: 1, boundAt: 2000 });
      store.modelCalls.recordModelCall({
        callId: "legacy_call", runId: "legacy_run", pixelId: "0_0_0", model: "test", roundNum: 1,
        promptTokens: null, completionTokens: null, cachedTokens: null, actualTokens: null,
        costCny: null, outcome: "SUCCESS", createdAt: 1500,
      });
      store.modelCalls.recordModelCall({
        callId: "attributed_call", runId: "run_qj", pixelId: "0_0_0", bindingId: binding.bindingId,
        narrativeRevision: 0, model: "test", roundNum: 2, promptTokens: 10, completionTokens: 2,
        cachedTokens: null, actualTokens: 12, costCny: 0.01, outcome: "SUCCESS", createdAt: 2500,
      });
      store.ledger.appendEntry({
        entry_id: "legacy_ledger", timestamp: 1500, pixel_id: "0_0_0", binding_id: null,
        entry_type: "legacy", amount: -10, balance_after: 90,
      });
      store.ledger.appendEntry({
        entry_id: "attributed_ledger", timestamp: 2500, pixel_id: "0_0_0", binding_id: binding.bindingId,
        entry_type: "model_usage", amount: -12, balance_after: 88,
      });

      const history = store.qianji.getHistory(profile.qianjiId);
      expect(history.modelCalls.map(call => call.callId)).toEqual(["attributed_call"]);
      expect(history.modelCalls[0].costCny).toBe(0.01);
      expect(history.costSummary).toEqual({ totalCostCny: 0.01, knownCostCny: 0.01, unknownModelCount: 0, unknownToolCount: 0 });
      expect(history.carrierLegacy.modelCalls.map(call => call.callId)).toEqual(["legacy_call"]);
      expect(history.carrierLegacy.modelCalls[0].costCny).toBeNull();
      expect(history.carrierLegacy.costSummary.totalCostCny).toBeNull();
      expect(history.ledgerEntries.map(entry => entry.entryId)).toEqual(["attributed_ledger"]);
      expect(history.carrierLegacy.ledgerEntries.map(entry => entry.entryId)).toEqual(["legacy_ledger"]);
    } finally {
      store.close();
    }
  });
});
