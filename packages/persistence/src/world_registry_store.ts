import { CoreStore } from './core_store.js';
import { lifeId } from '@emergentinc/protocol';

export interface WorldRecord { world_id: string; qianji_id: string; status: string; workspace_relpath: string; gateway_pixel_id: string | null; created_at: number; archived_at: number | null }
/** Control identity uses the existing Qianji repository; runtime tables remain empty in this compatibility schema. */
export class WorldRegistryStore extends CoreStore {
  constructor(file = ':memory:') {
    super(file);
    this.db.exec(`CREATE TABLE IF NOT EXISTS world_recovery_blocks(world_id TEXT PRIMARY KEY,generation_id TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS qianji_worlds (
      world_id TEXT PRIMARY KEY, qianji_id TEXT NOT NULL UNIQUE REFERENCES qianji_profiles(qianji_id),
      status TEXT NOT NULL CHECK(status IN ('CREATING','ACTIVE','ARCHIVED')), workspace_relpath TEXT NOT NULL UNIQUE,
      gateway_pixel_id TEXT, created_at INTEGER NOT NULL, archived_at INTEGER);
      CREATE TABLE IF NOT EXISTS world_gateway_state (world_id TEXT PRIMARY KEY REFERENCES qianji_worlds(world_id), revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS world_chat_turns (turn_id TEXT PRIMARY KEY, qianji_id TEXT NOT NULL REFERENCES qianji_profiles(qianji_id),
      world_id TEXT NOT NULL REFERENCES qianji_worlds(world_id), message_id TEXT NOT NULL, entry_pixel_id TEXT NOT NULL,
      request_key TEXT NOT NULL UNIQUE, question TEXT NOT NULL, reply TEXT, reply_call_id TEXT, run_id TEXT,
      created_at INTEGER NOT NULL, replied_at INTEGER);
      CREATE TABLE IF NOT EXISTS world_conclusions(turn_id TEXT PRIMARY KEY REFERENCES world_chat_turns(turn_id),qianji_id TEXT NOT NULL,summary TEXT NOT NULL,created_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS control_events (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, world_id TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL);`);
  }
  worlds(): WorldRecord[] { return this.db.prepare('SELECT * FROM qianji_worlds ORDER BY created_at,world_id').all() as unknown as WorldRecord[]; }
  world(id: string): WorldRecord { lifeId(id); const row = this.db.prepare('SELECT * FROM qianji_worlds WHERE world_id=?').get(id); if (!row) throw new Error('WORLD_NOT_FOUND'); return row as unknown as WorldRecord; }
  worldForQianji(id: string): WorldRecord { const row = this.db.prepare('SELECT world_id FROM qianji_worlds WHERE qianji_id=?').get(id); if (!row) throw new Error('QIANJI_WORLD_NOT_FOUND'); return this.world(String(row.world_id)); }
  insertWorld(input: WorldRecord) {
    lifeId(input.world_id); lifeId(input.qianji_id);
    if (input.workspace_relpath !== `worlds/${input.world_id}`) throw new Error('INVALID_WORLD_WORKSPACE');
    this.db.prepare('INSERT INTO qianji_worlds VALUES(?,?,?,?,?,?,?)').run(input.world_id,input.qianji_id,input.status,input.workspace_relpath,input.gateway_pixel_id,input.created_at,input.archived_at);
    this.db.prepare('INSERT INTO world_gateway_state VALUES(?,0,?)').run(input.world_id,Date.now());
  }
  setGateway(id: string, pixel: string, expectedRevision: number) {
    this.world(id);
    const changed = this.db.prepare('UPDATE world_gateway_state SET revision=revision+1,updated_at=? WHERE world_id=? AND revision=?').run(Date.now(),id,expectedRevision);
    if (!changed.changes) throw new Error('GATEWAY_REVISION_CONFLICT');
    this.db.prepare('UPDATE qianji_worlds SET gateway_pixel_id=? WHERE world_id=?').run(pixel,id);
  }
  event(kind: string, worldId: string, payload: unknown) { this.db.prepare('INSERT INTO control_events(kind,world_id,payload,created_at) VALUES(?,?,?,?)').run(kind,worldId,JSON.stringify(payload),Date.now()); }
}
