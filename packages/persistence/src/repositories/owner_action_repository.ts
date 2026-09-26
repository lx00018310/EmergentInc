import { SqliteDatabase } from "../sqlite/db.js";

export class OwnerActionRepository {
  constructor(private readonly db: SqliteDatabase) {}

  public getPrevious<T>(idempotencyKey: string, action: string, request: unknown): T | null {
    const requestJson = JSON.stringify(request);
    const existing = this.db.prepare(`SELECT action, request_json, result_json FROM owner_action_requests WHERE idempotency_key = ?`)
      .get(idempotencyKey) as any;
    if (!existing) return null;
    if (existing.action !== action || existing.request_json !== requestJson) {
      throw new Error("Idempotency key already used for a different owner action");
    }
    return JSON.parse(String(existing.result_json)) as T;
  }

  public execute<T>(idempotencyKey: string, action: string, request: unknown, work: () => T): T {
    if (!idempotencyKey.trim() || idempotencyKey.length > 200) {
      throw new Error("Idempotency key is required (1-200 characters)");
    }
    if (!action.trim() || action.length > 80) throw new Error("Action name is invalid");
    const requestJson = JSON.stringify(request);
    if (requestJson === undefined) throw new Error("Owner action request is not JSON serializable");
    return this.db.transaction(() => {
      const existing = this.getPrevious<T>(idempotencyKey, action, request);
      if (existing !== null) return existing;
      const result = work();
      const resultJson = JSON.stringify(result);
      if (resultJson === undefined) throw new Error("Owner action result is not JSON serializable");
      this.db.prepare(`
        INSERT INTO owner_action_requests (idempotency_key, action, request_json, result_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(idempotencyKey, action, requestJson, resultJson, Date.now() / 1000);
      return result;
    });
  }
}
