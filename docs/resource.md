# Resource v0.2

仍只使用一种统一 Resource。

## Maintenance

每个 active Pixel 每 Round 支付：

```text
maintenance_cost
```

默认 0.2。

存在本身有成本，因此 IDLE 不再等于永生。

## Reward

只有 Problem CLOSED 后结算成功 Reward。

例如：

```text
Environment Reward = 100
A promised B = 30
B promised C = 10
```

净：

```text
A +70
B +20
C +10
```

## Death

默认：

```text
resource <= 0
AND
grace_remaining == 0
```

grace 默认 3 Round。
