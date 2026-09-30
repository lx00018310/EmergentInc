import { SqliteDatabase } from "../sqlite/db.js";
export function migrateCurrent(db: SqliteDatabase) {
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version === 1) return;
  if (version !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length)
    throw new Error("UNSUPPORTED_CURRENT_SCHEMA_VERSION");
  db.transaction(() => db.exec(`
    CREATE TABLE current_meta (id INTEGER PRIMARY KEY CHECK(id=1), generation_id TEXT NOT NULL, body_revision INTEGER NOT NULL,
      gene_hash TEXT NOT NULL, release_id TEXT NOT NULL, body_interface_version TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE pixel_working_state (pixel_id TEXT PRIMARY KEY, state_json TEXT NOT NULL, carry_forward INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE objectives (id TEXT PRIMARY KEY, pixel_id TEXT NOT NULL, content TEXT NOT NULL, state TEXT NOT NULL,
      carry_forward INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE body_skills (skill_id TEXT PRIMARY KEY, name TEXT NOT NULL, active_change_id TEXT, interface_version TEXT NOT NULL,
      state TEXT NOT NULL, successful_runs INTEGER NOT NULL DEFAULT 0, failed_runs INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE TABLE body_needs (id TEXT PRIMARY KEY, pixel_id TEXT NOT NULL, need TEXT NOT NULL, evidence TEXT NOT NULL,
      state TEXT NOT NULL, carry_forward INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE body_candidates (id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, need_id TEXT REFERENCES body_needs(id),
      candidate_json TEXT NOT NULL, request_hash TEXT NOT NULL, candidate_hash TEXT, validation TEXT, state TEXT NOT NULL,
      previous_id TEXT REFERENCES body_candidates(id), activated_at INTEGER, created_at INTEGER NOT NULL, body_revision INTEGER);
    CREATE TABLE current_events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, pixel_id TEXT, kind TEXT NOT NULL,
      payload TEXT NOT NULL, created_at INTEGER NOT NULL);
    PRAGMA user_version=1;
  `));
}
