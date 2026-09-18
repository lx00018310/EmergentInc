# Round Loop

一次 Run = 推进 N 个 Round。轮次是世界的最小时间单位，由 `RunService` → `RoundScheduler` → `AgentStepRunner` → `EffectRuntime` 串成一条链。

## Run 启动

1. 取 `workspace/.engine.lock`，同一时刻只允许一个 Run。
2. 检查是否存在未决操作（OPEN `reservations`、`CALLING` 消息、未结算 `tool_executions`、`PENDING` run）；存在则拒绝启动，返回 `RECOVERY_REQUIRED`。
3. 起始轮 = `live/world_state.json.round + 1`，在 `runs` 表登记本次 Run。

## 每个 Round

4. `tryRecoverWaitingPixelBudgetMessages()`：把因自身能量不足而等待、现已补足（≥100 且无赤字）的消息放回队列。
5. 对 `listActivePixels()` 逐个判定自然唤醒：距 `last_active_round` 超过阈值（默认 5 轮）且有待处理消息即唤醒。
6. `claimNext()` 按优先级领取消息：`RESPONSE_STORED` > 系统消息 > FIFO，且只取 `round_num <= currentRound`。
7. 单轮消息处理上限 100 条；超限的 hop 顺延到下一轮。

## 单条消息（AgentStepRunner）

8. 组装上下文：自身 `pixel.md`、`tips.md`、`mandate.md`（只读）、邻居来信、`environment.md`、genesis / temporary prompt、工具目录。**不含**全局状态、非邻居数据、历史聊天。
9. 估算 token 并 `reserve()`，三级预算 PIXEL → RUN → GLOBAL 任一超限即抛 `BudgetExceededError`：PIXEL 级把消息置 `WAITING_PIXEL_BUDGET` 继续下一个，RUN / GLOBAL 级直接停机并记录原因。
10. 调用真实模型；响应非法时最多一次付费重试，仍失败则 Fail Fast。
11. `DecisionCompiler` 把响应编译成 `Effects[]`（UPDATE_MIND / ROUTE_MESSAGE / TRANSFER_ENERGY / REPRODUCE / TOOL_CALL / SELF 等）。
12. `EffectRuntime` 在事务内落盘：写文件 + 写 `effects` / `ledger_entries` / `messages` / `pixel_accounts`。
13. 按实际 token `settle()` 扣能；结果未知则保留预留并把消息停在 `AWAITING_SETTLEMENT`，等 Owner 决议。
14. 消息置 `COMMITTED`，回写 `state.json.last_active_round`。

## 轮末与停止

15. **只有整轮全部成功**才把 `world_state.json` 的 `round` 推进；否则轮号不变。
16. `runs` 记录 `end_round`、`status`、`stop_reason`、错误诊断。
17. Owner `POST /api/run/stop` → AbortController：在领取下一条消息前中断，模型调用前 refund 并退回 `QUEUED`，Run 记 `STOPPED / USER_STOPPED`，不推进轮次，释放锁。
18. 连续 3 次同质只读循环 → `READ_LOOP_THRESHOLD_REACHED`，主动结束本次 Run 以省预算。

## 不存在的东西

旧 Loop Snapshot（`workspace/loops`）、`run_report.json`、`v9_message_queue.json`、`ui_state`、`recovery_backups` 都已删除：轮次历史由 SQLite `runs` / `messages` / `model_calls` / `effects` 承担，恢复靠 `recovery_decisions` 审计，不做文件快照。
