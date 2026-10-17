import type { WorldRegistryStore } from '@emergentinc/persistence';

/** Operational holds are independent of the Owner's persistent ON/OFF intent. */
export class CompanyAdmissionService {
  constructor(private store: WorldRegistryStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_admission_blocks(id TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);`);
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_admission_context(id TEXT PRIMARY KEY REFERENCES company_admission_blocks(id) ON DELETE CASCADE,payload_json TEXT NOT NULL);`);
  }
  reason(): string | null { return this.store.db.prepare('SELECT reason FROM company_admission_blocks ORDER BY created_at,id LIMIT 1').get()?.reason as string??null; }
  block(id: string, reason: string,context?:Record<string,unknown>) {
    const now=Date.now();
    this.store.transaction(()=>{this.store.db.prepare('INSERT INTO company_admission_blocks VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason,updated_at=excluded.updated_at').run(id,reason,now,now);this.store.db.prepare('INSERT INTO company_admission_context VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json').run(id,JSON.stringify(context??{}));});
  }
  controllerStarted() { this.store.db.prepare("DELETE FROM company_admission_blocks WHERE id='scheduler'").run(); }
}
