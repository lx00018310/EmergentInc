import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { coordToId, idToCoord } from "@emergentinc/domain";
import { CoreStore } from "@emergentinc/persistence";
import { ExistingPixelIdentityInput, QianjiService } from "../apps/server/src/services/qianji_service.js";

const UNRESOLVED_MESSAGE_STATUSES = [
  "PROCESSING", "RESERVED", "CALLING", "RESPONSE_STORED", "CALL_OUTCOME_UNKNOWN", "AWAITING_SETTLEMENT",
];

export interface QianjiMigrationPlan {
  workspaceRoot: string;
  databasePath: string;
  accountCount: number;
  pixelDirectoryCount: number;
  currentBindingCount: number;
  accounts: Array<{
    pixelId: string;
    active: boolean;
    energy: number;
    incarnation: number | null;
    currentBindingId: string | null;
    qianjiId: string | null;
  }>;
  currentBindings: Array<{ bindingId: string; qianjiId: string; pixelId: string; incarnation: number }>;
  identitiesToCreate: ExistingPixelIdentityInput[];
  reusedBindings: Array<{ pixelId: string; incarnation: number }>;
  conflicts: string[];
  unsettled: string[];
  canApply: boolean;
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function readIncarnation(pixelDir: string, pixelId: string, conflicts: string[]): number | null {
  const statePath = path.join(pixelDir, "state.json");
  if (!fs.existsSync(statePath)) return 1;
  let state: unknown;
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    conflicts.push(`${pixelId}: state.json is not valid JSON`);
    return null;
  }
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    conflicts.push(`${pixelId}: state.json must contain an object`);
    return null;
  }
  const record = state as Record<string, unknown>;
  if (!("incarnation" in record)) return 1;
  if (Number.isSafeInteger(record.incarnation) && Number(record.incarnation) > 0) {
    return Number(record.incarnation);
  }
  conflicts.push(`${pixelId}: state.incarnation must be a positive safe integer`);
  return null;
}

function hasTable(db: DatabaseSync, table: string): boolean {
  return tableExists(db, table);
}

function addUnsettledRows(db: DatabaseSync, table: string, sql: string, label: string, output: string[]): void {
  if (!hasTable(db, table)) return;
  for (const row of db.prepare(sql).all() as Array<Record<string, unknown>>) {
    output.push(`${label}: ${String(row.id ?? row.run_id ?? row.call_id ?? row.operation_id ?? row.message_id)}`);
  }
}

function collectUnsettled(db: DatabaseSync): string[] {
  const unsettled: string[] = [];
  addUnsettledRows(db, "runs", "SELECT run_id FROM runs WHERE status = 'RUNNING'", "RUNNING Run", unsettled);
  addUnsettledRows(db, "reservations", "SELECT call_id FROM reservations WHERE status = 'OPEN'", "OPEN reservation", unsettled);
  addUnsettledRows(db, "model_calls", "SELECT call_id FROM model_calls WHERE outcome = 'CALL_OUTCOME_UNKNOWN'", "Unknown model call", unsettled);
  addUnsettledRows(db, "tool_executions", "SELECT operation_id FROM tool_executions WHERE status IN ('STARTED', 'UNKNOWN')", "Unresolved tool call", unsettled);
  if (hasTable(db, "messages")) {
    const placeholders = UNRESOLVED_MESSAGE_STATUSES.map(() => "?").join(", ");
    addUnsettledRows(
      db,
      "messages",
      `SELECT message_id FROM messages WHERE status IN (${placeholders})`,
      "Unresolved message",
      unsettled,
    );
  }
  return unsettled;
}

export function inspectQianjiMigration(workspaceRoot: string): QianjiMigrationPlan {
  const root = path.resolve(workspaceRoot);
  const databasePath = path.join(root, "ledger", "v9_core.sqlite3");
  if (!fs.existsSync(databasePath)) throw new Error(`Workspace database not found: ${databasePath}`);
  const db = new DatabaseSync(databasePath, { readOnly: true, enableForeignKeyConstraints: true, timeout: 5000 });
  try {
    const conflicts: string[] = [];
    const accounts = db.prepare("SELECT pixel_id, active, energy FROM pixel_accounts ORDER BY pixel_id").all() as Array<Record<string, unknown>>;
    const accountsById = new Map(accounts.map((row) => [String(row.pixel_id), row]));
    const pixelRoot = path.join(root, "live", "pixels");
    const directories = fs.existsSync(pixelRoot)
      ? fs.readdirSync(pixelRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
      : [];
    const directorySet = new Set(directories);
    for (const pixelId of accountsById.keys()) {
      if (!directorySet.has(pixelId)) conflicts.push(`${pixelId}: account has no live/pixels directory`);
    }
    for (const pixelId of directories) {
      if (!accountsById.has(pixelId)) conflicts.push(`${pixelId}: live/pixels directory has no account`);
      try {
        if (coordToId(idToCoord(pixelId)) !== pixelId) throw new Error("non-canonical pixel ID");
      } catch {
        conflicts.push(`${pixelId}: invalid Pixel coordinate directory name`);
      }
    }

    const hasBindings = tableExists(db, "qianji_bindings");
    const bindings = hasBindings
      ? db.prepare("SELECT binding_id, qianji_id, pixel_id, incarnation, unbound_at FROM qianji_bindings ORDER BY bound_at, binding_id").all() as Array<Record<string, unknown>>
      : [];
    const currentByPixel = new Map<string, Record<string, unknown>>();
    const historicalIncarnations = new Set<string>();
    for (const binding of bindings) {
      const pixelId = String(binding.pixel_id);
      const incarnation = Number(binding.incarnation);
      const key = `${pixelId}\0${incarnation}`;
      if (binding.unbound_at == null) currentByPixel.set(pixelId, binding);
      else historicalIncarnations.add(key);
    }

    const identitiesToCreate: ExistingPixelIdentityInput[] = [];
    const reused: Array<{ pixelId: string; incarnation: number }> = [];
    const incarnations = new Map<string, number>();
    for (const pixelId of [...accountsById.keys()].sort()) {
      if (!directorySet.has(pixelId)) continue;
      const incarnation = readIncarnation(path.join(pixelRoot, pixelId), pixelId, conflicts);
      if (incarnation === null) continue;
      incarnations.set(pixelId, incarnation);
      const current = currentByPixel.get(pixelId);
      if (current) {
        if (Number(current.incarnation) !== incarnation) {
          conflicts.push(`${pixelId}: current binding incarnation ${String(current.incarnation)} conflicts with state ${incarnation}`);
        } else {
          reused.push({ pixelId, incarnation });
        }
        continue;
      }
      if (historicalIncarnations.has(`${pixelId}\0${incarnation}`)) {
        conflicts.push(`${pixelId}: incarnation ${incarnation} already has a historical binding`);
        continue;
      }
      identitiesToCreate.push({ pixelId, incarnation });
    }
    const unsettled = collectUnsettled(db);
    const currentBindings = [...currentByPixel.values()].map((binding) => ({
      bindingId: String(binding.binding_id),
      qianjiId: String(binding.qianji_id),
      pixelId: String(binding.pixel_id),
      incarnation: Number(binding.incarnation),
    }));
    return {
      workspaceRoot: root,
      databasePath,
      accountCount: accounts.length,
      pixelDirectoryCount: directories.length,
      currentBindingCount: currentByPixel.size,
      accounts: accounts.map((account) => {
        const pixelId = String(account.pixel_id);
        const binding = currentByPixel.get(pixelId);
        return {
          pixelId,
          active: Boolean(account.active),
          energy: Number(account.energy),
          incarnation: incarnations.get(pixelId) ?? null,
          currentBindingId: binding ? String(binding.binding_id) : null,
          qianjiId: binding ? String(binding.qianji_id) : null,
        };
      }),
      currentBindings,
      identitiesToCreate,
      reusedBindings: reused,
      conflicts,
      unsettled,
      canApply: conflicts.length === 0 && unsettled.length === 0,
    };
  } finally {
    db.close();
  }
}

export function applyQianjiMigration(workspaceRoot: string): {
  createdProfiles: number;
  createdBindings: number;
  reusedBindings: number;
  plan: QianjiMigrationPlan;
} {
  const plan = inspectQianjiMigration(workspaceRoot);
  if (!plan.canApply) throw new Error(`Migration blocked: ${JSON.stringify({ conflicts: plan.conflicts, unsettled: plan.unsettled })}`);
  const store = new CoreStore(plan.databasePath);
  try {
    const refreshed = inspectQianjiMigration(workspaceRoot);
    if (!refreshed.canApply) {
      throw new Error(`Migration state changed after preflight: ${JSON.stringify({ conflicts: refreshed.conflicts, unsettled: refreshed.unsettled })}`);
    }
    const result = new QianjiService(store).migrateExistingPixels(refreshed.identitiesToCreate);
    return {
      createdProfiles: result.createdProfiles.length,
      createdBindings: result.createdBindings.length,
      reusedBindings: result.reusedBindings.length + refreshed.reusedBindings.length,
      plan: refreshed,
    };
  } finally {
    store.close();
  }
}

function parseArgs(args: string[]): { workspace: string; apply: boolean; confirmLive: boolean } {
  let workspace = "";
  let mode: "dry-run" | "apply" = "dry-run";
  let confirmLive = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace") workspace = args[++i] ?? "";
    else if (args[i] === "--dry-run") mode = "dry-run";
    else if (args[i] === "--apply") mode = "apply";
    else if (args[i] === "--confirm-live-workspace") confirmLive = true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!workspace) throw new Error("--workspace <absolute path> is required");
  if (!path.isAbsolute(workspace)) throw new Error("--workspace must be an absolute path");
  return { workspace, apply: mode === "apply", confirmLive };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectWorkspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "workspace");
  const isLiveWorkspace = path.resolve(args.workspace).toLowerCase() === projectWorkspace.toLowerCase();
  if (args.apply && isLiveWorkspace && !args.confirmLive) {
    throw new Error("Applying to the project workspace requires --confirm-live-workspace after arranging downtime and approval");
  }
  const report = args.apply ? applyQianjiMigration(args.workspace) : inspectQianjiMigration(args.workspace);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.plan.canApply) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
