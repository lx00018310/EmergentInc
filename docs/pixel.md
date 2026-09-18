# Pixel

Pixel 是世界里唯一的决策主体。它的身份极简：

```text
position = [x, y, z]      # 出生即固定，不可移动
active   = true | false    # 能量归零即失活，主链不删除
energy   = token 余额      # 真值在 SQLite pixel_accounts
```

没有 `role`、没有 `genome`、没有 `memory`、没有 `status_log`。长期扮演什么角色是外部观察结论，不是字段。

## 目录结构

```text
workspace/live/pixels/x_y_z/
├─ state.json     # 身份与能量副本（引擎只回写 last_active_round、energy）
├─ pixel.md       # 心智，唯一长期自我；模型可写，上限 2000 码点
├─ tips.md        # 对外的未解决提醒；模型给出才写，mtime 即版本
└─ mandate.md     # Owner 指令通道；模型只读，严禁回写进 pixel.md
```

## 字段约定

```json
{
  "id": "0_0_0",
  "position": [0, 0, 0],
  "active": true,
  "energy": 98878389,
  "parent": "0_0_0",
  "born_round": 18,
  "last_active_round": 62,
  "generation": 1
}
```

* `energy` / `active` 以 SQLite 为准，`/api/world` 读盘后立即用账户值覆盖。
* `neighbors` 不写盘，由 `getNeighbors6()` 实时计算。
* `born_round` / `last_active_round` / `generation` / `parent` 由 `world_service` 从磁盘读取用于展示。
* 主链从不创建 `state.json`，只回写已存在文件中的 `last_active_round`（Owner reward 时回写 `energy`）。因此新繁殖的子代只有空的 `pixel.md` 与 `tips.md`，其 `parent` / `generation` / `born_round` 在界面上显示为 `unknown`，直到有人补齐该文件。

## 心智规则

1. `pixel.md` 是跨轮唯一的记忆载体：写进心智的才是长期事实，运行日志（逐轮能量、旧回执、临时探测）应当被压缩或丢弃。
2. 上限 2000 码点，超限的更新被拒绝并回喂 `MIND_VALIDATION_FAILED`，原心智保持不变。
3. 模型只能改写自己的 `pixel.md` 与 `tips.md`。
4. `tips.md` 用来提醒仍未解决的问题；问题消失就清空，不留历史告警。前端按 mtime 判断已读状态。
5. 新繁殖的 Pixel 从空白 `pixel.md` 开始，不继承父代心智文本，只继承能量与坐标事实。
6. 能量耗尽的 Pixel 变成终态：不再收信、不再划能、不再繁殖，但文件与账目保留，可经外部注入能量复活（需 ≥100 且无赤字）。
