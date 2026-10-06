import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { WorldRegistryStore } from '@emergentinc/persistence';
import { PaymentService, type Invoice } from './payment_service.js';
import {migratePublicProducts} from './public_products_migration.js';
import { quotedAmount, tokenAmount } from './payment_assets.js';

export class PublicError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
const text = (value: unknown, max: number, required = true) => {
  if (typeof value !== 'string' || value.length > max || required && !value.trim()) throw new PublicError('INVALID_CHECKOUT_INPUT');
  return value.trim();
};
const fields = (value: unknown, keys: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new PublicError('UNEXPECTED_FIELD');
  return value as Record<string, unknown>;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const defaults = {
  site_name: 'EmergentInc', headline_en: 'AI that helps anyone start and run an online business.', headline_zh: '帮助每个人利用 AI 开启并运营线上生意。',
  description_en: 'Start with an idea. Let AI help turn it into a real business.', description_zh: '从一个想法开始，让 AI 帮你把它变成真正的生意。',
  github_url: 'https://github.com/lx00018310/EmergentInc',
  contact_text_en: 'Product and contact details will be added soon.', contact_text_zh: '商品与联系方式将在完善后公布。',
};
const productKeys = ['product_enabled', 'product_name_en', 'product_name_zh', 'product_description_en', 'product_description_zh', 'product_price', 'product_currency'];

/** Instance storefront in the existing control DB. Payment facts remain in the existing payment DB. */
export class PublicStore {
  private readonly finalized = (invoice: Invoice) => {
    if (invoice.world_id !== null || !invoice.order_id || invoice.status !== 'FINALIZED') return;
    this.control.db.prepare("UPDATE orders SET status='PAID',paid_at=? WHERE order_id=? AND invoice_id=? AND status!='PAID'")
      .run(invoice.paid_at, invoice.order_id, invoice.invoice_id);
  };
  constructor(readonly control: WorldRegistryStore, readonly payments: PaymentService) {
    migratePublicProducts(control.db);
    control.db.transaction(() => {
      control.db.exec(`CREATE TABLE IF NOT EXISTS public_site_config(id INTEGER PRIMARY KEY CHECK(id=1),config_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS public_products(product_id TEXT PRIMARY KEY,product_enabled INTEGER NOT NULL CHECK(product_enabled IN (0,1)),
          product_name_en TEXT NOT NULL,product_name_zh TEXT NOT NULL,product_description_en TEXT NOT NULL,product_description_zh TEXT NOT NULL,
          product_price TEXT,product_currency TEXT NOT NULL CHECK(product_currency='USDT'));
        CREATE TABLE IF NOT EXISTS orders(order_id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES public_products(product_id),product_name_snapshot TEXT NOT NULL,
          customer_name TEXT NOT NULL,customer_contact TEXT NOT NULL,customer_requirement TEXT NOT NULL,amount TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency='USDT'),
          status TEXT NOT NULL CHECK(status IN ('PENDING','AWAITING_PAYMENT','PAID','CANCELLED')),invoice_id TEXT UNIQUE,created_at INTEGER NOT NULL,paid_at INTEGER,
          public_order_token TEXT NOT NULL UNIQUE,rail_id TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL);`);
      control.db.prepare('INSERT OR IGNORE INTO public_site_config VALUES(1,?,?)').run(JSON.stringify(defaults), Date.now());
      for(const id of ['custom-service','product-2'])control.db.prepare("INSERT OR IGNORE INTO public_products VALUES(?,0,'','','','',NULL,'USDT')").run(id);
    });
    payments.onFinalized = this.finalized;
    this.reconcile(true);
  }
  close() { if (this.payments.onFinalized === this.finalized) this.payments.onFinalized = undefined; }
  site() { return JSON.parse(String(this.control.db.prepare('SELECT config_json FROM public_site_config WHERE id=1').get()!.config_json)) as typeof defaults; }
  product(enabledOnly = true, id = 'custom-service') {
    const row = this.control.db.prepare(`SELECT * FROM public_products WHERE product_id=?${enabledOnly ? ' AND product_enabled=1' : ''}`).get(id);
    if (!row) throw new PublicError('PRODUCT_NOT_AVAILABLE', 404);
    return row;
  }
  products() { return { items: this.control.db.prepare('SELECT * FROM public_products ORDER BY rowid').all() }; }
  rails() { return this.payments.rails().filter(r => r.status === 'ENABLED').map(r => ({ rail_id: r.rail_id, chain: r.chain, asset: r.asset })); }
  settings() {
    return { ...this.site(), ...this.product(false), updated_at: this.control.db.prepare('SELECT updated_at FROM public_site_config WHERE id=1').get()!.updated_at };
  }
  configure(value: unknown) {
    const input = fields(value, [...Object.keys(defaults), ...productKeys]);
    const site = Object.fromEntries(Object.keys(defaults).map(key => [key, text(input[key], key === 'site_name' ? 100 : key === 'github_url' ? 500 : 4000, key !== 'github_url' && !key.startsWith('contact_text'))]));
    if(Boolean(site.contact_text_en)!==Boolean(site.contact_text_zh))throw new PublicError('BILINGUAL_CONTENT_REQUIRED');
    if (site.github_url) {
      let url: URL; try { url = new URL(site.github_url!); } catch { throw new PublicError('INVALID_GITHUB_URL'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.hostname !== 'github.com') throw new PublicError('INVALID_GITHUB_URL');
    }
    const product = productKeys.some(key=>Object.hasOwn(input,key)) ? this.productSettings(input) : undefined;
    this.control.db.transaction(() => {
      this.control.db.prepare('UPDATE public_site_config SET config_json=?,updated_at=? WHERE id=1').run(JSON.stringify(site), Date.now());
      if(product)this.updateProduct('custom-service',product);
    });
    return this.settings();
  }
  private productSettings(input:Record<string,unknown>){
    if(typeof input.product_enabled!=='boolean'||input.product_currency!=='USDT')throw new PublicError('INVALID_PRODUCT_SETTINGS');
    const enabled=input.product_enabled;
    const names=[text(input.product_name_en,200,enabled),text(input.product_name_zh,200,enabled)];
    const descriptions=[text(input.product_description_en,4000,enabled),text(input.product_description_zh,4000,enabled)];
    if(Boolean(names[0])!==Boolean(names[1])||Boolean(descriptions[0])!==Boolean(descriptions[1]))throw new PublicError('BILINGUAL_CONTENT_REQUIRED');
    let price:string|null=null;
    if(input.product_price!==''&&input.product_price!==null){try{price=quotedAmount(input.product_price);}catch{throw new PublicError('INVALID_PRODUCT_PRICE');}}
    if(enabled&&(!price||!this.rails().length))throw new PublicError('PRICE_AND_PAYMENT_RAIL_REQUIRED');
    return {enabled,names,descriptions,price};
  }
  private updateProduct(id:string,product:ReturnType<PublicStore['productSettings']>){
    this.control.db.prepare("UPDATE public_products SET product_enabled=?,product_name_en=?,product_name_zh=?,product_description_en=?,product_description_zh=?,product_price=?,product_currency='USDT' WHERE product_id=?")
      .run(product.enabled?1:0,product.names[0]!,product.names[1]!,product.descriptions[0]!,product.descriptions[1]!,product.price,id);
  }
  configureProduct(id:string,value:unknown){
    this.product(false,id);const input=fields(value,productKeys),product=this.productSettings(input);
    this.updateProduct(id,product);return this.product(false,id);
  }
  addProduct(value:unknown){
    fields(value,[]);const id='product_'+randomUUID();
    this.control.db.prepare("INSERT INTO public_products VALUES(?,0,'','','','',NULL,'USDT')").run(id);
    return this.product(false,id);
  }
  createOrder(value: unknown) {
    const input = fields(value, ['product_id', 'customer_name', 'customer_contact', 'customer_requirement', 'rail_id', 'idempotency_key', 'language']);
    if (typeof input.product_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(input.product_id) || !['en', 'zh-CN'].includes(String(input.language))) throw new PublicError('INVALID_CHECKOUT_INPUT');
    const requestKey = text(input.idempotency_key, 128);
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(requestKey)) throw new PublicError('INVALID_CHECKOUT_KEY');
    const customer = { name: text(input.customer_name, 120), contact: text(input.customer_contact, 320), requirement: text(input.customer_requirement, 4000) };
    const railId = text(input.rail_id, 100), requestHash = hash({ product: input.product_id, language: input.language, railId, customer });
    const order = this.control.db.transaction(() => {
      const old = this.control.db.prepare('SELECT * FROM orders WHERE request_key=?').get(requestKey);
      if (old) { if (old.request_hash !== requestHash) throw new PublicError('ORDER_IDEMPOTENCY_CONFLICT', 409); return old; }
      const product = this.product(true,String(input.product_id));
      if (!this.rails().some(r => r.rail_id === railId)) throw new PublicError('PAYMENT_RAIL_NOT_AVAILABLE', 409);
      const id = 'order_' + randomUUID(), token = randomBytes(32).toString('hex');
      this.control.db.prepare("INSERT INTO orders VALUES(?,?,?,?,?,?,?,'USDT','PENDING',NULL,?,NULL,?,?,?,?)")
        .run(id, String(input.product_id), input.language === 'en' ? product.product_name_en : product.product_name_zh,
          customer.name, customer.contact, customer.requirement, product.product_price, Date.now(), token, railId, requestKey, requestHash);
      return this.control.db.prepare('SELECT * FROM orders WHERE order_id=?').get(id)!;
    });
    this.ensureInvoice(order);
    return { order_id: order.order_id, public_order_token: order.public_order_token };
  }
  private ensureInvoice(order: Record<string, any>) {
    if (order.invoice_id || order.status === 'CANCELLED') return;
    if (Number(order.created_at) + 86400000 <= Date.now()) {
      this.control.db.prepare("UPDATE orders SET status='CANCELLED' WHERE order_id=? AND status='PENDING'").run(order.order_id); return;
    }
    const invoice = this.payments.createInstanceInvoice({ order_id: order.order_id, rail_id: order.rail_id,
      amount: order.amount, expires_at: Number(order.created_at) + 86400000, idempotency_key: String(order.order_id) });
    this.control.db.prepare("UPDATE orders SET invoice_id=?,status='AWAITING_PAYMENT' WHERE order_id=? AND invoice_id IS NULL AND status='PENDING'").run(invoice.invoice_id, order.order_id);
    if (invoice.status === 'FINALIZED') this.finalized(invoice);
  }
  reconcile(recoverPending = false) {
    for (const order of recoverPending ? this.control.db.prepare("SELECT * FROM orders WHERE status='PENDING'").all() : []) {
      try { this.ensureInvoice(order); } catch (error) { if (!(error instanceof Error) || error.message !== 'PAYMENT_RAIL_NOT_ENABLED') throw error; }
    }
    for (const invoice of this.payments.db.prepare("SELECT invoice_id FROM payment_invoices WHERE world_id IS NULL AND order_id IS NOT NULL AND status='FINALIZED'").all()) this.finalized(this.payments.invoice(String(invoice.invoice_id)));
    for (const order of this.control.db.prepare('SELECT order_id,invoice_id,amount FROM orders WHERE invoice_id IS NOT NULL').all()) {
      const invoice = this.payments.invoice(String(order.invoice_id));
      if (invoice.world_id !== null || invoice.qianji_id !== null || invoice.order_id !== order.order_id || invoice.quoted_amount !== order.amount) throw new Error('PUBLIC_ORDER_INVOICE_CONFLICT');
      if (invoice.cancelled_at || ['CANCELLED','EXPIRED'].includes(invoice.status)) this.control.db.prepare("UPDATE orders SET status='CANCELLED' WHERE order_id=? AND status!='PAID'").run(order.order_id);
    }
  }
  payment(id: string, token: unknown) {
    if (!/^order_[a-f0-9-]{36}$/.test(id) || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new PublicError('ORDER_NOT_FOUND', 404);
    const order = this.control.db.prepare('SELECT * FROM orders WHERE order_id=?').get(id);
    if (!order || !timingSafeEqual(Buffer.from(String(order.public_order_token)), Buffer.from(token))) throw new PublicError('ORDER_NOT_FOUND', 404);
    const current = this.control.db.prepare('SELECT * FROM orders WHERE order_id=?').get(id)!;
    if (!current.invoice_id) throw new PublicError('ORDER_PAYMENT_UNAVAILABLE', 409);
    const invoice = this.payments.invoice(String(current.invoice_id));
    if (invoice.status === 'FINALIZED') this.finalized(invoice);
    if (invoice.cancelled_at || ['CANCELLED','EXPIRED'].includes(invoice.status)) this.control.db.prepare("UPDATE orders SET status='CANCELLED' WHERE order_id=? AND status!='PAID'").run(id);
    const status = this.control.db.prepare('SELECT status FROM orders WHERE order_id=?').get(id)!.status;
    return { order_id: id, status, invoice_status: invoice.status === 'FINALIZED' ? 'PAID' : invoice.status,
      chain: invoice.chain, amount: tokenAmount(invoice.amount_atomic, invoice.decimals), quoted_amount: invoice.quoted_amount,
      currency: 'USDT', recipient_address: invoice.recipient_address, token_contract: invoice.mint,
      qr_payload: invoice.qr_payload, wallet_url: invoice.wallet_url, expires_at: invoice.expires_at, paid_at: invoice.paid_at ?? null };
  }
  overview() {
    this.reconcile();
    return { settings: this.settings(), products:this.products().items, rails: this.rails(), revenue: this.payments.revenue(null),
      orders: this.control.db.prepare('SELECT order_id,product_name_snapshot,customer_name,customer_contact,customer_requirement,amount,currency,status,invoice_id,created_at,paid_at FROM orders ORDER BY created_at DESC LIMIT 200').all() };
  }
}
