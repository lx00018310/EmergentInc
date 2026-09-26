# Runtime Invariants

以下每一条都由当前 TypeScript 主链强制保证，改动主链时必须继续成立。

## 世界结构

1. 一个整数三维坐标最多一个 Pixel；Pixel 出生后不能移动，坐标即 `x_y_z` 形式的 id。
2. 直接邻域固定为 6-neighborhood（±X/±Y/±Z），由 `packages/domain/src/topology/grid.ts` 实时计算，磁盘上不保存邻居表。
3. 世界调度要求 SQLite `pixel_accounts.active`；已绑定人物还必须处于 `active`，且未被未关闭的 execution 占用。未绑定的旧 Pixel 暂保留兼容。candidate、trial、retired 与任务占用成员不会被世界运行唤醒或领取消息。execution 调度只允许该执行快照中的当前 binding，且要求 mission 对应 active、trial 对应 trial。磁盘文件缺失不影响调度：`state.json` 不存在时 `last_active_round` 按 0 处理，`pixel.md` 不存在时按空心智处理。
4. 主链不删除 Pixel：模型结算和账户能量变动使能量归零时置 `active=false`；账户与审计历史保留。

## 能量与预算

5. 能量单位就是 token 计量，扣费用 `actualTokens`：`energy = MAX(0, energy - actualTokens)`，同一事务内写 `ledger_entries`。
6. `reserve()` 在同一事务中检查 Pixel 自身能量与本次 Run Tokens 上限；scoped Run 同时检查 execution 额度，Trial 还检查所有候选的共享额度。历史累计消耗继续记账，但不再设累计上限。
7. 预留—结算—退款必须闭合：任何 `reservations` 处于 OPEN 都不允许开始新 Run；结果未知（`actualTokens` 为 null）时消息停在 `AWAITING_SETTLEMENT`，由 Owner 经 `/api/run/recovery/resolve` 决议。
8. 存在退款赤字（`refund_deficit_tokens > 0`）的 Pixel 不能被扣费，消息退回 `QUEUED`。
9. 失活 Pixel 获得任意正整数 Token 即恢复活跃；预算不足的旧消息仍按预算规则等待，退款赤字仍禁止模型扣费。同坐标重建只允许失活、零余额、无未结算工作的目标，并归档其旧文件。

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

## Execution 范围

19. 世界 Run 只领取 `execution_id IS NULL` 的消息；任务 Run 只领取自身 ID 的消息。范围同时进入自然唤醒、预算等待恢复、SELF/environment 去重和所有运行派生消息。旧记录的 null 范围按普通世界记录处理。
20. 消息的接收 binding 快照与当前 binding 不一致时标记 `ABANDONED` 并记录原因；不得把旧消息交给同坐标新人。世界 Run 不消费未关闭 execution 成员的普通排队消息。
21. execution 工具权限是注册表 enabled 与不可变工具快照的交集。Prompt 目录和实际 handler 执行都检查该范围；任务不能使用 `workspace/private` 工具。任务产物存放在 `workspace/evidence/<executionId>/artifacts/<pixelId>`。
22. execution 内通信只允许同执行的直接六邻居；trial 禁止对外通信、能量转移、繁殖和产物转移。Mission 禁止繁殖，能量与产物转移仅限同执行直接邻居。
23. execution Run 的已开始轮次在调度前持久化计数；同一 `(run_id, round)` 只计一次，中断轮次也占额度。execution Run 不推进世界轮次。Run 结束进入 `awaiting_review`，存在未决调用、预留或结算时进入 `blocked`，业务验收另行关闭 execution。
24. scoped 调用预留输入估算与输出上限之和；最终 `maxTokens` 受 Pixel、Run、Execution 与 Trial 共享剩余额度约束。结算按实际 usage 记账，未知 usage 保留 OPEN 预留；超出预留的实际用量如实记录并阻止后续 execution 调用。
