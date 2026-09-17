# EmergentInc V10 Small Runtime 架构重构计划

**基线：V9.14**
**版本目标：纯架构重构，不增加新功能。**
**核心原则：保留 V9 已验证的业务语义，重新构造 Runtime，使后续新增能力通过模块、Provider、Tool、Effect、Hook 扩展，而不是继续修改中央 Scheduler。**

---

# 第一部分：V10 整体架构

## 1. V10 的核心目标

V10 不解决“功能不够多”的问题。

V10 只解决一个问题：

> **把 EmergentInc 从一个由大型 Scheduler 驱动的 Python 应用，重构成一个 TypeScript-first、Small Core、Protocol-driven 的 Agent Runtime。**

V10 完成后：

```text
现在：

V9RoundScheduler
 ├─ Round
 ├─ Queue
 ├─ Budget
 ├─ Context
 ├─ LLM
 ├─ Response Parse
 ├─ Tool
 ├─ Environment
 ├─ Energy
 ├─ Reproduce
 ├─ Message
 ├─ Effect
 ├─ Recovery
 └─ Persistence


V10：

Scheduler
   │
   ▼
Agent Runtime
   │
   ├── Context Runtime
   ├── Model Runtime
   ├── Tool Runtime
   ├── Effect Runtime
   ├── Hook/Event Runtime
   └── Persistence Port
```

Scheduler 不再知道每项功能如何实现。

---

## 2. V10 明确不做什么

V10 禁止借重构顺便增加产品功能。

不增加：

* 新 Agent 类型
* 新商业规则
* 新组织层级
* 新元胞能力
* 新工具种类
* SubAgent
* MCP
* Browser
* Shell
* 外部支付
* Owner Approval
* 多机集群
* PostgreSQL
* Redis
* NATS
* 多用户系统

这里的 Shell 指新增通用 Shell 能力；V9.14 已有的 `vps_exec` 等 VPS 工具必须保留，不属于新增功能。

这些全部留给 V10 之后。

V10 的验收标准只有：

> **同样的输入、同样的模型响应、同样的初始状态，V10 应产生与 V9 等价的世界演化结果。**

---

# 3. 技术栈决策

V10 主干统一为：

```text
TypeScript
+
Node.js
+
SQLite
+
React
```

建议：

```text
Backend Runtime : TypeScript
API             : Fastify
Frontend        : React + TypeScript + Vite
Protocol        : JSON Schema + TypeScript Types
Validation      : Ajv
Persistence     : SQLite
Package Manager : pnpm workspace
```

## Python 的定位

V10 完成以后：

```text
Python 不再属于主 Runtime。
```

即不再有：

```text
Python Scheduler
Python FastAPI
Python Tool Runtime
Python LLM Runtime
```

未来如果出现 Python 独占能力，例如：

```text
机器学习
科学计算
复杂数据分析
特定 Python SDK
```

再增加：

```text
Python Worker
```

通过 Protocol 与主 Runtime 通信。

所以长期结构是：

```text
TypeScript = Runtime / Control Plane

Python = Optional Capability Worker
```

V10 本身暂时不需要 Python Worker。

---

# 4. V10 推荐仓库结构

```text
EmergentInc/
│
├─ apps/
│  │
│  ├─ server/
│  │   ├─ src/
│  │   │  ├─ api/
│  │   │  ├─ controllers/
│  │   │  └─ main.ts
│  │   └─ package.json
│  │
│  └─ web/
│      └─ 当前 frontend React 项目
│
├─ packages/
│  │
│  ├─ protocol/
│  │   ├─ schemas/
│  │   ├─ types/
│  │   ├─ enums/
│  │   └─ trace.ts
│  │
│  ├─ domain/
│  │   ├─ pixel/
│  │   ├─ world/
│  │   ├─ energy/
│  │   ├─ message/
│  │   └─ effects/
│  │
│  ├─ runtime/
│  │   ├─ scheduler/
│  │   ├─ agent-step/
│  │   ├─ context/
│  │   ├─ effects/
│  │   ├─ hooks/
│  │   └─ run/
│  │
│  ├─ model/
│  │   ├─ provider/
│  │   ├─ prompt/
│  │   ├─ parser/
│  │   ├─ usage/
│  │   └─ openai-compatible/
│  │
│  ├─ tools/
│  │   ├─ registry/
│  │   ├─ runtime/
│  │   ├─ contracts/
│  │   └─ builtin/
│  │
│  └─ persistence/
│      ├─ sqlite/
│      ├─ repositories/
│      ├─ migrations/
│      └─ projections/
│
├─ resources/
│  ├─ prompts/
│  └─ bootstrap/
│
├─ workspace/
│  ├─ live/
│  ├─ ledger/
│  ├─ runtime/
│  └─ private/
│
├─ tests/
│  ├─ contract/
│  ├─ parity/
│  ├─ replay/
│  ├─ recovery/
│  └─ integration/
│
├─ scripts/
│  └─ migrate-v9-to-v10.ts
│
├─ package.json
├─ pnpm-workspace.yaml
└─ tsconfig.base.json
```

不要照搬 DeepSeek Harness 几十个 package。

EmergentInc 当前规模只需要这六个核心 package：

```text
protocol
domain
runtime
model
tools
persistence
```

---

# 5. Protocol 层——整个 V10 的地基

参考大型 Harness 的经验，V10 第一优先级不是 Scheduler，而是 Protocol。

建立：

```text
packages/protocol
```

负责定义系统共同语言。

包括：

```text
PixelState
MessageEnvelope
AgentStepInput
AgentDecision
ToolCall
ToolResult
Effect
RuntimeEvent
RunStatus
ModelCallRecord
TraceContext
StopReason
```

禁止各模块自己重新定义类似结构。

例如：

```typescript
interface TraceContext {
  runId: string
  round: number
  pixelId?: string
  messageId?: string
  modelCallId?: string
  operationId?: string
  effectId?: string
}
```

---

# 6. 所有状态字符串统一类型化

把现在散落的：

```text
QUEUED
RESERVED
CALLING
RESPONSE_STORED
COMMITTED
WAITING_PIXEL_BUDGET
WAITING_RUN_BUDGET
UNKNOWN
SUCCESS
FAILED
PAUSED_RECOVERY_REQUIRED
```

全部进入 Protocol。

例如：

```typescript
type MessageStatus =
  | "QUEUED"
  | "PROCESSING"
  | "RESERVED"
  | "CALLING"
  | "RESPONSE_STORED"
  | "COMMITTED"
  | "WAITING_PIXEL_BUDGET"
  | "WAITING_RUN_BUDGET"
```

同理：

```text
RunStatus
ModelCallStatus
ToolExecutionStatus
EffectStatus
StopReason
```

都成为稳定协议。

`PROCESSING` 是 V10 领取消息后的执行状态，不是新的业务结果。消息状态与队列位置分别表达，不能用状态替代延期归属、入队顺序和模型调用结果。

正常状态转换统一为：

```text
QUEUED → PROCESSING → RESERVED → CALLING → RESPONSE_STORED → COMMITTED
```

| 当前状态 / 触发条件 | 下一状态与调度动作 |
| --- | --- |
| PROCESSING，Pixel 单轮调用预算不足 | QUEUED，延期到下一轮，本轮不重复领取 |
| PROCESSING，Pixel 正余额但预留不足 | WAITING_PIXEL_BUDGET，延期；下轮重新检查，不将 Pixel 失活 |
| PROCESSING，Run / Global 预算不足 | WAITING_RUN_BUDGET，保留队首位置，结束本轮 |
| PROCESSING，退款赤字阻断 | QUEUED，延期；条件未解除前不调用模型 |
| PROCESSING，目标不存在或已经失活 | COMMITTED，不调用模型，保持 V9 消费行为 |
| PROCESSING，零余额且预留失败 | COMMITTED，并按 V9 规则失活 |
| RESERVED，调用前收到 Stop | 按 V9 退还预留，转 QUEUED，放回队首 |
| CALLING，已确定未计费的基础设施失败 | QUEUED，放回队首，Run fail fast |
| CALLING，响应无效但已计费 | 按 V9 结算后转 QUEUED，放回队首，停止 Run |
| CALLING，调用结果不明 | 不重新领取；由 ModelCall 的 CALL_OUTCOME_UNKNOWN 和现有恢复门禁阻断执行 |
| RESPONSE_STORED，继续处理同一消息 | 复用已保存响应，进入 Effect 阶段，不再预留或调用模型 |
| WAITING_PIXEL_BUDGET / WAITING_RUN_BUDGET，再次调度 | 下轮或后续 Run 重新评估等待条件，经 QUEUED → PROCESSING 按相同预算门禁判断；仍不足则继续等待，不忙轮询 |

`COMMITTED` 不可重新领取。模型结果不明不能被普通队列重置为 QUEUED。此表只统一消息与调度契约，不替代尚待细化的完整崩溃恢复设计。

---

# 7. Agent Runtime 的最小核心

借鉴 Pi 的 Small Core 思想。

V10 Agent Core 不应该知道：

* SQLite
* HTTP
* React
* OpenAI
* Artifact 文件路径
* 具体 Tool
* 具体模型供应商

Agent Core 只理解：

```text
Input
→ Context
→ Model
→ Decision
→ Effects
→ Result
```

核心接口：

```typescript
interface AgentStepRunner {
  execute(input: AgentStepInput): Promise<AgentStepResult>
}
```

---

# 8. AgentStep 成为核心执行单位

V9 的隐含执行单位实际上已经是：

```text
一条 Message
+
一个 Pixel
+
一次模型调用
+
若干副作用
```

V10 正式命名为：

```text
AgentStep
```

结构：

```text
AgentStepInput
├─ TraceContext
├─ PixelState
├─ pixel.md
├─ MessageEnvelope
└─ RuntimePolicy

         ↓

AgentStep

         ↓

AgentStepResult
├─ AgentDecision
├─ ModelUsage
├─ Effects[]
└─ Trace
```

---

# 9. 保留“三输入认知隔离”

这一点不能因为重构而丢掉。

模型仍然只能看到：

```text
state
pixel.md
message.md
```

即：

```text
ContextAssembler
       │
       ├─ Pixel State
       ├─ Pixel Mind
       └─ Current Message
              │
              ▼
          ModelRequest
```

World 全局状态不能直接传入模型。

邻居情况仍然必须先投影进 Pixel State。

Environment 仍然只能通过主动：

```text
environment_read
```

获取。

---

# 10. Model Runtime 独立

当前 LLM 模块拆成：

```text
PromptBuilder
ModelProvider
ResponseParser
UsageMeter
```

执行：

```text
AgentStep
   ↓
PromptBuilder
   ↓
PreparedModelRequest
   ↓
ModelProvider
   ↓
RawModelResponse
   ↓
ResponseParser
   ↓
AgentDecision
```

Provider 接口：

```typescript
interface ModelProvider {
  prepare(...)
  call(...)
}
```

现阶段只实现当前正在使用的 OpenAI-compatible Provider。

未来：

```text
Anthropic
Gemini
OpenRouter
Local
```

只增加 Provider。

不能修改 Agent Runtime。

---

# 11. Tool Runtime 独立

保留 V9 已经正确形成的：

```text
ToolRegistry
ToolContext
ToolResult
OperationReceipt
Exactly-Once
```

V10 转为：

```text
ToolRegistry
    ↓
ToolRuntime
    ↓
ToolHandler
```

统一：

```typescript
interface ToolDefinition {
  name: string
  description: string
  schema: JSONSchema
  effect: "read" | "write"
  enabled: boolean
  timeoutSeconds: number
  execute(ctx, args): Promise<ToolResult>
}
```

当前工具：

```text
save_artifact
read_artifact
list_artifacts
list_private_files
read_private_file
inspect_private_image
vps_exec
vps_list_files
vps_read_file
vps_write_file
vps_upload_file
vps_download_file
```

保持不变。

以上 12 项以 `emergentinc/tools/registry_manifest.py` 的 V9.14 注册清单为基线。保留工具名、参数 Schema、默认启用状态、读写属性、超时配置、输出与错误码；不因更换语言而扩大权限或默认启用原本禁用的能力。

`ToolContext` 保留由引擎注入的 pixel/run/message/operation 身份和停止信号，模型参数不能覆盖这些字段。内部 camelCase 字段必须显式映射到现有 API 的 `input_schema`、`timeout_seconds` 等字段。

私有文件工具保留敏感文件限制和路径校验；VPS 工具保留现有连接配置、凭据隔离、远端路径与传输限制。超时和取消按现有工具实际行为逐项建立 fixture，不能仅凭 timeout 字段推断结果。

---

# 12. Effect Runtime —— V10 最关键的新架构边界

模型不能直接修改世界。

AgentDecision 首先转成：

```text
Effect[]
```

V10 定义：

```text
UpdateMindEffect
ReadEnvironmentEffect
ToolCallEffect
TransferEnergyEffect
ReproduceEffect
RouteMessageEffect
EngineFeedbackEffect
```

然后：

```text
AgentDecision
      ↓
DecisionCompiler
      ↓
Effect[]
      ↓
EffectRuntime
      ↓
EffectHandler
```

---

# 13. Scheduler 不再实现 Effect

例如现在 Scheduler 内部直接处理：

```text
if energy_transfer:
   ...

if reproduce:
   ...

if environment_read:
   ...
```

V10 禁止这种写法。

Scheduler 只：

```typescript
const result = await agentStep.execute(stepInput)

await effectRuntime.apply(result.effects)
```

具体实现分别属于：

```text
TransferEnergyHandler
ReproduceHandler
EnvironmentReadHandler
ToolCallHandler
RouteMessageHandler
```

---

# 14. Effect 继续 Exactly-Once

保留 V9 已经建立的：

```text
effect_id
message_id
effect_type
effect_index
payload_hash
status
```

V10 所有产生外部或世界副作用的操作必须经过：

```text
Effect Runtime
```

原则：

```text
没有 Effect ID
=
不能产生副作用
```

因此：

```text
模型重放
进程重启
重复消息
Runtime Recovery
```

都不会导致副作用执行两遍。

---

# 15. Hooks 与 Durable State 分开

参考 Claude Code / DeepSeek Harness。

V10 定义两种完全不同的事件。

## A. Durable Facts

数据库里的事实：

```text
Message
ModelCall
ToolExecution
Effect
EnergyLedger
Run
```

重启以后仍然存在。

## B. Runtime Hooks

只负责观察和扩展运行过程：

```text
run:start
round:start

agent:step:start
agent:step:end

model:before
model:after

tool:before
tool:after

effect:before
effect:after

round:end
run:end
```

Hook 第一版只服务：

```text
Logging
Tracing
Metrics
Tests
UI Event Bridge
```

不得承载核心业务状态。

---

# 16. Persistence 完全从 Runtime 中抽离

Agent Runtime 不能直接：

```text
sqlite.execute(...)
read_json(...)
write_json(...)
Path(...)
```

Runtime 只能调用接口：

```typescript
interface MessageRepository
interface RunRepository
interface PixelRepository
interface BudgetRepository
interface ModelCallRepository
interface ToolExecutionRepository
interface EffectRepository
```

SQLite 是这些接口的一个实现。

这意味着以后：

```text
SQLite
→ PostgreSQL
```

只替换 persistence package。

不用修改 Agent Runtime。

---

# 17. V10 仍然使用 SQLite

V10 不迁 PostgreSQL。

原因是当前运行模式仍然是：

```text
单机
单 Runtime
本地实验
```

SQLite 非常适合。

并继续保留：

```text
WAL
Transaction
BEGIN IMMEDIATE
Exactly-Once
```

不要引入 ORM。

核心事务继续用显式 SQL。

---

# 18. 消除“双重事实源”

V10：

```text
SQLite = Machine State Source of Truth
```

进入数据库：

```text
Runs
Messages
Queue
Energy
Budgets
Model Calls
Tool Executions
Effects
Pixel machine state
```

不再让：

```text
v9_message_queue.json
```

成为第二套 Queue。

`world_state.json` 和 `state.json` 如果继续存在，只作为：

```text
Projection
Debug View
Compatibility View
```

不能反写数据库。

---

# 19. 文件系统只保存“内容”

文件系统继续保存：

```text
pixel.md
environment.md
artifacts/
prompts/
private/
```

原则变成：

```text
Machine State → SQLite

Agent/Human Content → Files
```

这个边界必须严格。

---

# 20. App / Server 层

Fastify Server 只是 Adapter。

结构：

```text
React
  ↓ HTTP
Fastify
  ↓
RunService / QueryService
  ↓
Runtime
```

HTTP Controller 不实现业务逻辑。

例如：

```text
POST /api/run/start
```

只能：

```typescript
runService.start(...)
```

不能自己管理：

```text
Round
Budget
Queue
Agent
```

---

# 21. Frontend 保持现在 React + TypeScript

V9.14 已经做出的 React/Vite 前端继续保留。

V10 不重新设计 UI。

尽量维持现在：

```text
/api/world
/api/pixels/*
/api/run/start
/api/run/stop
/api/run/status
/api/tools
/api/tool-executions
...
```

前端只修改必要的接口适配。

---

# 22. Dependency Rule

必须设置硬依赖规则：

```text
protocol
   ↑
domain
   ↑
runtime

model ─────┐
tools ─────┼─→ runtime
persistence┘
```

禁止：

```text
protocol → runtime
domain → Fastify
domain → SQLite
model → React
tools → Fastify
persistence → runtime
```

最重要的一条：

> **上层依赖接口，下层实现接口。**

---

# 23. V10 不建立“巨型公共 utils”

禁止再形成：

```text
utils.ts
helpers.ts
common.ts
```

不断膨胀。

函数必须归属于：

```text
protocol
domain
runtime
model
tools
persistence
```

之一。

---

# 24. V10 迁移步骤

不要 Big Bang 一次性重写。

## Phase 0 — Freeze V9

建立：

```text
tag: v9-final
```

保存：

* 当前数据库 fixture
* 当前 workspace fixture
* 模拟模型响应
* 当前 API 返回样本
* 当前关键演化结果

作为 V10 Golden Baseline。

---

## Phase 1 — Protocol

先建立：

```text
packages/protocol
```

不改业务。

整理所有：

```text
DTO
Enum
Schema
Status
AgentDecision
Effect
Trace
```

---

## Phase 2 — Persistence

TypeScript 重建：

```text
SQLite CoreStore
Repositories
Transactions
Migrations
```

用 V9 数据跑 Migration Test。

---

## Phase 3 — Domain

迁移：

```text
World
Pixel
Topology
Energy
Reproduction Rules
Message Rules
```

这些全部写成不依赖数据库的领域逻辑。

---

## Phase 4 — Model Runtime

迁移：

```text
PromptBuilder
Provider
ResponseParser
UsageMeter
```

Golden Model Response 测试必须通过。

---

## Phase 5 — Tool Runtime

迁移当前：

```text
ToolRegistry
Artifact Tools
Private File Tools
VPS Tools
ToolExecution
Exactly-Once
```

不新增工具。

---

## Phase 6 — Effect Runtime

建立：

```text
DecisionCompiler
EffectRuntime
EffectHandlers
```

把 Scheduler 中所有业务 if/else 搬出。

同时落实第二部分第 14 节的 Effect 顺序、短路范围和跳过原因；混合响应与 Stop 场景通过后再接入 Scheduler。

---

## Phase 7 — AgentStep

实现：

```text
AgentStepRunner
```

完整跑通：

```text
Message
→ Model
→ Decision
→ Effects
```

---

## Phase 8 — Small Scheduler

最后才实现新的：

```text
RoundScheduler
```

Scheduler 只剩：

```text
beginRound
naturalWake
claimMessage
executeStep
commitMessage
endRound
```

---

## Phase 9 — Server

将 FastAPI 替换为：

```text
Fastify
```

保持 API 契约。

连接现有 React 前端。

按第二部分第 31 节的交付覆盖清单逐项迁移 API、配置和 Windows 启动入口，不能只验证首页与 Run 接口。

---

## Phase 10 — Parity / Replay / Recovery

确认完全等价之后：

删除 Python Runtime。

---

# 第二部分：现有功能在 V10 新架构中的运行

# 1. 整个系统的主链路

最终主链路：

```text
            React UI
                │
                ▼
          Fastify API
                │
                ▼
            RunService
                │
                ▼
         RoundScheduler
                │
          claim Message
                │
                ▼
          AgentStepRunner
                │
      ┌─────────┼─────────┐
      ▼         ▼         ▼
   Context    Model    Protocol
   Runtime   Runtime
      │         │
      └────┬────┘
           ▼
      AgentDecision
           │
           ▼
     DecisionCompiler
           │
           ▼
        Effects[]
           │
           ▼
      EffectRuntime
           │
 ┌─────────┼───────────┐
 ▼         ▼           ▼
Tool     Energy      Router
Runtime  Domain      Domain
 │
 ▼
SQLite / Files
```

---

# 2. 系统启动

启动：

```text
EmergentInc
```

首先：

```text
Boot
 ↓
Load Config
 ↓
Open SQLite
 ↓
Run migrations
 ↓
Create Repositories
 ↓
Create Providers
 ↓
Create Tool Registry
 ↓
Create Effect Registry
 ↓
Create Runtime
 ↓
Create Fastify Server
 ↓
Serve React
```

所有依赖在 Boot 阶段显式组装。

禁止 Runtime 内部偷偷：

```text
new Database()
new OpenAI()
new ToolRegistry()
```

---

# 3. 用户点击“运行 X 轮”

React：

```text
POST /api/run/start
```

进入：

```text
RunController
 ↓
RunService.start()
```

RunService：

1. 校验没有正在运行的 Run；
2. 创建 run_id；
3. 写入 Run Budget；
4. 锁定 Genesis Prompt revision；
5. 锁定 Temporary Prompt revision；
6. 调用 RoundScheduler。

---

# 4. Round 开始

```text
RoundScheduler.beginRound()
```

执行：

```text
round + 1

refresh topology

natural wake check
```

然后：

```text
hook: round:start
```

---

# 5. Natural Wake

保留当前规则：

```text
currentRound - lastActiveRound >= N
```

且：

```text
不存在 pending message
```

则：

```text
enqueue NATURAL_WAKE
```

Natural Wake 只属于：

```text
Scheduler / Domain
```

不进入 Model Runtime。

---

# 6. Scheduler 获取下一条消息

调用：

```text
messageRepository.claimNext()
```

数据库原子变更：

```text
QUEUED
→
PROCESSING
```

不再通过：

```text
v9_message_queue.json
```

维护第二个队列。

`claimNext()` 必须遵守以下调度契约：

* 保存稳定队列顺序与本轮/延期归属；不能依赖 SQLite 未指定 ORDER BY 的返回顺序，也不能仅按时间戳排序。`round_num` 是消息元数据，不能直接替代 V9 延期队列归属。
* 本轮主队列按 FIFO 消费；普通新消息追加队尾；已有控制反馈的队首插入保持批内顺序。
* `MAX_MESSAGES_PER_ROUND = 100`：保留 V9 的“已领取数量 + 主队列长度”入队限制，超过时进入延期队列；轮末将延期队列追加到剩余主队列之后，重置本轮计数。它与 Hop 上限不是同一个限制。
* Pixel 的 `inbox_call_budget_per_round` 以本轮已实际结算消耗加本次预计预留判断，独立于 Pixel 余额、Run 预算和 Global 预算。延期消息本轮不得再次领取。
* 正余额但余额不足的 Pixel 继续 active；预算等待消息仍属于 pending，防止重复自然唤醒。自然唤醒保留 active 条件、阈值和主队列/延期队列去重规则。
* Run / Global 预算不足时停止继续取消息；后续 Run 重新检查预算。不能因 WAITING 状态丢弃消息或自动增加预算。
* `RESPONSE_STORED` 的继续处理与待调用消息分开识别，不能重新走模型调用链。

本次不调整第二部分第 25 节的 Hop 行为；该节与 V9 的已知差异仍属单独待处理的审查项。

---

# 7. 建立 AgentStepInput

Scheduler 不组 Prompt。

它只创建：

```text
AgentStepInput
```

包括：

```text
trace
pixelId
message
round
```

AgentStepRunner 再加载：

```text
PixelState
pixel.md
```

---

# 8. Context Runtime

Context Runtime 严格创建：

```text
state
pixel.md
message.md
```

进行 Cognitive Isolation Validation。

如果发现试图加入：

```text
global world
other pixel mind
complete neighbor memory
host environment
```

立即失败。

---

# 9. PromptBuilder

PromptBuilder 加载：

```text
Genesis Prompt
Temporary Prompt
Tool Catalog
```

形成：

```text
PreparedModelRequest
```

并生成：

```text
promptHash
estimatedTokens
model
pricingRevision
```

---

# 10. 预算预留

AgentStep 在模型调用之前调用：

```text
BudgetService.reserve()
```

一次事务同时检查：

```text
Pixel budget
Run budget
Global budget
Refund deficit
```

保持当前 V9 语义。

---

# 11. 模型调用

流程：

```text
MessageStatus
QUEUED
 ↓
PROCESSING
 ↓
RESERVED
 ↓
CALLING
```

然后：

```text
ModelProvider.call()
```

Provider 只负责 API。

不负责：

```text
预算
工具
世界状态
消息路由
```

---

# 12. 模型调用异常

保留现有三类语义。

## Infrastructure Failure

例如：

```text
network
proxy
authentication
connection
```

结果：

```text
refund reservation
message → QUEUED
run fail fast
```

---

## Invalid Model Response

供应商已经计费，但是响应不可使用：

```text
记录真实 usage
结算成本
保存 raw response
message → QUEUED
stop_reason = MODEL_RESPONSE_INVALID
```

---

## Unknown Outcome

无法确认供应商是否已计费：

```text
CALL_OUTCOME_UNKNOWN
```

规则保持：

```text
不能退款
不能自动 retry
Run pause
```

---

# 13. Response Parser

Raw Response：

```text
ResponseParser
```

统一输出：

```text
AgentDecision
```

V10 Runtime 后续永远不处理供应商原始 JSON。

---

# 14. Decision Compiler

AgentDecision：

```text
pixel_md
environment_read
operations
energy_transfer
reproduce
send_to
message_md
```

转换成标准：

```text
Effects[]
```

例如：

```text
UpdateMind
ReadEnvironment
ToolCall
TransferEnergy
Reproduce
RouteMessage
```

---

## 14.1 Effect 顺序与短路范围

Effect 必须串行执行，顺序固定为：

```text
UpdateMind
→ Owner CapabilityUnavailable / 对应反馈
→ ReadEnvironment
→ ToolCall（operations 原始顺序，最多前三项）/ 工具汇总反馈
→ TransferEnergy（原始数组顺序）/ 各项失败反馈
→ Reproduce / 失败反馈
→ RouteMessage / 路由结果
```

反馈在产生它的阶段按 V9 顺序入队，不能全部移到 Step 末尾，也不能通过并行执行改变顺序。后一个 Effect 校验前一个 Effect 执行后的可见世界，例如先转账再复制、先复制再路由到新子代。

| 结果 | 后续处理 |
| --- | --- |
| 心智校验失败、Owner 能力不可用、确定性转账/复制失败 | 生成相应反馈，继续后续阶段 |
| 某个 Tool FAILED | 停止本批剩余 Tool，保留已有回执并汇总反馈；继续转账、复制和路由 |
| 超过三个 Tool | 只编译前三项，与 V9 截断行为一致，不执行多余项 |
| Tool 或其他副作用 UNKNOWN | 按本计划已有的 UNKNOWN 暂停要求阻断后续 Effect；不得当作确定失败继续提交 |
| 用户 Stop | 使用第二部分第 27 节的 V9 兼容边界，不隐式改为整条 Effect 链取消 |

未执行的剩余 Tool 使用编排层 `SKIPPED` 和原因（如 `PRIOR_TOOL_FAILED`、`USER_STOPPED`）区分，不伪造 SUCCESS/FAILED 工具回执，也不改变 ToolResult 的三种状态。已进入 V9 工具调用边界并返回 `FAILED/USER_STOPPED` 的调用，仍保留该回执。

`UNKNOWN` 全链暂停是原计划已有要求，不能假称已经与 V9 完全等价；其现有差异应在验收报告中单列，本次不展开恢复算法。

---

# 15. 心智更新

执行：

```text
UpdateMindEffect
```

验证：

```text
pixel.md <= 2000 chars
```

合法：

```text
save pixel.md
```

非法：

```text
不修改原 pixel.md
+
创建 ENGINE_FEEDBACK message
```

保持 V9 行为。

---

# 16. Owner Request

V10 不重新启用 Owner Approval。

如果模型产生：

```text
owner_request
```

转换：

```text
CapabilityUnavailableEffect
```

结果：

```text
ENGINE_FEEDBACK
CAPABILITY_UNAVAILABLE
```

不中断 Run。

---

# 17. Environment Read

模型请求：

```text
environment_read = true
```

产生：

```text
ReadEnvironmentEffect
```

Effect Handler：

```text
读取 environment.md
       ↓
生成 ENVIRONMENT Message
       ↓
加入 Message Queue
```

仍然不是直接塞入当前模型 Context。

---

# 18. Tool 调用

AgentDecision：

```text
operations[]
```

转换：

```text
ToolCallEffect[]
```

进入：

```text
ToolRuntime
```

流程：

```text
ToolCall
 ↓
ToolRegistry.resolve
 ↓
Validate Args
 ↓
record STARTED
 ↓
Tool.execute
 ↓
record SUCCESS / FAILED / UNKNOWN
 ↓
ToolResult
 ↓
ENGINE_FEEDBACK
```

保持：

```text
单 Step 最大 3 个 Tool
```

保持失败后停止剩余 Tool。

这里仅停止剩余 Tool，不停止后续转账、复制和路由；`UNKNOWN` 与用户 Stop 按第 14、27 节分别处理。

---

# 19. Artifact 工具

当前三项：

```text
save_artifact
read_artifact
list_artifacts
```

保持完全相同。

Artifact 继续：

```text
workspace/live/artifacts/{pixel_id}/
```

并保持 Pixel 隔离和路径穿越保护。

其余九项工具同样属于迁移范围：私有文件三项由 `private_files` 对应实现迁移，VPS 六项由 `vps` 对应实现迁移。工具目录、配置、Prompt Catalog、调用回执和 UI 历史必须覆盖全部 12 项；离线验收使用固定文件和模拟 VPS 结果，不连接真实 VPS 执行写操作。

---

# 20. Energy Transfer

模型产生：

```text
energy_transfer
```

转换：

```text
TransferEnergyEffect
```

Handler 校验：

```text
target 是否合法
是否直接邻居
目标是否 active
余额是否充足
```

数据库事务：

```text
sender -
receiver +
ledger entry
```

Effect ID 保证 Exactly-Once。

---

# 21. Reproduction

模型产生：

```text
reproduce
```

转换：

```text
ReproduceEffect
```

Handler：

```text
validate direct neighbor
 ↓
validate empty position
 ↓
validate energy
 ↓
create child
 ↓
transfer initial energy
 ↓
create child pixel.md
 ↓
refresh topology
```

保持当前行为。

---

# 22. Message Routing

模型：

```text
send_to
message_md
```

转换：

```text
RouteMessageEffect
```

Router：

```text
validate route
 ↓
create MessageEnvelope
 ↓
enqueue SQLite message queue
```

保留：

```text
hop
round_num
sender
recipient
source_type
feedback
```

---

# 23. Engine Feedback

以下所有 Runtime 结果：

```text
Tool Result
Mind Validation Failure
Transfer Failure
Reproduce Failure
Capability Unavailable
Hop Limit
```

统一经过：

```text
FeedbackFactory
```

转换成：

```text
ENGINE_FEEDBACK Message
```

不要各 Handler 自己拼不同格式。

---

# 24. Message Commit

只有全部需要执行的 Effect 已经：

```text
SUCCESS
或者确定性 FAILED
或者按既定短路规则 SKIPPED（仅编排状态，必须记录原因）
```

当前 Message 才：

```text
COMMITTED
```

如果发生不确定副作用：

```text
UNKNOWN
```

Run 必须暂停恢复。

---

# 25. Round Hop Limit

保持现有：

```text
MAX_HOPS_PER_ROUND
```

达到限制：

当前工作延期到：

```text
round + 1
```

不能丢失 Message。

---

# 26. Round End

Message Queue 在本轮无更多可运行消息后：

```text
RoundScheduler.endRound()
```

更新：

```text
round
active_pixels
model_calls_completed
messages_processed
activity_status
stop_reason
```

然后：

```text
hook: round:end
```

---

# 27. 用户 Stop

UI：

```text
POST /api/run/stop
```

设置：

```text
CancellationToken / AbortSignal
```

Stop 的 V9 兼容契约：

| Stop 被观察到的位置 | 处理方式 |
| --- | --- |
| 领取下一条消息之前 | 停止本轮，不再领取 |
| 已预留、模型尚未调用 | 退还本次预留，消息回队首，结束本轮 |
| 模型调用已经开始 | 不新增强制 abort 语义；等待原调用返回或进入既有异常分支，按真实结果记账 |
| 进入 operations 批次之前 | 跳过本批工具；继续当前消息的转账、复制、路由和提交 |
| 工具批次内部、某个工具执行之前 | 按 V9 工具边界记录停止回执并停止剩余工具，之后继续当前消息的非工具阶段 |
| 工具已经开始 | 沿用该工具现有协作式停止能力，不承诺远端动作已撤销；结果按 SUCCESS/FAILED/UNKNOWN 处理 |
| 当前消息已经获得响应且在非工具 Effect 阶段 | 完成当前消息的既定非工具阶段与提交，再在下一次领取前停止 |

已经发生的副作用不能回滚。

`AbortSignal` 只是传递停止意图，不能统一解释为立刻中断所有网络请求和 Effect。最终停止原因保留 `USER_STOPPED`；若发生 UNKNOWN，则优先保留恢复暂停原因。更严格的“Stop 后不再执行任何新 Effect”属于行为变更，不在本次纯重构中引入。

---

# 28. Crash Recovery

这是 V10 必须重点验证的部分。

重启以后：

```text
SQLite
 ↓
RecoveryService
```

扫描：

```text
PROCESSING messages
OPEN reservations
CALL_OUTCOME_UNKNOWN
STARTED tool executions
uncommitted effects
```

然后按照既定规则：

```text
retry
resume
replay
pause-for-recovery
```

不能简单“重新运行整个 Step”。

---

# 29. Replay

V10 增加的是架构测试能力，不是产品功能。

对于已保存：

```text
Normalized Model Response
```

测试时：

```text
禁用真实 LLM
 ↓
Replay Response
 ↓
DecisionCompiler
 ↓
Effects
 ↓
World
```

比较 V9 / V10 最终状态。

重放输入还必须固定：初始文件内容、环境读取结果、工具返回值、目录排序、Prompt/工具目录/价格配置版本，以及时间和 ID 生成器。读操作也可能观察到变化，不能在 Replay 中重新读取真实 VPS 或可变外部文件。每次 V9/V10 运行使用独立的初始状态副本。

---

# 30. V9 → V10 Parity Test

必须建立一批 Golden Scenario。

例如：

### Scenario A

```text
普通 Message
→ Model
→ STOP
```

### Scenario B

```text
Pixel A
→ message
→ Pixel B
```

### Scenario C

```text
Energy Transfer
```

### Scenario D

```text
Reproduction
```

### Scenario E

```text
save_artifact
```

### Scenario F

```text
environment_read
```

### Scenario G

```text
Budget Exhausted
```

### Scenario H

```text
Invalid Response
```

### Scenario I

```text
Tool Failure
```

### Scenario J

```text
Crash + Replay
```

---

# 31. V10 最终验收标准

V10 必须满足：

### 跨语言兼容与比较规则

* 文本长度沿用 Python `len(str)` 的 Unicode 码点计数；TypeScript 不得直接用 UTF-16 `.length` 替代。`pixel.md` 与 `message.md` 都保留 2000 码点限制，覆盖中文、emoji、组合字符和 1999/2000/2001 边界；不擅自进行 Unicode 归一化。
* Prompt 文本、换行、JSON 空格/键序/转义、UTF-8 编码分别固定 fixture。对参与 Prompt Hash、参数 Hash、Effect/Operation ID 的序列化，逐调用点复现 V9 格式；不能统一换成 `JSON.stringify()` 后声称 Hash 兼容。
* 旧 ID/Hash 按原值保留，不因语言迁移重算；新生成值以相同输入的 V9 fixture 验证。Hash 不匹配必须报出差异，不通过忽略字段绕过幂等身份检查。
* 金额、能量、token 的类型、整数转换、缓存 token 计价、取整和显示精度以现有调用点为准。测试覆盖零值、边界值、负值、浮点边界和缺省字段；不能用宽泛浮点误差掩盖余额或预算不同。明确 JS 安全整数范围并验证现有数据范围，禁止静默丢失精度。
* JSON Schema 与 TypeScript 类型只能有一个契约来源并做一致性检查。Ajv 的类型强转、默认值注入、移除额外字段不得默认启用；缺字段、null、空字符串、额外字段和 V9 兼容响应格式分别建立 fixture。
* 新建随机 ID 优先注入相同生成序列；确需比较不同 ID 时，仅对明列的随机 ID 建立双向一一映射，并检查所有引用关系。旧 ID、派生操作 ID、Hash、队列次序、状态、账本数量和副作用次数不得忽略。时间戳使用固定时钟，耗时字段只允许在明列的观测字段中排除。
* 等价比较同时覆盖中间轨迹与最终状态：模型请求次数/内容、工具调用顺序/参数、反馈入队顺序、预算结算、消息终态和文件内容。已有计划与 V9 的未解决差异须逐项报告，不得统一放宽断言后宣告完全等价。

必测组合：12 项工具各自的成功/失败契约；禁用和非法参数；第二个工具失败导致第三个跳过但后续转账继续；转账后复制；复制后向子代路由；不同 Stop 边界；预算等待跨轮/跨 Run；队首反馈与延期 FIFO；Unicode 和 Hash 固定向量。UNKNOWN 按原计划目标单列验证，不把 V9 当前实现自动当作正确答案。

### 整个项目的交付覆盖清单

Phase 0 为以下每项保存当前契约与 fixture，Phase 9 逐项对照验收。所有 API 均带 `/api` 前缀，静态入口除外。

| 现有入口 / 能力 | V10 对应实现 | 必须保留的验收内容 |
| --- | --- | --- |
| GET /world、/pixels/{pixel_id} | QueryService | DTO 字段、空值、账户/状态投影、凭据不泄露 |
| POST /run/start、/run/stop；GET /run/status | RunService | 请求默认值、预算参数、并发启动拒绝、轮次/停止原因/兼容状态字段 |
| GET/POST /environment | 内容服务 | content 与 length 返回、编辑后主动读取行为 |
| GET/PUT /genesis-prompt、/temporary-prompt | Prompt 服务 | revision/hash、内容校验、Run 内锁定、运行中编辑返回 409 |
| GET /tools、/tool-executions | 工具查询服务 | 12 项目录及配置字段、run_id/pixel_id 筛选、limit 默认值与范围、回执结构 |
| GET /pixels/{pixel_id}/document/{doc_name} | 内容查询服务 | 文档 allowlist、文本内容、非法/越权/不存在的错误 |
| GET /pixels/{pixel_id}/artifacts 及其 /{filename}、/{filename}/download 子路径 | Artifact Adapter | 列表排序、预览、下载字节、文件名、Content-Type/Content-Disposition、隔离与路径校验 |
| GET /private-files、/private-files/preview | 私有文件 Adapter | path 查询参数、目录排序、敏感文件标识、图片与凭据访问限制 |
| GET /loops、/owner/requests、/audit/workspace | 兼容查询 Adapter | 已有只读入口与返回形状、运行中审计结果；不重新启用 Loop/审批写接口 |
| React 静态页面、/assets、未知 /api 路径 | Fastify 静态 Adapter | 首页加载、资源路径、构建产物缺失返回 503、未知 API 返回 JSON 404 |
| 配置与内容资源 | Boot / 对应 Adapter | world_config、model_pricing、模型/代理环境配置、tools.json、VPS profile/known_hosts、Prompt revision 文件；读取路径、默认值与凭据隔离 |
| EmergentInc_UI.bat / EmergentInc_UI.ps1、README 启动说明 | Node 启动入口 | Windows 中文路径、工作目录独立、开发/生产构建启动、端口复用识别、浏览器打开、退出；删除 Python 主运行依赖后仍可启动 |
| 现有 CLI 与离线脚本 | 逐入口处置清单 | 冻结基线时列明 README/脚本实际引用的初始化、自检、审计等命令；仍受支持的入口迁移或提供等价 TS 命令，历史停用入口明确标识，不能因删除 Python 静默丢失受支持能力 |

API 契约测试记录 method、path/query/body、必填/可选/默认值、成功和错误状态码、错误 JSON 结构（含 `detail`）、文件响应头与字节。Fastify 默认参数校验错误不得无意替换 FastAPI 的既有 422 契约；400/403/404/409/422/500 按实际入口建立样本。前端只做明确列出的必要适配。

测试同时保留工具 `enabled`、`effect`、`timeout_seconds` 配置和实际执行边界；完成 API 自动化验收后，在 Windows 做一次现有 React 页面与启动脚本的端到端验证。

### Architecture

* Scheduler 不实现具体业务 Effect；
* Model 不依赖 Persistence；
* Tool 不依赖 Scheduler；
* Domain 不依赖 HTTP；
* Runtime 不直接执行 SQL；
* Frontend 不拥有业务状态机；
* Protocol 为唯一跨层数据契约。

### Functional Parity

相同：

```text
Initial World
Model Responses
Prompts
Budget
```

必须得到等价：

```text
Pixel State
pixel.md
Messages
Energy
Artifacts
Tool Executions
Model Accounting
Stop Reason
Final World
```

### Recovery

任何以下位置中断：

```text
Before Model
After Model
Before Tool
After Tool
Before Effect
After Effect
Before Message Commit
```

重启都不得：

```text
重复收费
重复 Tool
重复 Transfer
重复 Reproduce
重复 Message
```

---

# 32. V10 完成后的结构

最终：

```text
                  EmergentInc V10

                    Protocol
                       │
        ┌──────────────┼───────────────┐
        │              │               │
      Domain        Runtime          Model
        │              │               │
        │        ┌─────┴─────┐         │
        │        │ AgentStep │         │
        │        │ Scheduler │         │
        │        │ Effects   │         │
        │        │ Hooks     │         │
        │        └─────┬─────┘         │
        │              │               │
        └──────────────┼───────────────┘
                       │
                Persistence Ports
                       │
                    SQLite
                       │
              ┌────────┴────────┐
              │                 │
            Files            Fastify
              │                 │
         pixel.md etc.       React UI
```

---

# 33. V10 的最终设计原则

V10 应始终遵守以下六句话：

> **Protocol 定义语言。**

> **Domain 定义规则。**

> **Runtime 定义流程。**

> **Provider 提供能力。**

> **Effect 改变世界。**

> **Persistence 保存事实。**

Scheduler 只做调度。

模型只做决策。

Tool 只做能力。

UI 只做人机交互。

这就是 EmergentInc V10 的架构边界。
