import { SqliteDatabase } from "../sqlite/db.js";
import { MessageEnvelope, MessageStatus, EnqueueMessageParams } from "@emergentinc/protocol";

export const MAX_MESSAGES_PER_ROUND = 100;

export class MessageRepository {
  constructor(private db: SqliteDatabase) {}

  public enqueueMessage(params: EnqueueMessageParams): MessageEnvelope {
    const messageId = params.messageId || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = Date.now() / 1000;
    const hop = params.hop ?? 1;
    const status: MessageStatus = params.status ?? "QUEUED";
    const isFeedback = params.isFeedback ? 1 : 0;
    let sourceType = params.sourceType;
    if (!sourceType) {
      if (params.sender === "human") {
        sourceType = "human";
      } else if (params.sender === "system") {
        sourceType = "system";
      } else if (params.isFeedback) {
        sourceType = "feedback";
      } else if (params.sender === "environment") {
        sourceType = "environment";
      } else {
        sourceType = "pixel";
      }
    }

    // 幂等去重：同元胞同内容的未消费 environment 消息或未消费 SELF 消息直接复用，防止队列堆积
    if (
      (sourceType === "environment" || (params.sender === params.recipient && sourceType === "pixel")) &&
      status === "QUEUED"
    ) {
      const existing = this.db.prepare(`
        SELECT * FROM messages
        WHERE recipient = ? AND sender = ? AND content = ? AND status = 'QUEUED'
        LIMIT 1
      `).get(params.recipient, params.sender, params.content) as any;

      if (existing) {
        return this.mapRowToEnvelope(existing);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        message_id, run_id, round_num, hop, sender, recipient, content,
        status, is_feedback, source_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      messageId,
      params.runId ?? null,
      params.roundNum,
      hop,
      params.sender,
      params.recipient,
      params.content,
      status,
      isFeedback,
      sourceType,
      now,
      now
    );

    return {
      messageId,
      runId: params.runId ?? null,
      roundNum: params.roundNum,
      hop,
      sender: params.sender,
      recipient: params.recipient,
      content: params.content,
      status,
      isFeedback: Boolean(isFeedback),
      sourceType,
      createdAt: now,
      updatedAt: now,
    };
  }

  public getMessage(messageId: string): MessageEnvelope | null {
    const stmt = this.db.prepare("SELECT * FROM messages WHERE message_id = ?");
    const row = stmt.get(messageId) as any;
    if (!row) return null;
    return this.mapRowToEnvelope(row);
  }

  public listRecentMessages(limit: number = 20): MessageEnvelope[] {
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(limit) as any[];
    return rows.map((r) => this.mapRowToEnvelope(r));
  }

  /**
   * 原子领取下一条可处理消息
   * 
   * 调度原则：
   * 1. 只领取当前轮 (round_num <= round)
   * 2. 状态为 QUEUED 或 RESPONSE_STORED (待继续完成副作用)
   * 3. 排序：未决恢复的 RESPONSE_STORED 最优先(0)，关键系统控制消息次之(1)，工具/环境反馈与普通消息按 FIFO(2) 排序，防止普通消息饥饿
   * 4. 领取后原子更新为 PROCESSING
   */
  public claimNext(currentRound: number): MessageEnvelope | null {
    return this.db.transaction(() => {
      // 1. 查询符合条件的下一条消息
      const selectStmt = this.db.prepare(`
        SELECT * FROM messages
        WHERE round_num <= ? AND status IN ('QUEUED', 'RESPONSE_STORED')
        ORDER BY 
          (CASE 
            WHEN status = 'RESPONSE_STORED' THEN 0 
            WHEN source_type = 'system' THEN 1 
            ELSE 2 
          END) ASC, 
          created_at ASC
        LIMIT 1
      `);

      const row = selectStmt.get(currentRound) as any;
      if (!row) return null;

      const envelope = this.mapRowToEnvelope(row);
      const now = Date.now() / 1000;

      // 2. 如果是 QUEUED，推进为 PROCESSING
      if (envelope.status === "QUEUED") {
        const updateStmt = this.db.prepare(`
          UPDATE messages
          SET status = 'PROCESSING', updated_at = ?
          WHERE message_id = ?
        `);
        updateStmt.run(now, envelope.messageId);
        envelope.status = "PROCESSING";
      }

      envelope.updatedAt = now;
      return envelope;
    });
  }

  public commitMessage(messageId: string): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'COMMITTED', updated_at = ?
      WHERE message_id = ?
    `);
    stmt.run(now, messageId);
  }

  public updateStatus(messageId: string, status: MessageStatus): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = ?, updated_at = ?
      WHERE message_id = ?
    `);
    stmt.run(status, now, messageId);
  }

  public deferMessage(messageId: string, targetRound: number): void {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'QUEUED', round_num = ?, updated_at = ?
      WHERE message_id = ?
    `);
    stmt.run(targetRound, now, messageId);
  }

  public countPendingMessages(pixelId?: string): number {
    let sql = `
      SELECT COUNT(*) as count FROM messages
      WHERE status IN ('QUEUED', 'PROCESSING', 'RESERVED', 'CALLING', 'RESPONSE_STORED', 'WAITING_PIXEL_BUDGET', 'WAITING_RUN_BUDGET')
    `;
    const params: any[] = [];
    if (pixelId) {
      sql += " AND recipient = ?";
      params.push(pixelId);
    }
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as any;
    return Number(row?.count ?? 0);
  }

  /**
   * 在新 Run 启动或新轮次开始时，将因 Run 预算不足等待的消息重置为 QUEUED
   */
  public resetWaitingRunBudgetMessages(): number {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'QUEUED', updated_at = ?
      WHERE status = 'WAITING_RUN_BUDGET'
    `);
    const res = stmt.run(now);
    return Number(res.changes);
  }

  /**
   * 尝试恢复已补足能量的 Pixel 预算等待消息
   */
  public tryRecoverWaitingPixelBudgetMessages(minEnergyRequired: number = 100): number {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'QUEUED', updated_at = ?
      WHERE status = 'WAITING_PIXEL_BUDGET'
        AND recipient IN (
          SELECT pixel_id FROM pixel_accounts
          WHERE energy >= ? AND active = 1 AND refund_deficit_tokens = 0
        )
    `);
    const res = stmt.run(now, minEnergyRequired);
    return Number(res.changes);
  }

  private mapRowToEnvelope(row: any): MessageEnvelope {
    return {
      messageId: row.message_id,
      runId: row.run_id,
      roundNum: Number(row.round_num),
      hop: Number(row.hop),
      sender: row.sender,
      recipient: row.recipient,
      content: row.content,
      status: row.status as MessageStatus,
      isFeedback: Boolean(row.is_feedback),
      sourceType: row.source_type,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
