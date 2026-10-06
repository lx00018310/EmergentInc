import { SqliteDatabase } from '../sqlite/db.js';
export function migrateWorldLife(db:SqliteDatabase){
  if(Number(db.prepare('PRAGMA user_version').get()!.user_version)===3)return;
  db.transaction(()=>db.exec(`ALTER TABLE memories ADD COLUMN world_id TEXT;
    ALTER TABLE life_events ADD COLUMN world_id TEXT;
    CREATE INDEX world_memories ON memories(world_id,created_at);
    CREATE TABLE gene_promotion_candidates (id TEXT PRIMARY KEY,world_id TEXT NOT NULL,pixel_id TEXT,kind TEXT NOT NULL,
      source_path TEXT NOT NULL,source_hash TEXT NOT NULL,snapshot_path TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
      metadata TEXT NOT NULL,state TEXT NOT NULL,proposal_id TEXT REFERENCES gene_proposals(id),created_at INTEGER NOT NULL);
    CREATE TABLE gene_assets (id TEXT PRIMARY KEY,kind TEXT NOT NULL,current_version INTEGER NOT NULL,state TEXT NOT NULL);
    CREATE TABLE gene_asset_sources (asset_id TEXT NOT NULL REFERENCES gene_assets(id),version INTEGER NOT NULL,world_id TEXT NOT NULL,
      pixel_id TEXT,candidate_id TEXT NOT NULL REFERENCES gene_promotion_candidates(id),source_hash TEXT NOT NULL,snapshot_hash TEXT NOT NULL,
      PRIMARY KEY(asset_id,version));
    CREATE TABLE gene_asset_versions (asset_id TEXT NOT NULL REFERENCES gene_assets(id),version INTEGER NOT NULL,
      generation_id TEXT NOT NULL REFERENCES generations(id),content_hash TEXT NOT NULL,relative_path TEXT NOT NULL,license TEXT NOT NULL,
      PRIMARY KEY(asset_id,version));
    PRAGMA user_version=3;`));
}
