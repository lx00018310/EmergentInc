import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import type { WorldRuntimeManager } from '../services/world_runtime_manager.js';
import type { PaymentService } from '../services/payment_service.js';
import type { PaymentMonitor } from '../services/payment_monitor.js';
import { USDT_CHAINS, paymentChain, recipientAddress } from '../services/payment_assets.js';
import type { OwnerWorkService } from '../services/owner_work_service.js';

export interface WorldRouteServices { manager: WorldRuntimeManager; payments: PaymentService; monitor: PaymentMonitor; modelName: string; ownerWork?: OwnerWorkService }
export async function registerWorldRoutes(app: FastifyInstance, services: WorldRouteServices) {
  const { manager, payments, monitor } = services, control = manager.registry.control;
  app.get('/payments/rails', () => ({ items: payments.rails(), chains: USDT_CHAINS, monitor: monitor.status() }));
  app.put('/payments/rails', async req => {
    const input = req.body as any;
    if (!input || input.network !== 'mainnet' || Object.keys(input).some(k => !['rail_id', 'chain', 'network', 'recipient_address', 'status', 'expected_revision', 'rpc_id'].includes(k))) throw new Error('PAYMENT_RAIL_CONFIG_INVALID');
    const chain = paymentChain(input.chain); recipientAddress(chain, input.recipient_address);
    return payments.configureRail(input, input.status === 'ENABLED' ? await monitor.validateRecipient(chain, input.recipient_address) : 0);
  });
  app.post('/payments/invoices', req => payments.createInvoice(req.body as any));
  app.get('/payments/invoices', req => { const id = (req.query as any)?.world_id; if (id) control.world(id); return { items: payments.db.prepare(`SELECT * FROM payment_invoices ${id ? 'WHERE world_id=?' : ''} ORDER BY created_at DESC LIMIT 200`).all(...(id ? [id] : [])) }; });
  app.get<{ Params: { id: string } }>('/payments/invoices/:id', req => payments.invoice(req.params.id));
  app.get<{ Params: { id: string } }>('/payments/invoices/:id/qr', async (req, reply) => reply.type('image/png').send(await QRCode.toBuffer(payments.invoice(req.params.id).qr_payload, { width: 320, errorCorrectionLevel: 'M' })));
  app.post<{ Params: { id: string } }>('/payments/invoices/:id/scan', async req => { await monitor.scanInvoice(req.params.id); return payments.invoice(req.params.id); });
  app.get('/payments/unmatched', () => ({ items: payments.db.prepare('SELECT * FROM payment_unmatched ORDER BY created_at DESC LIMIT 200').all() }));
  app.post<{ Params: { id: string } }>('/payments/invoices/:id/cancel', req => {
    payments.invoice(req.params.id); const result = payments.db.prepare("UPDATE payment_invoices SET status='CANCELLED',cancelled_at=? WHERE invoice_id=? AND status='WAITING'").run(Date.now(), req.params.id);
    if (!result.changes) throw new Error('INVOICE_NOT_CANCELLABLE'); return payments.invoice(req.params.id);
  });
  app.get('/owner/recovery', () => ({ items: services.ownerWork?.legacy?.reviews() ?? manager.list().flatMap(row => { const runtime = manager.peek(row.world_id); return runtime ? [{ worldId: row.world_id, status: runtime.run.getStatus() }] : []; }) }));
  app.post<{ Params: { id: string } }>('/owner/recovery/:id', async (req, reply) => {
    const runtime = await manager.open(req.params.id);
    const response = await runtime.api.inject({ method: 'POST', url: '/api/run/recovery/resolve', payload: req.body as any });
    if(response.statusCode<400)manager.automation?.reconcileWorld(runtime.store,req.params.id);
    return reply.status(response.statusCode).type('application/json').send(response.rawPayload);
  });
}
