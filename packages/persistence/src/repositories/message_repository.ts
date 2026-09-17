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
    const sourceType = params.sourceType ?? "pixel";

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

  /**
   * 原子领取下一条可处理消息
   * 
   * 调度原则：
   * 1. 只领取当前轮 (round_num <= round)
   * 2. 状态为 QUEUED 或 RESPONSE_STORED (待继续完成副作用)
   * 3. 排序：is_feedback DESC (控制反馈优先插入队首批次), created_at ASC (严格 FIFO)
   * 4. 领取后原子更新为 PROCESSING
   */
  public claimNext(currentRound: number): MessageEnvelope | null {
    return this.db.transaction(() => {
      // 1. 查询符合条件的下一条消息
      const selectStmt = this.db.prepare(`
        SELECT * FROM messages
        WHERE round_num <= ? AND status IN ('QUEUED', 'RESPONSE_STORED')
        ORDER BY is_feedback DESC, created_at ASC
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
