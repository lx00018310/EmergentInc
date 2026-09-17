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
      record.toolCost ?? null,
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
      promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
      completionTokens: row.completion_tokens == null ? null : Number(row.completion_tokens),
      cachedTokens: row.cached_tokens == null ? null : Number(row.cached_tokens),
      actualTokens: row.actual_tokens == null ? null : Number(row.actual_tokens),
      costCny: row.cost_cny == null ? null : Number(row.cost_cny),
      toolCost: row.tool_cost == null ? null : Number(row.tool_cost),
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
      SELECT m.*,
        (SELECT COUNT(*) FROM tool_executions t WHERE t.model_call_id = m.call_id) AS tool_count,
        (SELECT COUNT(*) FROM tool_executions t WHERE t.model_call_id = m.call_id AND t.cost_cny IS NULL) AS unknown_tool_count,
        (SELECT SUM(t.cost_cny) FROM tool_executions t WHERE t.model_call_id = m.call_id) AS actual_tool_cost
      FROM model_calls m
      WHERE m.pixel_id = ?
      ORDER BY m.created_at ASC, m.rowid ASC
    `);
    const rows = stmt.all(pixelId) as any[];
    return rows.map((r) => ({
      pixelId: r.pixel_id,
      round: Number(r.round_num || 0),
      inputTokens: r.prompt_tokens == null ? null : Number(r.prompt_tokens),
      cachedInputTokens: r.cached_tokens == null ? null : Number(r.cached_tokens),
      outputTokens: r.completion_tokens == null ? null : Number(r.completion_tokens),
      actualTokens: r.actual_tokens == null ? null : Number(r.actual_tokens),
      modelCost: r.cost_cny == null ? null : Number(r.cost_cny),
      toolCost: r.tool_count > 0
        ? (r.unknown_tool_count > 0 ? null : Number(r.actual_tool_cost))
        : (r.tool_cost == null ? null : Number(r.tool_cost)),
    }));
  }
}
