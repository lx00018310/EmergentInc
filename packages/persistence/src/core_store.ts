import { SqliteDatabase } from "./sqlite/db.js";
import { initSchema } from "./migrations/init_schema.js";
import { RunRepository } from "./repositories/run_repository.js";
import { PixelRepository } from "./repositories/pixel_repository.js";
import { MessageRepository } from "./repositories/message_repository.js";
import { BudgetRepository } from "./repositories/budget_repository.js";
import { ModelCallRepository } from "./repositories/model_call_repository.js";
import { ToolExecutionRepository } from "./repositories/tool_execution_repository.js";
import { EffectRepository } from "./repositories/effect_repository.js";
import { LedgerRepository } from "./repositories/ledger_repository.js";

/**
 * CoreStore：单一事务事实源门面
 */
export class CoreStore {
  public readonly db: SqliteDatabase;
  public readonly runs: RunRepository;
  public readonly pixels: PixelRepository;
  public readonly messages: MessageRepository;
  public readonly budgets: BudgetRepository;
  public readonly modelCalls: ModelCallRepository;
  public readonly toolExecutions: ToolExecutionRepository;
  public readonly effects: EffectRepository;
  public readonly ledger: LedgerRepository;

  constructor(dbPath: string = ":memory:") {
    this.db = new SqliteDatabase(dbPath);
    initSchema(this.db);

    this.runs = new RunRepository(this.db);
    this.pixels = new PixelRepository(this.db);
    this.messages = new MessageRepository(this.db);
    this.budgets = new BudgetRepository(this.db);
    this.modelCalls = new ModelCallRepository(this.db);
    this.toolExecutions = new ToolExecutionRepository(this.db);
    this.effects = new EffectRepository(this.db);
    this.ledger = new LedgerRepository(this.db);

    // 确保全局预算记录存在
    this.budgets.ensureGlobalBudget();
  }

  public transaction<T>(action: () => T): T {
    return this.db.transaction(action);
  }

  public close(): void {
    this.db.close();
  }
}
