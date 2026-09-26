import { SqliteDatabase } from "../sqlite/db.js";

export interface LedgerEntry {
  entry_id: string;
  timestamp: number;
  pixel_id: string;
  binding_id?: string | null;
  entry_type: string;
  amount: number;
  balance_after: number;
  details?: string | null;
}

export class LedgerRepository {
  constructor(private db: SqliteDatabase) {}

  public appendEntry(entry: LedgerEntry): void {
    const bindingId = entry.binding_id !== undefined
      ? entry.binding_id
      : ((this.db.prepare("SELECT binding_id FROM qianji_bindings WHERE pixel_id = ? AND unbound_at IS NULL")
          .get(entry.pixel_id) as any)?.binding_id ?? null);
    const stmt = this.db.prepare(`
      INSERT INTO ledger_entries (
        entry_id, timestamp, pixel_id, binding_id, entry_type, amount, balance_after, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.entry_id,
      entry.timestamp,
      entry.pixel_id,
      bindingId,
      entry.entry_type,
      entry.amount,
      entry.balance_after,
      entry.details ?? null
    );
  }

  public listEntriesByPixel(pixelId: string): LedgerEntry[] {
    const stmt = this.db.prepare("SELECT * FROM ledger_entries WHERE pixel_id = ? ORDER BY timestamp ASC");
    return (stmt.all(pixelId) as unknown as LedgerEntry[]) ?? [];
  }
}
