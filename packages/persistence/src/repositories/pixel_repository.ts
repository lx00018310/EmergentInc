import { SqliteDatabase } from "../sqlite/db.js";
import { PixelAccount } from "@emergentinc/protocol";

export class PixelRepository {
  constructor(private db: SqliteDatabase) {}

  public upsertPixelAccount(account: Omit<PixelAccount, "updatedAt">): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      INSERT INTO pixel_accounts (
        pixel_id, energy, active, refund_deficit_tokens, spend_blocked_reason, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(pixel_id) DO UPDATE SET
        energy = excluded.energy,
        active = excluded.active,
        refund_deficit_tokens = excluded.refund_deficit_tokens,
        spend_blocked_reason = excluded.spend_blocked_reason,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      account.pixelId,
      account.energy,
      account.active ? 1 : 0,
      account.refundDeficitTokens,
      account.spendBlockedReason,
      now
    );
  }

  public getPixelAccount(pixelId: string): PixelAccount | null {
    const stmt = this.db.prepare(`
      SELECT pixel_id as pixelId, energy, active, refund_deficit_tokens as refundDeficitTokens,
             spend_blocked_reason as spendBlockedReason, updated_at as updatedAt
      FROM pixel_accounts
      WHERE pixel_id = ?
    `);
    const row = stmt.get(pixelId) as any;
    if (!row) return null;
    return {
      pixelId: row.pixelId,
      energy: Number(row.energy),
      active: Boolean(row.active),
      refundDeficitTokens: Number(row.refundDeficitTokens),
      spendBlockedReason: row.spendBlockedReason,
      updatedAt: Number(row.updatedAt),
    };
  }

  public updateEnergy(pixelId: string, delta: number): number {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE pixel_accounts
      SET energy = energy + ?, updated_at = ?
      WHERE pixel_id = ?
      RETURNING energy, active
    `);
    const row = stmt.get(delta, now, pixelId) as any;
    if (!row) {
      throw new Error(`Pixel ${pixelId} not found`);
    }

    const currentEnergy = Number(row.energy);
    // 如果能量耗尽归零，自动设为失活
    if (currentEnergy <= 0 && row.active === 1) {
      this.setActive(pixelId, false);
    }
    return currentEnergy;
  }

  public setActive(pixelId: string, active: boolean): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE pixel_accounts
      SET active = ?, updated_at = ?
      WHERE pixel_id = ?
    `);
    stmt.run(active ? 1 : 0, now, pixelId);
  }

  public listActivePixels(): PixelAccount[] {
    const stmt = this.db.prepare(`
      SELECT pixel_id as pixelId, energy, active, refund_deficit_tokens as refundDeficitTokens,
             spend_blocked_reason as spendBlockedReason, updated_at as updatedAt
      FROM pixel_accounts
      WHERE active = 1
    `);
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      pixelId: row.pixelId,
      energy: Number(row.energy),
      active: Boolean(row.active),
      refundDeficitTokens: Number(row.refundDeficitTokens),
      spendBlockedReason: row.spendBlockedReason,
      updatedAt: Number(row.updatedAt),
    }));
  }
}
