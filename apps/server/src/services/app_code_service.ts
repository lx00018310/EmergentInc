import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppCodeReport } from '@emergentinc/protocol';
import type { WorldRuntimeManager } from './world_runtime_manager.js';
import { appCodePath, appSourceFile, sourceHash, validateAppPatch } from './app_code_policy.js';

export class AppCodeService {
  constructor(private manager: WorldRuntimeManager, readonly projectRoot: string) {
    manager.registry.control.db.exec(`CREATE TABLE IF NOT EXISTS owner_code_reports(id TEXT PRIMARY KEY, operation_key TEXT UNIQUE NOT NULL, report_json TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  }
  listFiles() {
    const files: string[] = [];
    const walk = (rel: string) => {
      const directory = path.join(this.projectRoot, rel); if (!fs.existsSync(directory)) return;
      for (const name of fs.readdirSync(directory).sort()) {
        const next = `${rel}/${name}`, stat = fs.lstatSync(path.join(this.projectRoot, next));
        if (stat.isSymbolicLink()) continue;
        if (stat.isDirectory()) walk(next);
        else try { appCodePath(next); files.push(next); } catch { /* Protected files are not in the agent catalogue. */ }
      }
    };
    for (const dir of ['apps/server/src', 'apps/server/tests', 'frontend/src', 'frontend/tests', 'packages/model/src', 'packages/model/tests', 'packages/domain/src', 'packages/domain/tests', 'packages/runtime/src', 'packages/runtime/tests', 'packages/tools/src', 'packages/tools/tests', 'resources/prompts']) walk(dir);
    return { files, policy: 'Only 8765 application source. Upgrade, authentication, shared persistence/protocol, dependencies, configuration and this permission boundary are protected. Submission creates a separate source candidate and Owner report; it does not change the running release.' };
  }
  read(name: string) {
    const file = appSourceFile(this.projectRoot, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error('APP_SOURCE_NOT_FOUND');
    if (fs.statSync(file).size > 100000) throw new Error('APP_SOURCE_TOO_LARGE');
    const content = fs.readFileSync(file, 'utf8'); return { path: name, content, baseHash: sourceHash(content) };
  }
  async submit(worldId: string, pixelId: string, input: { title: string; summary: string; files: unknown }, key: string) {
    const db = this.manager.registry.control.db, operationKey = `${worldId}:${key}`;
    const old = db.prepare('SELECT report_json FROM owner_code_reports WHERE operation_key=?').get(operationKey);
    if (old) {
      const report=JSON.parse(String(old.report_json)) as AppCodeReport;
      if(report.pixelId!==pixelId||report.title!==input.title||report.summary!==input.summary||JSON.stringify(report.files)!==JSON.stringify(input.files))throw new Error('IDEMPOTENCY_CONFLICT');
      return {id:report.id,hash:report.hash,title:report.title,state:'REPORTED_TO_OWNER',testing:'Owner must prepare and validate this candidate in the independent upgrade service. Publication requires separate exact-hash approval.'};
    }
    const runtime = await this.manager.open(worldId);
    if (!runtime.store.pixels.getPixelAccount(pixelId)?.active) throw new Error('APP_CODE_ACTOR_INACTIVE');
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 4000) throw new Error('APP_CODE_REPORT_INVALID');
    const files = validateAppPatch(this.projectRoot, input.files), generation = this.manager.registry.effectiveGeneration();
    const id = `code_${randomUUID().replaceAll('-', '')}`;
    const body = { schema: 1 as const, id, worldId, pixelId, personName: this.manager.registry.control.qianji.getProfile(this.manager.registry.control.world(worldId).qianji_id)!.narrative.displayName,
      title: input.title, summary: input.summary, baseGeneration: String(generation.id), baseRelease: String(generation.release_id), files, createdAt: Date.now() };
    const report: AppCodeReport = { ...body, hash: sourceHash(JSON.stringify(body)) };
    const directory = path.join(runtime.directory, 'code-candidates', id);
    fs.mkdirSync(directory, { recursive: true });
    for (const file of files) if (file.content !== null) {
      const target = path.join(directory, 'source', file.path); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, file.content, { flag: 'wx' });
    }
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    db.prepare('INSERT INTO owner_code_reports VALUES(?,?,?,?)').run(id, operationKey, JSON.stringify(report), report.createdAt);
    return { id: report.id, hash: report.hash, title: report.title, state: 'REPORTED_TO_OWNER', testing: 'Owner must prepare and validate this candidate in the independent upgrade service. Publication requires separate exact-hash approval.' };
  }
  reports(): AppCodeReport[] { return this.manager.registry.control.db.prepare('SELECT report_json FROM owner_code_reports ORDER BY created_at DESC LIMIT 30').all().map(r => JSON.parse(String(r.report_json))); }
  get(id: string): AppCodeReport { const row = this.manager.registry.control.db.prepare('SELECT report_json FROM owner_code_reports WHERE id=?').get(id); if (!row) throw new Error('APP_CODE_REPORT_NOT_FOUND'); return JSON.parse(String(row.report_json)); }
}
