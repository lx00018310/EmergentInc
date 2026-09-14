# Round Loop

每 Round：

1. Environment 注入本轮事件/Problem。
2. 读取所有 active Pixel。
3. 基于 Round 开始时的快照构造每个 Pixel 的 Local View。
4. 判断是否需要唤醒；无事件 Pixel 直接 IDLE。
5. 对需决策 Pixel 做 seeded shuffle。
6. 每个唤醒 Pixel 独立调用真实 LLM。
7. 收集所有 Action。
8. 按同一随机顺序验证并执行 Action。
9. 处理 REQUEST_CLOSE。
10. 结算 Resource。
11. 所有 active Pixel 支付 maintenance。
12. Death 检查。
13. 对重大事件更新 memory。
14. 持久化 JSON、Markdown、Round log、metrics。
