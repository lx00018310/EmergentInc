import { SqliteDatabase } from "../sqlite/db.js";
import { ModelCallRecord, PixelStepCost } from "@emergentinc/protocol";

export class ModelCallRepository {
  constructor(private db: SqliteDatabase) {}

  public recordModelCall(record: ModelCallRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO model_calls (
        call_id, run_id, pixel_id, message_id, round_num, model, pricing_revision,
        prompt_hash, raw_response, normalized_response, prompt_tokens,
        completion_tokens, cached_tokens, actual_tokens, cost_cny, tool_cost, outcome, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.callId,
      record.runId,
      record.pixelId,
      record.messageId ?? null,
      record.roundNum ?? 0,
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
      record.toolCost ?? 0.0,
      record.outcome,
      record.createdAt
    );
  }

  public getModelCall(callId: string): ModelCallRecord | null {
    const stmt = this.db.prepare("SELECT * FROM model_calls WHERE call_id = ?");
    const row = stmt.get(callId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  public getLatestByMessageId(messageId: string): ModelCallRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM model_calls
      WHERE message_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `);
    const row = stmt.get(messageId) as any;
    if (!row) return null;
    return this.mapRow(row);
  }

  private mapRow(row: any): ModelCallRecord {
    return {
      callId: row.call_id,
      runId: row.run_id,
      pixelId: row.pixel_id,
      messageId: row.message_id,
      roundNum: Number(row.round_num || 0),
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
      toolCost: Number(row.tool_cost || 0),
      outcome: row.outcome,
      createdAt: Number(row.created_at),
    };
  }

  public countByRunId(runId: string): number {
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM model_calls WHERE run_id = ?");
    const row = stmt.get(runId) as any;
    return Number(row?.count ?? 0);
  }

  public getPixelStepCosts(pixelId: string): PixelStepCost[] {
    const stmt = this.db.prepare(`
      SELECT pixel_id, round_num, prompt_tokens, cached_tokens, completion_tokens, actual_tokens, cost_cny, tool_cost
      FROM model_calls
      WHERE pixel_id = ? AND outcome = 'SUCCESS'
      ORDER BY created_at ASC
    `);
    const rows = stmt.all(pixelId) as any[];
    return rows.map((r) => ({
      pixelId: r.pixel_id,
      round: Number(r.round_num || 0),
      inputTokens: Number(r.prompt_tokens || 0),
      cachedInputTokens: Number(r.cached_tokens || 0),
      outputTokens: Number(r.completion_tokens || 0),
      actualTokens: Number(r.actual_tokens || 0),
      modelCost: Number(r.cost_cny || 0),
      toolCost: Number(r.tool_cost || 0),
    }));
  }
}
