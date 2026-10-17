import type { FastifyInstance } from 'fastify';
import type { CoreStore } from '@emergentinc/persistence';
import type { RunService } from '../services/run_service.js';
export interface ApiRoutesOptions { coreStore: CoreStore; runService: RunService }
/** In-process recovery only; no listening socket or manual runtime workbench. */
export async function registerApiRoutes(server: FastifyInstance, { coreStore, runService }: ApiRoutesOptions) {
  server.post('/run/recovery/resolve', async (req, reply) => {
    if (runService.getStatus().running) return reply.status(409).send({ detail: 'RUN_IN_PROGRESS' });
    const body = req.body as any;
    if (!body || Object.keys(body).some(k=>!['kind','id','decision','reason','actualTokens','costCny','idempotencyKey'].includes(k)) || !['model', 'tool', 'run', 'message'].includes(body.kind) || typeof body.id !== 'string' || !body.id || !['confirm_not_billed', 'settle_billed', 'settle_reserved', 'abandon', 'acknowledge'].includes(body.decision) || typeof body.reason !== 'string' || body.reason.trim().length < 8 || body.reason.length>1000) return reply.status(400).send({ detail: 'RECOVERY_EXPLICIT_EVIDENCE_REQUIRED' });
    try { return coreStore.resolveRecoveryOperation(body); } catch (error) { return reply.status(409).send({ detail: (error as Error).message }); }
  });
}
