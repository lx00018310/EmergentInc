import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type { AppCodeFile, AppCodeReport } from '@emergentinc/protocol';

// This module is used by the independent upgrade service and is itself protected.
const protectedServer = new Set(['owner_auth.ts', 'routes/public_routes.ts', 'services/public_store.ts',
  'services/public_products_migration.ts', 'services/payment_assets.ts', 'services/solana_payment.ts',
  'services/app_code_policy.ts', 'services/app_code_service.ts', 'services/release_maintenance_client.ts']);
export const sourceHash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
export function appCodePath(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_./\-]+$/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..' || /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(p))) throw new Error('APP_CODE_PATH_DENIED');
  // Case-sensitive canonical names also prevent Windows case aliases of protected files.
  const server = value.startsWith('apps/server/src/') && value.endsWith('.ts') && !protectedServer.has(value.slice('apps/server/src/'.length));
  const frontend = /^frontend\/(?:src|tests)\/.+\.(?:ts|tsx|css|svg)$/.test(value);
  const runtime = /^packages\/(?:model|domain|runtime|tools)\/(?:src|tests)\/.+\.ts$/.test(value);
  const tests = /^apps\/server\/tests\/.+\.test\.ts$/.test(value) && !/(?:upgrade|generation|supervisor|migration|release)/i.test(value);
  const prompts = /^resources\/prompts\/[a-zA-Z0-9_-]+\.md$/.test(value);
  if (!(server || frontend || runtime || tests || prompts)) throw new Error('APP_CODE_PATH_DENIED');
  return value;
}
export function appSourceFile(root: string, name: unknown): string {
  const relative = appCodePath(name), absoluteRoot = fs.realpathSync(root);
  let current = absoluteRoot;
  for (const segment of relative.split('/')) {
    if (fs.existsSync(current)) {
      const actual = fs.readdirSync(current).find(n => n.toLowerCase() === segment.toLowerCase());
      if (actual !== undefined && actual !== segment) throw new Error('APP_CODE_PATH_DENIED');
    }
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('APP_CODE_PATH_DENIED');
  }
  return current;
}
export function validateAppPatch(root: string, value: unknown): AppCodeFile[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error('APP_CODE_PATCH_INVALID');
  const names = new Set<string>(); let bytes = 0;
  return value.map(f => {
    if (!f || Object.keys(f).some(k => !['path', 'content', 'baseHash'].includes(k)) || !(f.content === null || typeof f.content === 'string') || !(f.baseHash === null || typeof f.baseHash === 'string' && /^[a-f0-9]{64}$/.test(f.baseHash))) throw new Error('APP_CODE_PATCH_INVALID');
    const file = appSourceFile(root, f.path);
    if (names.has(f.path.toLowerCase())) throw new Error('APP_CODE_PATCH_INVALID'); names.add(f.path.toLowerCase());
    const before = fs.existsSync(file) ? sourceHash(fs.readFileSync(file)) : null;
    if (before !== f.baseHash || f.content === null && before === null) throw new Error('APP_CODE_BASE_CHANGED');
    if (f.content !== null) { bytes += Buffer.byteLength(f.content); if (bytes > 1000000) throw new Error('APP_CODE_PATCH_TOO_LARGE'); }
    if (f.content !== null && sourceHash(f.content) === before) throw new Error('APP_CODE_NO_CHANGE');
    return { path: f.path, content: f.content, baseHash: f.baseHash };
  });
}
export function verifyAppReport(report: AppCodeReport, root: string, generation: string, release: string): void {
  if (!report || Object.keys(report).some(k=>!['schema','id','hash','worldId','pixelId','personName','title','summary','baseGeneration','baseRelease','files','createdAt'].includes(k)) || report.schema !== 1 || !/^code_[a-f0-9]{32}$/.test(report.id) || typeof report.title!=='string'||!report.title.trim()||report.title.length>200||typeof report.summary!=='string'||!report.summary.trim()||report.summary.length>4000) throw new Error('APP_CODE_REPORT_INVALID');
  if(report.baseGeneration !== generation || report.baseRelease !== release) throw new Error('APP_CODE_BASE_CHANGED');
  const { hash, ...body } = report;
  if (sourceHash(JSON.stringify(body)) !== hash) throw new Error('APP_CODE_REPORT_CHANGED');
  validateAppPatch(root, report.files);
}
