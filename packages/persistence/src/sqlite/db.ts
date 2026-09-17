import { DatabaseSync, StatementSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";

export interface DatabaseOptions {
  timeoutMs?: number;
}

/**
 * SQLite 原生数据库连接包装，支持事务与 WAL
 */
export class SqliteDatabase {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath: string, options: DatabaseOptions = {}) {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") {
      const dir = path.dirname(path.resolve(dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(dbPath);
    this.initPragmas();
  }

  private initPragmas() {
    // 启用 WAL 模式与外键约束
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 30000;");
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  private transactionDepth = 0;

  /**
   * 显式 BEGIN IMMEDIATE 事务封装，支持嵌套事务与写入排他性
   */
  public transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) {
      this.transactionDepth++;
      try {
        return fn();
      } finally {
        this.transactionDepth--;
      }
    }

    this.db.exec("BEGIN IMMEDIATE;");
    this.transactionDepth = 1;
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {}
      throw err;
    } finally {
      this.transactionDepth = 0;
    }
  }

  public close(): void {
    this.db.close();
  }
}
