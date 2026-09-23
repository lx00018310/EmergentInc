# Architecture

当前主链只有 TypeScript：Node.js 服务 + SQLite 事实源 + React 控制台。没有 Python 组件，没有第二套 Runtime。

## 运行链路

```text
React UI (frontend)
   ↓  HTTP /api/*
Fastify (apps/server)
   ↓
RunService        —— 一次 Run 的生命周期、SQLite 原子互斥、世界轮次推进
   ↓
RoundScheduler    —— 领取消息、唤醒判定、护栏（连续只读循环）
   ↓
AgentStepRunner   —— 组装上下文 → 调用模型 → 解析响应
   ↓
DecisionCompiler  —— 把模型意图编译成 Effects[]（唯一合法动作来源）
   ↓
EffectRuntime     —— 落盘文件 + 写 SQLite（mind / message / transfer / reproduce / tool）
   ↓
CoreStore         —— node:sqlite，单事务仓储
```

## 模块边界

| 包 | 职责 | 不负责 |
| --- | --- | --- |
| `packages/protocol` | 数据结构、枚举、Unicode 码点计数与长度上限 | 任何 I/O |
| `packages/domain` | 纯规则：3D 拓扑与邻居、能量守恒、繁殖校验、路由校验 | 存储、模型调用 |
| `packages/persistence` | `CoreStore` + 各 Repository，事务与恢复对账 | 业务决策 |
| `packages/model` | Prompt 组装、OpenAI 兼容 Provider、响应解析、`UsageMeter` 计价 | 写世界状态 |
| `packages/tools` | 工具注册表与运行时（artifact 读写转移、私有文件） | 全局世界视图 |
| `packages/runtime` | `RoundScheduler` / `AgentStepRunner` / `EffectRuntime` / `FeedbackFactory` | HTTP |
| `apps/server` | API 适配层、`WorldService`、`RunService`、`PromptService`、静态托管 | 领域规则实现 |
| `frontend` | 3D 晶格与控制台，只读 `/api`，写入仅限 Owner 动作 | 世界真值计算 |

## 真值划分

* **SQLite `workspace/ledger/v9_core.sqlite3` 是唯一机器真值**：`pixel_accounts`（能量/active）、`runs`、`messages`、`reservations`、`model_calls`、`effects`、`ledger_entries`、`tool_executions`、`recovery_decisions`、`global_budget`、`external_revenues`。
* **文件是人类可读的心智与交付物**：`live/pixels/<id>/{state.json,pixel.md,tips.md,mandate.md}`、`live/artifacts/<id>/`、`live/environment.md`、`live/world_state.json`。
* `state.json` 的 `energy` 是副本；`/api/world` 读取时以 `pixel_accounts` 覆盖磁盘值。`neighbors` 不落盘，由 `getNeighbors6()` 按坐标实时计算。

## 兼容占位

`GET /api/loops` 与 `GET /api/owner/requests` 只返回空结构，用于旧前端容错，背后没有实现，也不再有 `workspace/loops` 目录。
