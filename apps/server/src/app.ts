import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { registerWorldRoutes, type WorldRouteServices } from './routes/world_routes.js';
import { registerOwnerAuth, type OwnerAuthOptions } from './owner_auth.js';
import { PublicStore } from './services/public_store.js';
import { registerPublicRoutes } from './routes/public_routes.js';
import { OwnerOverviewService } from './services/owner_overview_service.js';
import { OwnerChatService } from './services/owner_chat_service.js';
import { registerOwnerRoutes } from './routes/owner_routes.js';
import { registerPluginRoutes } from './routes/plugin_routes.js';
import { CompanyPluginService } from './services/company_plugin_service.js';
import { OwnerWorkService } from './services/owner_work_service.js';
import { OwnerAutomationGate } from './services/owner_automation_gate.js';
import { OwnerGoalScheduler } from './services/owner_goal_scheduler.js';
import { OwnerProductService } from './services/owner_product_service.js';

export interface CompanyMaintenance { generation: string; geneHash: string; quiesced: () => boolean; switching: () => boolean; quiesce: () => Promise<void>; resume: () => Promise<void> }
export interface CreateServerOptions {
  worlds: WorldRouteServices; workspaceRoot: string; instanceId?: string; maintenance?: CompanyMaintenance;
  ownerAuth?: OwnerAuthOptions; trustLoopbackProxy?: boolean; frontendDistDir?: string; development?: boolean; allowedOrigins?: string[]; ownerUpgradeOrigin?: string;
}
export async function createServer(options: CreateServerOptions): Promise<FastifyInstance> {
  const app = fastify({ logger: false, trustProxy: options.trustLoopbackProxy ? ['127.0.0.1', '::1'] : false });
  const allowed = new Set(options.development ? options.allowedOrigins ?? [] : []);
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.headers.host}` && !allowed.has(origin) || !origin && req.headers['sec-fetch-site'] === 'cross-site') return reply.status(403).send({ detail: 'ORIGIN_FORBIDDEN' });
  });
  await app.register(cors, { origin: (origin, cb) => cb(null, Boolean(origin && allowed.has(origin))), methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  registerOwnerAuth(app, options.ownerAuth, 'boss', true);
  const { manager, payments } = options.worlds, gate = manager.automation ?? new OwnerAutomationGate(manager.registry.control);
  manager.attachAutomation(gate, () => Boolean(options.maintenance?.quiesced()));
  const work = options.worlds.ownerWork ?? new OwnerWorkService(manager, () => Boolean(options.maintenance?.quiesced()));
  const plugins = work.plugins ?? new CompanyPluginService(manager.registry.control, options.workspaceRoot); work.plugins = plugins;
  const store = new PublicStore(payments.control, payments); registerPublicRoutes(app, store);
  work.products = new OwnerProductService(store, gate, manager);
  const scheduler = new OwnerGoalScheduler(manager, work, gate, payments);
  const ready = () => !work.hasFailure() && (Boolean(work.worker) || !manager.list().some(w => w.runtimeFailure));
  const overview = new OwnerOverviewService(options.worlds, work, store, options.instanceId);
  const chat = manager.options.projectRoot && manager.options.isModelConfigured ? new OwnerChatService({ projectRoot: manager.options.projectRoot, workspaceRoot: options.workspaceRoot, store: manager.registry.control,
    provider: gate.provider(manager.options.provider, manager.options.usageMeter), usageMeter: manager.options.usageMeter, modelName: manager.options.modelName, isModelConfigured: true,
    snapshot: async () => ({ data: await overview.overview(), sources: ['owner_goals', 'owner_company_budget', 'owner_work_tasks', 'world_revenue_events', 'orders'] }) }) : undefined;
  if (!options.worlds.ownerWork) { const previous = manager.options.configureTools; manager.options.configureTools = (id, tools) => { previous?.(id, tools); work.registerTools(tools, id); }; }
  app.addHook('onReady', async () => { work.start(); scheduler.start(); });
  app.addHook('onClose', async () => { await scheduler.close(); await work.close(); store.close(); });
  app.addHook('preHandler', async (req, reply) => {
    const route=req.url.split('?')[0]!,command=String((req.body as any)?.question??'').trim().replace(/[。.!！]+$/,'');
    if(route==='/api/owner/chat'&&/^(?:先|请)?(?:暂停|暂停公司|停止运行|暂停自动经营)$|^(?:please )?(?:pause|pause company|stop running)$|^(?:公司状态|任务进度|查看任务|查看预算|company status|task status|show budget)$/i.test(command))return;
    if (!options.maintenance?.switching() || req.method === 'GET' || ['/api/login', '/api/logout', '/api/owner/automation', '/api/maintenance/quiesce', '/api/maintenance/checkpoint', '/api/maintenance/resume'].includes(req.url.split('?')[0]!)) return;
    return reply.status(409).send({ detail: 'EVOLUTION_QUIESCED' });
  });
  app.get('/health/live', () => ({ alive: true, processId: process.pid }));
  app.get('/health/ready', (_req, reply) => reply.status(ready() ? 200 : 503).send({ ready: ready(), mode: 'boss', version: 'boss-afk-v34', generation: options.maintenance?.generation ?? manager.registry.effectiveGeneration().id, geneHash: options.maintenance?.geneHash ?? manager.registry.effectiveGeneration().gene_hash }));
  app.addHook('onSend', async (_req, reply) => { reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store').header('Content-Security-Policy', "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"); });
  await app.register(async api => {
    await registerWorldRoutes(api, {...options.worlds,ownerWork:work});
    registerOwnerRoutes(api, overview, chat, work, gate, options.maintenance, plugins);
    registerPluginRoutes(api, plugins);
    if (options.maintenance) {
      api.post('/maintenance/quiesce', async () => { await options.maintenance!.quiesce(); return { quiesced: true }; });
      api.post('/maintenance/resume', async () => { await options.maintenance!.resume(); return { quiesced: false }; });
      api.post('/maintenance/checkpoint', async () => {
        if (!options.maintenance!.quiesced() || manager.list().some(w => w.running) || work.worker?.snapshots().some(a=>work.worker!.isRunning(String(a.id)))) throw new Error('MAINTENANCE_NOT_QUIESCED');
        manager.registry.control.event('release_checkpoint', '', { generation: options.maintenance!.generation }); return { quiesced: true };
      });
    }
  }, { prefix: '/api' });
  const dist = options.frontendDistDir ?? path.resolve(import.meta.dirname, '../../../frontend/dist');
  if (fs.existsSync(dist)) await app.register(fastifyStatic, { root: dist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => req.url.startsWith('/api') ? reply.status(404).send({ detail: 'ROUTE_NOT_FOUND' }) : fs.existsSync(dist) ? reply.sendFile('index.html') : reply.status(503).send('FRONTEND_BUILD_REQUIRED'));
  app.setErrorHandler((error: any, _req, reply) => reply.status(error.statusCode || 500).send({ detail: error.message || String(error) }));
  return app;
}
