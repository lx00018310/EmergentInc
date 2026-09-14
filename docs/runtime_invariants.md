# Runtime Invariants

每轮结束必须检查：

1. 一个坐标最多一个 Pixel。
2. active Pixel state 可读取。
3. Pixel current_problem 最多一个。
4. current_holder 与 Pixel current_problem 双向一致。
5. 非邻居不能直接形成 transfer/bid 合约。
6. Local View 中出现的 Pixel ID 必须属于自己或 6 邻域。
7. Local View 中 Problem 必须通过 VisibilityService。
8. 每个非 IDLE 动作必须有 LLM audit。
9. Resource 不允许 NaN。
10. CLOSED Problem 不能再次被处理。
