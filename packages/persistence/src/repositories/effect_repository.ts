import { SqliteDatabase } from "../sqlite/db.js";
import { EffectStatus, EffectType } from "@emergentinc/protocol";

export interface EffectRecord {
  effect_id: string;
  message_id: string;
  effect_type: EffectType;
  effect_index: number;
  payload_hash: string;
  status: EffectStatus;
  details?: string | null;
  created_at: number;
}

export class EffectRepository {
  constructor(private db: SqliteDatabase) {}

  public recordEffect(record: EffectRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO effects (
        effect_id, message_id, effect_type, effect_index, payload_hash, status, details, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(effect_id) DO UPDATE SET
        status = excluded.status,
        details = excluded.details
    `);

    stmt.run(
      record.effect_id,
      record.message_id,
      record.effect_type,
      record.effect_index,
      record.payload_hash,
      record.status,
      record.details ?? null,
      record.created_at
    );
  }

  public getEffect(effectId: string): EffectRecord | null {
    const stmt = this.db.prepare("SELECT * FROM effects WHERE effect_id = ?");
    return (stmt.get(effectId) as unknown as EffectRecord) ?? null;
  }

  public hasEffectBeenApplied(effectId: string): boolean {
    const stmt = this.db.prepare("SELECT 1 FROM effects WHERE effect_id = ? AND status = 'APPLIED'");
    return stmt.get(effectId) !== undefined;
  }

  public listEffectsByMessage(messageId: string): EffectRecord[] {
    const stmt = this.db.prepare("SELECT * FROM effects WHERE message_id = ? ORDER BY effect_index ASC");
    return (stmt.all(messageId) as unknown as EffectRecord[]) ?? [];
  }
}
