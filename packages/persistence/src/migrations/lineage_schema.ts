import { SqliteDatabase } from "../sqlite/db.js";
/** V34 fresh schema only. Old databases require the separate destructive reset. */
export function migrateLineage(db: SqliteDatabase) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version === 34) return;
  if (version !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) throw new Error('V34_DESTRUCTIVE_RESET_REQUIRED');
  db.transaction(() => db.exec(`CREATE TABLE generations (
      id TEXT PRIMARY KEY, generation_no INTEGER NOT NULL UNIQUE, parent_id TEXT REFERENCES generations(id),
      gene_hash TEXT NOT NULL, release_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('BIRTHING','ACTIVE','RETIRED','FAILED','ROLLED_BACK')),
      born_at INTEGER, retired_at INTEGER, failure_reason TEXT
    );
CREATE TABLE memories (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id), pixel_id TEXT,
      kind TEXT NOT NULL, point TEXT NOT NULL, reason TEXT NOT NULL, effect TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 5), source TEXT NOT NULL,
      source_ref TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
    , world_id TEXT);
CREATE TABLE gene_proposals (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id),
      source TEXT NOT NULL CHECK(source IN ('dream','owner')), point TEXT NOT NULL, reason TEXT NOT NULL, effect TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('PROPOSED','APPROVED','REJECTED','IMPLEMENTING','CANDIDATE_READY','BORN','FAILED')),
      created_at INTEGER NOT NULL, owner_decided_at INTEGER, candidate_hash TEXT, target_generation_id TEXT,
      source_ref TEXT NOT NULL UNIQUE
    );
CREATE TABLE life_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, generation_id TEXT NOT NULL REFERENCES generations(id),
      pixel_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, source_ref TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
    , world_id TEXT);
CREATE UNIQUE INDEX one_active_generation ON generations(state) WHERE state='ACTIVE';
CREATE INDEX world_memories ON memories(world_id,created_at);
PRAGMA user_version=34;`));
}
export const LINEAGE_SCHEMA_VERSION = 34;
