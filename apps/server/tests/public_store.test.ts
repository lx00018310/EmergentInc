import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { LineageStore, WorldRegistryStore, writeGenerationPointer, SqliteDatabase } from '@emergentinc/persistence';
import { snapshotDatabase } from '../../../supervisor/migration_runner.js';
import {checkPaymentRollback,preparePaymentRollback} from '../../../supervisor/payment_compatibility.js';
import { UsageMeter } from '@emergentinc/model';
import { createServer } from '../src/app.js';
import { PaymentService } from '../src/services/payment_service.js';
import { PaymentMonitor, type PaymentRpc } from '../src/services/payment_monitor.js';
import { PublicStore } from '../src/services/public_store.js';
import { WorldRegistryService } from '../src/services/world_registry_service.js';
import { WorldRuntimeManager } from '../src/services/world_runtime_manager.js';
import { GenePromotionService } from '../src/services/gene_promotion_service.js';
import { BusinessService } from '../src/services/business_service.js';
import { TRANSFER_TOPIC } from '../src/services/payment_assets.js';

const clean: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of clean.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'v24-store-')), lineage = new LineageStore(join(root, 'system/lineage/lineage.sqlite3'), { v23: true });
  lineage.createGeneration({ id: 'G0001', number: 1, geneHash: '1'.repeat(64), releaseId: 'r1', state: 'ACTIVE' });
  writeGenerationPointer(join(root, 'system'), 'G0001');
  const control = new WorldRegistryStore(join(root, 'system/control/control.sqlite3')), registry = new WorldRegistryService(root, control, lineage, '1');
  const a = registry.create({ displayName: 'A', traits: {}, behaviorProfile: [] }), b = registry.create({ displayName: 'B', traits: {}, behaviorProfile: [] });
  const genome = { schema_version: 1, generation: 1, body_interface_version: '1', protected_paths: ['genome/**'], capability_contracts: {} };
  const manager = new WorldRuntimeManager(registry, genome, { provider: { async call() { throw Error('MODEL_MUST_NOT_RUN'); } },
    usageMeter: new UsageMeter({ models: {} }), modelName: 'test', isMockMode: true, isModelConfigured: false });
  const paymentFile = join(root, 'system/payment/payment.sqlite3'), payments = new PaymentService(paymentFile, control, lineage);
  payments.configureRail({ rail_id: 'bsc', chain: 'bsc', network: 'mainnet', recipient_address: '0x' + '12'.repeat(20), status: 'ENABLED', expected_revision: 0, rpc_id: 'bsc-mainnet' }, 100);
  const store = new PublicStore(control, payments), secret = 'owner-secret'.repeat(4), dist = join(root, 'frontend');
  fs.mkdirSync(dist); fs.writeFileSync(join(dist, 'index.html'), '<html><div id="root">Public entry</div></html>');
  const app = await createServer({ workspaceRoot: root, runtimeMode: 'business', ownerAuth: { secret, secureCookies: false }, businessService: new BusinessService(lineage),
    worlds: { manager, promotion: new GenePromotionService(manager, resolve('.'), lineage), payments, monitor: new PaymentMonitor(payments), modelName: 'test' }, frontendDistDir: dist });
  const cookie = String((await app.inject({ method: 'POST', url: '/api/login', payload: { secret } })).headers['set-cookie']).split(';')[0]!;
  clean.push(async () => { await app.close(); await manager.closeAll(); store.close(); payments.close(); control.close(); lineage.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const settings = () => {
    const { product_id: _id, updated_at: _at, ...input } = store.settings();
    return { ...input, product_enabled: true, product_price: '10', product_currency: 'USDT',product_name_en:'Custom Service',product_name_zh:'定制服务',product_description_en:'Test service',product_description_zh:'测试服务' };
  };
  const owner = (method: any, url: string, payload?: unknown) => app.inject({ method, url, payload, headers: { cookie } });
  const body = (key = 'k'.repeat(40)) => ({ product_id: 'custom-service', customer_name: 'Ada', customer_contact: 'ada@example.com', customer_requirement: 'Help deploy my business', rail_id: 'bsc', idempotency_key: key, language: 'en' });
  const publish = async () => { const result = await owner('PUT', '/api/public-site', settings()); expect(result.statusCode, result.body).toBe(200); };
  const order = async (key?: string) => { const result = await app.inject({ method: 'POST', url: '/api/public/orders', payload: body(key) }); expect(result.statusCode, result.body).toBe(201); return result.json(); };
  const payment = (order: any, token = order.public_order_token) => app.inject({ url: `/api/public/orders/${order.order_id}/payment`, headers: { authorization: `Bearer ${token}` } });
  return { root, app, control, lineage, payments, store, paymentFile, a, b, owner, body, publish, order, payment, settings };
}
function wire(invoice: any) {
  const signature = '0x' + 'ab'.repeat(32), blockHash = '0x' + 'cd'.repeat(32), timestamp = '0x' + Math.floor(Date.now() / 1000).toString(16);
  const log = { address: invoice.mint, topics: [TRANSFER_TOPIC, '0x' + '0'.repeat(24) + '34'.repeat(20), '0x' + '0'.repeat(24) + invoice.recipient_address.slice(2)],
    data: '0x' + BigInt(invoice.amount_atomic).toString(16).padStart(64, '0'), logIndex: '0x0', transactionHash: signature, blockHash, blockNumber: '0x64', removed: false };
  const evidence = { chainId: 56, receipt: { status: '0x1', transactionHash: signature, blockHash, blockNumber: '0x64', logs: [log] },
    block: { number: '0x64', hash: blockHash, timestamp }, finalizedHead: { number: '0x64' } };
  const rpc: PaymentRpc = { async call(_network, method) {
    if (method === 'eth_getBlockByNumber') return evidence.block;
    if (method === 'eth_getLogs') return [log];
    if (method === 'eth_getTransactionReceipt') return evidence.receipt;
    throw Error('UNEXPECTED_TEST_RPC_METHOD: ' + method);
  } };
  return { signature, evidence, rpc };
}
describe('V24 anonymous store with an instance treasury', () => {
  it('shows two empty products, denies placeholder checkout, and prices orders from the selected product',async()=>{
    const f=await fixture();
    const initial=(await f.app.inject('/api/public/products')).json().items;
    expect(initial).toHaveLength(2);expect(initial.every((p:any)=>!p.product_enabled&&p.product_price===null&&!p.product_name_en&&!p.product_name_zh)).toBe(true);
    expect((await f.app.inject({method:'POST',url:'/api/public/orders',payload:{...f.body(),product_id:'product-2'}})).statusCode).toBe(404);
    expect(f.control.db.prepare('SELECT count(*) n FROM orders').get()!.n).toBe(0);
    const second={product_enabled:true,product_price:'23',product_currency:'USDT',product_name_en:'Second service',product_name_zh:'第二项服务',product_description_en:'Second description',product_description_zh:'第二项说明'};
    expect((await f.app.inject({method:'PUT',url:'/api/public-site/products/product-2',payload:second})).statusCode).toBe(401);
    expect((await f.owner('PUT','/api/public-site/products/product-2',{...second,product_name_zh:''})).statusCode).toBe(400);
    expect((await f.owner('PUT','/api/public-site/products/product-2',second)).statusCode).toBe(200);
    const response=await f.app.inject({method:'POST',url:'/api/public/orders',payload:{...f.body(),product_id:'product-2'}});expect(response.statusCode).toBe(201);
    const old=f.control.db.prepare('SELECT * FROM orders').get()!;expect(old).toMatchObject({product_id:'product-2',product_name_snapshot:'Second service',amount:'23.000000'});
    expect((await f.owner('PUT','/api/public-site/products/product-2',{...second,product_enabled:false,product_price:'50'})).statusCode).toBe(200);
    expect((await f.payment(response.json())).json().quoted_amount).toBe('23.000000');
    expect((await f.owner('POST','/api/public-site/products',{})).statusCode).toBe(200);expect(f.store.products().items).toHaveLength(3);
    expect(f.control.db.prepare('SELECT * FROM orders').get()).toEqual(old);
  });
  it('migrates the single-product constraint while retaining an existing paid order and invoice graph',async()=>{
    const f=await fixture();await f.publish();const order=await f.order(),invoice=f.payments.invoice(String(f.control.db.prepare('SELECT invoice_id FROM orders').get()!.invoice_id)),evidence=wire(invoice);
    f.payments.observe(invoice.invoice_id,evidence.signature,'finalized',evidence.evidence);
    const copy=join(f.root,'legacy-control.sqlite3');await snapshotDatabase(join(f.root,'system/control/control.sqlite3'),copy);
    const old=new SqliteDatabase(copy);old.exec('PRAGMA foreign_keys=OFF;');old.transaction(()=>{
      old.exec("DELETE FROM public_products WHERE product_id='product-2';");
      const sql=String(old.prepare("SELECT sql FROM sqlite_master WHERE name='public_products'").get()!.sql);
      old.exec(sql.replace(/^CREATE TABLE\s+"?public_products"?/i,'CREATE TABLE public_products_old').replace('product_id TEXT PRIMARY KEY',"product_id TEXT PRIMARY KEY CHECK(product_id='custom-service')"));
      old.exec('INSERT INTO public_products_old SELECT * FROM public_products; DROP TABLE public_products; ALTER TABLE public_products_old RENAME TO public_products;');
    });const before=old.prepare('SELECT * FROM orders').all(),product=old.prepare('SELECT * FROM public_products').get();old.close();
    const control=new WorldRegistryStore(copy),upgraded=new PublicStore(control,f.payments);
    try{expect(control.db.prepare('SELECT * FROM orders').all()).toEqual(before);expect(upgraded.product(false)).toEqual(product);expect(upgraded.products().items).toHaveLength(2);
      expect(control.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(upgraded.payment(order.order_id,order.public_order_token).status).toBe('PAID');
    }finally{upgraded.close();control.close();}
  });
  it('reverses V24 attribution preserving historical receipts, but refuses any instance invoice', async () => {
    const f=await fixture(),legacy=join(f.root,'legacy');fs.mkdirSync(join(legacy,'genome'),{recursive:true});
    fs.writeFileSync(join(legacy,'genome/manifest.json'),JSON.stringify({capability_contracts:{}}));
    const invoice=f.payments.createInvoice({qianji_id:f.a.qianji_id,rail_id:'bsc',amount:'12',idempotency_key:'historical-rollback'}),evidence=wire(invoice);
    f.payments.observe(invoice.invoice_id,evidence.signature,'finalized',evidence.evidence);
    const tables=['payment_rails','payment_invoices','payment_observations','payment_receipts','world_revenue_events','payment_outbox'];
    const before=tables.map(table=>f.payments.db.prepare(`SELECT * FROM ${table}`).all());
    const copy=join(f.root,'rollback.sqlite3');await snapshotDatabase(f.paymentFile,copy);
    checkPaymentRollback(copy,legacy);preparePaymentRollback(copy,legacy);
    const db=new SqliteDatabase(copy);
    try{expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(2);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(tables.map(table=>db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
      expect(db.prepare('PRAGMA table_info(payment_invoices)').all().find(row=>row.name==='world_id')?.notnull).toBe(1);
    }finally{db.close();}
    const upgraded=new PaymentService(copy,f.control,f.lineage);upgraded.createInstanceInvoice({order_id:'new_order',rail_id:'bsc',amount:'10',idempotency_key:'new-instance'});upgraded.close();
    expect(()=>checkPaymentRollback(copy,legacy)).toThrow('V23_ROLLBACK_DENIED_INSTANCE_PAYMENT_FACTS');
    expect(()=>preparePaymentRollback(copy,legacy)).toThrow('V23_ROLLBACK_DENIED_INSTANCE_PAYMENT_FACTS');
    const retained=new SqliteDatabase(copy);try{expect(retained.prepare('PRAGMA user_version').get()!.user_version).toBe(3);expect(retained.prepare('SELECT count(*) n FROM payment_invoices').get()!.n).toBe(2);}finally{retained.close();}
  });
  it('migrates an existing V2 USDT invoice / receipt / revenue / outbox graph without rewriting any financial rows', async () => {
    const f = await fixture(), invoice = f.payments.createInvoice({ qianji_id: f.a.qianji_id, rail_id: 'bsc', amount: '12', idempotency_key: 'historical-world' });
    const evidence = wire(invoice); f.payments.observe(invoice.invoice_id, evidence.signature, 'finalized', evidence.evidence);
    const copy = join(f.root, 'v2-payment.sqlite3'); await snapshotDatabase(f.paymentFile, copy);
    const db = new SqliteDatabase(copy); db.exec('PRAGMA foreign_keys=OFF;');
    db.transaction(() => {
      for (const table of ['payment_invoices', 'payment_receipts', 'world_revenue_events']) {
        const sql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table)!.sql);
        db.exec(sql.replace(new RegExp(`^CREATE TABLE\\s+"?${table}"?`, 'i'), `CREATE TABLE ${table}_v2`)
          .replace(/world_id TEXT/g, 'world_id TEXT NOT NULL').replace(/qianji_id TEXT/g, 'qianji_id TEXT NOT NULL'));
        db.exec(`INSERT INTO ${table}_v2 SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_v2 RENAME TO ${table};`);
      }
      db.exec("CREATE UNIQUE INDEX permanent_invoice_amount ON payment_invoices(chain,network,mint,recipient_address,amount_atomic) WHERE chain!='solana'; PRAGMA user_version=2;");
    });
    const tables = ['payment_invoices', 'payment_observations', 'payment_receipts', 'world_revenue_events', 'payment_outbox'];
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table}`).all()); db.close();
    const upgraded = new PaymentService(copy, f.control, f.lineage);
    try {
      expect(upgraded.db.prepare('PRAGMA user_version').get()!.user_version).toBe(3);
      expect(upgraded.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(tables.map(table => upgraded.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
      expect(upgraded.revenue(f.a.world_id).mainnetAtomic).toBe('12000001'); expect(upgraded.revenue(null).mainnetAtomic).toBe('0');
      expect(upgraded.createInstanceInvoice({ order_id: 'order_new', rail_id: 'bsc', amount: '10', idempotency_key: 'instance-new' }).world_id).toBeNull();
    } finally { upgraded.close(); }
  });
  it('serves public entry and only the exact anonymous allowlist; never leaks Owner data or permits public settings mutations', async () => {
    const f = await fixture(); await f.publish();
    for (const url of ['/', '/api/public/site', '/api/public/products', '/api/public/products/custom-service', '/api/public/payment-rails']) expect((await f.app.inject(url)).statusCode).toBe(200);
    for (const url of ['/api/evolution/overview', '/api/worlds', '/api/business/overview', '/api/public-site', '/api/payments/rails', '/api/public/private', '/api/public/orders']) expect((await f.app.inject(url)).statusCode).toBe(401);
    expect((await f.app.inject('/api/public/products/unknown')).statusCode).toBe(404);
    expect((await f.app.inject({ method: 'PUT', url: '/api/public/site', payload: {} })).statusCode).toBe(401);
    expect((await f.app.inject({ url: '/api/public/site', headers: { origin: 'https://attacker.example' } })).statusCode).toBe(403);
    expect(JSON.stringify((await f.app.inject('/api/public/payment-rails')).json())).not.toMatch(/rpc_id|recipient_address|secret|credential|qianji_id|world_id/);
  });
  it('pins server price and customer/product snapshots, protects payment queries with random tokens and survives product delisting', async () => {
    const f = await fixture(); await f.publish(); const first = await f.order();
    expect(first.public_order_token).toMatch(/^[a-f0-9]{64}$/); expect(first).toEqual(await f.order());
    const row = f.control.db.prepare('SELECT * FROM orders').get()!;
    expect(row).toMatchObject({ amount: '10.000000', product_name_snapshot: 'Custom Service', status: 'AWAITING_PAYMENT' });
    expect(f.payments.invoice(String(row.invoice_id))).toMatchObject({ world_id: null, qianji_id: null, order_id: first.order_id });
    expect((await f.payment(first, '0'.repeat(64))).statusCode).toBe(404);
    const publicPayment = (await f.payment(first)).json(); expect(publicPayment.amount).toBe('10.000001000000000000'); expect(publicPayment.qr_data_url).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(publicPayment)).not.toMatch(/Ada|ada@example|Help deploy|rpc_id|world_id|qianji_id|request_hash/);
    expect((await f.app.inject({ method: 'POST', url: '/api/public/orders', payload: { ...f.body('new'.repeat(12)), amount: '0.01', world_id: f.a.world_id } })).statusCode).toBe(400);
    expect((await f.app.inject({ method: 'POST', url: '/api/public/orders', payload: { ...f.body(), customer_name: 'Changed' } })).statusCode).toBe(409);
    await f.owner('PUT', '/api/public-site', { ...f.settings(), product_enabled: false, product_name_en: 'Changed name', product_price: '20' });
    expect((await f.app.inject('/api/public/products')).json().items.every((p:any)=>!p.product_enabled)).toBe(true);
    expect(first).toEqual(await f.order()); expect((await f.payment(first)).json().quoted_amount).toBe('10.000000');
    expect(f.control.db.prepare('SELECT COUNT(*) n FROM products').get()!.n).toBe(0);
  });
  it('runs the existing monitor through paid Invoice, paid Order, instance Revenue and shared experience without crediting either World', async () => {
    const f = await fixture(); await f.publish(); const order = await f.order(), row = f.control.db.prepare('SELECT invoice_id FROM orders').get()!;
    const invoice = f.payments.invoice(String(row.invoice_id)), evidence = wire(invoice);
    f.payments.observe(invoice.invoice_id, evidence.signature, 'confirmed', evidence.evidence);
    expect((await f.payment(order)).json().status).toBe('AWAITING_PAYMENT'); expect(f.payments.revenue(null).mainnetAtomic).toBe('0');
    await new PaymentMonitor(f.payments, evidence.rpc).scanAll();
    expect((await f.payment(order)).json()).toMatchObject({ invoice_status: 'PAID', status: 'PAID' });
    const overview = (await f.owner('GET', '/api/public-site')).json();
    expect(overview.revenue).toMatchObject({ scope: 'INSTANCE', mainnetAtomic: '10000001' });
    const mission=(await f.owner('GET','/api/owner/overview')).json();
    expect(mission.activity.find((e:any)=>e.type==='Payment received')).toMatchObject({source:'world_revenue_events',href:'/GENE?view=public-site'});
    expect(overview.orders[0].customer_requirement).toBe('Help deploy my business'); expect(JSON.stringify(overview)).not.toContain(order.public_order_token);
    expect(f.payments.revenue(f.a.world_id).mainnetAtomic).toBe('0'); expect(f.payments.revenue(f.b.world_id).mainnetAtomic).toBe('0');
    for (const world of [f.a, f.b]) expect(f.lineage.relevantMemories({ worldId: world.world_id, kind: 'business_outcome' })).toHaveLength(1);
    expect(f.lineage.db.prepare("SELECT world_id FROM memories WHERE source='chain_finalized'").get()!.world_id).toBeNull();
    await new PaymentMonitor(f.payments, evidence.rpc).scanAll(); expect(f.payments.db.prepare('SELECT COUNT(*) n FROM payment_receipts').get()!.n).toBe(1);
  });
  it('recovers the precise invoice intent after failure between databases and preserves finalized facts across restart', async () => {
    const f = await fixture(); await f.publish(); const commit = f.payments.createInstanceInvoice.bind(f.payments);
    const fail = vi.spyOn(f.payments, 'createInstanceInvoice').mockImplementationOnce(input => { commit(input); throw Error('TEST_LOST_LINK_ACK'); });
    expect((await f.app.inject({ method: 'POST', url: '/api/public/orders', payload: f.body() })).statusCode).toBe(503); fail.mockRestore();
    expect(f.control.db.prepare('SELECT status FROM orders').get()!.status).toBe('PENDING');
    const recovered = new PublicStore(f.control, f.payments); const order = await f.order();
    expect(f.payments.db.prepare('SELECT COUNT(*) n FROM payment_invoices').get()!.n).toBe(1);
    const invoice = f.payments.invoice(String(f.control.db.prepare('SELECT invoice_id FROM orders').get()!.invoice_id)), evidence = wire(invoice);
    f.payments.onFinalized = undefined; f.payments.observe(invoice.invoice_id, evidence.signature, 'finalized', evidence.evidence);
    expect(f.control.db.prepare('SELECT status FROM orders').get()!.status).toBe('AWAITING_PAYMENT');
    const reopenedPayment = new PaymentService(f.paymentFile, f.control, f.lineage), restarted = new PublicStore(f.control, reopenedPayment);
    try {
      expect(restarted.payment(order.order_id, order.public_order_token).status).toBe('PAID'); reopenedPayment.deliverMemories();
      await new PaymentMonitor(reopenedPayment, evidence.rpc).scanAll();
      expect(reopenedPayment.revenue(null).mainnetAtomic).toBe('10000001'); expect(reopenedPayment.db.prepare('SELECT COUNT(*) n FROM payment_receipts').get()!.n).toBe(1);
      expect(f.lineage.db.prepare("SELECT COUNT(*) n FROM memories WHERE source='chain_finalized'").get()!.n).toBe(1);
    } finally { restarted.close(); reopenedPayment.close(); recovered.close(); }
  },15000); // Database reopen + WAL writes can exceed the default 5s on Windows.
  it('propagates Owner cancellation to the order and leaves subsequent money in review without recognizing revenue', async () => {
    const f = await fixture(); await f.publish(); const order = await f.order();
    const invoice = f.payments.invoice(String(f.control.db.prepare('SELECT invoice_id FROM orders').get()!.invoice_id));
    expect((await f.owner('POST', `/api/payments/invoices/${invoice.invoice_id}/cancel`, {})).statusCode).toBe(200);
    expect((await f.owner('GET', '/api/public-site')).json().orders[0].status).toBe('CANCELLED');
    const evidence = wire(invoice); expect(f.payments.observe(invoice.invoice_id, evidence.signature, 'finalized', evidence.evidence).status).toBe('REVIEW_REQUIRED');
    expect((await f.payment(order)).json()).toMatchObject({ status: 'CANCELLED', invoice_status: 'REVIEW_REQUIRED' });
    expect(f.payments.revenue(null).mainnetAtomic).toBe('0'); expect(f.payments.db.prepare('SELECT COUNT(*) n FROM payment_receipts').get()!.n).toBe(0);
  });
});
