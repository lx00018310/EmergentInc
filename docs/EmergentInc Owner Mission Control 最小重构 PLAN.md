# EmergentInc Owner Mission Control 最小重构 PLAN

## 0. 本次重构目标

当前 EmergentInc 的底层结构已经基本成立：

- `/`：公开营销与商城
- `/QIAN`：人物 / World 入口 / 人物对话
- `/YUAN`：Pixel / Run / 文件 / 调试
- `/GENE`：生命循环 / 经营 / 方案 / 资源 / 治理
- 独立 Upgrade Service：Owner 软件版本发布
- World / Pixel / Gene / Evolution / Generation 等底层机制

本次**不重新设计这些系统**。

本次只解决一个问题：

> Owner 不应该为了管理系统，在 QIAN / YUAN / GENE / Upgrade 之间来回寻找信息和操作入口。

最终目标：

> **Owner 平时只使用 `/OWNER`。**

`/QIAN`、`/YUAN`、`/GENE` 保留，但降级为：

> 专业详情页 / Debug 页面 / Drill-down 页面。

核心原则：

```text
内部复杂
↓
Owner Control Plane 聚合
↓
外部简单
```

Owner 的一级交互只围绕三件事：

```text
1. 我需要处理什么？
2. 系统现在正在做什么？
3. 我想让系统做什么？
```

---

# 1. 本次必须遵守的重构原则

## 1.1 最小修改

禁止为了这次 UI 重构：

- 重写 World Runtime
- 重写 Pixel 调度器
- 修改生命循环定义
- 修改 Generation 定义
- 修改四层架构
- 重写现有 Business 模块
- 重写现有人物系统
- 大规模迁移数据库
- 新建复杂工作流引擎
- 新建第二套 Agent Runtime

优先：

> **组合现有能力，而不是重新实现能力。**

---

## 1.2 原页面保留

以下页面全部保留：

```text
/QIAN
/YUAN
/GENE
```

原有 API 也尽可能保持不变。

新 `/OWNER` 只是：

> 聚合入口。

旧页面成为：

> “查看详细信息”。

---

## 1.3 Upgrade 安全边界不改变

现有独立：

```text
127.0.0.1:8766
```

软件升级服务继续独立运行。

必须保留：

- 独立 Owner Session
- localhost 限制
- Candidate Hash 校验
- prepare
- validate
- approve
- apply
- recover
- 操作互斥
- Root of Trust 边界

`/OWNER` 可以显示软件升级状态。

但第一版：

> **不要把 Upgrade 执行逻辑搬进主服务。**

Owner Console 中只提供：

```text
发现可发布版本
↓
查看概要
↓
打开独立 Upgrade 页面
```

---

# 2. 最终目标结构

重构后：

```text
                     /
              Public Store
                     │
               Owner Login
                     │
                     ▼
              /OWNER
        Owner Mission Control
                     │
       ┌─────────────┼─────────────┐
       │             │             │
       ▼             ▼             ▼
 What needs me    Activity       Chat
 待我决定          活动流         对话入口
       │             │             │
       └─────── Owner Router ──────┘
                     │
       ┌─────────────┼─────────────┐
       ▼             ▼             ▼
     QIAN          YUAN          GENE
     人物           运行           治理
       │             │             │
       └──────── World / Pixel ─────┘
```

QIAN / YUAN / GENE 继续存在。

但用户正常工作流从：

```text
Owner → 找页面 → 找对象 → 找状态 → 操作
```

变成：

```text
Owner → /OWNER
         ↓
系统告诉 Owner：
发生了什么
需要决定什么
可以做什么
```

---

# 3. 第一阶段：建立 `/OWNER`

这是本次最重要、也是最小的一步。

## 3.1 新增页面

新增：

```text
frontend/src/features/owner/OwnerConsole.tsx
```

继续使用现有：

```text
frontend/src/features/owner/OwnerChat.tsx
```

新增：

```text
OwnerInbox.tsx
OwnerActivity.tsx
```

形成：

```text
owner/
├── OwnerConsole.tsx
├── OwnerChat.tsx
├── OwnerInbox.tsx
└── OwnerActivity.tsx
```

不要建立大型新的组件体系。

---

# 4. `/OWNER` 第一版页面布局

保持简单。

桌面版建议：

```text
┌──────────────────────────────────────────────┐
│ EmergentInc                     中文 / EN    │
│ Owner Mission Control                        │
├──────────────────────────────────────────────┤
│                                              │
│ 需要你决定                    当前状态        │
│                                              │
│ 3 Items                      Running 2       │
│                                              │
├──────────────────────┬───────────────────────┤
│                      │                       │
│ What needs me        │ Activity              │
│                      │                       │
│ □ Gene Proposal      │ 09:31 xxx 完成任务    │
│ □ Run blocked        │ 09:25 收到反馈        │
│ □ Resource Request   │ 09:20 G0010 candidate │
│                      │                       │
├──────────────────────┴───────────────────────┤
│                                              │
│ Owner Chat                                   │
│                                              │
│ [现在整个公司最需要我处理什么？          ]   │
│                                              │
└──────────────────────────────────────────────┘
```

不要：

- 地图
- 大量图表
- 复杂统计
- KPI Dashboard
- 新的三维可视化

这是**操作入口**，不是展示页面。

---

# 5. Owner Inbox：整个重构的核心

新增统一数据类型：

```ts
type OwnerInboxItem = {
  id: string;
  type: string;
  priority: 'critical' | 'normal' | 'low';

  title: string;
  summary: string;

  source:
    | 'qian'
    | 'yuan'
    | 'gene'
    | 'business'
    | 'upgrade';

  entityId?: string;

  actions: OwnerInboxAction[];

  createdAt: number;
};
```

第一版不必持久化。

直接通过已有 API 实时聚合。

---

# 6. 第一版 Inbox 聚合哪些事情

只聚合**真正需要 Owner 行动**的状态。

## 6.1 Gene Proposal

例如：

```text
G0010 Gene Proposal
新的公共营销策略等待批准。

[查看]
[前往 GENE]
```

如果现有 API 已经支持 approve：

可以直接：

```text
[批准]
[拒绝]
[查看详情]
```

否则第一版只跳转 GENE。

不要为了统一 UI 重写 Gene API。

---

## 6.2 Business Plan

现有：

```text
AWAITING_APPROVAL
```

自动进入 Inbox。

显示：

```text
新的经营方案等待批准

目标：
验证定制服务获客渠道

预算：
¥2

[批准]
[查看方案]
```

直接复用当前：

```text
business/plans/:id/approve
```

---

## 6.3 Resource Request

当前 GENE：

```text
需要你提供的资源
```

自动成为：

```text
Pixel 请求资源

需要：
xxx

原因：
xxx

[提供]
[拒绝]
[查看详情]
```

---

## 6.4 Run Blocked

YUAN 当前已经能识别：

```text
WAITING_PIXEL_BUDGET
WAITING_RUN_BUDGET
CALL_OUTCOME_UNKNOWN
AWAITING_SETTLEMENT
ABANDONED
```

只有确实需要 Owner 的情况进入 Inbox。

例如：

```text
张三 World 运行暂停

原因：
Pixel Energy 不足

[查看详情]
```

不要所有 Run stop 都进入 Inbox。

---

## 6.5 External Outcome Unknown

这是高优先级。

显示：

```text
一项外部操作结果未知

GitHub Issue 可能已经创建，
系统不会自动重试。

[核实]
[查看详情]
```

---

## 6.6 Software Upgrade

Owner Console 可以读取：

```text
当前 Generation
是否存在 VALIDATED Candidate
Upgrade Service 是否 Busy
```

显示：

```text
V25 已通过验证

Source:
abc123

[打开发布页面]
```

第一版不要直接发布。

---

# 7. Inbox 的最重要规则

不是所有事件都进入 Inbox。

必须满足：

> **需要 Owner 做决定或者提供资源。**

否则进入 Activity。

例如：

```text
Pixel 完成任务
人物回复
一次 Run 成功
创建了一份文件
产生了一个 Body 技能
获得收入
生成了一份报告
```

这些不应该要求 Owner 点“已读”。

全部进入 Activity。

---

# 8. Owner Activity

Activity 是系统生命迹象。

它解决：

> “我的公司现在到底有没有在干活？”

第一版只需要统一时间线。

数据来源优先复用：

```text
control_events
business events
run status
generation events
payments
Qianji / World events
```

可以展示：

```text
09:31
张三完成了一轮市场研究

09:26
World world_xxx 完成 Run

09:18
创建 GitHub Issue #32

08:51
生成 Gene Proposal G0010

08:34
收到 20 USDC
```

只展示：

```text
最近 20～50 条
```

不要一开始开发：

- 无限滚动
- 高级搜索
- 日志系统
- Elasticsearch
- 新 event bus

有现成数据就组合。

---

# 9. Owner Chat 第一阶段：增强查询，不立即做万能 Agent

现有：

```text
OwnerChat.tsx
```

继续保留。

当前已经能够：

- 读取状态
- 查询项目
- 返回 Sources
- 显示时间
- 显示 Token

第一阶段只扩展上下文。

让 Owner 可以问：

```text
现在整个公司在做什么？
```

```text
哪些事情需要我处理？
```

```text
张三现在在干什么？
```

```text
为什么李白停了？
```

```text
最近产生了什么 Gene？
```

```text
现在有哪些 World 在运行？
```

Owner Chat 应读取：

```text
QIAN
World
Run
GENE
Business
Owner Inbox
```

但仍然保持：

> **Read Mostly。**

---

# 10. 第二阶段：Owner Chat 增加 Action Proposal

第一阶段稳定以后，再增加。

不要让 LLM 直接调用任意 API。

结构：

```text
Owner message
      ↓
Intent Parser
      ↓
OwnerActionProposal
      ↓
Owner 确认
      ↓
Typed Action
      ↓
现有 API
```

定义简单结构：

```ts
type OwnerActionProposal = {
  action: string;
  target?: string;

  explanation: string;

  risk:
    | 'read'
    | 'normal'
    | 'sensitive';

  requiresApproval: boolean;

  payload: Record<string, unknown>;
};
```

---

# 11. 第一批允许的自然语言 Action

只支持高频动作。

不要追求万能。

例如：

### 人物对话

Owner：

```text
问张三今天发现了什么
```

系统：

```text
准备向 张三 发送：

“今天最重要的发现是什么？”

[发送]
```

确认后复用：

```text
postQianjiChat()
```

---

### 多人物询问

Owner：

```text
问所有人现在最大的风险是什么
```

转换成：

```text
targets:
张三
李白
王阳明
```

分别调用现有 Qianji Chat。

第一版允许并发限制：

```text
2～3 个
```

不要开发复杂 multi-agent meeting runtime。

---

### Business Plan Approval

Owner：

```text
批准刚才那个营销方案
```

系统生成：

```text
准备批准：

Plan xxx
Revision 3
Hash xxx

[确认批准]
```

然后调用已有 approve API。

---

### Resource Request

Owner：

```text
告诉它这个数据以后再提供
```

转换成已有：

```text
reject / feedback
```

---

# 12. 不允许 Owner Chat 直接执行的东西

以下操作继续保持专用 UI / 强确认：

```text
软件版本发布
Root of Trust 修改
私钥操作
钱包私钥
大额预算改变
不可逆外部操作
危险恢复操作
任意 Shell
任意 Git 命令
任意文件修改
```

核心原则：

> 自然语言可以提出操作，但高风险动作仍由既有安全边界执行。

---

# 13. 第三阶段：让 `/OWNER` 成为默认后台

完成前两阶段后：

当前：

```text
QIAN | YUAN | GENE | Publish upgrade
```

改成：

```text
OWNER
```

然后右上角增加：

```text
Advanced ▾
```

展开：

```text
QIAN
YUAN
GENE
Publish Upgrade
```

即：

> 专业页面仍然存在，但不再占用一级注意力。

---

# 14. QIAN 的定位调整

QIAN 不删除。

定位从：

> Owner 日常入口

改为：

> 人物管理与深度人物交互。

继续负责：

```text
人物列表
人物档案
人物配置
人物长期对话
人物 World
人物 Tips
招募
退役
无限 Energy
```

但是：

正常情况下 Owner 不需要每天打开 QIAN。

---

# 15. YUAN 的定位调整

YUAN 定义成：

> Debug / Runtime Inspector

继续负责：

```text
Pixel
Run
Messages
Files
Tools
Recovery
Budget
World
Execution
```

OWNER 页面只展示：

```text
张三 World 暂停
原因：Energy 不足

[查看详情]
```

点击详情再进入：

```text
/YUAN?world=xxx
```

不要在 OWNER 重做整个 Engine UI。

---

# 16. GENE 的定位调整

GENE 定义成：

> Governance / Business / Evolution Console

继续负责：

```text
四层生命结构
Gene
Evolution
Business
Plans
Resources
Payments
Public Site
Connections
History
```

OWNER 只拿：

```text
需要决定的事情
关键结果
关键异常
```

不要把 BusinessHome.tsx 搬进 OWNER。

---

# 17. 后端最小修改方案

第一阶段优先不增加新 DB。

新增一个聚合 API 即可：

```text
GET /api/owner/overview
```

返回：

```json
{
  "summary": {},
  "inbox": [],
  "activity": []
}
```

后端内部调用已有 Repository / Service。

不要让前端自己并发请求十几个接口。

但也不要建立：

```text
OwnerRepository
OwnerDatabase
OwnerEventStore
```

如果没有必要。

Owner 是一个：

> Projection / Aggregation Layer。

不是新的 Domain。

---

# 18. Owner Overview 推荐返回结构

```ts
interface OwnerOverview {
  asOf: number;

  summary: {
    qianjiCount: number;
    activeWorlds: number;
    runningWorlds: number;
    inboxCount: number;
    currentGeneration?: string;
  };

  inbox: OwnerInboxItem[];

  activity: OwnerActivityItem[];
}
```

第一版已经足够。

---

# 19. Activity 数据不要强行统一数据库

第一版允许从多个表读取后：

```text
map
↓
normalize
↓
sort(createdAt)
↓
slice(50)
```

即可。

暂时不要开发：

```text
统一事件溯源系统
Kafka
EventBus
CQRS
新的 Ledger
```

以后出现真实需求再考虑。

---

# 20. Navigation 最小调整

修改：

```text
frontend/src/Entry.tsx
```

支持：

```text
/OWNER
```

Owner 登录后的默认后台入口变成：

```text
/OWNER
```

导航从：

```text
QIAN
YUAN
GENE
Publish upgrade
```

调整成：

```text
OWNER

Advanced
 ├ QIAN
 ├ YUAN
 ├ GENE
 └ Publish upgrade
```

第一阶段如果不想处理 dropdown：

直接：

```text
OWNER | QIAN | YUAN | GENE
```

但 OWNER 放第一位并作为默认。

等稳定后再隐藏后 3 个。

---

# 21. 现有 OwnerChat 迁移方式

不要重写：

```text
OwnerChat.tsx
```

只调整：

### 当前

```text
OwnerChat
独立存在
```

### 修改后

```text
OwnerConsole
 ├ OwnerInbox
 ├ OwnerActivity
 └ OwnerChat
```

OwnerChat 变成 Mission Control 中央输入区域。

保持现有：

```text
localStorage history
source
as_of
usage
```

第一阶段不要做复杂跨设备 Chat History。

---

# 22. OwnerChat 后端需要增加的上下文

当前 query context 扩展到：

```text
Qianji summary
World summary
Run status
Gene status
Business pending decisions
Recent activity
Current generation
```

重要：

不要直接把大量原始数据库内容塞给 LLM。

先形成：

```text
OwnerContextSnapshot
```

例如：

```json
{
  "people": [],
  "worlds": [],
  "pending_decisions": [],
  "recent_activity": [],
  "generation": {}
}
```

控制上下文大小。

---

# 23. 页面跳转必须带上下文

从 OWNER 点：

```text
查看张三运行详情
```

必须直接：

```text
/YUAN?world=world_xxx
```

而不是：

```text
/YUAN
↓
Owner 再选择 World
```

从 Inbox 点：

```text
查看 Gene Proposal
```

应尽可能：

```text
/GENE?view=proposal&id=xxx
```

如果现有 GENE 暂不支持 deep link：

第一版跳 `/GENE` 即可。

不要为了这一点大改 BusinessHome。

---

# 24. Tips 处理方式

现在 QIAN 中：

```text
Tips
已读
未读
```

保留。

但 Owner Console 中：

普通 Tips → Activity

只有满足：

```text
需要决定
需要资源
风险
运行阻塞
```

才进入 Inbox。

否则不要增加 Owner 的认知负担。

---

# 25. Notifications 暂不开发

本次不要做：

```text
系统通知
Email
Telegram
微信
飞书
Push
桌面通知
```

先把 `/OWNER` 做好。

未来是否通知 Owner，再根据真实使用情况决定。

---

# 26. 第一阶段文件级修改范围

预计主要修改：

```text
frontend/src/Entry.tsx
frontend/src/OwnerEntry.tsx

frontend/src/features/owner/OwnerConsole.tsx
frontend/src/features/owner/OwnerInbox.tsx
frontend/src/features/owner/OwnerActivity.tsx
frontend/src/features/owner/OwnerChat.tsx

frontend/src/api/owner.ts

apps/server/src/...
```

后端增加：

```text
GET /api/owner/overview
```

以及必要的数据聚合 Service。

不要修改：

```text
packages/core runtime
scheduler
generation supervisor
version-upgrade
world lifecycle
pixel lifecycle
ledger 核心逻辑
```

除非编译或接口复用确实需要极小调整。

---

# 27. 开发阶段划分

## Phase 1 — Owner Mission Control

完成：

```text
/OWNER
OwnerInbox
OwnerActivity
OwnerChat
Owner Overview API
```

能力：

Owner 打开一个页面即可知道：

```text
系统现在怎样
有什么需要我处理
最近发生了什么
```

验收标准：

> 日常查看状态不需要进入 QIAN / YUAN / GENE。

---

## Phase 2 — Action Proposal

增加：

```text
Owner natural language
↓
Intent
↓
Proposal
↓
Confirm
↓
Existing API
```

第一批只支持：

```text
向人物发消息
向多人物发消息
批准 Business Plan
拒绝 Business Plan
处理 Resource Request
打开对应详情
```

验收标准：

> 高频 Owner 操作可以直接从 OWNER 完成。

---

## Phase 3 — Navigation 收敛

确认 OWNER 稳定以后：

把：

```text
QIAN
YUAN
GENE
```

放入：

```text
Advanced
```

Owner 默认登录：

```text
/OWNER
```

最终形成：

```text
Public /
Owner /OWNER
Advanced /QIAN /YUAN /GENE
Upgrade 独立服务
```

---

# 28. 明确不做的事情

本版本禁止顺手实现：

```text
新的多 Agent 框架
新的 Workflow Engine
新的消息队列
新的数据库
统一 Event Store
复杂 RBAC
多 Owner
多租户
移动 App
通知系统
全站重写
新的 CSS Design System
重新设计人物系统
重新设计四层架构
自动软件发布
LLM 任意工具调用
```

这些都不属于当前核心问题。

当前问题只有：

> **降低 Owner 管理 EmergentInc 的操作复杂度。**

---

# 29. 测试要求

至少覆盖：

## 路由

```text
/OWNER 正常访问
未登录要求 Owner 登录
登录后正确进入 OWNER
QIAN/YUAN/GENE 仍可正常访问
```

## Inbox

构造：

```text
Business Plan awaiting approval
Resource Request
Blocked Run
Unknown external action
```

确认：

都能正常出现。

普通完成事件：

不得进入 Inbox。

---

## Activity

验证：

```text
不同来源事件
↓
正确 normalize
↓
按照 createdAt 排序
```

---

## Owner Chat

原有：

```text
history
sources
as_of
usage
```

不得回归。

并能回答：

```text
有哪些事情需要我处理？
```

---

## 安全

Owner Chat 不得：

```text
调用任意 shell
直接修改数据库
直接发布软件
绕过 approve
绕过 hash
绕过 existing auth
```

---

# 30. 最终验收场景

重构完成以后，用下面几个真实场景验收。

---

### 场景 A

Owner 打开后台。

只能进入：

```text
/OWNER
```

马上看到：

```text
3 件事情需要你决定
2 个 World 正在工作
当前 Generation G0010
```

通过。

---

### 场景 B

Owner：

```text
现在所有人在做什么？
```

Owner Chat 能从不同 World 获取摘要并回答。

不需要进入 QIAN。

通过。

---

### 场景 C

某个 World 因 Energy 不足停止。

Owner Console 出现：

```text
张三 World 暂停
Pixel Energy 不足

[查看详情]
```

点击直接打开对应：

```text
/YUAN?world=...
```

通过。

---

### 场景 D

新的 Business Plan 等待批准。

OWNER Inbox：

```text
新的经营方案等待批准
```

Owner 可以直接批准，或打开 GENE 查看完整内容。

通过。

---

### 场景 E

存在新的软件 Candidate。

OWNER：

```text
V25 已验证，可以发布
```

点击：

```text
打开发布页面
```

进入独立 Upgrade Service。

仍然要求：

```text
review
hash
approve
publish
```

通过。

---

# 31. 最终产品原则

以后任何新功能开发，都先问：

> **这个功能真的需要成为 Owner 的新页面吗？**

默认答案应该是：

> 不需要。

新能力优先进入：

```text
内部 Domain
↓
Activity
↓
必要时 Inbox
↓
Owner Chat 可以查询
```

只有真正需要专业操作时：

才新增 Drill-down UI。

---

# 32. 本次重构完成后的核心状态

EmergentInc 的内部依然是：

```text
Root
Gene
Evolution
Body

Qianji
World
Pixel

Run
Business
Payment
Generation
Upgrade
```

但 Owner 看到的是：

```text
我要做什么
↓
有什么需要我决定
↓
公司发生了什么
↓
必要时查看证据
```

最终原则：

> **内部复杂度可以继续增长，但 Owner 的交互复杂度不能随之增长。**

这次重构不改变 EmergentInc 的生命系统。

它只是给整个生命系统增加一层真正的人机接口：

# Owner Mission Control

---

# 33. V25 执行与审查记录（2026-10-07）

三个阶段已完成。本次仅增加 Owner 聚合与确认界面，沿用原业务审批、资源处理、人物对话和独立升级服务；不修改 Runtime / Scheduler / Generation 的执行或授权机制。

## 已实现

- `/OWNER`：老板窗口、真实状态摘要、Inbox、Activity；后台商城登录默认进入 OWNER，QIAN / YUAN / GENE / 发布升级收进“高级”，原路径保留。
- `GET /api/owner/overview`：复用 Control、各已打开 World、Lineage / Current、Business 和 Payment 记录，统一为毫秒时间，最近 50 条动态。Tips 进入动态，普通完成 / 停止不进入待办。
- 需要处理的待办：当前代 Gene 提案、待批准经营方案、OPEN 资源请求、真实等待或未知结果、未经人工处理且没有答复的 ABANDONED 对话、独立升级服务中针对当前代的有效候选。
- 全局 Owner Chat：复用原有问答与独立用量记录，保留浏览器历史、读取时间和来源；模型上下文限制为 20 人、每世界 5 个元胞摘要、30 条待办、50 条动态，显式声明截断边界。查询不启动 Run，也不恢复或结算操作。
- 有限指令：人物 / 群发对话、批准 / 拒绝经营方案、提供 / 拒绝资源、打开详情。解释及风险由有限规则生成，LLM 文本不进入执行器。未知或同名目标要求指定 ID。
- 变更动作先展示目标、内容、费用或影响并勾选确认；审批绑定 revision / hash，资源处理绑定 request / plan / revision；群发最多 2 个并发，失败后只重试未受理目标并沿用幂等编号。
- QIAN 人物、YUAN World、GENE 方案 / 资源 / 商城使用具体上下文链接。Gene 审批、外部未知结果核实和敏感恢复继续进入现有详情页。
- 独立 Upgrade Service 增加回环只读 `/status`，只返回当前代、busy、候选 ID / 状态 / 时间 / source commit / hash / base generation。Root 不读取 Supervisor 私有库，不接收升级凭证，不执行发布；真实发布仍由独立服务完成精确审批。
- 新增页面文本与错误同步中英文；用户原始人物、方案、Tips 等内容保持原文。

## Review 与修复

1. Run 的 `NO_ACTIVE_MESSAGES` 不能证明没有阻塞：同时检查真实消息状态，修复能量不足待办遗漏。
2. ABANDONED 仅在人物对话无答复且没有相应人工恢复记录时要求处理，已明确放弃的内容不反复提醒。
3. “拒绝资源”与“拒绝方案”分别解析，避免误选；资源拒绝会终止关联方案，确认界面明确说明。
4. 给旧 revoke / resource decision API 添加可选版本绑定，防止历史提案误操作新版本；旧页面调用契约保留。
5. 群发记录各收件人的受理状态与幂等编号，避免部分失败后重新提交已成功目标；“已受理”与“已回复”分开。
6. 全局 Owner API 显式绕过选中 World 的前端 URL 重写，防止概览与问答被锁定到单个世界。
7. 实例收入的详情指向商城经营页，避免形成 `world=null` 的无效链接。
8. 升级服务不可用明确显示；过时代候选不要求审批。主服务来源列表仅在实际读取升级摘要时列出 `/status`。
9. 最终截图发现全局深色主题与固定高度干扰 Owner 页面；仅为 Owner 增加背景、对话文字对比和独立滚动覆盖，保留旧页面主题。
10. 缺少原始时间的待办明确显示“未记录时间”，避免将未知时间渲染为 1970 年。
11. 实际 Windows 进程升级测试内部运行完整候选验证，原 240 秒超时不足；仅将此测试的超时改为 600 秒，未改产品运行超时或升级审批。复测实际用时约 391 秒并通过。

## 验证

- `npm.cmd run typecheck`：通过。
- `npm.cmd --prefix frontend run build`：通过；原有 App 大包提示仍存在，不纳入本次重构。
- `$env:EMERGENTINC_CANDIDATE_MODE='1'; npm.cmd test -- --maxWorkers=1`：91 个测试文件通过，654 项通过，2 项按条件跳过。
- 单独真实进程 `world_process_generation.test.ts`：1 项通过，覆盖进程重启、批准升级、世界继承、收入事实保持和回退。另一项 `owner_version_process.test.ts` 需要 `EMERGENTINC_TEST_V23_RELEASE`，本次没有指定发布目录，未运行。
- 最终受影响回归：World / Owner actions 27 项、商城收入 / 问答 / 独立升级服务 18 项、中英文页面 / 确认 / 群发重试 / 未知时间 11 项，全部通过。
- 浏览器：独立临时数据库、模拟模型、单独测试 Cookie 验证登录、双语、摘要、待办过滤、公开 Tips、问答时间 / 来源 / 用量、确认按钮和详情链接；不调用正式模型或操作正式实例。
- `git diff --check`：通过。

初次完整测试遇到进程测试超时；另一次指令回归是在代码修复过程中启动的旧测试进程中失败。修复后的独立回归与新一轮候选全量均通过，不将旧失败计为通过。

交付边界：本次交付代码、测试及本 PLAN 的本地 V25 提交；没有发布、推送或切换正式 Generation。自然语言操作采用有限规则，不支持通用工具执行。
