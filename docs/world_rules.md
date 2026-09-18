# World Rules

只描述当前 TypeScript 主链实际执行的世界规则。

## 空间

1. 世界是无界整数三维网格，坐标 `[x,y,z]`，Pixel id 为 `x_y_z`（负坐标合法，如 `-1_0_0`）。一个坐标最多一个 Pixel。
2. Pixel 出生后不能移动。邻居固定为 6-neighborhood（±X、±Y、±Z 各一格），每轮按坐标实时计算。
3. 前端把世界 Z 轴映射为竖直方向，仅是呈现约定。

## 生命与能量

4. 权威能量在 SQLite `pixel_accounts.energy`；`state.json` 的 `energy` 是展示副本。
5. 能量以 token 计量：每次模型调用先按估算 token 预留，结束按实际 token 结算，`energy = MAX(0, energy - actualTokens)`，并写 `ledger_entries`。
6. 能量归零 → 账户置 `active=false`，该 Pixel 停止收信、划能、繁殖。主链不删除它，终态文件保留。
7. 复活条件：能量 ≥ 100 且无退款赤字。
8. 现金成本只记账：`model_calls.cost_cny` 按 `resources/config/model_pricing.json` 的每百万 token 单价计算，不参与扣能。

## 繁殖

9. 繁殖只能进入自己的空闲 6 邻居坐标；父代必须活跃；`initial_energy` 为正整数且不超过父代能量。
10. 能量拆分为一次原子事务，双方各写 `reproduction_out` / `reproduction_in` 账目，子账户以 `active=true` 建立。
11. 子代 `pixel.md` 与 `tips.md` 初始为空 —— 没有基因组、没有先天记忆，心智只能靠自己后续写出来。
12. 每轮唤醒判定使用 `last_active_round`（默认静默 5 轮后自然唤醒），不存在 sleep 字段。

## 通信

13. 消息由 `ROUTE_MESSAGE` effect 产生，收件人只能是 6 邻居、`SELF` 或 `STOP`。
14. 单轮消息上限 100 条；单条消息 hop 上限 20，超限顺延下一轮而非丢弃。
15. `message_md`、`pixel.md` 上限均为 2000 Unicode 码点（按码点计数，代理对算一个字符）。
16. 相同内容的 environment / SELF 消息幂等去重。

## 决策与环境

17. 一切商业判断由 Pixel 的模型决策产生；Owner 只能提供事实（`environment.md`）、指令通道（`mandate.md`）与真实收入（reward），不能替 Pixel 写心智。
18. `environment.md` 是全局唯一共享事实源，任何 Pixel 可读。
19. 模型输出必须编译为合法 effects 才生效；非法响应最多一次付费重试，再失败即 Fail Fast。
20. 连续 3 次同质只读循环触发停机保护 `READ_LOOP_THRESHOLD_REACHED`，避免空转消耗预算。
21. 只有整轮成功才推进 `world_state.json` 的 `round`；停止/失败的轮次不推进，状态记录在 `runs`。

## 已移除的旧概念

Problem / Market / Evidence Gate / Genome / Memory / Capability 申请 / Loop Snapshot 均不属于当前世界，代码与数据都不再存在。
