import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { applyQianjiMigration, inspectQianjiMigration } from "../../../scripts/migrate-qianji.js";

const roots: string[] = [];

function createLegacyWorkspace(options: { pixelId?: string; incarnation?: unknown; malformedState?: boolean } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qianji-migration-"));
  roots.push(root);
  const pixelId = options.pixelId ?? "0_0_0";
  const ledgerDir = path.join(root, "ledger");
  const pixelDir = path.join(root, "live", "pixels", pixelId);
  fs.mkdirSync(ledgerDir, { recursive: true });
  fs.mkdirSync(pixelDir, { recursive: true });
  const db = new DatabaseSync(path.join(ledgerDir, "v9_core.sqlite3"));
  db.exec(`
    CREATE TABLE pixel_accounts (
      pixel_id TEXT PRIMARY KEY, energy INTEGER NOT NULL, active INTEGER NOT NULL,
      refund_deficit_tokens INTEGER NOT NULL DEFAULT 0, spend_blocked_reason TEXT, updated_at REAL NOT NULL
    );
    INSERT INTO pixel_accounts (pixel_id, energy, active, updated_at) VALUES ('${pixelId}', 0, 0, 1);
  `);
  db.close();
  const ledgerDb = new DatabaseSync(path.join(ledgerDir, "v9_core.sqlite3"));
  ledgerDb.exec("CREATE TABLE ledger_entries (entry_id TEXT PRIMARY KEY, timestamp REAL NOT NULL, pixel_id TEXT NOT NULL, entry_type TEXT NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL, details TEXT)");
  ledgerDb.prepare("INSERT INTO ledger_entries VALUES (?, ?, ?, ?, ?, ?, ?)").run("legacy-ledger", 1, pixelId, "legacy", -4, 8, null);
  ledgerDb.close();
  if (options.malformedState) fs.writeFileSync(path.join(pixelDir, "state.json"), "not-json");
  else if (options.incarnation !== undefined) {
    fs.writeFileSync(path.join(pixelDir, "state.json"), JSON.stringify({ incarnation: options.incarnation }));
  }
  fs.writeFileSync(path.join(pixelDir, "pixel.md"), "historical mind");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Qianji workspace identity migration", () => {
  it("dry-run reads legacy schema without creating tables and apply preserves incarnation", () => {
    const root = createLegacyWorkspace({ incarnation: 3 });
    const mindPath = path.join(root, "live", "pixels", "0_0_0", "pixel.md");
    const mindHashBefore = createHash("sha256").update(fs.readFileSync(mindPath)).digest("hex");
    const plan = inspectQianjiMigration(root);
    expect(plan).toMatchObject({
      accountCount: 1,
      pixelDirectoryCount: 1,
      accounts: [{ pixelId: "0_0_0", active: false, energy: 0, incarnation: 3, currentBindingId: null, qianjiId: null }],
      identitiesToCreate: [{ pixelId: "0_0_0", incarnation: 3 }],
      conflicts: [],
      unsettled: [],
      canApply: true,
    });
    const readOnlyDb = new DatabaseSync(plan.databasePath, { readOnly: true });
    try {
      expect(readOnlyDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'qianji_profiles'").get()).toBeUndefined();
    } finally {
      readOnlyDb.close();
    }

    const applied = applyQianjiMigration(root);
    expect(applied).toMatchObject({ createdProfiles: 1, createdBindings: 1, reusedBindings: 0 });
    const repeated = applyQianjiMigration(root);
    expect(repeated).toMatchObject({ createdProfiles: 0, createdBindings: 0, reusedBindings: 1 });
    const migratedDb = new DatabaseSync(plan.databasePath, { readOnly: true });
    try {
      expect(migratedDb.prepare("SELECT career_status FROM qianji_profiles").get()).toEqual({ career_status: "active" });
      expect(migratedDb.prepare("SELECT pixel_id, incarnation FROM qianji_bindings").get())
        .toEqual({ pixel_id: "0_0_0", incarnation: 3 });
      expect(migratedDb.prepare("SELECT COUNT(*) AS count FROM world_events").get()).toEqual({ count: 2 });
      expect(migratedDb.prepare("SELECT entry_id, amount, balance_after FROM ledger_entries").get())
        .toEqual({ entry_id: "legacy-ledger", amount: -4, balance_after: 8 });
    } finally {
      migratedDb.close();
    }
    expect(createHash("sha256").update(fs.readFileSync(mindPath)).digest("hex")).toBe(mindHashBefore);
  });

  it("defaults only missing incarnation to one and rejects malformed values or state files", () => {
    const missing = createLegacyWorkspace();
    expect(inspectQianjiMigration(missing).identitiesToCreate).toEqual([{ pixelId: "0_0_0", incarnation: 1 }]);

    const invalid = createLegacyWorkspace({ incarnation: 0 });
    expect(inspectQianjiMigration(invalid).conflicts).toContain("0_0_0: state.incarnation must be a positive safe integer");

    const malformed = createLegacyWorkspace({ malformedState: true });
    expect(inspectQianjiMigration(malformed).conflicts).toContain("0_0_0: state.json is not valid JSON");
  });

  it("blocks orphaned directories, accounts without directories, and unresolved operations", () => {
    const root = createLegacyWorkspace();
    const pixelRoot = path.join(root, "live", "pixels");
    fs.mkdirSync(path.join(pixelRoot, "1_0_0"));
    const db = new DatabaseSync(path.join(root, "ledger", "v9_core.sqlite3"));
    db.exec(`
      CREATE TABLE runs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL);
      INSERT INTO runs VALUES ('run-live', 'RUNNING');
      INSERT INTO pixel_accounts (pixel_id, energy, active, updated_at) VALUES ('2_0_0', 0, 0, 1);
    `);
    db.close();

    const plan = inspectQianjiMigration(root);
    expect(plan.canApply).toBe(false);
    expect(plan.conflicts).toContain("1_0_0: live/pixels directory has no account");
    expect(plan.conflicts).toContain("2_0_0: account has no live/pixels directory");
    expect(plan.unsettled).toContain("RUNNING Run: run-live");
    expect(() => applyQianjiMigration(root)).toThrow("Migration blocked");
  });
});
