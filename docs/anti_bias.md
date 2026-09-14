# Anti-Bias Rules

1. 禁止固定坐标排序先手。
2. 禁止 `available_probs[0]`。
3. 禁止 `first_idle_neighbor`。
4. 禁止全局 Problem 可见。
5. 禁止 Evidence 按 WORK 次数累加。
6. 禁止零成本静态永生。
7. Environment 注入 Reward 必须单独记账，不能把外部输血解释成系统利润。
8. 观察性描述不得写回角色字段。
9. 报告必须区分：
   - Observed
   - Inferred
   - Hypothesized
