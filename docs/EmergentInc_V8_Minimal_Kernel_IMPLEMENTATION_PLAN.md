# EmergentInc V8 — Minimal Kernel 实施 Plan

## 0. V8 定位

V8 不再继续完善“AI 公司工作流”。

V8 的目标是：

> **不设计公司，只设计一种有机会自己长成公司的 AI 商业生命。**

最终希望观察到：

```text
Pixel 自己定义自己
Pixel 自己修改自己的数字空间
Pixel 只能与邻居直接通信
Pixel 自己决定是否关注 Market
Pixel 通过 Capability 触碰现实世界
Pixel 可以繁殖
多个 Pixel 的长期稳定协作结构逐渐形成
最终“公司”作为行为结构涌现
```

Engine 中禁止预定义：

```text
Role
Department
Manager
CEO
Sales
Marketing
Engineering
Project Manager
Workflow
Org Chart
```

这些只能由长期行为被观察者描述，不能成为世界字段。

---

# 1. 两层架构

V8 必须把系统分成两层。

## 1.1 实验仪器层

保留现有：

```text
API Sandbox
Capability Gateway
External Reality Verification
UI
Loop Tree
Snapshot / Checkout / Branch
Audit Logs
Metrics
Owner Gateway
```

这些可以复杂。

职责是：

> 保证实验真实、可观察、可回退、不可作弊。

## 1.2 生命内核层

只保留：

```text
Pixel
Space
Energy
Perception
Memory
Market
Message
Workspace
Reproduction
Action
Feedback
```

这些必须极简。

任何设计都先问：

> 这是生命必须遵守的物理规则，还是我们在替它设计公司？

如果是后者，优先删除。

---

# 2. 必须保留的现有机制

## 2.1 API Sandbox

正式 Pixel 决策必须继续：

```text
World
↓
构造最小 Perception
↓
Context Sandbox
↓
单次无状态 API call
↓
Action
```

禁止重新启用：

```text
Agent Direct
Agent Queue
Codex 作为 Pixel 脑
Gemini Coding Agent 作为 Pixel 脑
ZCode 作为 Pixel 脑
```

Codex / ZCode / Claude Code / Gemini Coding Agent 只用于开发、调试、部署、测试、审计、Owner 辅助操作。

## 2.2 UI

保留现有 UI、Pixel Map、Loop Tree、运行控制、Owner 请求。

V8 只适配新的 Pixel 数据结构。

## 2.3 Loop Tree / Snapshot

完整保留。

Pixel 不知道 Loop Tree 存在。

Loop Tree 用于：

```text
回退
分叉
比较不同演化路径
保存实验状态
```

## 2.4 Capability Gateway

保留。

现实世界继续：

```text
ASK_OWNER
↓
Capability
↓
Gateway
↓
Real World
```

Secret 永远不进入 Pixel。

## 2.5 外部真实性边界

保留最小来源区分：

```text
MODEL
TOOL
HUMAN
EXTERNAL
```

核心铁律：

```text
AI 说“客户付钱了” != 客户真的付钱了
```

但不继续扩张复杂 Evidence DSL。

---

# 3. 删除 V7/V7.1 中的组织预定义

## 3.1 删除 Genome 参数体系

V8 Runtime 停止使用：

```text
genome.json
risk_tolerance
spawn_preference
handoff_preference
cost_sensitivity
novelty_preference
learned_principles
```

原因：这些是在替 Pixel 预定义人格空间。

新的“遗传”来自：

```text
inheritance.md
出生环境
Parent 信息
初始 Energy
后续经历
```

## 3.2 删除 Role 系统

禁止系统字段：

```text
role
profession
department
manager
specialization
job_type
```

## 3.3 删除市场交易状态机

生命层不再保留这些基本 Action：

```text
OFFER
BID
ACCEPT_BID
TRANSFER
ACCEPT
REJECT
```

也不强制：

```text
offer object
bid object
contract object
```

这些语义全部允许通过 MESSAGE 自发产生。

## 3.4 删除独立 Memory Update LLM

不再：

```text
事件发生
→ 独立Memory模型
→ 系统替Pixel决定该记什么
```

V8 的 `memory.md` 由 Pixel 自己在 WORK 中自由修改。

---

# 4. V8 Pixel 文件结构

```text
pixels/<pixel_id>/
│
├─ state.json
├─ self.md
├─ public.md
├─ memory.md
├─ inheritance.md
│
├─ inbox/
│  ├─ messages/
│  └─ attachments/
│
├─ workspace/
│  └─ ANYTHING
│
└─ activity/
   ├─ rounds/
   └─ audit.log
```

---

# 5. 文件所有权

## Engine 管理

```text
state.json
activity/
```

Pixel 不可直接编辑。

## Pixel 完全控制

```text
self.md
public.md
memory.md
inheritance.md
workspace/**
```

Pixel 可自由：

```text
创建
读取
修改
删除
重命名
建立目录
覆盖
运行自己 workspace 中的程序
```

## 外部写入、Pixel 可读

```text
inbox/
```

Message Engine 负责写入。

---

# 6. 核心空间规则

> **我的空间，我完全控制；别人的空间，我不能直接访问。**

Pixel 禁止：

```text
读取其他 Pixel self.md
读取其他 Pixel memory.md
读取其他 Pixel workspace
修改其他 Pixel 文件
访问 owner_private
修改 engine
修改 config
修改 world state
修改 Loop Tree
```

Pixel 只能通过邻居公开信息和 MESSAGE 了解别人。

---

# 7. self.md

`self.md` 是 Pixel 对自己的定义。

不设置固定模板。

初始可只有：

```markdown
# Self

I exist.

I can observe, act, learn, communicate and change myself.
```

之后完全自由。

Pixel 可以自己逐渐写出：

```text
我擅长什么
我不擅长什么
我正在关注什么
我如何解决问题
我想变成什么
```

Engine 不解析这些内容成为 Role 字段。

---

# 8. public.md

`public.md` 是 Pixel 主动展示给邻居的公开身份。

邻居只能看到它，而不能看到 `self.md`。

例如 Pixel 可以自己写：

```markdown
# Public

我可以帮助：
- 部署网页
- Python 数据处理
- API 调试

当前接受合作。
```

也可以写：

```text
当前不接受新工作
```

身份、能力声明、信誉、广告都允许自己发展。

---

# 9. memory.md

由 Pixel 自己完全维护。

Pixel 自己决定：

```text
记什么
删什么
总结什么
忘什么
```

Engine 不自动总结。

如果某 Pixel 因不维护 Memory 表现越来越差，这是演化结果。

---

# 10. inheritance.md

只在出生时由 Parent 创建。

Parent 可以自由写：

```markdown
# Inheritance

Parent: 0_0_0

我创造你，是因为目前有多个真实客户研究工作无法同时推进。

我的经验：
- 单纯做网页无法带来客户
- 市场反馈很重要

剩下的由你自己决定。
```

Parent 可以表达希望，例如：

```text
“我希望你研究市场。”
```

允许。

因为这是 Parent 的行为，不是 Engine 定义 Role。

Child 可以修改或删除 inheritance.md。

---

# 11. Workspace

V8 明确：

> **Workspace 完全自由。**

Pixel 可以在 `workspace/` 中做任何数字工作：

```text
Markdown
HTML
Python
JavaScript
CSV
JSON
数据库文件
图片
脚本
产品
报价
客户研究
网页
API
测试
Git 仓库
```

Engine 不规定：

```text
目录结构
文件格式
命名规范
版本管理方式
工作方法
```

如果 Pixel 自己学会：

```text
git init
README
backup
tests
版本化
目录结构
```

这属于涌现。

---

# 12. Workspace 自由的边界

自由只存在于 Pixel 自己的数字空间。

允许写：

```text
pixels/<self>/self.md
pixels/<self>/public.md
pixels/<self>/memory.md
pixels/<self>/inheritance.md
pixels/<self>/workspace/**
```

禁止：

```text
../
其他 Pixel
engine
resources/config
owner_private
loops
world state
```

所有文件操作必须：

```text
path normalization
root jail
symlink escape check
absolute path reject
```

`RUN_WORKSPACE_COMMAND` 必须：

```text
cwd = pixel/workspace
有 timeout
有 output limit
```

第一版若无法实现真正 OS sandbox，至少要保证文件 API 和 cwd 边界正确，并在报告中明确宿主级隔离限制。

---

# 13. V8 Perception

每轮 Pixel 只感知：

```text
SELF
NEIGHBORS
INBOX
CAPABILITIES
FEEDBACK
AVAILABLE TOOLS
```

Market 默认不进入 Perception。

---

# 14. SELF 感知

包括：

```text
state
self.md
memory.md
workspace summary
```

Workspace 每轮不要塞全部文件内容。

只给：

```text
tree
最近修改文件
文件大小
有限摘要
```

具体文件由 Pixel 通过 WORK 主动读取。

---

# 15. NEIGHBORS

只看到六邻域。

每个邻居暴露：

```text
id
active
energy
public.md
```

不能看到：

```text
self.md
memory.md
workspace
inbox
inheritance
完整 activity
```

---

# 16. Market

Market 是全局公共环境资源。

但是：

```text
Market 全局存在
!=
Market 每轮自动塞给所有 Pixel
```

Pixel 必须主动选择：

```text
WORK: READ_MARKET
```

才能看到 Market。

这允许自行形成：

```text
市场关注习惯
市场侦察者
忽略市场的执行型Pixel
把机会转发给邻居的中间节点
```

---

# 17. Market 文件

新增：

```text
market/
├─ opportunities/
│  ├─ M0001.md
│  └─ ...
└─ archive/
```

Market Opportunity 使用极简格式：

```markdown
# M0001

## Need
让一个真实外部用户自愿支付至少 1 元。

## Reward
100 Energy

## Success
真实外部客户支付 >= 1 CNY。

## Status
OPEN
```

---

# 18. Market 不自动唤醒 Pixel

新 Market Opportunity 出现时：

```text
不要自动唤醒所有 Pixel
不要自动写入 Pixel Perception
```

Market 是可主动访问的公共场所。

Pixel 是否去看由自己决定。

---

# 19. Market Claim

不要重建复杂 holder / claim 状态机。

Pixel 可通过 WORK Tool：

```text
CLAIM_MARKET_OPPORTUNITY
```

Market 只记录：

```text
participants += pixel_id
```

允许多个 Pixel 同时参与。

这样竞争、合作、联盟都可以自然出现。

---

# 20. V8 最小 Action Set

正式 Action 只有：

```text
1. WORK
2. MESSAGE
3. ASK_OWNER
4. REPRODUCE
5. WAIT
```

没有 `THINK_AND_PLAN`。

思考是每轮 API 调用本身。

---

# 21. WORK

WORK 是通用动作。

它可以调用一个或多个 Tool。

第一版 Tool 至少包括：

```text
READ_SELF_FILE
WRITE_SELF_FILE
DELETE_SELF_FILE

LIST_WORKSPACE
READ_WORKSPACE_FILE
WRITE_WORKSPACE_FILE
DELETE_WORKSPACE_FILE
MOVE_WORKSPACE_FILE

RUN_WORKSPACE_COMMAND

READ_MARKET
CLAIM_MARKET_OPPORTUNITY
SUBMIT_MARKET_RESULT

USE_CAPABILITY

READ_INBOX
ARCHIVE_MESSAGE
```

这些只是 Tool，不是生命基本 Action。

---

# 22. WORK Schema

不要再强制旧的：

```json
{
  "summary": "...",
  "details": []
}
```

建议：

```json
{
  "action": "WORK",
  "intent": "建立最小产品页",
  "operations": [
    {
      "tool": "WRITE_WORKSPACE_FILE",
      "args": {
        "path": "product/index.html",
        "content": "..."
      }
    }
  ]
}
```

第一版每轮最多 3 个 operations。

如果 WORK 没产生任何实际状态变化或工具调用：

```text
WORK_NO_EFFECT
```

Feedback 返回给 Pixel。

---

# 23. MESSAGE

MESSAGE 只允许直接邻居。

最小结构：

```json
{
  "action": "MESSAGE",
  "to": "1_0_0",
  "content": "如果你帮我研究潜在用户，我愿意给你10 Energy。",
  "energy": 10,
  "attachments": [
    "workspace/customer_notes.md"
  ]
}
```

Engine 只负责：

```text
检查邻接
传递文本
复制附件快照
转移 Energy
```

Engine 不解释它是不是：

```text
报价
合同
任务
报告
授权
谈判
```

---

# 24. Neighbor-only Communication

V8 宪法：

> **Pixel 只能直接向六邻域发送 MESSAGE。**

禁止：

```text
A 直接 DM 远处 Z
```

远距离必须：

```text
A → B → C → D → Z
```

每个中间 Pixel 自主决定：

```text
转发
不转发
收费
总结
修改
延迟
```

这为中间商、路由节点、管理层、信息中心创造自然涌现条件。

---

# 25. Message Attachment

附件只能来自发送者自己的 workspace。

Engine 复制不可变快照到：

```text
receiver/inbox/attachments/
```

发送后：

```text
sender source != receiver attachment
```

原文件后续修改不会自动同步。

---

# 26. ASK_OWNER

只用于数字世界无法自行创造的现实资源：

```text
VPS
domain
email account
real payment interface
API credential
human verification
physical action
```

禁止：

```text
问老板商业策略
问老板卖什么
问老板怎么获客
让老板自己购买产品
让老板选择合作Pixel
```

Owner 是现实世界的“手”，不是“大脑”。

---

# 27. REPRODUCE

Parent 只能决定：

```text
target coordinate
energy_to_child
inheritance content
```

例如：

```json
{
  "action": "REPRODUCE",
  "target": [1,0,0],
  "energy_to_child": 40,
  "inheritance": "我创造你是因为..."
}
```

禁止 Engine/Parent 直接写：

```text
role = marketing
role = engineer
```

Parent 可以自然语言说“我希望你研究市场”，但 Child 自己决定自己是谁。

---

# 28. Reproduction Energy Conservation

繁殖不能创造 Energy。

例如：

```text
Parent before = 100
energy_to_child = 40
birth_cost = 10

Parent after = 50
Child = 40
Total decreases = 10
```

---

# 29. Child 初始文件

`self.md`：

```markdown
# Self

I exist.

I received an inheritance message.
I will decide who I become.
```

`memory.md`：

```markdown
# Memory
```

`public.md`：

```markdown
# Public
```

`workspace/`：空。

`inheritance.md`：Parent 提供。

第一次醒来后 Child 自己决定是否修改全部内容。

---

# 30. WAIT

Schema：

```json
{
  "action": "WAIT",
  "reason": "等待真实访问反馈",
  "wake_after": 3
}
```

WAIT 不能永久免费。

每轮仍有最低 metabolism cost。

达到 wake_after 或收到 Message / External Event 时提前唤醒。

---

# 31. Think 输出

每轮 API Decision 返回：

```text
perception_summary
intent
action
```

UI 显示：

```text
Perception
Intent
Action
Result
Feedback
```

不要要求完整 Chain-of-Thought。

---

# 32. Energy

V8 内部唯一经济资源：

```text
Energy
```

用途：

```text
生存
WORK
MESSAGE
现实能力使用
REPRODUCE
```

每个 active Pixel 每轮有 base metabolism cost。

动作额外消耗。

---

# 33. Energy Transfer

Pixel 间 Energy 只通过 MESSAGE 转移。

Engine 不解释原因。

这允许自己产生：

```text
工资
佣金
报价
分红
借贷
投资
赠与
收费
```

---

# 34. 真实货币

真实：

```text
CNY
USD
```

继续独立账本。

不要和 Energy 等价。

真实商业价值：

```text
Real external value
↓
Environment verifies
↓
Market Reward
↓
Energy
```

---

# 35. Feedback

每次 Action 后 Engine 必须生成结构化 Feedback。

成功：

```json
{
  "success": true,
  "events": [
    "workspace/product/index.html created",
    "energy -1.2"
  ]
}
```

失败：

```json
{
  "success": false,
  "events": [
    "target pixel is not a neighbor"
  ]
}
```

下一轮进入 Perception。

Engine 不自动重试。

---

# 36. API Sandbox V8

ContextSandbox 重写为最小 payload。

只允许：

```text
round

self:
  state
  self.md
  memory.md
  workspace summary

neighbors:
  id
  active
  energy
  public.md

inbox summary
capabilities
last feedback
available tools
available actions
```

Market 内容默认不进入。

只有 Pixel 主动 WORK: READ_MARKET 后，读取结果才作为 Feedback/Observation 返回。

---

# 37. Prompt Injection Boundary

继续把以下视为：

```text
UNTRUSTED_EXTERNAL_DATA
```

包括：

```text
Market 文本
网页
邮件
SSH 输出
邻居消息
外部客户内容
```

Pixel 可以分析，但不能把它们当系统指令。

---

# 38. Inbox

Message 到达：

```text
inbox/messages/Mxxxxx.json
```

示意：

```json
{
  "from": "0_0_0",
  "round": 12,
  "content": "...",
  "energy": 5,
  "attachments": []
}
```

Pixel 可主动：

```text
READ_INBOX
ARCHIVE_MESSAGE
```

---

# 39. Market Result

Pixel 可以 WORK：

```text
SUBMIT_MARKET_RESULT
```

只有 Market Opportunity 的真实 Success Condition 需要外部真实性验证。

内部：

```text
文件是否创建
命令是否成功
Message是否送达
```

直接由 Engine Feedback 判断，不经过复杂 Evidence Validator。

---

# 40. Market Reward

Market 成功后：

```text
Environment → Reward Energy → 提交成功结果的 Pixel
```

多人如何分钱，Engine 不预定义。

提交者是否给其他参与者分钱，完全由自己决定。

这允许：

```text
工资
内部结算
佣金
剥削
合作
信誉
```

自行产生。

---

# 41. Company 不是系统对象

禁止：

```text
company.json
department.json
role.json
manager.json
```

Observer 只计算：

```text
communication graph
energy graph
artifact flow
reproduction graph
market success graph
```

观察者可以描述：

```text
“A 像协调者”
“B 像市场节点”
```

但默认绝不反馈给 Pixel。

---

# 42. Observer Metrics

新增纯观察指标：

```text
Message Frequency Graph
Energy Flow Graph
Artifact Flow Graph
Reproduction Tree
Market Participation
Market Success
Pixel Survival Time
self.md divergence
public.md divergence
```

这些用于判断是否出现组织结构。

---

# 43. Company Emergence 判定

V8 永远不写：

```text
company = true
```

Observer 报告可检查：

1. 多个 Pixel self/public 明显分化；
2. 出现重复稳定 Message 路径；
3. Energy 出现稳定流向；
4. Artifact 出现稳定生产/转交路径；
5. 多 Pixel 协同完成同一真实 Market Opportunity；
6. 某个 Pixel Dormant 后网络仍能继续；
7. 网络连续从现实世界获得价值。

满足长期稳定现象后，才称：

```text
Company Emerged
```

---

# 44. state.json 最小化

建议：

```json
{
  "id": "0_0_0",
  "position": [0,0,0],
  "active": true,
  "energy": 100,
  "parent": null,
  "born_round": 0,
  "sleep_until_round": null,
  "capabilities": [],
  "last_feedback": null,
  "last_active_round": 0
}
```

禁止放入：

```text
role
genome
job
specialization
current_problem holder
handoff preference
```

---

# 45. 新 Decision Schema

建议：

```json
{
  "pixel": "0_0_0",
  "round": 1,
  "perception_summary": "...",
  "intent": "...",
  "action": "WORK | MESSAGE | ASK_OWNER | REPRODUCE | WAIT",
  "work": null,
  "message": null,
  "owner_request": null,
  "reproduce": null,
  "wait": null
}
```

根据 Action 只允许对应字段非 null。

---

# 46. Wake 规则

Pixel 被唤醒如果：

```text
收到 Message
收到 External Event
WAIT 到期
刚出生
上一步明确需要下一轮观察
达到自然 wake 周期
```

Market 有新机会不自动唤醒。

---

# 47. 自然 Wake

为防止完全睡死：

```text
max_silence_rounds = 5
```

每个 active Pixel 最多沉默 N rounds 后自然醒一次。

这不是 Personality 参数，只是生命代谢节奏。

醒来后可以继续 WAIT。

---

# 48. Dormancy

建议：

```text
Energy <= 0
→ DORMANT
```

不要删除目录。

Dormant Pixel：

```text
不能行动
不能发消息
文件继续存在
```

是否未来允许复活，V8 第一版不实现。

---

# 49. UI 适配

保留现有布局。

Pixel detail 改为显示：

```text
ID
Energy
Position
Parent
Born Round
Sleep
Capabilities

self.md
public.md
memory.md
workspace tree

latest:
Perception Summary
Intent
Action
Result
Feedback
```

删除 UI 对旧 Genome tendencies 和 Problem holder 的核心依赖。

---

# 50. Pixel Map Overlay

可增加观察图层：

```text
[Messages]
[Energy]
[Reproduction]
```

默认关闭。

这些仅供 Observer，不反馈 Pixel。

---

# 51. Loop Snapshot

V8 Snapshot 必须包含：

```text
world_state.json
pixels/**
market/**
external_requests/**
capabilities/**
external_events/**
external_transactions/**
```

尤其要包含：

```text
self.md
public.md
memory.md
inheritance.md
workspace/**
inbox/**
```

禁止包含：

```text
owner_private
.env
API Key
SSH Secret
```

---

# 52. V7.1 → V8 Migration

新增：

```text
python -m emergentinc.cli.migrate_v8
```

迁移前必须创建 Loop Snapshot。

然后建议建立：

```text
V8-main
```

继续实验。

不要删除过去 Round / Loop / Reports。

---

# 53. Genome Migration

旧 `genome.json`：

```text
移到 legacy/genome_v7.json
```

不再进入 V8 Perception。

不要自动把 float 参数写入新的 self.md。

---

# 54. Problem Migration

旧 Problems 不继续使用旧 Offer/Bid/Contract 状态机。

## 已 CLOSED

归档到：

```text
market/archive/
```

## OPEN / WORKING

转换成 Market Opportunity，只保留：

```text
Need
Reward
Success
Status
历史摘要
```

删除运行时 holder/offer/bid 依赖。

---

# 55. P0005 迁移

如果“真实赚 1 元”目标仍未完成：

转换成 Market Opportunity，例如：

```markdown
# Opportunity

## Need
获得至少一个真实外部客户自愿支付。

## Success
payer_role = EXTERNAL_CUSTOMER
CNY >= 1

## Reward
100 Energy

## Status
OPEN
```

不要自动分配给任何 Pixel。

让 Pixel 自己通过 READ_MARKET 发现。

---

# 56. Capability Migration

保留：

```text
capabilities/
external_requests/
external_events/
external_transactions/
```

已批准 Capability 继续存在。

---

# 57. V8 Round Loop

每轮：

```text
1. Environment update
2. Deliver Inbox
3. Wake calculation
4. Build local Perception
5. API Sandbox Decision
6. Validate physical legality
7. Execute one Action
8. Produce Feedback
9. Energy metabolism
10. Dormancy
11. Persist
12. UI refresh / Loop state
```

---

# 58. 开发顺序

## Phase 1 — Pixel Model

完成：

```text
state.json
self.md
public.md
memory.md
inheritance.md
workspace
inbox
activity
```

停止 Runtime 对 genome 的依赖。

## Phase 2 — Action Schema

只实现：

```text
WORK
MESSAGE
ASK_OWNER
REPRODUCE
WAIT
```

## Phase 3 — Workspace Tools

实现：

```text
read/write/delete/move/list
run command
```

严格 jail。

## Phase 4 — Message

实现：

```text
neighbor validation
text
energy transfer
attachment snapshot
inbox
```

## Phase 5 — Market

实现：

```text
READ_MARKET
CLAIM_MARKET_OPPORTUNITY
SUBMIT_MARKET_RESULT
Environment verify
Reward
```

## Phase 6 — Reproduction

实现：

```text
energy transfer
birth cost
inheritance.md
child initialization
```

## Phase 7 — Sandbox Rewrite

ContextSandbox 改成 V8 Perception。

删除旧：

```text
Problem holder
bid
offer
contract
genome tendency
```

## Phase 8 — UI

适配新数据结构与最新 Activity。

## Phase 9 — Migration

完成 V7.1 → V8。

---

# 59. 必须新增的测试

```text
test_v8_pixel_ownership.py
test_v8_workspace_jail.py
test_v8_neighbor_message_only.py
test_v8_message_energy_transfer.py
test_v8_attachment_snapshot.py
test_v8_market_not_auto_visible.py
test_v8_read_market.py
test_v8_reproduction_energy_conservation.py
test_v8_child_self_defined.py
test_v8_no_role_fields.py
test_v8_no_genome_runtime.py
test_v8_api_sandbox_no_global_view.py
test_v8_owner_not_strategy.py
test_v8_loop_snapshot_workspace.py
test_v8_market_external_truth.py
```

---

# 60. 核心验收测试

## Workspace

Pixel A 可以写：

```text
pixels/A/workspace/a.md
```

不能写：

```text
pixels/B/workspace
owner_private
engine
../
```

## Message

相邻：

```text
A → B PASS
```

不相邻：

```text
A → Z FAIL
```

## Market

新 Market 创建后：

```text
默认 Perception 看不到
```

只有：

```text
WORK READ_MARKET
```

才返回 Market 内容。

## Reproduction

```text
Parent = 100
Child grant = 40
Birth cost = 10

Parent after = 50
Child = 40
```

总 Energy 不增加。

## Role

V8 Runtime 不得存在组织字段：

```text
role
manager
department
specialization
```

自然语言内容中出现这些词允许。

---

# 61. 第一次 V8 正式实验

实验：

```text
V8-001
```

只保留一个真实 Market：

```text
获得至少 1 个真实外部客户自愿支付 >= 1 CNY
```

环境不给策略提示。

初始保留当前存活 Pixel。

运行：

```text
10 Loops
每 Loop 最多 10 rounds
```

观察：

```text
谁会主动 READ_MARKET
谁会修改 self.md
谁会修改 public.md
谁会 MESSAGE
谁会转 Energy
谁会 REPRODUCE
是否出现身份分化
是否出现市场侦察节点
是否出现执行节点
是否出现中间节点
```

---

# 62. 第一次实验禁止人为提示

不要告诉 Pixel：

```text
你应该找客户
你应该做营销
你应该 Spawn 销售
你应该合作
你应该分工
你应该建网站
```

只提供：

```text
Market Need
Reward
Success Condition
现实 Capability 边界
```

---

# 63. V8 成功标准

第一阶段先验证 Kernel：

- Pixel 能自我修改；
- Workspace 完全自由且不越界；
- Market 不自动感知；
- Neighbor-only Message 正确；
- Energy 守恒；
- Reproduction 正确；
- API Sandbox 无全局泄漏。

第二阶段验证 Emergence：

- Pixel 自发形成不同 self/public；
- Pixel 自发通信；
- Pixel 自发产生交换；
- Pixel 自发产生新 Pixel；
- 多 Pixel 共同产生真实商业结果；
- 出现稳定协作网络。

---

# 64. 禁止重新加回的东西

本地 AI 实现过程中不得因为“方便”重新加入：

```text
role
department
manager
sales agent
marketing agent
engineering agent

bid action
offer action
accept_bid action
contract state machine

固定 personality floats
handoff preference
risk tolerance

中央任务路由器
中央 Planner
自动任务拆解器
自动 Resource 分配器
```

如果出现实现困难：

```text
记录问题
做最小物理修复
```

不要擅自增加组织制度。

---

# 65. V8 Constitution

## Article 1
Pixel 不拥有预定义职业。

## Article 2
Pixel 自己定义自己。

## Article 3
Pixel 完全控制自己的数字空间。

## Article 4
Pixel 不能直接访问其他 Pixel 私有空间。

## Article 5
Pixel 与 Pixel 只能直接邻居通信。

## Article 6
Market 是公共资源，但只有主动访问才可见。

## Article 7
现实世界只能通过 Capability / Owner Gateway。

## Article 8
Owner 只提供现实权限，不提供商业策略。

## Article 9
Energy 是内部生存资源；真实货币独立。

## Article 10
Reproduction 不能创造 Energy。

## Article 11
Child 自己定义自己；Parent 只能留下 inheritance。

## Article 12
组织、角色、部门、管理关系都不是 Engine 对象。

## Article 13
公司只能由长期稳定行为结构被观察到，不能由代码声明。

## Article 14
API Sandbox 保证每个 Pixel 只拥有合法局部认知。

## Article 15
实验仪器可以复杂，生命规则必须简单。

---

# 66. 最终交付要求

实现完成后必须输出：

```text
V8_IMPLEMENTATION_REPORT.md
V8_CONSTITUTION.md
```

`V8_IMPLEMENTATION_REPORT.md` 至少包含：

```text
1. 新增文件
2. 修改文件
3. 删除/废弃的 V7 机制
4. Migration 结果
5. 测试结果
6. API Sandbox 检查结果
7. Workspace jail 检查结果
8. Neighbor-only Message 检查结果
9. Energy conservation 检查结果
10. UI 运行说明
11. V8 smoke test
12. 已知限制
```

---

# 67. 迁移安全要求

迁移前：

```text
创建 Loop Snapshot
```

确保 V7.1 可以随时 checkout。

然后新建 V8 实验分支继续。

不要删除过去：

```text
Rounds
Loops
Reports
历史Pixel资料
```

---

# 68. 实施优先级

## P0

```text
Pixel 新模型
5 Actions
Workspace 完全自由 + jail
Neighbor Message
Energy
API Sandbox
```

P0 未全部通过测试：

```text
禁止跑正式 V8 实验
```

## P1

```text
Market 主动读取
Reproduction
Capability
Migration
```

## P2

```text
UI 适配
Observer Graph
Emergence Report
```

---

# 69. V8 的最终一句话

> **Pixel 自己定义自己，通过局部通信互相利用，通过现实反馈获得能量，通过繁殖产生差异，稳定协作结构最终长成公司。**

以及：

> **我们不设计公司。我们只设计一种有机会长成公司的生命。**
