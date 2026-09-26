import { randomUUID } from "node:crypto";
import { WorldEvent, WorldEventType, WorldEventSubjectType } from "@emergentinc/protocol";
import { SqliteDatabase } from "../sqlite/db.js";

export interface AppendWorldEvent {
  eventId?: string;
  eventType: WorldEventType;
  subjectType: WorldEventSubjectType;
  subjectId: string;
  qianjiId?: string | null;
  bindingId?: string | null;
  pixelId?: string | null;
  roundNum?: number | null;
  sourceKey: string;
  payload?: Record<string, unknown>;
  createdAt?: number;
}

export class WorldEventRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public append(input: AppendWorldEvent): WorldEvent {
    if (!input.sourceKey.trim() || !input.subjectId.trim()) {
      throw new Error("World event sourceKey and subjectId are required");
    }
    const payload = input.payload ?? {};
    const now = input.createdAt ?? Date.now() / 1000;
    return this.db.transaction(() => {
      const existing = this.db.prepare("SELECT * FROM world_events WHERE source_key = ?")
        .get(input.sourceKey) as any;
      if (existing) {
        const event = this.mapRow(existing);
        const same = event.eventType === input.eventType &&
          event.subjectType === input.subjectType &&
          event.subjectId === input.subjectId &&
          event.qianjiId === (input.qianjiId ?? null) &&
          event.bindingId === (input.bindingId ?? null) &&
          event.pixelId === (input.pixelId ?? null) &&
          event.roundNum === (input.roundNum ?? null) &&
          JSON.stringify(event.payload) === JSON.stringify(payload);
        if (!same) throw new Error("World event sourceKey already used for different facts");
        return event;
      }
      const event: WorldEvent = {
        eventId: input.eventId ?? `evt_${randomUUID()}`,
        eventType: input.eventType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        qianjiId: input.qianjiId ?? null,
        bindingId: input.bindingId ?? null,
        pixelId: input.pixelId ?? null,
        roundNum: input.roundNum ?? null,
        sourceKey: input.sourceKey,
        payload,
        createdAt: now,
      };
      this.db.prepare(`
        INSERT INTO world_events (
          event_id, event_type, subject_type, subject_id, qianji_id, binding_id,
          pixel_id, round_num, source_key, payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        event.eventId, event.eventType, event.subjectType, event.subjectId, event.qianjiId,
        event.bindingId, event.pixelId, event.roundNum, event.sourceKey,
        JSON.stringify(event.payload), event.createdAt,
      );
      return event;
    });
  }

  public getBySourceKey(sourceKey: string): WorldEvent | null {
    const row = this.db.prepare("SELECT * FROM world_events WHERE source_key = ?").get(sourceKey) as any;
    return row ? this.mapRow(row) : null;
  }

  public listRecent(options: { limit?: number; offset?: number; qianjiId?: string | null } = {}): WorldEvent[] {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("World event limit must be an integer from 1 to 200");
    }
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      throw new Error("World event offset must be a non-negative integer");
    }
    const rows = options.qianjiId != null
      ? this.db.prepare(`
          SELECT * FROM world_events WHERE qianji_id = ?
          ORDER BY created_at DESC, event_id DESC LIMIT ? OFFSET ?
        `).all(options.qianjiId, limit, offset) as any[]
      : this.db.prepare(`
          SELECT * FROM world_events ORDER BY created_at DESC, event_id DESC LIMIT ? OFFSET ?
        `).all(limit, offset) as any[];
    return rows.map(row => this.mapRow(row));
  }

  public countBetween(from: number, to: number): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM world_events WHERE created_at>=? AND created_at<?").get(from, to) as any;
    return Number(row.count);
  }

  public listBetween(from: number, to: number, limit: number): WorldEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000) throw new Error("World event range limit must be 1-2000");
    const rows = this.db.prepare(`SELECT * FROM world_events WHERE created_at>=? AND created_at<?
      ORDER BY created_at,event_id LIMIT ?`).all(from, to, limit) as any[];
    return rows.map(row => this.mapRow(row));
  }

  private mapRow(row: any): WorldEvent {
    return {
      eventId: String(row.event_id),
      eventType: row.event_type,
      subjectType: row.subject_type,
      subjectId: String(row.subject_id),
      qianjiId: row.qianji_id ?? null,
      bindingId: row.binding_id ?? null,
      pixelId: row.pixel_id ?? null,
      roundNum: row.round_num == null ? null : Number(row.round_num),
      sourceKey: String(row.source_key),
      payload: JSON.parse(String(row.payload_json)),
      createdAt: Number(row.created_at),
    };
  }
}
