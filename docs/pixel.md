# Pixel

Pixel 的极简身份：

```text
active = 0/1
position = (x,y,z)
```

每个 Pixel：

```text
pixels/x_y_z/
├─ state.json       # 机器真值
├─ genome.json      # 可遗传策略
├─ memory.json      # 压缩经验
├─ state.md         # 人类镜像
├─ genome.md
├─ memory.md
├─ history.md       # 不回写事件流水
├─ inbox.md         # 最近一次 Local View
└─ llm_log.md       # 模型调用审计
```

禁止 `role=sales`、`role=manager`。

如果某个 Pixel 长期像销售，那是涌现观察，不是身份字段。
