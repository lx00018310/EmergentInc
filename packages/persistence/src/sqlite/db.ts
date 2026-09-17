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

  /**
   * 显式 BEGIN IMMEDIATE 事务封装，确保写入排他性
   */
  public transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const result = fn();
      this.db.exec("COMMIT;");
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK;");
      throw err;
    }
  }

  public close(): void {
    this.db.close();
  }
}
