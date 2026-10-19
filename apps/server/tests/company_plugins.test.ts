import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { goalFixture } from './fixtures/owner_goals.js';
import { CompanyPluginService } from '../src/services/company_plugin_service.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

const CARD_HTML = '<!doctype html><html><body><p id="mark">Real summary card</p></body></html>';
const DETAIL_HTML = '<!doctype html><html><body><p id="detail">Real detail</p></body></html>';
function manifest(pluginId = 'marketing', viewKey = 'marketing-summary') {
  return { schema: 1 as const, pluginId, version: '1.0.0', title: 'Marketing summary', titleZh: '营销摘要',
    cards: [{ viewKey, title: 'Marketing summary', titleZh: '营销摘要', resources: ['company.summary@1'] }] };
}
function files(viewKey = 'marketing-summary') {
  return { [`cards/${viewKey}/card.html`]: Buffer.from(CARD_HTML), [`cards/${viewKey}/detail.html`]: Buffer.from(DETAIL_HTML) };
}
function plugin() {
  const f = goalFixture(); cleanups.push(f.close);
  return { ...f, plugins: new CompanyPluginService(f.control, f.root) };
}

describe('company plugin host', () => {
  it('starts with zero cards and never presets a number', () => {
    const f = plugin();
    expect(f.plugins.cards()).toEqual([]);
    expect(fs.existsSync(join(f.root, 'assets', 'plugins'))).toBe(false);
  });

  it('registers an authorized card as 001 only after a verified install, then keeps it across reopen', () => {
    const f = plugin(), idempotencyKey = 'install-001-once';
    const result = f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), goalId: 'goal-x', activate: true, idempotencyKey });
    expect(result.candidate).toBe(false); expect(result.activeHash).toBe(result.hash);
    const cards = f.plugins.cards();
    expect(cards).toHaveLength(1); expect(cards[0]!.id).toBe('001'); expect(cards[0]!.visible).toBe(true); expect(cards[0]!.enabled).toBe(true);
    expect(fs.existsSync(join(f.root, 'assets', 'plugins', 'marketing', 'versions', result.hash, 'manifest.json'))).toBe(true);
    expect(f.plugins.cards(true).map(c => c.id)).toEqual(['001']);
  });

  it('keeps 001 working when the next candidate fails, and never burns the next number', () => {
    const f = plugin();
    f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'k1' });
    expect(() => f.plugins.install({ pluginId: 'marketing', manifest: { ...manifest(), version: '1.1.0' } as any, files: { 'cards/marketing-summary/card.html': Buffer.from(CARD_HTML) }, activate: true, idempotencyKey: 'k2' }))
      .toThrow('PLUGIN_PAGE_MISSING');
    const second = f.plugins.install({ pluginId: 'news', manifest: manifest('news', 'news-brief') as any, files: files('news-brief'), activate: true, idempotencyKey: 'k3' });
    expect(second.pluginId).toBe('news');
    const cards = f.plugins.cards();
    expect(cards.map(c => c.id)).toEqual(['001', '002']);
    expect(cards.every(c => c.visible)).toBe(true);
  });

  it('hides without touching anything else, shows again, and rolls back only the version', () => {
    const f = plugin();
    const first = f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'a' });
    const updated = f.plugins.install({ pluginId: 'marketing', manifest: { ...manifest(), version: '1.1.0' } as any, files: files(), activate: true, expectedRevision: first.revision, idempotencyKey: 'b' });
    const card = f.plugins.cards()[0]!;
    const hidden = f.plugins.action(card.id, { action: 'hide', expectedRevision: card.revision, idempotencyKey: 'hide-card-001' });
    expect(hidden.visible).toBe(false);
    expect(f.plugins.cards(true)).toHaveLength(0);
    expect(fs.existsSync(join(f.root, 'assets', 'plugins', 'marketing', 'versions', updated.hash))).toBe(true);
    const shown = f.plugins.action(card.id, { action: 'show', expectedRevision: hidden.revision, idempotencyKey: 'show-card-001' });
    expect(shown.visible).toBe(true);
    const rolled = f.plugins.action(card.id, { action: 'rollback', expectedRevision: shown.revision, idempotencyKey: 'rollback-card-001' });
    expect(rolled.activeHash).toBe(first.hash);
    // A repeated idempotent request returns the recorded response without a new change.
    expect(f.plugins.action(card.id, { action: 'rollback', expectedRevision: shown.revision, idempotencyKey: 'rollback-card-001' })).toEqual(rolled);
    expect(() => f.plugins.action(card.id, { action: 'rollback', expectedRevision: shown.revision, idempotencyKey: 'rollback-card-001' })).not.toThrow();
  });

  it('rejects action revision conflicts and unknown card ids without guessing titles', () => {
    const f = plugin();
    f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'a' });
    const card = f.plugins.cards()[0]!;
    expect(() => f.plugins.action(card.id, { action: 'hide', expectedRevision: card.revision + 5, idempotencyKey: 'stale-action-1' })).toThrow('PLUGIN_REVISION_CONFLICT');
    expect(() => f.plugins.action('042', { action: 'hide', expectedRevision: 0, idempotencyKey: 'missing-card-042' })).toThrow('PLUGIN_CARD_NOT_FOUND');
    expect(() => f.plugins.action('haha', { action: 'hide', expectedRevision: 0, idempotencyKey: 'missing-card-name' })).toThrow('PLUGIN_CARD_NOT_FOUND');
  });

  it('serves exact hashed assets only, with traversal and undeclared files refused', () => {
    const f = plugin();
    const result = f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'a' });
    const asset = f.plugins.asset('marketing', result.hash, 'cards/marketing-summary/card.html');
    expect(asset.bytes.toString()).toBe(CARD_HTML); expect(asset.contentType).toContain('text/html'); expect(asset.csp).toContain("frame-ancestors 'self'");
    expect(() => f.plugins.asset('marketing', result.hash, 'cards/marketing-summary/../../manifest.json')).toThrow();
    expect(() => f.plugins.asset('marketing', result.hash, 'manifest.json')).toThrow('PLUGIN_ASSET_NOT_FOUND');
    expect(() => f.plugins.asset('marketing', '0'.repeat(64), 'cards/marketing-summary/card.html')).toThrow();
    expect(() => f.plugins.asset('marketing', result.hash, 'cards/marketing-summary/secret.txt')).toThrow('PLUGIN_ASSET_NOT_FOUND');
    fs.writeFileSync(join(f.root, 'assets', 'plugins', 'marketing', 'versions', result.hash, 'cards', 'marketing-summary', 'card.html'), 'TAMPERED');
    expect(() => f.plugins.asset('marketing', result.hash, 'cards/marketing-summary/card.html')).toThrow();
  });

  it('never auto-grants a declared resource and serves projections only for granted scope', () => {
    const f = plugin();
    f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'a' });
    expect(() => f.plugins.project('marketing', 'company.summary@1', {})).toThrow('PLUGIN_RESOURCE_NOT_GRANTED');
    expect(() => f.plugins.project('marketing', 'goals.summary@1', {})).toThrow('PLUGIN_RESOURCE_NOT_GRANTED');
    f.plugins.grant('marketing', 'company.summary@1');
    const projection = f.plugins.project('marketing', 'company.summary@1', {});
    expect(projection).toMatchObject({ resource: 'company.summary@1', summary: { activeGoals: 0, paidOrders: 0, publishedProducts: 0 } });
    expect(Object.keys(projection as object)).not.toContain('goals');
    // An unknown resource stays rejected even after another grant.
    expect(() => f.plugins.project('marketing', 'orders.raw@9', {})).toThrow('PLUGIN_RESOURCE_INVALID');
  });

  it('marks a corrupted version incompatible without deleting its files, and refuses activation of it', () => {
    const f = plugin();
    const first = f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'a' });
    const second = f.plugins.install({ pluginId: 'marketing', manifest: { ...manifest(), version: '1.1.0' } as any, files: files(), activate: true, expectedRevision: first.revision, idempotencyKey: 'b' });
    fs.writeFileSync(join(f.root, 'assets', 'plugins', 'marketing', 'versions', second.hash, 'manifest.json'), '{"schema":1}');
    const card = f.plugins.cards()[0]!;
    expect(card.incompatible).toBe(true); expect(card.enabled).toBe(false);
    expect(fs.existsSync(join(f.root, 'assets', 'plugins', 'marketing', 'versions', second.hash, 'cards'))).toBe(true);
    expect(() => f.plugins.action(card.id, { action: 'show', expectedRevision: card.revision, idempotencyKey: 'show-bad-card' })).toThrow('PLUGIN_INCOMPATIBLE');
    const rolled = f.plugins.action(card.id, { action: 'rollback', expectedRevision: card.revision, idempotencyKey: 'rollback-bad-card' });
    expect(rolled.activeHash).toBe(first.hash); expect(rolled.enabled).toBe(true);
  });

  it('rejects oversized, undeclared-page and traversal installs before any version directory survives', () => {
    const f = plugin();
    expect(() => f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: { ...files(), 'cards/x/evil.html': Buffer.alloc(600_000, 'a') }, activate: true, idempotencyKey: 'big' })).toThrow();
    expect(() => f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: { ...files(), 'escape/../../evil.txt': Buffer.from('no') }, activate: true, idempotencyKey: 'trav' })).toThrow();
    expect(fs.existsSync(join(f.root, 'assets', 'plugins')) ? fs.readdirSync(join(f.root, 'assets', 'plugins')) : []).toEqual([]);
  });

  it('supports a 1000+ card id without truncation', () => {
    const f = plugin();
    f.control.db.exec("INSERT INTO company_plugins VALUES('p0','h0',NULL,1,'[]',1,NULL,NULL,0,0)");
    const insert = f.control.db.prepare("INSERT INTO company_cards(plugin_id,view_key,title,title_zh,visible,created_at) VALUES('p0',?,'t','t',1,0)");
    for (let i = 0; i < 1000; i++) insert.run(`v${i}`);
    const cards = f.plugins.cards();
    expect(cards).toHaveLength(1000);
    expect(cards[998]!.id).toBe('999'); expect(cards[999]!.id).toBe('1000');
    expect(f.plugins.card('1000').id).toBe('1000');
  });

  it('retains the plugin registry across a control-store reopen (upgrade/rollback compatibility)', () => {
    const f = plugin();
    const first = f.plugins.install({ pluginId: 'marketing', manifest: manifest() as any, files: files(), activate: true, idempotencyKey: 'a' });
    f.plugins.action('001', { action: 'hide', expectedRevision: f.plugins.cards()[0]!.revision, idempotencyKey: 'hide-first-card' });
    const reopened = new CompanyPluginService(f.control, f.root);
    const cards = reopened.cards();
    expect(cards).toHaveLength(1); expect(cards[0]!.visible).toBe(false); expect(cards[0]!.activeHash).toBe(first.hash);
    expect(reopened.grants('marketing')).toEqual([]);
  });
});
