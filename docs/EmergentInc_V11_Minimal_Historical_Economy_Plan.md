# EmergentInc V11 — Minimal Historical Economy Plan

## 0. 版本定位

V11 不增加公司、职业、部门、市场、Skill、信誉系统等高层结构。

V11 只增加一个最小机制：

> **让不同 Pixel 因不同历史积累产生真实成本差异，并允许这种差异通过 Pixel 间的信息交换转化为 Energy 流动。**

研究目标不是让系统更快“形成公司”。

研究目标是观察：

> 当同质 Pixel 因历史不同形成不同知识积累和边际成本后，是否会自然出现交换、重复交换、专业化、稳定关系以及后续组织结构。

---

# 1. V11 核心原则

整个版本只增加四条规则。

```text
1. 历史私有
2. 历史复用降低真实成本
3. 信息可以交换 Energy
4. External 与 Pixel Self 严格分离
```

除此之外，不新增经济学或组织学规则。

---

# 2. 明确禁止实现的内容

V11 禁止增加：

```text
role
job
department
skill
skill_score
efficiency_score
reputation
market
exchange
central marketplace
task dispatcher
project manager agent
company
organization
price algorithm
recommended price
capability label
asset valuation
knowledge category score
```

禁止 Engine 判断：

```text
哪个 Pixel 更擅长什么
哪个 Pixel 应该接任务
某份资料值多少钱
谁应该向谁购买
谁应该成为经理
```

这些都必须由 Pixel 自己根据历史和局部信息决定。

---

# 3. 规则一：历史私有

## 3.1 原则

每个 Pixel 继续拥有自己的：

```text
pixel.md
artifacts/
```

Pixel 过去产生的资料默认只属于自己。

其他 Pixel：

```text
不能直接读取
不能全局搜索
不能自动继承
```

只能通过现有局部通信或后续的信息交换获得。

---

## 3.2 不新增复杂 Asset 系统

V11 暂时不要创建：

```text
Asset
Knowledge Object
Skill Object
Knowledge Graph
```

现有：

```text
pixel.md
artifacts/
```

已经足够承担历史积累。

目标是保持规则最小。

---

# 4. 规则二：历史复用产生真实成本差异

## 4.1 核心原则

不人为设置：

```text
有经验 = 80% cost
专家 = 50% cost
```

成本差异必须来自真实模型调用。

例如：

```text
Pixel A
过去已经生成 PostgreSQL 排查资料

新任务出现
↓
读取已有 artifact
↓
少量推理
↓
输出答案
↓
实际消耗 5000 Token
```

而：

```text
Pixel B
没有任何相关历史

新任务出现
↓
重新分析
↓
重新生成资料
↓
实际消耗 18000 Token
```

系统只记录真实发生的：

```text
input_tokens
cached_input_tokens
output_tokens
tool_cost
model_cost
```

不建立人工效率评分。

---

## 4.2 最小成本记录

每一次 Pixel Step 至少记录：

```ts
{
  pixelId,
  round,
  inputTokens,
  cachedInputTokens,
  outputTokens,
  modelCost,
  toolCost
}
```

如果 Provider 暂时无法提供某字段：

```text
允许 null
```

不要为了补齐字段建立估算算法。

真实数据优先。

---

# 5. 规则三：Pixel 可以进行最小交换

## 5.1 V11 不建立市场

不存在：

```text
Marketplace
OrderBook
Auction
Pricing Engine
Matching Engine
```

Pixel 只能通过现有局部消息自己协商。

---

## 5.2 最小交换形式

交换只有两种东西：

```text
Information
Energy
```

例如：

```text
Pixel B：
我需要 PostgreSQL 死锁排查资料。

Pixel A：
我有，可以给你。
给我 100 Energy。

Pixel B：
同意。
```

然后产生：

```text
B.energy -= 100
A.energy += 100
```

同时 A 将指定资料发送给 B。

---

# 6. 不创建新的复杂交易协议

优先复用现有 Message / Effect / Energy 机制。

只需要允许 Pixel 决策表达：

```text
发送资料
转移 Energy
```

如果当前 Protocol 已经可以表达：

```text
MESSAGE
ENERGY_TRANSFER
ARTIFACT_TRANSFER
```

则直接组合现有 Effect。

如果缺少其中某一个，增加最小 Effect：

```ts
TRANSFER_ENERGY
TRANSFER_ARTIFACT
```

不要引入：

```text
BUY
SELL
ORDER
CONTRACT
TRADE
MARKET
```

因为“交易”应该是多个基础动作组合形成的宏观行为，而不是 Engine 内置概念。

---

# 7. Artifact 传递规则

Pixel A 可以将自己的某个 artifact 复制给邻居 Pixel B。

建议语义：

```text
复制，而不是所有权转移。
```

即：

```text
A 保留原文件
B 获得副本
```

原因：

数字知识具有：

```text
第一次生产成本高
复制成本低
```

V11 不增加：

```text
版权
禁止转售
授权
许可证
所有权制度
```

允许后续观察：

```text
转卖
免费分享
重复销售
囤积
中介
信息扩散
```

这些现象是否自然产生。

---

# 8. 规则四：External 与 Pixel Self 严格分开

这是 V11 必须完成的重要结构调整。

模型每次运行时，需要能够区分：

```text
External
Pixel Self
```

---

## 8.1 External

External 包括：

```text
Human instruction
Environment information
Human-provided files
Human feedback
Human reward
```

这些内容：

```text
不是 Pixel 自己产生的
Pixel 不能修改原始 External
```

---

## 8.2 Pixel Self

Pixel 自身内容继续包括：

```text
pixel.md
自己的 artifacts
自己的历史判断
自己的策略
自己的经验
```

这些才代表：

> Pixel 自己变成了什么。

---

# 9. Human Mandate

允许人类明确给某个 Pixel 一个任务或职责。

例如：

```text
Target:
pixel_0_0_0

Human Mandate:
负责当前项目的任务分发与进度汇总。
```

但禁止 Engine 做：

```text
role = project_manager
```

也不要自动修改：

```text
pixel.md
```

成为：

```text
我是项目经理。
```

Human Mandate 只是一个独立 External Input。

Pixel 是否因为长期承担该职责形成自己的身份、能力和历史优势，由后续运行决定。

---

# 10. Prompt / Context 最小分层

Context Runtime 最终至少明确输出以下区域：

```text
=== EXTERNAL ===

{human instructions}
{environment information}
{human provided materials}


=== PIXEL SELF ===

{pixel.md}


=== YOUR FILES ===

{pixel artifacts available to this pixel}


=== LOCAL MESSAGES ===

{neighbor messages}
```

如果 Constitution 已经单独存在，则保持：

```text
=== CONSTITUTION ===
```

最终：

```text
CONSTITUTION
EXTERNAL
PIXEL SELF
PIXEL FILES
LOCAL MESSAGES
```

五层清晰分离。

不要把它们重新拼成一段没有来源标记的自然语言。

---

# 11. External Reward

外部世界允许给予某个 Pixel Energy。

例如：

```text
Human:
这个结果有效。

Reward:
+100 Energy
```

这属于：

```text
External → Pixel
```

的 Energy 注入。

---

## 11.1 Energy 最小公式

保持简单：

```text
nextEnergy
=
currentEnergy
- computeCost
- transferOut
+ transferIn
+ externalReward
```

V11 不增加：

```text
工资
税
利息
贷款
资本
股权
利润率
```

---

# 12. 数据库最小改动

不要建立完整经济数据库。

只需要保证现有 Ledger 能记录以下事实。

### Pixel Step Cost

```text
pixel_id
round
input_tokens
cached_input_tokens
output_tokens
model_cost
tool_cost
```

### Energy Transfer

```text
from_pixel
to_pixel
amount
round
reason/message_id
```

### Artifact Transfer

```text
from_pixel
to_pixel
source_path
target_path
round
message_id
```

### External Reward

```text
target_pixel
amount
round
source
```

如果现有 Event / Effect Ledger 已经能够表达这些内容，应直接复用，不重复建表。

---

# 13. Runtime 原则

V11 必须遵守 V10 Small Core 架构。

不得重新让：

```text
Scheduler
```

知道：

```text
交换逻辑
资料价值
价格
角色
专业能力
```

正确结构：

```text
Pixel Decision
      ↓
DecisionCompiler
      ↓
Effects[]
      ↓
EffectRuntime
      ↓
Energy / Artifact / Message / Persistence
```

Scheduler 只负责调度。

---

# 14. 最重要的实验场景

V11 完成后，不要立即测试复杂公司。

只做三个实验。

---

## Experiment 1：历史成本差

初始化两个相同 Pixel：

```text
A
B
```

让 A 先完成一次任务并保存资料。

然后让 A、B 分别处理相似任务。

观察：

```text
A 是否主动利用已有历史
A 的真实 Token 成本是否低于 B
```

系统不能人为给予 A 成本优惠。

---

## Experiment 2：信息交换

设置：

```text
A 有相关资料
B 没有资料
```

B 收到一个问题。

观察 B 是否：

```text
自己解决
或
向邻居请求帮助
```

如果 A/B 自主协商：

```text
资料 ↔ Energy
```

系统应允许完成该交换。

但不得提示：

```text
你应该交易。
```

---

## Experiment 3：外生角色 → 是否形成历史优势

Human Mandate：

```text
Pixel A：
负责当前项目任务分发与进度汇总。
```

运行若干轮。

然后移除 Human Mandate。

观察：

```text
A 是否继续承担协调工作
其他 Pixel 是否继续向 A 发送相关信息
A 是否因为历史积累而具有更低协调成本
```

不得为了维持 A 的角色增加任何规则。

---

# 15. 成功标准

V11 成功不等于：

```text
出现公司
出现项目经理
产生利润
```

V11 只需证明基础机制真实存在。

必须满足：

### A. 历史私有

```text
Pixel 默认不能读取其他 Pixel 的私有历史和 artifacts。
```

### B. 历史可复用

```text
Pixel 可以利用自己的历史资料完成未来任务。
```

### C. 成本是真实的

```text
系统能够观察不同 Pixel 因历史不同产生真实 Token / Cost 差异。
```

### D. 信息可以流动

```text
Pixel 可以把已有资料发送给邻居。
```

### E. Energy 可以流动

```text
Pixel → Pixel Energy transfer 可完成并持久化。
```

### F. External 独立

```text
Human / Environment 输入不会与 pixel.md 混为同一来源。
```

### G. 无高层预设

系统中仍然不存在：

```text
role
skill
market
company
manager
profession
```

---

# 16. 测试要求

至少增加以下自动化测试：

```text
1. Pixel A 无法直接读取 Pixel B 私有 artifact
2. Pixel A 可以读取自己的历史 artifact
3. artifact transfer 后 B 获得副本，A 原文件仍存在
4. energy transfer 前后总量正确
5. energy transfer 不允许负余额
6. external reward 正确进入目标 Pixel
7. Human Mandate 不写入 pixel.md
8. Human Mandate 删除后 Pixel Self 仍保持原历史
9. cost ledger 正确记录模型 token usage
10. Context 中 External 与 Pixel Self 来源明确分离
```

---

# 17. 实施顺序

严格按照以下顺序执行。

## Phase 1 — Context Separation

先完成：

```text
External
Pixel Self
Pixel Files
Local Messages
```

来源分离。

不要改经济规则。

---

## Phase 2 — Cost Ledger

记录：

```text
真实 token
cached token
model cost
tool cost
```

先做到能观察成本差异。

---

## Phase 3 — Artifact Transfer

增加：

```text
Pixel A → Pixel B
artifact copy
```

保持局部通信约束。

---

## Phase 4 — Energy Transfer

增加：

```text
Pixel A → Pixel B
Energy
```

保证事务一致性。

---

## Phase 5 — External Reward

允许：

```text
Human / Environment
→ Energy
→ Pixel
```

---

## Phase 6 — Experiments

运行三个最小实验。

只观察，不增加新的高层机制。

---

# 18. 最终验收问题

完成 V11 后，只回答下面五个问题：

```text
1. 不同 Pixel 是否能够因为不同历史产生不同资料积累？

2. 历史积累是否能够真实降低后续模型调用成本？

3. 当不同 Pixel 拥有不同资料时，它们是否存在交换动机？

4. Pixel 是否能够自行通过“信息 ↔ Energy”完成交换？

5. 在没有 role / skill / market / company 等预设结构时，
   重复历史差异和交换是否开始产生稳定的行为差异？
```

如果前四项成立：

```text
V11 完成。
```

第五项无论出现还是不出现，都属于实验结果。

不得为了让第五项出现而继续向 Engine 添加规则。

---

# 19. V11 核心公式

整个版本最终保持为：

```text
Private History
      ↓
Reuse
      ↓
Real Cost Difference
      ↓
Information Exchange
      ↓
Energy Flow
```

External 只负责：

```text
Input
Feedback
Reward
```

Engine 不负责设计社会。

Engine 只提供：

> **历史能够积累、成本能够产生差异、信息能够交换、Energy 能够流动的最小世界。**

然后观察社会是否自己出现。
