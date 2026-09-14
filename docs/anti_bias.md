# Anti-Bias

禁止：

```text
sorted(pixel_ids) 作为固定决策顺序
available_problems[0]
first_idle_neighbor
全局 Problem 自动可见
evidence_progress += 1
random_action fallback
模型失败后启发式兜底
```

Spawn 冲突使用当轮 seeded decision order 解决，不能用坐标优先。

报告必须区分：

```text
Observed
Inferred
Hypothesized
```
