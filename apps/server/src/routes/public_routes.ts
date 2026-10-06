import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { PublicError, PublicStore } from '../services/public_store.js';

export function isAnonymousStoreRoute(method: string, path: string) {
  return method === 'GET' && ['/api/public/site', '/api/public/products', '/api/public/payment-rails'].includes(path) ||
    method === 'GET' && /^\/api\/public\/products\/[a-zA-Z0-9_-]{1,100}$/.test(path) ||
    method === 'POST' && path === '/api/public/orders' || method === 'GET' && /^\/api\/public\/orders\/order_[a-f0-9-]{36}\/payment$/.test(path);
}
export function registerPublicRoutes(app: FastifyInstance, store: PublicStore) {
  const attempts = new Map<string, { start: number; count: number }>();
  app.get('/api/public/site', async () => store.site());
  app.get('/api/public/products', async () => store.products());
  app.get<{Params:{id:string}}>('/api/public/products/:id', async req => store.product(false,req.params.id));
  app.get('/api/public/payment-rails', async () => ({ items: store.rails() }));
  app.post('/api/public/orders', { bodyLimit: 16000 }, async (req, reply) => {
    const now = Date.now();
    for (const [ip, attempt] of attempts) if (now - attempt.start >= 60000) attempts.delete(ip);
    const attempt = attempts.get(req.ip) ?? { start: now, count: 0 }; attempts.set(req.ip, attempt);
    if (++attempt.count > 10) throw new PublicError('CHECKOUT_RATE_LIMITED', 429);
    try { return reply.code(201).send(store.createOrder(req.body)); }
    catch (error) { if (error instanceof PublicError) throw error; req.log.error(error); throw new PublicError('CHECKOUT_UNAVAILABLE', 503); }
  });
  app.get<{ Params: { id: string } }>('/api/public/orders/:id/payment', async req => {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const payment = store.payment(req.params.id, token);
    return { ...payment, qr_data_url: await QRCode.toDataURL(payment.qr_payload, { width: 280, errorCorrectionLevel: 'M' }) };
  });
  app.get('/api/public-site', async () => store.overview());
  app.put('/api/public-site', async req => store.configure(req.body));
  app.post('/api/public-site/products', async req => store.addProduct(req.body));
  app.put<{Params:{id:string}}>('/api/public-site/products/:id', async req => store.configureProduct(req.params.id,req.body));
}
