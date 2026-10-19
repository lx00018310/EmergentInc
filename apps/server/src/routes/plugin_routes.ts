import type { FastifyInstance } from 'fastify';
import { exactKeys } from '../services/owner_goal_service.js';
import type { CompanyPluginService } from '../services/company_plugin_service.js';

/** Narrow plugin routes: read-only card library, exact card actions, hashed assets and the typed data bridge. */
export function registerPluginRoutes(app: FastifyInstance, plugins: CompanyPluginService) {
  app.get('/owner/plugins/cards', req => {
    const visible = (req.query as any)?.visible;
    return { items: visible === 'true' ? plugins.cards(true) : plugins.cards() };
  });
  app.get<{ Params: { id: string } }>('/owner/plugins/cards/:id', req => plugins.card(req.params.id));
  app.post<{ Params: { id: string } }>('/owner/plugins/cards/:id/actions', req => {
    const input = req.body as any; exactKeys(input, ['action', 'expectedRevision', 'idempotencyKey']);
    return plugins.action(req.params.id, input as { action: 'show' | 'hide' | 'rollback'; expectedRevision: number; idempotencyKey: string });
  });
  app.get<{ Params: { pluginId: string; hash: string; name: string } }>('/owner/plugins/:pluginId/versions/:hash/assets/:name', async (req, reply) => {
    const { bytes, contentType, csp } = plugins.asset(req.params.pluginId, req.params.hash, req.params.name);
    if (contentType.startsWith('text/html')) reply.header('Content-Security-Policy', csp).header('X-Frame-Options', 'SAMEORIGIN');
    else reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return reply.type(contentType).send(bytes);
  });
  app.post<{ Params: { pluginId: string } }>('/owner/plugins/:pluginId/data', req => {
    const input = req.body as any; exactKeys(input, ['resource', 'cardId', 'version', 'nonce']);
    return plugins.project(req.params.pluginId, input.resource, { cardId: input.cardId, version: input.version });
  });
}
