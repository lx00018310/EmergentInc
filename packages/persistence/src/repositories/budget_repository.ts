import { SqliteDatabase } from "../sqlite/db.js";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class SpendBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpendBlockedError";
  }
}

export interface GlobalBudgetRecord {
  id: string;
  totalLimit: number;
  totalSpent: number;
  totalReserved: number;
  currency: string;
  updatedAt: number;
}

export interface ReservationRecord {
  callId: string;
  runId: string;
  pixelId: string;
  amount: number;
  status: "OPEN" | "SETTLED" | "REFUNDED";
  createdAt: number;
  settledAt?: number | null;
}

export class BudgetRepository {
  constructor(private db: SqliteDatabase) {}

  public ensureGlobalBudget(totalLimit: number = 1000000): GlobalBudgetRecord {
    const now = Date.now() / 1000;
    const stmt = this.db.prepare(`
      INSERT INTO global_budget (id, total_limit, total_spent, total_reserved, currency, updated_at)
      VALUES ('GLOBAL', ?, 0, 0, 'CNY', ?)
      ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at
    `);
    stmt.run(totalLimit, now);
    return this.getGlobalBudget()!;
  }

  public getGlobalBudget(): GlobalBudgetRecord | null {
    const stmt = this.db.prepare("SELECT * FROM global_budget WHERE id = 'GLOBAL'");
    const row = stmt.get() as any;
    if (!row) return null;
    return {
      id: row.id,
      totalLimit: Number(row.total_limit),
      totalSpent: Number(row.total_spent),
      totalReserved: Number(row.total_reserved),
      currency: row.currency,
      updatedAt: Number(row.updated_at),
    };
  }

  /**
   * 原子多级预算检查与预留
   */
  public reserve(params: {
    callId: string;
    runId: string;
    pixelId: string;
    estimatedTokens: number;
  }): void {
    const { callId, runId, pixelId, estimatedTokens } = params;
    const now = Date.now() / 1000;

    this.db.transaction(() => {
      // 1. 检查 Pixel 账户与退款赤字
      const pixelStmt = this.db.prepare(`
        SELECT energy, active, refund_deficit_tokens, spend_blocked_reason
        FROM pixel_accounts WHERE pixel_id = ?
      `);
      const pixel = pixelStmt.get(pixelId) as any;
      if (!pixel) {
        throw new Error(`Pixel ${pixelId} not found`);
      }
      if (pixel.refund_deficit_tokens > 0) {
        throw new SpendBlockedError(
          `Pixel ${pixelId} spend blocked by refund deficit (${pixel.refund_deficit_tokens} tokens)`
        );
      }
      if (pixel.energy < estimatedTokens) {
        throw new BudgetExceededError(
          `Pixel ${pixelId} insufficient energy: balance ${pixel.energy} < estimated ${estimatedTokens}`
        );
      }

      // 2. 检查 Run 预算
      const runStmt = this.db.prepare(`
        SELECT run_limit, run_spent, run_reserved FROM runs WHERE run_id = ?
      `);
      const run = runStmt.get(runId) as any;
      if (run) {
        if (run.run_spent + run.run_reserved + estimatedTokens > run.run_limit) {
          throw new BudgetExceededError(
            `Run ${runId} budget exceeded: limit=${run.run_limit}, current=${run.run_spent + run.run_reserved}, request=${estimatedTokens}`
          );
        }
      }

      // 3. 检查 Global 预算
      const global = this.getGlobalBudget();
      if (global) {
        if (global.totalSpent + global.totalReserved + estimatedTokens > global.totalLimit) {
          throw new BudgetExceededError(
            `Global budget exceeded: limit=${global.totalLimit}, current=${global.totalSpent + global.totalReserved}, request=${estimatedTokens}`
          );
        }
      }

      // 4. 写入预留记录
      const resStmt = this.db.prepare(`
        INSERT INTO reservations (call_id, run_id, pixel_id, amount, status, created_at)
        VALUES (?, ?, ?, ?, 'OPEN', ?)
      `);
      resStmt.run(callId, runId, pixelId, estimatedTokens, now);

      // 5. 更新 Run 和 Global 预留量
      if (run) {
        this.db.prepare(`UPDATE runs SET run_reserved = run_reserved + ? WHERE run_id = ?`).run(estimatedTokens, runId);
      }
      this.db.prepare(`UPDATE global_budget SET total_reserved = total_reserved + ?, updated_at = ? WHERE id = 'GLOBAL'`).run(estimatedTokens, now);
    });
  }

  /**
   * 结算预留 (根据实际消耗结算，多退少补)
   */
  public settle(params: {
    callId: string;
    actualTokens: number;
    costCny: number;
  }): void {
    const { callId, actualTokens, costCny } = params;
    const now = Date.now() / 1000;

    this.db.transaction(() => {
      const resStmt = this.db.prepare(`SELECT * FROM reservations WHERE call_id = ? AND status = 'OPEN'`);
      const res = resStmt.get(callId) as any;
      if (!res) return;

      const reservedAmount = Number(res.amount);
      const runId = res.run_id;
      const pixelId = res.pixel_id;

      // 1. 扣减 Pixel 能量
      this.db.prepare(`
        UPDATE pixel_accounts 
        SET energy = MAX(0, energy - ?), updated_at = ? 
        WHERE pixel_id = ?
      `).run(actualTokens, now, pixelId);

      // 2. 扣除 Run 预算 (释放 reserved，增加 spent)
      this.db.prepare(`
        UPDATE runs 
        SET run_reserved = MAX(0, run_reserved - ?), run_spent = run_spent + ?
        WHERE run_id = ?
      `).run(reservedAmount, actualTokens, runId);

      // 3. 扣除 Global 预算
      this.db.prepare(`
        UPDATE global_budget
        SET total_reserved = MAX(0, total_reserved - ?), total_spent = total_spent + ?, updated_at = ?
        WHERE id = 'GLOBAL'
      `).run(reservedAmount, actualTokens, now);

      // 4. 标记预留为 SETTLED
      this.db.prepare(`
        UPDATE reservations
        SET status = 'SETTLED', settled_at = ?
        WHERE call_id = ?
      `).run(now, callId);
    });
  }

  /**
   * 退还预留 (如调用前取消或基础设施失败)
   */
  public refund(callId: string): void {
    const now = Date.now() / 1000;
    this.db.transaction(() => {
      const resStmt = this.db.prepare(`SELECT * FROM reservations WHERE call_id = ? AND status = 'OPEN'`);
      const res = resStmt.get(callId) as any;
      if (!res) return;

      const reservedAmount = Number(res.amount);
      const runId = res.run_id;

      // 释放 Run 预留
      this.db.prepare(`
        UPDATE runs 
        SET run_reserved = MAX(0, run_reserved - ?)
        WHERE run_id = ?
      `).run(reservedAmount, runId);

      // 释放 Global 预留
      this.db.prepare(`
        UPDATE global_budget
        SET total_reserved = MAX(0, total_reserved - ?), updated_at = ?
        WHERE id = 'GLOBAL'
      `).run(reservedAmount, now);

      // 标记预留为 REFUNDED
      this.db.prepare(`
        UPDATE reservations
        SET status = 'REFUNDED', settled_at = ?
        WHERE call_id = ?
      `).run(now, callId);
    });
  }
}
