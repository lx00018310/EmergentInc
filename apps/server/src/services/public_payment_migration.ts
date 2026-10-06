import type { SqliteDatabase } from '@emergentinc/persistence';

/** V24 allows a genuine instance scope (NULL World / Qianji), without creating a synthetic World. */
export function migrateInstancePayments(db: SqliteDatabase) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version === 3) return;
  if (version !== 2) throw new Error('V24_PAYMENT_MIGRATION_REQUIRES_V2');
  // Rebuild only the three tables whose attribution was mandatory. Preserve the complete receipt graph.
  db.exec('PRAGMA foreign_keys=OFF;');
  try {
    db.transaction(() => {
      for (const table of ['payment_invoices', 'payment_receipts', 'world_revenue_events']) {
        const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)!.sql);
        const next = table + '_v24';
        db.exec(sql.replace(new RegExp(`^CREATE TABLE\\s+"?${table}"?`, 'i'), `CREATE TABLE ${next}`)
          .replace(/world_id TEXT NOT NULL/g, 'world_id TEXT').replace(/qianji_id TEXT NOT NULL/g, 'qianji_id TEXT'));
        db.exec(`INSERT INTO ${next} SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${next} RENAME TO ${table};`);
      }
      db.exec("CREATE UNIQUE INDEX permanent_invoice_amount ON payment_invoices(chain,network,mint,recipient_address,amount_atomic) WHERE chain!='solana';");
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('V24_PAYMENT_FOREIGN_KEY_CONFLICT');
      db.exec('PRAGMA user_version=3;');
    });
  } finally { db.exec('PRAGMA foreign_keys=ON;'); }
}
