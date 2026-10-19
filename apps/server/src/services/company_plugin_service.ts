import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorldRegistryStore } from '@emergentinc/persistence';
import { containedPath } from './safe_path.js';
import { ownerConflict, ownerInput } from './owner_goal_service.js';

export interface CompanyPluginManifest {
  schema: 1; pluginId: string; version: string; title: string; titleZh: string;
  cards: { viewKey: string; title: string; titleZh: string; resources: string[] }[];
}

export interface CompanyCardView {
  id: string; pluginId: string; viewKey: string; title: string; titleZh: string;
  visible: boolean; enabled: boolean; activeHash: string | null; previousHash: string | null;
  revision: number; incompatible: boolean; assetsUrl: string | null; detailUrl: string | null; updatedAt: number;
}

const PLUGIN_ID = /^[a-z][a-z0-9-]{0,63}$/, VIEW_KEY = /^[a-z][a-z0-9-]{0,63}$/, VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, HASH = /^[a-f0-9]{64}$/;
const ASSET_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
};
const MAX_ASSET_BYTES = 512_000, MAX_TOTAL_BYTES = 2_000_000, MAX_FILES = 16;
// The only first-version read projections; each is served by a typed host bridge query.
const RESOURCE_IDS = ['company.summary@1', 'goals.summary@1', 'tasks.summary@1'];
const PLUGIN_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function pluginManifest(value: unknown): asserts value is CompanyPluginManifest {
  ownerInput(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => ['schema', 'pluginId', 'version', 'title', 'titleZh', 'cards'].includes(k)), 'PLUGIN_MANIFEST_INVALID');
  const m = value as CompanyPluginManifest;
  ownerInput(m.schema === 1 && typeof m.pluginId === 'string' && PLUGIN_ID.test(m.pluginId) && !/^(con|prn|aux|nul|com\d|lpt\d)$/.test(m.pluginId) &&
    typeof m.version === 'string' && VERSION.test(m.version) && typeof m.title === 'string' && m.title.trim().length > 0 && m.title.length <= 80 &&
    typeof m.titleZh === 'string' && m.titleZh.trim().length > 0 && m.titleZh.length <= 80 && Array.isArray(m.cards) && m.cards.length >= 1 && m.cards.length <= 10, 'PLUGIN_MANIFEST_INVALID');
  const keys = new Set<string>();
  for (const c of m.cards) {
    ownerInput(c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).every(k => ['viewKey', 'title', 'titleZh', 'resources'].includes(k)), 'PLUGIN_MANIFEST_INVALID');
    ownerInput(typeof c.viewKey === 'string' && VIEW_KEY.test(c.viewKey) && !keys.has(c.viewKey) && typeof c.title === 'string' && c.title.trim().length > 0 && c.title.length <= 80 &&
      typeof c.titleZh === 'string' && c.titleZh.trim().length > 0 && c.titleZh.length <= 80 && Array.isArray(c.resources) && c.resources.length <= 8 &&
      c.resources.every((r: unknown) => typeof r === 'string' && RESOURCE_IDS.includes(r)), 'PLUGIN_MANIFEST_INVALID');
    keys.add(c.viewKey);
  }
};

/** Thin company-level plugin host: immutable hashed versions, numbered cards, no execution of its own. */
export class CompanyPluginService {
  constructor(readonly store: WorldRegistryStore, readonly workspace: string) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_plugins(plugin_id TEXT PRIMARY KEY,active_hash TEXT,previous_hash TEXT,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      grants_json TEXT NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0,goal_id TEXT,attempt_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS company_cards(id INTEGER PRIMARY KEY AUTOINCREMENT,plugin_id TEXT NOT NULL REFERENCES company_plugins(plugin_id),view_key TEXT NOT NULL,
      title TEXT NOT NULL,title_zh TEXT NOT NULL,visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),created_at INTEGER NOT NULL,removed_at INTEGER,UNIQUE(plugin_id,view_key));
      CREATE TABLE IF NOT EXISTS company_plugin_files(plugin_id TEXT NOT NULL,version_hash TEXT NOT NULL,name TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(plugin_id,version_hash,name));`);
  }
  private pluginsRoot() { return containedPath(this.workspace, 'assets', 'plugins'); }
  private pluginRoot(pluginId: string) { return containedPath(this.pluginsRoot(), pluginId); }
  private versionRoot(pluginId: string, hash: string) { if (!HASH.test(hash)) ownerConflict('PLUGIN_HASH_INVALID'); return containedPath(this.pluginRoot(pluginId), 'versions', hash); }
  private grants(pluginId: string): string[] { const r = this.store.db.prepare('SELECT grants_json FROM company_plugins WHERE plugin_id=?').get(pluginId); return r ? JSON.parse(String(r.grants_json)) : []; }
  private incompatible(pluginId: string, hash: string | null) { if (!hash) return false; try { this.loadVersion(pluginId, hash); return false; } catch { return true; } }

  private loadVersion(pluginId: string, hash: string): { manifest: CompanyPluginManifest; files: Record<string, { sha256: string; bytes: number }> } {
    const root = this.versionRoot(pluginId, hash), file = path.join(root, 'manifest.json');
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) ownerConflict('PLUGIN_VERSION_MISSING');
    const bytes = fs.readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== hash) ownerConflict('PLUGIN_HASH_MISMATCH');
    const manifest = JSON.parse(bytes.toString('utf8')); pluginManifest(manifest);
    if (manifest.pluginId !== pluginId) ownerConflict('PLUGIN_MANIFEST_INVALID');
    // The authoritative file list is the recorded install manifest, not a live directory walk:
    // a tampered, added or deleted file cannot invent its own identity.
    const recorded = this.store.db.prepare('SELECT name,sha256,bytes FROM company_plugin_files WHERE plugin_id=? AND version_hash=? ORDER BY name').all(pluginId, hash) as any[];
    if (!recorded.length) ownerConflict('PLUGIN_VERSION_MISSING');
    const files: Record<string, { sha256: string; bytes: number }> = {};
    let total = 0;
    for (const row of recorded) {
      const target = containedPath(root, ...String(row.name).split('/'));
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) ownerConflict('PLUGIN_FILE_INVALID');
      const stat = fs.statSync(target); total += Number(row.bytes);
      if (stat.size !== Number(row.bytes) || Number(row.bytes) > MAX_ASSET_BYTES || total > MAX_TOTAL_BYTES) ownerConflict('PLUGIN_FILE_INVALID');
      const content = fs.readFileSync(target);
      if (createHash('sha256').update(content).digest('hex') !== row.sha256) ownerConflict('PLUGIN_FILE_CHANGED');
      files[String(row.name)] = { sha256: String(row.sha256), bytes: Number(row.bytes) };
    }
    for (const card of manifest.cards) {
      ownerInput(files[`cards/${card.viewKey}/card.html`] && files[`cards/${card.viewKey}/detail.html`], 'PLUGIN_PAGE_MISSING');
    }
    return { manifest, files };
  }

  private cardId(id: number) { return String(id).padStart(3, '0'); }

  /** Registers or replaces a candidate version after full verification; the active pointer moves only in the same transaction. */
  install(input: { pluginId: string; manifest: CompanyPluginManifest; files: Record<string, Buffer>; goalId?: string; attemptId?: string; activate: boolean; expectedRevision?: number; idempotencyKey: string }) {
    const manifest = JSON.parse(JSON.stringify(input.manifest)); pluginManifest(manifest);
    // Declared resources are requests, not grants (P1): every actual read is re-checked against stored grants.
    const pluginId = manifest.pluginId;
    const names = new Set<string>();
    for (const [name, content] of Object.entries(input.files)) {
      ownerInput(!name.includes('..') && !/[\\:]/.test(name) && !name.startsWith('/') && name.length <= 120 && Buffer.isBuffer(content) && content.length > 0 && content.length <= MAX_ASSET_BYTES, 'PLUGIN_FILE_INVALID');
      ownerInput(!names.has(name), 'PLUGIN_FILE_INVALID'); names.add(name);
      ownerInput(!name.endsWith('manifest.json'), 'PLUGIN_FILE_INVALID');
    }
    for (const c of manifest.cards) ownerInput(names.has(`cards/${c.viewKey}/card.html`) && names.has(`cards/${c.viewKey}/detail.html`), 'PLUGIN_PAGE_MISSING');
    // The version identity is the exact manifest.json content; assets are verified against the recorded file list.
    const hash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const root = this.versionRoot(pluginId, hash), temporary = containedPath(this.pluginRoot(pluginId), 'versions', `new-${hash.slice(0, 16)}-${randomBytes(4).toString('hex')}`);
    const recorded = this.store.db.prepare('SELECT COUNT(*) n FROM company_plugin_files WHERE plugin_id=? AND version_hash=?').get(pluginId, hash) as any;
    if (!recorded.n) {
      fs.mkdirSync(temporary, { recursive: true });
      try {
        fs.writeFileSync(path.join(temporary, 'manifest.json'), manifestBytes, { flag: 'wx' });
        for (const [name, content] of Object.entries(input.files)) {
          const target = containedPath(temporary, ...name.split('/'));
          fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content, { flag: 'wx' });
        }
        fs.renameSync(temporary, root);
      } catch (e) { fs.rmSync(temporary, { recursive: true, force: true }); throw e; }
    }
    const db = this.store.db;
    return this.store.transaction(() => {
      const old = db.prepare('SELECT * FROM company_plugins WHERE plugin_id=?').get(pluginId) as any;
      if (old) {
        if (typeof input.expectedRevision === 'number' && Number(old.revision) !== input.expectedRevision) ownerConflict('PLUGIN_REVISION_CONFLICT');
        if (!old.enabled) ownerConflict('PLUGIN_DISABLED');
      }
      const now = Date.now();
      if (!recorded.n) {
        const statement = db.prepare('INSERT INTO company_plugin_files(plugin_id,version_hash,name,sha256,bytes) VALUES(?,?,?,?,?)');
        for (const [name, content] of Object.entries(input.files)) statement.run(pluginId, hash, name, createHash('sha256').update(content).digest('hex'), content.length);
      }
      // Verify the written bytes on disk before the pointer can move.
      this.loadVersion(pluginId, hash);
      if (old) {
        if (input.activate) db.prepare("UPDATE company_plugins SET previous_hash=active_hash,active_hash=?,revision=revision+1,goal_id=?,attempt_id=?,updated_at=? WHERE plugin_id=?").run(hash, input.goalId ?? null, input.attemptId ?? null, now, pluginId);
        else db.prepare('UPDATE company_plugins SET updated_at=? WHERE plugin_id=?').run(now, pluginId);
      } else {
        db.prepare("INSERT INTO company_plugins(plugin_id,active_hash,previous_hash,enabled,grants_json,revision,goal_id,attempt_id,created_at,updated_at) VALUES(?,?,?,1,'[]',1,?,?,?,?)")
          .run(pluginId, input.activate ? hash : null, null, input.goalId ?? null, input.attemptId ?? null, now, now);
      }
      if (input.activate) {
        for (const card of manifest.cards) {
          const existing = db.prepare('SELECT id FROM company_cards WHERE plugin_id=? AND view_key=?').get(pluginId, card.viewKey) as any;
          if (existing) db.prepare('UPDATE company_cards SET title=?,title_zh=?,removed_at=NULL WHERE id=?').run(card.title, card.titleZh, existing.id);
          else db.prepare('INSERT INTO company_cards(plugin_id,view_key,title,title_zh,visible,created_at) VALUES(?,?,?,?,1,?)').run(pluginId, card.viewKey, card.title, card.titleZh, now);
        }
      }
      const row = db.prepare('SELECT * FROM company_plugins WHERE plugin_id=?').get(pluginId) as any;
      return { pluginId, hash, activeHash: input.activate ? hash : String(row.active_hash ?? ''), previousHash: String(row.previous_hash ?? ''), revision: Number(row.revision), candidate: !input.activate };
    });
  }

  cards(visibleOnly = false): CompanyCardView[] {
    const db = this.store.db;
    return db.prepare(`SELECT * FROM company_cards${visibleOnly ? ' WHERE visible=1' : ''} ORDER BY id`).all().map((r: any) => {
      const plugin = db.prepare('SELECT * FROM company_plugins WHERE plugin_id=?').get(r.plugin_id) as any;
      const incompatible = this.incompatible(r.plugin_id, plugin?.active_hash ?? null), enabled = Boolean(plugin?.enabled) && !incompatible;
      const activeHash = plugin?.active_hash ? String(plugin.active_hash) : null;
      return { id: this.cardId(Number(r.id)), pluginId: String(r.plugin_id), viewKey: String(r.view_key), title: String(r.title), titleZh: String(r.title_zh),
        visible: Boolean(r.visible), enabled, activeHash, previousHash: plugin?.previous_hash ? String(plugin.previous_hash) : null, revision: Number(plugin?.revision ?? 0), incompatible,
        assetsUrl: enabled && activeHash ? `/api/owner/plugins/${r.plugin_id}/versions/${activeHash}/assets/cards/${r.view_key}/card.html` : null,
        detailUrl: enabled && activeHash ? `/api/owner/plugins/${r.plugin_id}/versions/${activeHash}/assets/cards/${r.view_key}/detail.html` : null, updatedAt: Number(plugin?.updated_at ?? r.created_at) };
    });
  }

  card(id: string) {
    const numeric = /^(\d{3}|\d{4,})$/.test(id) ? Number(id) : NaN;
    const row = Number.isSafeInteger(numeric) ? this.store.db.prepare('SELECT * FROM company_cards WHERE id=?').get(numeric) as any : undefined;
    if (!row) ownerConflict('PLUGIN_CARD_NOT_FOUND');
    return this.cards().find(c => c.id === this.cardId(Number(row.id))) ?? ownerConflict('PLUGIN_CARD_NOT_FOUND');
  }

  action(id: string, input: { action: 'show' | 'hide' | 'rollback'; expectedRevision: number; idempotencyKey: string }) {
    ownerInput(input && Object.keys(input).every(k => ['action', 'expectedRevision', 'idempotencyKey'].includes(k)) && ['show', 'hide', 'rollback'].includes(input.action) &&
      Number.isSafeInteger(input.expectedRevision) && typeof input.idempotencyKey === 'string' && /^[\w:-]{8,180}$/.test(input.idempotencyKey), 'PLUGIN_ACTION_INVALID');
    const key = `plugin_action_${createHash('sha256').update(JSON.stringify({ id, ...input })).digest('hex').slice(0, 64)}`;
    return this.store.db.prepare('SELECT 1 FROM owner_control_requests WHERE key=?').get(key)
      ? JSON.parse(String(this.store.db.prepare('SELECT response FROM owner_control_requests WHERE key=?').get(key)!.response))
      : this.requestAction(key, { id, ...input });
  }
  private requestAction(key: string, input: { id: string; action: string; expectedRevision: number }) {
    const db = this.store.db;
    return this.store.transaction(() => {
      const numeric = /^(\d{3}|\d{4,})$/.test(input.id) ? Number(input.id) : NaN;
      const card = Number.isSafeInteger(numeric) ? db.prepare('SELECT * FROM company_cards WHERE id=?').get(numeric) as any : undefined;
      if (!card) ownerConflict('PLUGIN_CARD_NOT_FOUND');
      const plugin = db.prepare('SELECT * FROM company_plugins WHERE plugin_id=?').get(card.plugin_id) as any;
      ownerInput(plugin, 'PLUGIN_CARD_NOT_FOUND');
      // The revision binds hide/show/rollback to the exact observed plugin state; a stale request never overwrites.
      ownerInput(Number(plugin.revision) === input.expectedRevision, 'PLUGIN_REVISION_CONFLICT');
      const incompatible = this.incompatible(card.plugin_id, plugin.active_hash ? String(plugin.active_hash) : null);
      if (input.action === 'show') {
        if (incompatible || !plugin.enabled) ownerConflict('PLUGIN_INCOMPATIBLE');
        db.prepare('UPDATE company_cards SET visible=1,removed_at=NULL WHERE id=?').run(card.id);
      } else if (input.action === 'hide') db.prepare('UPDATE company_cards SET visible=0,removed_at=? WHERE id=?').run(Date.now(), card.id);
      else {
        if (!plugin.previous_hash) ownerConflict('PLUGIN_NO_PREVIOUS_VERSION');
        if (this.incompatible(card.plugin_id, String(plugin.previous_hash))) ownerConflict('PLUGIN_INCOMPATIBLE');
        db.prepare('UPDATE company_plugins SET active_hash=previous_hash,previous_hash=active_hash,revision=revision+1,updated_at=? WHERE plugin_id=?').run(Date.now(), card.plugin_id);
      }
      const response = this.cards().find(c => c.id === this.cardId(Number(card.id)))!;
      db.prepare("INSERT OR IGNORE INTO owner_control_requests VALUES(?,?,?)").run(key, createHash('sha256').update(JSON.stringify(input)).digest('hex'), JSON.stringify(response));
      this.store.db.prepare("INSERT INTO control_events(kind,world_id,payload,created_at) VALUES('owner_plugin_card_action',NULL,?,?)").run(JSON.stringify({ cardId: this.cardId(Number(card.id)), action: input.action }), Date.now());
      return response;
    });
  }

  /** Serves one declared file of an installed version; traversal, symlinks and undeclared files never resolve. */
  asset(pluginId: string, hash: string, name: string) {
    if (!HASH.test(hash) || !name || name.includes('..') || /[\\:]|^\/|\.\./.test(name) || name.length > 120) ownerConflict('PLUGIN_ASSET_NOT_FOUND');
    const plugin = this.store.db.prepare('SELECT * FROM company_plugins WHERE plugin_id=?').get(pluginId) as any;
    if (!plugin) ownerConflict('PLUGIN_ASSET_NOT_FOUND');
    const version = this.loadVersion(pluginId, hash), declared = version.files[name];
    if (!declared) ownerConflict('PLUGIN_ASSET_NOT_FOUND');
    const root = this.versionRoot(pluginId, hash), file = containedPath(root, ...name.split('/'));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) ownerConflict('PLUGIN_ASSET_NOT_FOUND');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== declared.bytes || createHash('sha256').update(bytes).digest('hex') !== declared.sha256) ownerConflict('PLUGIN_ASSET_CHANGED');
    return { bytes, contentType: ASSET_MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream', csp: PLUGIN_CSP };
  }

  grant(pluginId: string, resource: string) {
    ownerInput(RESOURCE_IDS.includes(resource), 'PLUGIN_RESOURCE_INVALID');
    const plugin = this.store.db.prepare('SELECT 1 FROM company_plugins WHERE plugin_id=?').get(pluginId);
    if (!plugin) ownerConflict('PLUGIN_NOT_FOUND');
    this.store.transaction(() => {
      const current = this.grants(pluginId);
      if (current.includes(resource)) return;
      this.store.db.prepare("UPDATE company_plugins SET grants_json=?,revision=revision+1,updated_at=? WHERE plugin_id=?").run(JSON.stringify([...current, resource].sort()), Date.now(), pluginId);
    });
    return { pluginId, grants: this.grants(pluginId) };
  }

  /** Minimal read-only projection for one granted resource; no SQL, paths or credentials cross this boundary. */
  project(pluginId: string, resource: string, params: { cardId?: string; version?: string }) {
    ownerInput(RESOURCE_IDS.includes(resource), 'PLUGIN_RESOURCE_INVALID');
    ownerInput(this.grants(pluginId).includes(resource), 'PLUGIN_RESOURCE_NOT_GRANTED');
    const db = this.store.db;
    if (resource === 'company.summary@1') {
      const goals = db.prepare('SELECT COUNT(*) n FROM owner_goals WHERE status NOT IN (\'ARCHIVED\',\'COMPLETED\',\'PARTIALLY_COMPLETED\',\'STOPPED\')').get()! as any;
      const orders = db.prepare("SELECT COUNT(*) n FROM orders WHERE status='PAID'").get()! as any;
      const products = db.prepare('SELECT COUNT(*) n FROM public_products WHERE product_enabled=1').get()! as any;
      return { resource, asOf: Date.now(), summary: { activeGoals: Number(goals.n), paidOrders: Number(orders.n), publishedProducts: Number(products.n) } };
    }
    if (resource === 'goals.summary@1') {
      const items = db.prepare("SELECT id,title,status,updated_at FROM owner_goals WHERE status NOT IN ('ARCHIVED','STOPPED') ORDER BY updated_at DESC LIMIT 20").all().map((r: any) => ({ id: String(r.id).slice(0, 12), title: String(r.title).slice(0, 60), status: String(r.status), updatedAt: Number(r.updated_at) }));
      return { resource, asOf: Date.now(), items };
    }
    const items = db.prepare("SELECT person_name,state,updated_at FROM owner_work_tasks ORDER BY updated_at DESC LIMIT 20").all().map((r: any) => ({ personName: String(r.person_name).slice(0, 40), state: String(r.state), updatedAt: Number(r.updated_at) }));
    return { resource, asOf: Date.now(), items };
  }
}

export { PLUGIN_CSP, RESOURCE_IDS };
