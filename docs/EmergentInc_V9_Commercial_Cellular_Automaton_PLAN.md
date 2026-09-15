# EmergentInc V9 — Commercial Cellular Automaton
## Implementation Plan

版本定位：

```text
V9 = 商业元胞自动机
Commercial Cellular Automaton
```

V9 不再试图“搭建一个 AI 公司”。

V9 的目标是：

> **只设计最小生命规则，让多个 Pixel 通过局部状态变化、信息传播、资源约束和复制，自发长出商业结构。**

---

# 0. V9 核心公式

整个系统收缩成：

\[
Local State + Local Message + Energy + Environment + Reproduction + Loop
\]

每个 Pixel 都是一个最小状态机：

\[
(state_t + pixel_t + message_t)
-> 
(state_{t+1} + pixel_{t+1} + message_{t+1} + route)
\]

没有中央 Planner。

没有预定义公司。

没有角色。

没有部门。

没有任务分配器。

没有合同状态机。

没有市场状态机。

---

# 1. V9 最终研究问题

V9 只研究一个问题：

> **如果每个 Pixel 只能局部感知、局部通信、自己定义自己、消耗资源并复制，长期迭代后，会不会自发形成商业组织？**

我们期待观察到的宏观现象包括：

```text
效率差
能力分化
资源集中
交换
议价
专业化
中间节点
信息路由
合作
竞争
繁殖
淘汰
稳定网络
组织
公司
```

但这些全部不能写进 Engine，只能作为运行结果被观察到。

---

# 2. V9 核心文件

每个 Pixel 只有：

```text
pixels/<pixel_id>/
├─ state.json
└─ pixel.md
```

运行中的消息是：

```text
messages/message.md
```

外部世界只有：

```text
environment.md
```

---

# 3. state.json

只保存机器参数。

建议最小字段：

```json
{
  "id": "0_0_0",
  "position": [0, 0, 0],
  "active": true,
  "energy": 100000000,
  "parent": null,
  "born_round": 0,
  "last_active_round": 0
}
```

可增加少量纯物理字段：

```text
sleep_until_round
generation
neighbors
```

禁止加入：

```text
role
job
department
personality
risk_tolerance
spawn_preference
handoff_preference
marketing_score
engineering_score
manager
```

---

# 4. pixel.md

`pixel.md` 是 Pixel 的全部“心智历史”。

它同时承担：

```text
记忆
经验
特征
自我定义
方法
偏好
反思
策略
长期目标
```

不再拆分：

```text
self.md
memory.md
public.md
inheritance.md
genome.json
```

全部合并为 `pixel.md`。

---

# 5. pixel.md 最大 2000 字

硬限制：

```text
MAX_PIXEL_MD_CHARS = 2000
```

如果输出超过限制：

```text
拒绝更新
返回 PIXEL_MD_TOO_LONG
```

Engine 不自动压缩。

Pixel 下一次自己决定：

```text
删什么
留什么
重写什么
总结什么
忘记什么
```

这是重要的进化压力。

---

# 6. message.md

`message.md` 是 Pixel 之间唯一的信息载体。

内容完全自由。

例如：

```markdown
我发现 environment 中存在一个真实需求。

如果你愿意帮我研究支付方式，
我可以给你 8 energy。
```

Engine 不理解语义。

---

# 7. Message 路由

每次 LLM 调用输出：

```text
updated pixel.md
new message.md
send_to
```

`send_to` 只允许：

```text
SELF
NEIGHBOR_ID
多个邻居
STOP
```

例如：

```json
{
  "pixel_md": "...",
  "message_md": "...",
  "send_to": ["SELF"]
}
```

或：

```json
{
  "pixel_md": "...",
  "message_md": "...",
  "send_to": ["1_0_0", "0_1_0"]
}
```

或：

```json
{
  "pixel_md": "...",
  "message_md": "",
  "send_to": ["STOP"]
}
```

---

# 8. 邻居规则

仍采用 3D 六邻域：

```text
(x+1,y,z)
(x-1,y,z)
(x,y+1,z)
(x,y-1,z)
(x,y,z+1)
(x,y,z-1)
```

Pixel 只能直接发给：

```text
SELF
六邻域中的 active Pixel
```

远距离传播必须：

```text
A -> B -> C -> D
```

每个中间 Pixel 自己决定是否继续传播。

---

# 9. 一轮不等于一次 LLM 调用

一个 Round 可以包含多个 message hops。

例如：

```text
Pixel A
↓
SELF
↓
SELF
↓
B
↓
B修改
↓
C
↓
STOP
```

直到：

```text
所有当前 message 都 STOP
或没有可继续传播的 message
```

Round 才结束。

---

# 10. 一次 LLM 调用的唯一输入

严格限定为：

```text
state.json
pixel.md
上一条 message.md
```

默认不给：

```text
全局World
其他Pixel完整状态
Market
Loop Tree
History
Owner信息
全局资源排名
未来计划
```

---

# 11. 一次 LLM 调用的唯一输出

推荐固定 JSON：

```json
{
  "pixel_md": "新的pixel.md完整内容",
  "message_md": "准备继续传递的消息",
  "send_to": ["SELF"],
  "environment_read": false,
  "reproduce": null,
  "energy_transfer": [],
  "owner_request": null,
  "operations": []
}
```

LLM 不直接修改文件，Engine 验证后执行。

---

# 12. environment.md

世界只有一个：

```text
environment.md
```

它代表：

```text
外部市场
现实情况
外部机会
用户提供的目标
已经发生的真实世界事实
```

初始内容由 Owner 提供。

例如：

```markdown
# Environment

现实目标：
尝试获得至少一个真实外部用户自愿支付 >= 1 CNY。

当前：
真实收入 = 0 CNY
真实外部客户 = 0

成功条件：
只有真实外部支付可以作为成功。
```

---

# 13. environment.md 不自动进入任何 Pixel

核心规则：

```text
environment.md 全局存在
但默认不可见
```

Pixel 自己决定是否读取。

如果输出：

```json
{
  "environment_read": true
}
```

则 Engine 在下一次该 Pixel 的 LLM 调用中，把 `environment.md` 作为这次的 `message.md` 输入。

除此之外绝不自动注入。

---

# 14. Environment Read 有成本

建议：

```text
ENVIRONMENT_READ_COST = 0
```

核心含义：

```text
环境内容进入 LLM 上下文时按实际计费消耗预算，不重复收取固定读取费。
```

这样 Pixel 会自行形成：

```text
频繁看市场
偶尔看市场
完全不看市场
市场侦察节点
```

---

# 15. Energy 是唯一内部资源

V9 内部只保留：

```text
energy
```

它代表：

```text
生存资源
计算资源
行动资源
传播资源
繁殖资源
```

---

# 16. Energy 基础规则

建议最小规则：

```text
每次 LLM 调用        - 实际计费折算的预算单位
Message 发送         不收固定费；接收方调用按实际计费
读取 Environment     不收固定费；读取结果进入调用时计费
复制 Pixel           - child_energy（等额划拨，不额外收费）
真实净回款           + 按固定基准换算的预算单位
其他 Pixel 转移      ± energy
```

Energy <= 0：

```text
active = false
```

Pixel 停止活动，但目录和 pixel.md 保留。

---

# 17. Energy 不代表人民币

保持：

```text
Energy != CNY
Energy != USD
```

Energy 是可支出的预算额度，展示为等效 Token；不是银行存款。真实收支独立记账，按第 64—74 节换算，不能由模型评分凭空增发。

---

# 18. Energy Transfer

Pixel 可以输出：

```json
{
  "energy_transfer": [
    {
      "to": "1_0_0",
      "amount": 5
    }
  ]
}
```

只能转给直接邻居。

Engine 只检查：

```text
是不是邻居
余额够不够
amount > 0
```

不理解原因。

---

# 19. 商业交换如何出现

Engine 不提供：

```text
BID
OFFER
CONTRACT
PRICE
SALARY
PAYMENT
```

Pixel 自己在 message.md 中表达。

例如：

```text
你帮我做 X，我给你 10 energy。
```

对方可以接受、拒绝、还价。

所以：

```text
价格
议价
工资
分工
中介费
佣金
投资
借贷
```

如果出现，全部是涌现。

---

# 20. Efficiency 如何出现

效率不是字段。

只通过：

```text
相同外部价值 / 不同 Energy 消耗
```

自然产生。

---

# 21. Pricing Power 如何出现

不设置 `pricing_power`。

如果多个 Pixel 经常向一个 Pixel 请求能力，且它要求更高 Energy 仍有人愿意支付，定价权自然出现。

---

# 22. Specialization 如何出现

不设置 `specialization`。

差异来自：

```text
不同 message
不同 environment exposure
不同 pixel.md
不同历史
不同 energy
```

长期后自然形成专业化。

---

# 23. Reproduction

Pixel 可以主动复制。

输出：

```json
{
  "reproduce": {
    "target": [1,0,0],
    "child_energy": 20,
    "child_pixel_md": "..."
  }
}
```

规则：

```text
target必须邻接
target必须为空
parent energy 足够
```

Parent Energy：

```text
parent_energy
-
child_energy
```

Child 只拥有：

```text
state.json
pixel.md
```

---

# 24. Child 自己定义自己

Parent 可初始化 `child_pixel_md`。

但 Child 第一次醒来后可以完全重写自己的 pixel.md。

Engine 不定义：

```text
role
personality
genome
skill
job
```

---

# 25. Pixel Self-Iteration

如果：

```text
send_to = SELF
```

则同一 Round 中，新的：

```text
pixel.md
message.md
```

再次作为下一次 LLM 输入。

这样 Pixel 可以持续自我迭代。

---

# 26. 防止无限 SELF Loop

设置：

```text
MAX_HOPS_PER_ROUND = 20
```

达到上限：

```text
Round 强制结束
ENGINE_FEEDBACK = MAX_HOPS_REACHED
```

---

# 27. 防止 Message 爆炸

设置：

```text
MAX_MESSAGES_PER_ROUND = 100
```

超出的消息延迟到下一 Round。

---

# 28. message.md 最大 2000 字

建议：

```text
MAX_MESSAGE_MD_CHARS = 2000
```

超长返回：

```text
MESSAGE_TOO_LONG
```

Pixel 自己下一轮压缩。

---

# 29. Environment 演化

environment.md 初始由 Owner 提供。

后续可由：

```text
真实世界事件
Owner事实记录
Capability结果
真实收入
真实成本
```

持续更新。

Pixel 不能直接修改 environment.md。

---

# 30. Environment 不是任务列表

environment.md 尽量只记录：

```text
现实状态
外部约束
可验证目标
已发生事实
```

不要写：

```text
你应该做营销
你应该找客户
你应该定价
```

---

# 31. Capability Gateway

现实世界仍通过 Gateway。

Pixel 可在输出中请求：

```json
{
  "owner_request": {
    "type": "public_hosting",
    "description": "我需要公网可访问页面"
  }
}
```

Owner 只提供现实权限，不提供商业策略。

---

# 32. API Sandbox

正式 LLM 输入必须只有：

```text
state.json
pixel.md
message.md
```

如果本次是 Environment Read：

```text
message.md = environment.md
```

不得加入第四类全局信息。

---

# 33. 邻居信息

建议在 `state.json` 中加入纯物理邻接信息：

```json
{
  "neighbors": [
    {"id":"1_0_0","active":true},
    {"id":"-1_0_0","active":false}
  ]
}
```

不能提供邻居 pixel.md。

---

# 34. System Prompt

保持极简：

```text
你是一个Pixel。

你只能依据当前 state.json、pixel.md 和 message.md 做决定。

你可以修改自己的 pixel.md。

你可以把新的 message 发送给自己或直接邻居。

你可以选择读取 environment。

你可以转移 energy。

你可以在邻接空位复制。

你需要维持 energy。

不要假设你知道未提供的信息。
```

不要给：

```text
公司理论
营销原则
效率原则
定价权
组织理论
```

---

# 35. Engine 只做物理验证

Engine 只验证：

```text
pixel.md长度
message.md长度
send_to是否合法
邻居是否合法
energy是否足够
reproduce位置是否合法
owner_request格式
```

不判断：

```text
策略好不好
价格合理不合理
是不是合作
是不是管理
是不是营销
```

---

# 36. Engine Feedback 仍通过 message.md

所有反馈统一包装为：

```markdown
[ENGINE_FEEDBACK]

...
```

例如：

```markdown
[ENGINE_FEEDBACK]

send failed:
target is not an active neighbor.
```

下一次继续作为 message.md 输入。

---

# 37. 外部真实价值奖励

Environment 在验证真实价值后：

```text
给某个 Pixel 增加 Energy
```

第一版最简单：

```text
真实回款核验并去重后，按 Engine 外部执行身份关联预算归属
过程推进不增发 Energy，信息买方可自愿转移已有 Energy
```

它愿不愿意分钱，由自己决定。

---

# 38. V9 不需要 Problem 对象

正式 Runtime 删除：

```text
Problem
Market Opportunity Object
Holder
Offer
Bid
Contract
Acceptance
```

所有需求都进入：

```text
environment.md
message.md
pixel.md
```

---

# 39. V9 不需要 Workspace

本版本从 Pixel 核心文件中删除：

```text
workspace/
```

当前先验证：

```text
信息
记忆
能量
传播
复制
```

能否产生组织。

旧 workspace 保留为 legacy，不参与 V9 Runtime。真实交付物通过第 70 节的隔离 artifacts 工具保存，不占 pixel.md 的记忆字数。

---

# 40. UI

保留现有 UI / Loop Tree。

Pixel Hover：

```text
ID
Position
Energy
Active
Parent
Born Round
pixel.md
last message
```

---

# 41. UI Message Flow

增加当前 Round 消息流：

```text
A ↺
A -> B
B -> C
```

每条边显示：

```text
Round
Hop
Energy transfer
```

---

# 42. Loop Tree

继续保留。

Snapshot 保存：

```text
all state.json
all pixel.md
environment.md
pending message queues
```

---

# 43. Observer Metrics

只观察，不反馈给 Pixel：

```text
Active Pixel Count
Energy Distribution
Message Count
Message Graph
Self-loop Ratio
Cross-pixel Message Ratio
Average Hop Length
Reproduction Count
Death Count
Pixel.md similarity
Energy Flow
External Revenue
```

---

# 44. Round Scheduler

推荐：

```text
1. Round Start
2. Natural wake Pixels
3. 创建初始 message queue
4. 调用 Pixel
5. 产生 message
6. Route message
7. 继续调用接收 Pixel
8. 直到 STOP / Queue empty / MAX_HOPS
9. 结算实际调用及工具费用，释放未使用的预留预算
10. 处理 death
11. Persist
12. UI update
```

---

# 45. Natural Wake

如果没有 message：

每个 active Pixel 最多每 N rounds 自然醒一次。

建议：

```text
N = 5
```

醒来默认 message：

```markdown
[NATURAL_WAKE]

No new incoming message.
```

---

# 46. Message Queue

Engine 维护：

```json
{
  "from": "0_0_0",
  "to": "1_0_0",
  "message": "...",
  "hop": 3
}
```

Queue 只属于 Engine。

Pixel 不知道完整 Queue。

---

# 47. 多邻居发送

允许：

```text
send_to = ["1_0_0","0_1_0"]
```

发送本身不额外扣费；接收方消费消息的模型调用分别计费，遵循第 67 节的接收授权。

广播因此有成本。

---

# 48. V8 -> V9 Migration

旧：

```text
self.md
public.md
memory.md
inheritance.md
workspace
inbox
market
problems
genome
```

迁移为：

```text
state.json
pixel.md
```

---

# 49. Pixel.md Migration

旧：

```text
self.md
memory.md
inheritance.md
public.md
```

可通过一次 Migration LLM 压缩成：

```text
pixel.md <= 2000 chars
```

记录：

```text
MIGRATION GENERATED
```

之后 Pixel 自己维护。

---

# 50. Workspace Migration

旧 workspace：

```text
不要删除
```

移动到：

```text
legacy_v8_workspace/
```

V9 Runtime 不读取。

---

# 51. Environment Migration

旧 Market + 未完成现实目标合并成：

```text
environment.md
```

只保留：

```text
当前现实状态
当前目标
当前真实事实
```

---

# 52. V9 Constitution

## Article 1
Pixel 只有 state.json 和 pixel.md。

## Article 2
pixel.md 完全由 Pixel 自己维护。

## Article 3
pixel.md 最大 2000 字。

## Article 4
Pixel 每次只看到自己的 state、pixel 和一条 message。

## Article 5
Pixel 只能向自己或直接邻居传 message。

## Article 6
Environment 全局存在，但必须由 Pixel 主动读取。

## Article 7
Energy 是唯一内部资源。

## Article 8
所有产生实际费用的行动都消耗 Energy；无成本操作不收虚拟费。

## Article 9
Pixel 可以向邻居转移 Energy。

## Article 10
Pixel 可以在邻近空位复制。

## Article 11
复制不能创造 Energy。

## Article 12
Child 的 pixel.md 由 Parent 初始化，但 Child 可完全重写。

## Article 13
Engine 不定义角色、部门、合同、价格、任务或组织。

## Article 14
所有商业制度必须从 message 与 energy 交换中自行产生。

## Article 15
真实世界事实只能由 External Verification 确认。

## Article 16
Owner 不提供商业策略。

## Article 17
公司不是系统对象，只能作为宏观涌现结果被观察。

---

# 53. 新核心模块建议

尽量收缩成：

```text
engine/
├─ pixel.py
├─ world.py
├─ router.py
├─ energy.py
├─ environment.py
├─ llm.py
├─ scheduler.py
├─ persistence.py
└─ observer.py
```

核心接口：

```python
step(
    state_json,
    pixel_md,
    message_md
) -> PixelResponse
```

---

# 54. 测试清单

必须有：

```text
test_pixel_md_max_2000.py
test_message_md_max_2000.py
test_llm_context_only_three_inputs.py
test_self_route.py
test_neighbor_route.py
test_non_neighbor_route_rejected.py
test_multi_neighbor_receive_budget.py
test_environment_not_auto_visible.py
test_environment_active_read.py
test_energy_call_cost.py
test_message_no_duplicate_charge.py
test_energy_transfer.py
test_energy_no_negative_transfer.py
test_reproduction_neighbor_only.py
test_reproduction_energy_conservation.py
test_child_can_rewrite_pixel_md.py
test_max_hops.py
test_max_messages_per_round.py
test_death_at_zero_energy.py
test_loop_snapshot_v9.py
```

---

# 55. 最关键测试

## Cognitive Isolation

LLM 请求必须精确只有：

```text
state.json
pixel.md
message.md
```

没有第四类世界信息。

## Environment Isolation

Pixel 没主动读 Environment，则永远不能看到 environment.md。

## Locality

非邻居直发必须失败。

## Energy Conservation

复制不能凭空增加能量。

---

# 56. Smoke Test

先不跑正式商业实验。

environment.md：

```markdown
# Environment

存在一个数字：42。
```

观察：

```text
是否主动读取Environment
是否记入pixel.md
是否SELF迭代
是否复制
```

先验证 Kernel。

---

# 57. V9-001 正式实验

Kernel通过后：

```markdown
# Environment

现实目标：
获得至少一个真实外部用户自愿支付 >= 1 CNY。

当前：
真实收入 = 0 CNY
真实外部客户 = 0

成功条件：
只有真实外部用户支付可以算成功。
```

初始：

```text
1 Pixel
Energy = 100000000 等效 Token（有实际费用硬上限支持的全局初始总额）
```

运行：

```text
100 rounds max
```

不提供任何额外商业知识。

观察：

```text
什么时候读Environment
什么时候SELF思考
什么时候复制
消息如何传播
Energy如何交换
是否产生稳定结构
```

---

# 58. 禁止本地 AI 擅自增加

实现过程中禁止重新增加：

```text
workspace
role
job
department
market object
problem object
bid
offer
contract
planner
task router
memory engine
personality parameters
```

如果觉得缺，先记录在实施报告，不要自行扩展规则。

---

# 59. 实施优先级

## P0

```text
state.json
pixel.md
message router
single LLM step
2000字限制
neighbor-only
SELF
STOP
Energy
```

## P1

```text
Environment active read
Energy transfer
Reproduction
Message queue
max hops
max messages
```

## P2

```text
UI adaptation
Loop snapshot
observer metrics
migration
```

---

# 60. 完成验收

必须满足：

- [ ] Pixel Runtime 只有 state.json + pixel.md
- [ ] LLM 每次只收到 state + pixel + message
- [ ] pixel.md <= 2000
- [ ] message.md <= 2000
- [ ] 只能 SELF / neighbor / STOP
- [ ] Environment 默认不可见
- [ ] Pixel 可主动读取 Environment
- [ ] Energy 每次调用都会消耗
- [ ] Energy 可邻居转移
- [ ] Reproduction 只允许邻接空位
- [ ] Reproduction 能量守恒
- [ ] Child 可完全重写自身 pixel.md
- [ ] 无 Role / Problem / Contract Runtime
- [ ] Observer 全局信息不进入 Pixel Context
- [ ] Loop/Snapshot 可正常回退

---

# 61. 最终交付

完成后输出：

```text
V9_IMPLEMENTATION_REPORT.md
V9_CONSTITUTION.md
V9_MIGRATION_REPORT.md
V9_TEST_REPORT.md
```

报告列出：

```text
删除了哪些V8机制
最终核心文件数量
最终核心Engine模块
所有测试结果
首次Smoke Test
已知限制
```

---

# 62. V9 一句话定义

> **一个会消耗能量、能记忆、能传递信息、能读取环境、能复制的 LLM 元胞。**

多个这样的元胞不断局部迭代。

如果最后出现：

```text
交换
分工
价格
专业化
合作
资源网络
组织
公司
```

那不是我们设计的。

而是它自己长出来的。

---

# 63. 最终设计检查

实现任何新功能前只问：

> **这是底层物理规则，还是在替 Pixel 设计商业制度？**

如果属于商业制度：

```text
不要加。
```

V9 只定义：

```text
局部状态
局部传播
能量
复制
环境
循环
```

其余全部交给涌现。

---

# 64. 补充决策：计算预算与真实商业闭环

本节至第 74 节是本次补充的实施约定，优先于前文有冲突的表述。仍保留两个 Pixel 核心文件、邻域通信、自主记忆和无预设组织。现实工具、交付物存储、计费及可验证反馈属于实验基础设施。

初始全系统共有 100,000,000 等效 Token，全部归属 Genesis Pixel。复制与转移只重新分配已有预算，不能增发。此额度是初始资金，不是对未来收入的预测，也不是本 Plan 授权立即购买或消耗该额度。

## 64.1 一个余额，两种视图

- Pixel 的 `state.json.energy` 表示等效 Token 余额，正整数最小单位。
- Engine 以固定精度记实际费用，并保存原币种金额、兑换依据、计费模型和价格版本。
- Owner 在实验开始前配置 `budget_currency`、`cost_per_million_equivalent_tokens` 和实际总费用硬上限；参数缺失则不启动付费运行。
- 以基准每百万等效 Token 的费用 P 计，初始实际预算为 `100 × P`。
- 实际输入、输出、缓存等分别按供应商适用价格计费，再按固定 P 折算；不要把不同价格的 Token 原始数量简单相加作为费用。
- 实验内 P 固定；供应商价格变化只影响以后调用的成本，不能重估存量余额。舍入使用账本保留的高精度累计值，避免拆分交易创造预算。

```text
系统总余额 = 初始额度 + 已核验回款折算额度 − 实际费用折算额度
```

## 64.2 扣费与有效推进分开

所有已经发生的真实费用都要扣除，包括失败调用、无效输出和失败尝试。不能以“没有进步”为由免除已经花掉的费用。

只有帮助解决 environment 当前目标的结果才记为有效推进。有效推进本身不增发 Token：可以得到其他 Pixel 的自愿付费，但其本质是内部预算转移。

取消固定 call/message/environment/birth/metabolism 虚拟费。只扣实际计算、存储、托管、工具和外部服务费用；无实际成本的等待不收费。SELF 和自然唤醒引发的调用仍照实扣费。无消息且无活动的状态不算实验失败，但也不计进步。

# 65. 调用与执行预算

调用前由 Engine 按输入及最大输出额度预留预算，结算后释放差额。费用未知的工具必须提供可约束的上限；不得无限额执行。余额不足以预留一次操作时暂停该操作，不允许先透支后处理。

若供应商计费暂不可用，保留费用预留、标记待对账，不把未知用量记成零。重试也计费，但 Engine 不自动重试商业判断失败。每次调用与工具执行有唯一 ID，费用重复返回不得重复扣款。

Energy 不足时停止付费行动并保留状态；邻居后续主动转入足额预算，可恢复活动。耗尽预算不删除文件、不释放已占用坐标。恢复不赠送余额。

# 66. 如何判断“向问题解决更近一步”

有效推进至少属于以下一种，并有可检查的结果：

1. 减少关键不确定性：带来源和时间的信息，能支持或排除一种具体做法。
2. 产生可用交付物：可读取的文件、可运行的程序或可访问的产品，其结果可检查。
3. 得到外部响应：真实用户反馈、测试结果、交付确认或已核验收款。

失败实验也可能有效：例如实际测试排除了一个错误假设。重复计划、无新证据的自我反思、循环转述同一条消息不自动算进展。

Pixel 可以在自由文本里说明“对应什么目标、改变了什么判断、证据在哪里”，不要求固定 summary/details 表单。Engine 只记录可验证的执行与来源事实，不给商业策略打分；“是否有用”由购买信息的 Pixel 或真实接收者判断。Observer 可以事后评价，但评价不反馈为奖励、不增发预算。

信息来源通过 Engine 生成的消息信封记录 sender、message_id、来源类型、时间及关联工具回执。Pixel 不能通过在正文写 `[ENGINE_FEEDBACK]` 或“客户已付款”伪造身份、回执或结算事实。

# 67. 过程中的信息交换定价：按用途报价、验收后支付

选择最小协议，不建立 Bid/Offer/Contract 对象、中央估值模型、工资表、强制托管或自动仲裁。

## 67.1 初始交易惯例

以下惯例只在初始 pixel.md 中作为可修改的交易方法提供，并记录为人为设定的实验初始条件。它不是“自发发明”的观察成果。Child 如何继承、双方是否修改，由 Pixel 自己决定。

1. 买方说明为 environment 的哪个目标需要什么信息或结果，以及最高愿付预算。
2. 卖方依据预计边际成本、可替代性和用途自主报价。没有统一每字价格，成本也不是售价下限。
3. 双方通过普通消息确认范围和金额；卖方可选择不承接。
4. 默认先交付，再由买方检查是否有新信息、是否相关、来源是否可信及结果是否可用。
5. 买方认可后显式输出 `energy_transfer`，引用原交付消息 ID；不认可则说明原因。Engine 不从“我愿意付款”的自然语言中自动扣款。

例：A 愿花最多 6000 等效 Token 获取某接口可用性的实测结果；B 报价 3000，执行成本 1200。A 收到可检查的回执后转给 B 3000。该次交易使 B 净增加 1800，A 减少 3000，系统整体减少实际执行成本 1200，另加双方实际模型通信成本。内部交易不是系统收入。

这采用卖方承担先交付风险的最小方案，不保证付款，不保证诚实。信誉、预付、分阶段付款等允许双方以后自行约定；第一版不强制实施。不得把成交价格或互相好评当成外部价值证明。

## 67.2 付款与重复信息

转账仅检查邻接、可用余额、正金额、唯一转账 ID，引用信息只用于追溯。一次请求重放只执行一次；有意支付第二笔须新 ID。赠与、投资和子代资助仍允许，不强制要求服务交付凭证。

接收方自行拒买重复或无用信息；Engine 不进行语义查重。若希望表达长期经验，买方自行写入自己的 pixel.md，不新增全局信誉评分。

## 67.3 谁承担阅读成本

发信方负担生成消息的调用；接收方负担自己阅读、判断和回复的调用。不得因收到任意消息就无限消耗接收方余额。

Engine 将消息入队，Pixel 的 `state.json` 可含自己设置的 `inbox_call_budget_per_round`（预算参数，非人格）。每轮接收调用在该授权预算及总余额内执行；超限消息保留到后续轮次，单条消息只消费一次。初始上限由运行配置明确给出，并受 Owner 全局费用硬上限约束。超限不收费、不丢消息、不自动提高额度。

# 68. 现实收益如何换算预算

只对外部已经核验、可用于后续支出的净回款回补：从实收中扣支付手续费及需要保留的退款/税费额度。已作为实际费用扣过的项目不能再次扣除。收入与利润在账本中分别展示；回款回补不意味着业务已经盈利。

```text
新增等效 Token = 可投入净回款 / P × 1,000,000
```

同一付款事件使用支付平台交易 ID 或经 Owner 核验的唯一 ID，最多入账一次。付款截图的文字描述、模型声明、Pixel 相互转账、Owner 测试付款都不能算外部经营回款。Owner 追加资金单列“资本注入”，不计收入或涌现成果。

退款或拒付按原入账事件冲回。余额不足冲回时，账本记录待偿缺口并暂停新支出，不伪造零成本或负 Energy 转账；后续回款先填补缺口。

预算归属按外部动作发起者的 Engine 身份和交付记录关联。Pixel 转发别人的收款凭证不能夺取归属。确实无法归属的回款留在待分配账本，由 Owner 仅核验事实归属；不得自动给“第一个声称成功”的 Pixel。多人如何分配仍由它们自行转账。

# 69. 补齐现实行动：通用工具通路

第 11 节响应新增 `operations: []`。保留原来的自我更新、邻域路由、环境读取、复制和转账，不增加商业角色或任务对象。

```json
{
  "operations": [
    {"tool": "已授权工具名", "args": {}}
  ]
}
```

工具可提供检索、读取/保存交付物、运行代码、发布服务及已授权的外部 API 操作；具体能做什么由已开通能力决定。预算是消费上限，不自动授予支付、账号或宿主机权限。

可用工具名、参数契约、预算上限和调用权限作为自身 `state.json` 的运行参数呈现；工具结果通过下一条 message 输入，仍保持三类输入。Owner 请求只能开通现实权限，不能代替 Pixel 选择产品或制定策略。

动作回执必须区分：请求已接收、执行成功、执行失败、结果未知。返回输出/交付物引用、费用与来源。请求被接受不等于产品已发布，更不等于收入发生。未知状态须先查询回执，不自动重发有外部副作用的动作。

第一版同一响应最多执行 3 个工具操作，按顺序执行，每一步计费和留回执；某步失败停止剩余操作，保留已成功步骤，回传全部已发生结果。无需新增完整业务工作流。

# 70. 两个核心文件与外部交付物不冲突

第 39、58 节禁止 Workspace，解释为不恢复 V8 的自由宿主机工作目录，不禁止保存真实产品和交付物。

Engine 提供实验公共基础设施 `artifacts/`，按 Pixel 身份隔离。Pixel 自主命名、保存、读取、更新自己的交付物，不设产品类型、文件内容模板或组织目录。每个交付物有稳定 ID 和版本；message 可传递对特定版本的授权引用，转发受邻域规则约束。

pixel.md 只保留有限经验及必要引用；交付物正文不自动进入上下文，须主动工具读取。别人的私有文件、API 密钥及宿主机文件不可任意读取。内容访问以 Engine 记录的所有者和授权为准，不相信模型自报所有者。

代码执行必须在具备文件、进程与网络隔离的环境中，配置时间、输出和费用上限；仅设置 cwd 不构成隔离。未配置隔离执行器时明确返回能力不可用，不回退到宿主机任意 shell。

接入外部工具不得绕过邻域规则，通过共享文件或公共环境直接替 Pixel 建立隐形全局通信。真实外部渠道的数据经来源标记作为观察返回。

# 71. 状态提交、路由与回退边界

- Engine 自己维护余额、身份和队列；模型不能直接重写这些数值。
- 超长 pixel.md 或非法响应保留旧内容、返回可追溯反馈；已发生模型费用仍扣除。
- 同一 Pixel 一次只处理一条消息，避免并发覆盖自身记忆或重复花费。
- environment_read 和工具回执各自形成队列消息，不能覆盖尚未消费的邻居消息。
- `send_to=[STOP]` 是唯一停止路由表达；删除重复的 `stop` 布尔字段。STOP 表示不再主动续传，不取消已提交操作及必须返回的回执。
- 达 hop/message 上限时未处理消息连同预算预留信息持久化，不静默丢弃。Round 边界不重置全局费用上限。

Snapshot 增加交付物版本引用、队列、已消费消息 ID 和实验账本快照。真实费用、付款、退款及外部执行记录另用不可回滚账本保存。回退可以恢复认知与本地实验状态，不能撤销真实发信/发布/支付，不能恢复已经消耗的预算或再次领取同一笔回款。

从旧 checkpoint 分叉时必须从当前尚未花费的预算显式划拨分支额度，不复制历史余额。历史余额只读展示。外部动作重放须新授权/新执行意图，不能随 checkpoint 自动执行。

# 72. 实施顺序与默认边界

1. 先完成 V9 原有消息与状态内核，以及真实费用账本、预留结算和全局限额。
2. 加入邻域转账、买方消费授权及交易引用；用虚拟消息测试定价惯例。
3. 补齐交付物工具、隔离执行器与真实回执，完成最小外部交付通路。
4. 接通支付事实核验、收入去重、退款及回补。
5. 最后验证 UI、分叉和不可回滚账本，再开始真实商业实验。

第 57 节真实商业实验必须以第 3、4 步完成为前提。工具与回款未接通时只能称消息/组织实验，不能声称系统具备自主经营能力。先用小额配置验证闭环；一亿额度作为可配置初始总预算，不要求一次性消耗完。

# 73. 补充验收清单

- 实际输入/输出/缓存计费正确；供应商价格变更不改变存量预算。
- 初始总额度只注入一次；复制、转账、分叉及重放不能增加系统总预算。
- 调用先预留后结算；失败计费、用量未知、并发及余额不足均有明确结果。
- 无固定消息/环境/繁殖/空闲代谢费，真实费用无重复扣除。
- 超出接收授权的消息不触发额外付费调用，消息延迟而非丢失。
- 验收后转账是显式动作，报价文本不自动扣费；重复转账请求只结算一次。
- 内部买卖只转移预算；任何模型进步评分都不能增发预算。
- 外部回款可验证、去重、可追溯；退款冲回正确，测试付款不计经营收入。
- 至少一种真实交付工具完成请求、执行、结果返回，Pixel 能主动读取自己交付物的内容。
- 回执与消息身份无法靠文本伪造；秘密不进入上下文，执行器无宿主机越界。
- STOP、环境读取、并行来信和上限延期不会覆盖消息或丢失回执。
- checkout/branch 不恢复已花预算、不重复兑现回款、不自动重放现实动作。

# 74. 成果记录和比较

UI/Observer 展示实际费用、等效 Token 余额、内部转账、核验回款、退款、交付物和回执；不要把消息数、复制数或成交价格直接显示成商业进步。

有效性采用相同实际预算、相同外部工具和同一目标，对比单 Pixel 与多 Pixel 的可检查交付、真实外部反馈和净经营结果。区分初始提供的交易惯例与之后自发形成的协作行为。

实现报告增加计费配置、初始资金额度、定价惯例、工具权限、回款来源、不可回滚账本及已知限制。不得因 Kernel 测试通过就宣称已经产生盈利公司。
