import { SqliteDatabase } from "@emergentinc/persistence";
/** V34 fresh schema only. Old databases require the separate destructive reset. */
export function initializePaymentSchema(db: SqliteDatabase) {
  const version = Number(db.prepare('PRAGMA user_version').get()!.user_version);
  if (version === 34) return;
  if (version !== 0 || db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().length) throw new Error('V34_DESTRUCTIVE_RESET_REQUIRED');
  db.transaction(() => db.exec(`CREATE TABLE payment_rails(rail_id TEXT PRIMARY KEY,chain TEXT NOT NULL CHECK(chain IN ('solana','bsc','polygon','tron')),network TEXT NOT NULL CHECK(network='mainnet'),
        asset TEXT NOT NULL CHECK(asset='USDT'),mint TEXT NOT NULL,decimals INTEGER NOT NULL CHECK(decimals IN (6,18)),recipient_address TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('ENABLED','DISABLED')),
        config_revision INTEGER NOT NULL,rpc_id TEXT NOT NULL,start_block INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE rail_events(id INTEGER PRIMARY KEY,rail_id TEXT NOT NULL,revision INTEGER NOT NULL,old_hash TEXT,new_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE payment_observations(chain TEXT NOT NULL,network TEXT NOT NULL,signature TEXT NOT NULL,invoice_id TEXT NOT NULL REFERENCES payment_invoices(invoice_id),slot INTEGER,
          commitment TEXT NOT NULL,status TEXT NOT NULL,raw_hash TEXT NOT NULL,reason TEXT,first_seen_at INTEGER NOT NULL,finalized_at INTEGER,PRIMARY KEY(chain,network,signature,invoice_id));
CREATE TABLE payment_outbox(receipt_id TEXT PRIMARY KEY REFERENCES payment_receipts(id),delivered INTEGER NOT NULL DEFAULT 0);
CREATE TABLE payment_scan_cursors(invoice_id TEXT PRIMARY KEY REFERENCES payment_invoices(invoice_id),last_seen_signature TEXT,backfill_before TEXT,target_head TEXT,updated_at INTEGER NOT NULL);
CREATE TABLE payment_chain_cursors(scope_key TEXT PRIMARY KEY,next_block INTEGER,last_timestamp INTEGER,fingerprint TEXT,updated_at INTEGER NOT NULL);
CREATE TABLE payment_unmatched(chain TEXT NOT NULL,network TEXT NOT NULL,signature TEXT NOT NULL,transfer_index INTEGER NOT NULL,rail_id TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,raw_hash TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(chain,network,signature,transfer_index));
CREATE TABLE "payment_invoices"(invoice_id TEXT PRIMARY KEY,world_id TEXT,qianji_id TEXT,order_id TEXT,
          rail_id TEXT NOT NULL REFERENCES payment_rails(rail_id),rail_revision INTEGER NOT NULL,chain TEXT NOT NULL,network TEXT NOT NULL,mint TEXT NOT NULL,recipient_address TEXT NOT NULL,
          asset TEXT NOT NULL CHECK(asset='USDT'),quoted_amount TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,reference TEXT NOT NULL UNIQUE,memo TEXT,
          qr_payload TEXT NOT NULL,wallet_url TEXT,status TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL,paid_at INTEGER,cancelled_at INTEGER,
          start_block INTEGER NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL);
CREATE TABLE "payment_receipts"(id TEXT PRIMARY KEY,chain TEXT NOT NULL,network TEXT NOT NULL,signature TEXT NOT NULL,transfer_index INTEGER NOT NULL,
          invoice_id TEXT NOT NULL UNIQUE REFERENCES payment_invoices(invoice_id),world_id TEXT,qianji_id TEXT,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,
          source TEXT NOT NULL CHECK(source='chain_finalized'),generation_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(chain,network,signature,transfer_index));
CREATE TABLE "world_revenue_events"(receipt_id TEXT PRIMARY KEY REFERENCES payment_receipts(id),world_id TEXT,chain TEXT NOT NULL,network TEXT NOT NULL,asset TEXT NOT NULL,amount_atomic TEXT NOT NULL,decimals INTEGER NOT NULL,created_at INTEGER NOT NULL);
CREATE UNIQUE INDEX permanent_invoice_amount ON payment_invoices(chain,network,mint,recipient_address,amount_atomic) WHERE chain!='solana';
PRAGMA user_version=34;`));
}
