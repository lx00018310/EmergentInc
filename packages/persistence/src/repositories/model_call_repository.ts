import { SqliteDatabase } from "../sqlite/db.js";
import { ModelCallRecord } from "@emergentinc/protocol";

export class ModelCallRepository {
  constructor(private db: SqliteDatabase) {}

  public recordModelCall(record: ModelCallRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO model_calls (
        call_id, run_id, pixel_id, message_id, model, pricing_revision,
        prompt_hash, raw_response, normalized_response, prompt_tokens,
        completion_tokens, cached_tokens, actual_tokens, cost_cny, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.callId,
      record.runId,
      record.pixelId,
      record.messageId ?? null,
      record.model,
      record.pricingRevision ?? null,
      record.promptHash ?? null,
      record.rawResponse ?? null,
      record.normalizedResponse ?? null,
      record.promptTokens,
      record.completionTokens,
      record.cachedTokens,
      record.actualTokens,
      record.costCny,
      record.outcome,
      record.createdAt
    );
  }

  public getModelCall(callId: string): ModelCallRecord | null {
    const stmt = this.db.prepare("SELECT * FROM model_calls WHERE call_id = ?");
    const row = stmt.get(callId) as any;
    if (!row) return null;
    return {
      callId: row.call_id,
      runId: row.run_id,
      pixelId: row.pixel_id,
      messageId: row.message_id,
      model: row.model,
      pricingRevision: row.pricing_revision,
      promptHash: row.prompt_hash,
      rawResponse: row.raw_response,
      normalizedResponse: row.normalized_response,
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      cachedTokens: Number(row.cached_tokens),
      actualTokens: Number(row.actual_tokens),
      costCny: Number(row.cost_cny),
      outcome: row.outcome,
      createdAt: Number(row.created_at),
    };
  }

  public countByRunId(runId: string): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM model_calls WHERE run_id = ?");
    const row = stmt.get(runId) as any;
    return Number(row?.count ?? 0);
  }
}
