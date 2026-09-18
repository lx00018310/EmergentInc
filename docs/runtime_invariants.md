# Runtime Invariants

以下每一条都由当前 TypeScript 主链强制保证，改动主链时必须继续成立。

## 世界结构

1. 一个整数三维坐标最多一个 Pixel；Pixel 出生后不能移动，坐标即 `x_y_z` 形式的 id。
2. 直接邻域固定为 6-neighborhood（±X/±Y/±Z），由 `packages/domain/src/topology/grid.ts` 实时计算，磁盘上不保存邻居表。
3. 调度资格只由 SQLite `pixel_accounts.active` 决定（`listActivePixels()`）。磁盘文件缺失不影响调度：`state.json` 不存在时 `last_active_round` 按 0 处理，`pixel.md` 不存在时按空心智处理。
4. 主链不删除 Pixel：能量归零只会被置 `active=false`（`pixel_repository.updateEnergy`），文件与账户保留为终态。

## 能量与预算

5. 能量单位就是 token 计量，扣费用 `actualTokens`：`energy = MAX(0, energy - actualTokens)`，同一事务内写 `ledger_entries`。
6. 三级预算在同一 `reserve()` 事务中按序检查：PIXEL（自身能量）→ RUN（本次 run 上限）→ GLOBAL（`global_budget` 表）。实际生效的全局上限来自 `global_budget.total_limit`，不是 `/api/run/start` 传入值。
7. 预留—结算—退款必须闭合：任何 `reservations` 处于 OPEN 都不允许开始新 Run；结果未知（`actualTokens` 为 null）时消息停在 `AWAITING_SETTLEMENT`，由 Owner 经 `/api/run/recovery/resolve` 决议。
8. 存在退款赤字（`refund_deficit_tokens > 0`）的 Pixel 不能被扣费，消息退回 `QUEUED`。
9. 失活 Pixel 复活条件：能量 ≥ 100 且无赤字，此前被丢弃的等待消息不再重放。

## 通信

10. 消息只能发给自己的 6 邻居、自己（`SELF`）或 `STOP`；非邻居收件人一律拒绝。
11. 单轮消息上限 100 条；hop 上限 20，超限不丢弃而是顺延到下一轮。
12. `message_md` 与 `pixel_md` 上限均为 2000 Unicode 码点，计数按码点而非 UTF-16 长度。
13. 相同内容的 environment / SELF 消息幂等去重，避免重复消耗。

## 决策与副作用

14. 模型输出不直接改世界：必须经 `DecisionCompiler` 编译成 `Effects[]`，再由 `EffectRuntime` 单事务落盘。
15. 心跳文件写入受限于自身目录与白名单文件名（`pixel.md` / `tips.md`），Owner 的 `mandate.md` 与 Pixel 心智物理隔离。
16. 一轮只在整轮成功时推进 `live/world_state.json` 的 `round`；被停止或失败的轮次不推进轮次，`runs` 记录 `stop_reason` 与状态。
17. 连续 3 次同质只读循环触发 `READ_LOOP_THRESHOLD_REACHED`，本轮停止以省预算。
18. 非法响应最多一次付费重试；再失败即 Fail Fast，不做静默兜底。
