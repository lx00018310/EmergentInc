import { SqliteDatabase } from "../sqlite/db.js";
import { MessageEnvelope, MessageStatus, EnqueueMessageParams } from "@emergentinc/protocol";

export const MAX_MESSAGES_PER_ROUND = 100;

export class MessageRepository {
  constructor(private db: SqliteDatabase) {}

  private currentBindingId(pixelId: string): string | null {
    const row = this.db.prepare("SELECT binding_id FROM qianji_bindings WHERE pixel_id = ? AND unbound_at IS NULL")
      .get(pixelId) as any;
    return row?.binding_id == null ? null : String(row.binding_id);
  }

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
    const senderBindingId = params.senderBindingId !== undefined
      ? params.senderBindingId
      : this.currentBindingId(params.sender);
    const recipientBindingId = params.recipientBindingId !== undefined
      ? params.recipientBindingId
      : this.currentBindingId(params.recipient);
    const executionId = params.executionId ?? null;

    // 幂等去重：同元胞同内容的未消费 environment 消息或未消费 SELF 消息直接复用，防止队列堆积
    if (
      (sourceType === "environment" || (params.sender === params.recipient && sourceType === "pixel")) &&
      status === "QUEUED"
    ) {
      const existing = this.db.prepare(`
        SELECT * FROM messages
        WHERE recipient = ? AND sender = ? AND content = ? AND status = 'QUEUED'
          AND execution_id IS ?
          AND sender_binding_id IS ? AND recipient_binding_id IS ?
        LIMIT 1
      `).get(params.recipient, params.sender, params.content, executionId, senderBindingId, recipientBindingId) as any;

      if (existing) {
        return this.mapRowToEnvelope(existing);
      }
    }

    const stmt = this.db.prepare(`
      INSERT INTO messages (
        message_id, run_id, execution_id, round_num, hop, sender, recipient, content,
        sender_binding_id, recipient_binding_id, binding_snapshot_captured,
        narrative_revision, identity_snapshot_captured,
        status, is_feedback, source_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, 0, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      messageId,
      params.runId ?? null,
      executionId,
      params.roundNum,
      hop,
      params.sender,
      params.recipient,
      params.content,
      senderBindingId,
      recipientBindingId,
      status,
      isFeedback,
      sourceType,
      now,
      now
    );

    return {
      messageId,
      runId: params.runId ?? null,
      executionId,
      roundNum: params.roundNum,
      hop,
      sender: params.sender,
      recipient: params.recipient,
      content: params.content,
      status,
      abandonedReason: null,
      isFeedback: Boolean(isFeedback),
      sourceType,
      senderBindingId,
      recipientBindingId,
      bindingSnapshotCaptured: true,
      narrativeRevision: null,
      identitySnapshotCaptured: false,
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
  public claimNext(currentRound: number, executionId: string | null = null): MessageEnvelope | null {
    return this.db.transaction(() => {
      this.db.prepare(`UPDATE messages AS m SET status='ABANDONED', abandoned_reason='RECIPIENT_BINDING_CHANGED', updated_at=?
        WHERE m.execution_id IS ? AND m.round_num<=? AND m.status IN ('QUEUED', 'RESPONSE_STORED')
          AND m.binding_snapshot_captured=1
          AND m.recipient_binding_id IS NOT (
            SELECT b.binding_id FROM qianji_bindings b WHERE b.pixel_id=m.recipient AND b.unbound_at IS NULL
          )`).run(Date.now() / 1000, executionId, currentRound);
      while (true) {
        const eligibleScope = executionId
          ? `m.execution_id=? AND EXISTS (
              SELECT 1 FROM execution_participants ep
              JOIN executions e ON e.execution_id=ep.execution_id
              JOIN qianji_bindings b ON b.binding_id=ep.binding_id
              JOIN qianji_profiles q ON q.qianji_id=b.qianji_id
              JOIN pixel_accounts p ON p.pixel_id=b.pixel_id AND p.active=1
              WHERE ep.execution_id=m.execution_id AND ep.released_at IS NULL AND e.status='running'
                AND b.pixel_id=m.recipient AND b.binding_id=m.recipient_binding_id AND b.unbound_at IS NULL
                AND ((e.kind='mission' AND q.career_status='active') OR
                     (e.kind='trial_candidate' AND q.career_status='trial'))
            )`
          : `m.execution_id IS NULL AND NOT EXISTS (
              SELECT 1 FROM qianji_bindings b JOIN qianji_profiles p ON p.qianji_id=b.qianji_id
              WHERE b.pixel_id=m.recipient AND b.unbound_at IS NULL AND p.career_status <> 'active'
            ) AND NOT EXISTS (
              SELECT 1 FROM execution_participants ep
              JOIN executions e ON e.execution_id=ep.execution_id
              JOIN qianji_bindings b ON b.binding_id=ep.binding_id
              WHERE b.pixel_id=m.recipient AND ep.released_at IS NULL AND e.status <> 'closed'
            )`;
        const selectStmt = this.db.prepare(`
          SELECT m.* FROM messages m
          WHERE m.round_num <= ? AND m.status IN ('QUEUED', 'RESPONSE_STORED')
            AND ${eligibleScope}
          ORDER BY
            (CASE WHEN m.status = 'RESPONSE_STORED' THEN 0 WHEN m.source_type = 'system' THEN 1 ELSE 2 END) ASC,
            m.created_at ASC
          LIMIT 1
        `);
        const row = (executionId
          ? selectStmt.get(currentRound, executionId)
          : selectStmt.get(currentRound)) as any;
        if (!row) return null;

        const currentBinding = this.currentBindingId(String(row.recipient));
        if (row.binding_snapshot_captured && (row.recipient_binding_id ?? null) !== currentBinding) {
          this.db.prepare(`UPDATE messages SET status='ABANDONED', abandoned_reason='RECIPIENT_BINDING_CHANGED', updated_at=? WHERE message_id=?`)
            .run(Date.now() / 1000, row.message_id);
          continue;
        }

      const envelope = this.mapRowToEnvelope(row);
      const now = Date.now() / 1000;

      // 2. 如果是 QUEUED，推进为 PROCESSING
      if (envelope.status === "QUEUED") {
        if (!envelope.bindingSnapshotCaptured) {
          envelope.recipientBindingId = currentBinding;
          envelope.bindingSnapshotCaptured = true;
          this.db.prepare(`
            UPDATE messages
            SET recipient_binding_id = ?, binding_snapshot_captured = 1, updated_at = ?
            WHERE message_id = ?
          `).run(envelope.recipientBindingId, now, envelope.messageId);
        }
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
      }
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

  public countPendingMessages(pixelId?: string, executionId: string | null = null): number {
    let sql = `
      SELECT COUNT(*) as count FROM messages
      WHERE execution_id IS ?
        AND status IN ('QUEUED', 'PROCESSING', 'RESERVED', 'CALLING', 'RESPONSE_STORED', 'WAITING_PIXEL_BUDGET', 'WAITING_RUN_BUDGET', 'WAITING_EXECUTION_BUDGET')
    `;
    const params: any[] = [executionId];
    if (pixelId) {
      sql += " AND recipient = ?";
      params.push(pixelId);
    }
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as any;
    return Number(row?.count ?? 0);
  }

  /** 当前或未来轮次仍有可处理的消息；可补足预算的等待消息留待下一轮恢复。 */
  public hasProcessableMessages(executionId: string | null = null): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM messages
      WHERE execution_id IS ? AND (status IN ('QUEUED', 'RESPONSE_STORED')
         OR (status = 'WAITING_PIXEL_BUDGET' AND recipient IN (
           SELECT pixel_id FROM pixel_accounts
           WHERE energy >= 100 AND active = 1 AND refund_deficit_tokens = 0
         )))
      LIMIT 1
    `).get(executionId);
    return Boolean(row);
  }

  /**
   * 在新 Run 启动或新轮次开始时，将因 Run 预算不足等待的消息重置为 QUEUED
   */
  public resetWaitingRunBudgetMessages(executionId: string | null = null): number {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'QUEUED', updated_at = ?
      WHERE status = 'WAITING_RUN_BUDGET' AND execution_id IS ?
    `);
    const res = stmt.run(now, executionId);
    return Number(res.changes);
  }

  /**
   * 尝试恢复已补足能量的 Pixel 预算等待消息
   */
  public tryRecoverWaitingPixelBudgetMessages(minEnergyRequired: number = 100, executionId: string | null = null): number {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      UPDATE messages
      SET status = 'QUEUED', updated_at = ?
      WHERE status = 'WAITING_PIXEL_BUDGET'
        AND execution_id IS ?
        AND recipient IN (
          SELECT pixel_id FROM pixel_accounts
          WHERE energy >= ? AND active = 1 AND refund_deficit_tokens = 0
        )
    `);
    const res = stmt.run(now, executionId, minEnergyRequired);
    return Number(res.changes);
  }

  private mapRowToEnvelope(row: any): MessageEnvelope {
    return {
      messageId: row.message_id,
      runId: row.run_id,
      executionId: row.execution_id ?? null,
      roundNum: Number(row.round_num),
      hop: Number(row.hop),
      sender: row.sender,
      recipient: row.recipient,
      content: row.content,
      status: row.status as MessageStatus,
      abandonedReason: row.abandoned_reason ?? null,
      isFeedback: Boolean(row.is_feedback),
      sourceType: row.source_type,
      senderBindingId: row.sender_binding_id ?? null,
      recipientBindingId: row.recipient_binding_id ?? null,
      bindingSnapshotCaptured: Boolean(row.binding_snapshot_captured),
      narrativeRevision: row.narrative_revision == null ? null : Number(row.narrative_revision),
      identitySnapshotCaptured: Boolean(row.identity_snapshot_captured),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }
}
