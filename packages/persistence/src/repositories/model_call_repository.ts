import { SqliteDatabase } from "../sqlite/db.js";
import { ModelCallRecord, PixelStepCost, CostSummary } from "@emergentinc/protocol";

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
      record.roundNum ?? null,
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
      roundNum: row.round_num == null ? null : Number(row.round_num),
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

  public countInvalidResponses(messageId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS count FROM model_calls WHERE message_id = ? AND outcome = 'MODEL_RESPONSE_INVALID'"
    ).get(messageId) as any;
    return Number(row?.count ?? 0);
  }

  /**
   * 真实台账成本汇总。任何组成未知（NULL）时整体未知，不补估算、不当作 0。
   * 注意：SQLite SUM 会忽略 NULL，因此必须用 unknown 计数判定未知，不能依赖 SUM 结果。
   */
  public getCostSummary(): CostSummary {
    const row = this.db.prepare(`
      SELECT
        SUM(cost_cny) AS model_cost,
        COUNT(*) AS model_count,
        SUM(CASE WHEN cost_cny IS NULL THEN 1 ELSE 0 END) AS unknown_model_count
      FROM model_calls
    `).get() as any;
    const tool = this.db.prepare(`
      SELECT
        (SELECT SUM(cost_cny) FROM tool_executions) AS tool_cost,
        (SELECT COUNT(*) FROM tool_executions WHERE cost_cny IS NULL) AS unknown_tool_count
    `).get() as any;
    const unknownModelCount = Number(row?.unknown_model_count ?? 0);
    const unknownToolCount = Number(tool?.unknown_tool_count ?? 0);
    // SUM ignores NULL rows, so a partial-sum result must still be treated as unknown.
    const modelCostCny = unknownModelCount > 0 ? null : (row?.model_cost == null ? 0 : Number(row.model_cost));
    const toolCostCny = unknownToolCount > 0 ? null : (tool?.tool_cost == null ? 0 : Number(tool.tool_cost));
    const totalCostCny = modelCostCny === null || toolCostCny === null ? null : modelCostCny + toolCostCny;
    const knownCostCny = (row?.model_cost == null ? 0 : Number(row.model_cost))
      + (tool?.tool_cost == null ? 0 : Number(tool.tool_cost));
    return { totalCostCny, knownCostCny, modelCostCny, toolCostCny, unknownModelCount, unknownToolCount };
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
      callId: r.call_id,
      runId: r.run_id,
      outcome: r.outcome,
      round: r.round_num == null ? null : Number(r.round_num),
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
