import type { ToolRegistry, ToolContext } from '@emergentinc/tools';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import type { PaymentService } from './payment_service.js';
import { listSkills, readSkill } from './skill_library.js';
export function registerWorldTools(registry: ToolRegistry, worldId: string, manager: WorldRuntimeManager, release: string, payments: PaymentService) {
  const register = (name: string, description: string, effect: 'read' | 'write', properties: Record<string, unknown>, required: string[], handler: (args: any, ctx: ToolContext) => unknown | Promise<unknown>) => {
    registry.register({ name, description, effect, enabled: true, timeout_seconds: 30, input_schema: { type: 'object', properties, required, additionalProperties: false } }, async (args, ctx) => {
      if (ctx.workspaceRoot !== manager.registry.directory(worldId)) throw new Error('WORLD_TOOL_CONTEXT_CONFLICT');
      return { operation_id: ctx.operationId, tool: name, status: 'SUCCESS', output: await handler(args, ctx), duration_ms: 0, truncated: false, costCny: 0 };
    });
  };
  const extensions = async (ctx: ToolContext) => { const runtime = await manager.open(worldId); if (!runtime.store.pixels.getPixelAccount(ctx.pixelId)?.active) throw new Error('EXTENSION_ACTOR_INVALID'); return manager.extensions(worldId); };
  register('LIST_EXTENSIONS', 'List private verified programs and their current revision.', 'read', {}, [], async (_a, ctx) => (await extensions(ctx)).list());
  register('RUN_EXTENSION', 'Run a private pure JSON program without network, file or credential access.', 'read', { id: { type: 'string' }, input: {} }, ['id', 'input'], async (a, ctx) => (await extensions(ctx)).run(a.id, a.input));
  register('SUBMIT_EXTENSION', 'Validate a private pure JSON program. Activation binds the expected revision and hash.', 'write', { manifest: { type: 'object' }, expectedRevision: { type: 'integer' }, expectedHash: { type: ['string', 'null'] } }, ['manifest', 'expectedRevision', 'expectedHash'], async (a, ctx) => {
    const service = await extensions(ctx), saved = service.submit(ctx.pixelId, a.manifest);
    return saved.supported ? service.action(saved.id, { action: 'activate', hash: saved.hash, expectedRevision: a.expectedRevision, expectedHash: a.expectedHash, idempotencyKey: ctx.operationId }) : saved;
  });
  register('SET_EXTENSION_STATE', 'Activate, disable or roll back a private program using its exact revision and hash.', 'write', { id: { type: 'string' }, action: { type: 'string', enum: ['activate', 'disable', 'rollback'] }, hash: { type: 'string' }, expectedRevision: { type: 'integer' }, expectedHash: { type: ['string', 'null'] } }, ['id', 'action', 'expectedRevision', 'expectedHash'], async (a, ctx) => { const { id, ...input } = a; return (await extensions(ctx)).action(id, { ...input, idempotencyKey: ctx.operationId }); });
  register('LIST_SKILLS', 'List available working methods. Skills grant no extra permissions.', 'read', {}, [], (_a, ctx) => listSkills(ctx, release));
  register('READ_SKILL', 'Read one method from the scoped Skill catalog.', 'read', { ref: { type: 'string' } }, ['ref'], (a, ctx) => readSkill(ctx, release, a.ref));
  register('LIST_PAYMENT_RAILS', 'List enabled receive-only USDT rails and public recipient addresses.', 'read', {}, [], () => payments.rails().filter(r => r.status === 'ENABLED').map(r => ({ rail_id: r.rail_id, chain: r.chain, asset: r.asset, mint: r.mint, decimals: r.decimals, recipient_address: r.recipient_address })));
}
