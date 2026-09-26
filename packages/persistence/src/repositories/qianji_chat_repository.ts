import { randomUUID } from "node:crypto";
import { QianjiChatTurn } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";
import { MessageRepository } from "./message_repository.js";

export interface CreateQianjiChatTurnInput {
  qianjiId: string;
  bindingId: string;
  pixelId: string;
  requestKey: string;
  question: string;
  roundNum: number;
}

export class QianjiChatRepository {
  constructor(private readonly db: SqliteDatabase, private readonly messages: MessageRepository) {}

  public createTurn(input: CreateQianjiChatTurnInput): { turn: QianjiChatTurn; created: boolean } {
    return this.db.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM qianji_chat_turns WHERE request_key = ?")
        .get(input.requestKey) as any;
      if (existing) {
        if (existing.qianji_id !== input.qianjiId || existing.binding_id !== input.bindingId || existing.question !== input.question) {
          throw new Error("IDEMPOTENCY_CONFLICT");
        }
        return { turn: this.mapTurn(existing), created: false };
      }
      const turnId = `chat_${randomUUID()}`;
      const messageId = `msg_${randomUUID()}`;
      const createdAt = Date.now() / 1000;
      this.messages.enqueueMessage({
        messageId,
        roundNum: input.roundNum,
        hop: 1,
        sender: "human",
        recipient: input.pixelId,
        content: input.question,
        sourceType: "human",
        recipientBindingId: input.bindingId,
      });
      this.db.prepare(`
        INSERT INTO qianji_chat_turns
          (turn_id, qianji_id, binding_id, message_id, request_key, question, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(turnId, input.qianjiId, input.bindingId, messageId, input.requestKey, input.question, createdAt);
      return { turn: this.getTurn(turnId)!, created: true };
    });
  }

  public getTurn(turnId: string): QianjiChatTurn | null {
    const row = this.db.prepare("SELECT * FROM qianji_chat_turns WHERE turn_id = ?").get(turnId) as any;
    return row ? this.mapTurn(row) : null;
  }

  public getTurnForMessage(messageId: string): QianjiChatTurn | null {
    const row = this.db.prepare("SELECT * FROM qianji_chat_turns WHERE message_id = ?").get(messageId) as any;
    return row ? this.mapTurn(row) : null;
  }

  public completeReply(messageId: string, bindingId: string, reply: string, callId: string | null): boolean {
    const message = this.db.prepare(`
      SELECT recipient_binding_id, source_type FROM messages WHERE message_id = ?
    `).get(messageId) as any;
    if (!message || message.source_type !== "human" || message.recipient_binding_id !== bindingId) return false;
    const result = this.db.prepare(`
      UPDATE qianji_chat_turns SET reply = ?, reply_call_id = ?, replied_at = ?
      WHERE message_id = ? AND binding_id = ? AND reply IS NULL
    `).run(reply, callId, Date.now() / 1000, messageId, bindingId);
    return Number(result.changes) === 1;
  }

  public listTurns(qianjiId: string, limit = 50, offset = 0): Array<QianjiChatTurn & {
    messageStatus: string;
    modelOutcome: string | null;
  }> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200 || !Number.isSafeInteger(offset) || offset < 0) {
      throw new Error("Invalid chat history pagination");
    }
    const rows = this.db.prepare(`
      SELECT c.*, m.status AS message_status,
        (SELECT outcome FROM model_calls WHERE message_id = c.message_id
          ORDER BY created_at DESC LIMIT 1) AS model_outcome
      FROM qianji_chat_turns c
      JOIN messages m ON m.message_id = c.message_id
      WHERE c.qianji_id = ?
      ORDER BY c.created_at DESC, c.turn_id DESC LIMIT ? OFFSET ?
    `).all(qianjiId, limit, offset) as any[];
    return rows.map(row => ({
      ...this.mapTurn(row),
      messageStatus: String(row.message_status),
      modelOutcome: row.model_outcome ?? null,
    }));
  }

  private mapTurn(row: any): QianjiChatTurn {
    return {
      turnId: String(row.turn_id),
      qianjiId: String(row.qianji_id),
      bindingId: String(row.binding_id),
      messageId: String(row.message_id),
      requestKey: String(row.request_key),
      question: String(row.question),
      reply: row.reply ?? null,
      replyCallId: row.reply_call_id ?? null,
      createdAt: Number(row.created_at),
      repliedAt: row.replied_at == null ? null : Number(row.replied_at),
    };
  }
}
