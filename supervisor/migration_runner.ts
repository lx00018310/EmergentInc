import { DatabaseSync, backup } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Trusted online snapshots, including committed WAL. Never restore Lineage over live history. */
export async function snapshotDatabase(source: string, target: string) {
  if (!existsSync(source) || existsSync(target)) throw new Error("SNAPSHOT_NEW_TARGET_REQUIRED");
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, "", { flag: "wx", mode: 0o600 });
  const db = new DatabaseSync(source, { readOnly: true });
  try { await backup(db, target); } finally { db.close(); }
  const copied = new DatabaseSync(target, { readOnly: true });
  try {
    const check = copied.prepare("PRAGMA integrity_check").all();
    if (check.length !== 1 || check[0]!.integrity_check !== "ok") throw new Error("SNAPSHOT_INTEGRITY_FAILED");
  } finally { copied.close(); }
  const sha256 = createHash("sha256").update(readFileSync(target)).digest("hex");
  writeFileSync(`${target}.manifest.json`, JSON.stringify({ source, sha256, created_at: Date.now() }), { flag: "wx", mode: 0o600 });
  return sha256;
}
