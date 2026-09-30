import { SqliteDatabase } from "../sqlite/db.js";
import { migrateBusiness } from "./business_schema.js";

export const LINEAGE_SCHEMA_VERSION = 2;
export function migrateLineage(db: SqliteDatabase) {
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (![0, 1, 2].includes(version)) throw new Error("UNSUPPORTED_LINEAGE_SCHEMA_VERSION");
  if (version === 0) migrateBusiness(db);
  if (version === 2) return;
  db.transaction(() => db.exec(`
    CREATE TABLE generations (
      id TEXT PRIMARY KEY, generation_no INTEGER NOT NULL UNIQUE, parent_id TEXT REFERENCES generations(id),
      gene_hash TEXT NOT NULL, release_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('BIRTHING','ACTIVE','RETIRED','FAILED','ROLLED_BACK')),
      born_at INTEGER, retired_at INTEGER, failure_reason TEXT
    );
    CREATE UNIQUE INDEX one_active_generation ON generations(state) WHERE state='ACTIVE';
    CREATE TABLE memories (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id), pixel_id TEXT,
      kind TEXT NOT NULL, point TEXT NOT NULL, reason TEXT NOT NULL, effect TEXT NOT NULL,
      importance INTEGER NOT NULL CHECK(importance BETWEEN 1 AND 5), source TEXT NOT NULL,
      source_ref TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
    );
    CREATE TABLE dream_runs (
      id TEXT PRIMARY KEY, generation_id TEXT NOT NULL REFERENCES generations(id),
      from_cursor TEXT NOT NULL, to_cursor TEXT NOT NULL, status TEXT NOT NULL,
      input_hash TEXT NOT NULL, output_hash TEXT, created_at INTEGER NOT NULL, finished_at INTEGER,
      trigger TEXT NOT NULL, error TEXT, input_json TEXT NOT NULL
    );
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
    );
    PRAGMA user_version=2;
  `));
}
