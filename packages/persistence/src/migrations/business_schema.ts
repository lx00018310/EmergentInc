import { SqliteDatabase } from "../sqlite/db.js";

export const BUSINESS_SCHEMA_VERSION = 1;

export function migrateBusiness(db: SqliteDatabase): void {
  db.transaction(() => {
    const version = Number((db.prepare("PRAGMA user_version").get() as any).user_version);
    if (![0, BUSINESS_SCHEMA_VERSION].includes(version)) throw new Error("UNSUPPORTED_BUSINESS_SCHEMA_VERSION");
    if (version === BUSINESS_SCHEMA_VERSION) return;
    if ((db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()).length) {
      throw new Error("UNVERSIONED_DATABASE_REQUIRES_REVIEW");
    }
    db.exec(`
      CREATE TABLE business_settings (
        id INTEGER PRIMARY KEY CHECK(id=1), currency TEXT NOT NULL CHECK(currency='CNY'),
        limit_micros INTEGER NOT NULL CHECK(limit_micros>=0), draft_limit_micros INTEGER NOT NULL CHECK(draft_limit_micros>=0),
        draft_call_limit INTEGER NOT NULL CHECK(draft_call_limit>=0), draft_expires_at INTEGER NOT NULL
      );
      CREATE TABLE business_plans (id TEXT PRIMARY KEY, direction TEXT NOT NULL, revision INTEGER NOT NULL,
        state TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE business_plan_revisions (plan_id TEXT NOT NULL REFERENCES business_plans(id), revision INTEGER NOT NULL,
        hash TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(plan_id,revision));
      CREATE TABLE business_grants (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
        hash TEXT NOT NULL, snapshot TEXT NOT NULL, approved_by TEXT NOT NULL CHECK(approved_by='owner'),
        approved_at INTEGER NOT NULL, revoked_at INTEGER, UNIQUE(plan_id,revision),
        FOREIGN KEY(plan_id,revision) REFERENCES business_plan_revisions(plan_id,revision));
      CREATE TABLE business_datasets (id TEXT PRIMARY KEY, name TEXT NOT NULL, content TEXT NOT NULL,
        hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE business_connections (id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider='github'),
        repository TEXT NOT NULL, account_login TEXT NOT NULL, enabled INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE business_requests (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES business_plans(id),
        revision INTEGER NOT NULL, resource TEXT NOT NULL, state TEXT NOT NULL, resolution TEXT,
        UNIQUE(plan_id,revision,resource));
      CREATE TABLE business_tasks (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES business_plans(id),
        revision INTEGER NOT NULL, grant_id TEXT NOT NULL REFERENCES business_grants(id),
        capability TEXT NOT NULL, capability_version TEXT NOT NULL, input TEXT NOT NULL,
        state TEXT NOT NULL, next_run_at INTEGER NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
        lease_until INTEGER, generation INTEGER NOT NULL DEFAULT 0, output TEXT, error TEXT, parent_id TEXT REFERENCES business_tasks(id));
      CREATE INDEX business_due ON business_tasks(state,next_run_at);
      CREATE TABLE business_schedules (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES business_plans(id),
        revision INTEGER NOT NULL, grant_id TEXT NOT NULL REFERENCES business_grants(id), specification TEXT NOT NULL,
        next_run_at INTEGER NOT NULL, occurrences INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL,
        UNIQUE(plan_id,revision));
      CREATE TABLE business_operations (id TEXT PRIMARY KEY, scope TEXT NOT NULL, plan_id TEXT REFERENCES business_plans(id),
        purpose TEXT NOT NULL, request_hash TEXT NOT NULL, pricing TEXT NOT NULL, reserved_micros INTEGER NOT NULL CHECK(reserved_micros>=0),
        state TEXT NOT NULL, response TEXT, created_at INTEGER NOT NULL, request TEXT);
      CREATE TABLE business_cost_entries (operation_id TEXT PRIMARY KEY REFERENCES business_operations(id),
        amount_micros INTEGER NOT NULL CHECK(amount_micros>=0), evidence TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE business_events (id TEXT PRIMARY KEY, plan_id TEXT REFERENCES business_plans(id),
        kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE business_worker (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, lease_until INTEGER NOT NULL);
      CREATE TABLE business_orders (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
        description TEXT NOT NULL, customer_ref TEXT NOT NULL, amount_micros INTEGER NOT NULL CHECK(amount_micros>0),
        currency TEXT NOT NULL CHECK(currency='CNY'), sales_state TEXT NOT NULL, delivery_state TEXT NOT NULL,
        version INTEGER NOT NULL, attribution_evidence TEXT NOT NULL, created_at INTEGER NOT NULL,
        FOREIGN KEY(plan_id,revision) REFERENCES business_plan_revisions(plan_id,revision));
      CREATE TABLE business_payment_events (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES business_orders(id),
        provider TEXT NOT NULL, account TEXT NOT NULL, external_event_id TEXT NOT NULL, kind TEXT NOT NULL,
        amount_micros INTEGER NOT NULL CHECK(amount_micros>0), currency TEXT NOT NULL CHECK(currency='CNY'),
        original_event_id TEXT REFERENCES business_payment_events(id), payer_kind TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source='owner_confirmed'), evidence TEXT NOT NULL,
        request_hash TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(provider,account,external_event_id));
      PRAGMA user_version = 1;
    `);
  });
}
