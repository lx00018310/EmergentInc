# EmergentInc /GENE 四层生命架构页面整改 Plan

> 仓库：`lx00018310/EmergentInc`
> 审阅基线：`fabf64032d9a1b4af4e7b0294406f8d73525f386`
> 当前状态：`/GENE` 已包含完整经营工作台和生命页，但生命信息仍是平铺列表，没有把系统真实结构表达为“信任根 → 基因 → 进化 → 身体”。
> 执行者：本地 AI / Codex
> 原则：**本次只重构 /GENE 的信息架构和必要的只读数据投影，不重做 V22 后端，不改变现有权限语义，不新增假的能力。**

---

# 0. 本次整改目标

把 `/GENE` 从现在的：

```text
经营工作台
├─ 首页
├─ 方案
├─ 连接与资料
└─ 生命
     ├─ 当前代
     ├─ 身体能力
     ├─ 记忆
     ├─ Dream
     ├─ Gene Proposal
     └─ 代际历史
```

改成真正表达 EmergentInc 生命架构的：

```text
/GENE
│
├─ 第一层：信任根 Root of Trust
│    └─ 谁能决定系统“能不能变”
│
├─ 第二层：基因层 Genome
│    └─ 当前这一代“遗传了什么”
│
├─ 第三层：进化层 Evolution
│    └─ 系统“如何从这一代走向下一代”
│
└─ 第四层：身体层 Body
     └─ 当前这一代“正在长什么、做什么”
```

核心要求：

> **每一层都必须显示“当前状态 + 最近发生的事情 + 下一步正在等待什么”。**

页面不是概念图，而是 **真实运行数据的生命控制台**。

---

# 1. 当前代码判断

最新代码已经有足够的数据，不要推倒重做。

当前已有：

```text
genome/manifest.json
LifeContext
LineageStore
CurrentStore
DreamService
MemoryGate
BodyGrowthService
GenerationSupervisor
Recovery Service
local-upgrade receipts
evolution/overview API
EvolutionPanel
```

当前 `EvolutionPanel.tsx` 的问题不是缺数据，而是：

```text
所有生命数据被平铺在一个 section 内
```

现在大致是：

```text
当前代
身体能力
最近记忆
Dream
Gene Proposal
代际历史
```

这会让用户看不出：

```text
什么是最高层边界
什么是遗传规则
什么是进化过程
什么只是身体活动
```

因此本次优先做 **重新分层**，而不是继续增加功能。

---

# 2. /GENE 页面总体结构

## 2.1 /GENE 默认进入“生命总览”

当前：

```text
首页 / 方案 / 连接与资料 / 生命
```

建议调整为：

```text
生命总览 / 经营 / 方案 / 连接与资料
```

`/GENE` 登录后默认：

```text
tab = life
```

而不是当前经营首页。

原有经营功能全部保留，只把原来的 `home` 内容改名为：

```text
经营
```

不要删除：

- 预算；
- 方案；
- 数据资料；
- GitHub connection；
- 任务；
- 订单；
- 付款证据；
- 真实结果。

这些本质上都属于 **Body 当前正在做的工作**。

---

# 3. 生命总览页面采用“四层堆栈”

页面从上到下严格按：

```text
L1  ROOT OF TRUST
        ↓
L2  GENOME
        ↓
L3  EVOLUTION
        ↓
L4  BODY
```

视觉上必须让用户一眼看出：

> 上层约束下层，下层不能反向越权修改上层。

不要继续做四个互不相关的小卡片。

建议布局：

```text
┌─────────────────────────────────────────────┐
│ L1 · ROOT OF TRUST                         │
│ 信任根：谁有最终裁决权                      │
│ 状态 / 边界 / 最近裁决事件                  │
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ L2 · GENOME                                │
│ 基因：这一代遗传了什么                      │
│ Gene Hash / Contracts / Proposals / History│
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ L3 · EVOLUTION                             │
│ 进化：如何形成下一代                        │
│ Dream / Memory / Candidate / Birth/Rollback│
└─────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│ L4 · BODY                                  │
│ 身体：当前正在生长和工作什么                │
│ Skills / Needs / Tasks / Results / Revision│
└─────────────────────────────────────────────┘
```

---

# 4. 每一层统一显示三类信息

四层的 UI 模板统一。

每层都必须有：

```text
A. 当前状态
B. 最近发生
C. 等待 / 下一步
```

例如：

```text
基因层

当前状态
G0004
Gene Hash: cfff95...
Body Interface: v1

最近发生
G0003 出生失败
G0004 经 Owner 批准后出生

等待
2 个 Gene Proposal 等待 Owner 决策
```

这样页面不是“数据库浏览器”，而是一个活体状态面板。

---

# 5. 第一层：信任根 Root of Trust

这是页面最上面一层。

## 5.1 页面表达的含义

标题：

```text
L1 · ROOT OF TRUST
信任根
```

副说明：

```text
决定哪些变化可以发生，以及系统失败后如何恢复。
身体和基因都不能自行绕过这一层。
```

## 5.2 当前状态

显示：

```text
Recovery Service
Trusted Supervisor
Owner Approval
Active Generation Pointer
Release Recovery
```

状态只允许真实值：

```text
READY
REACHABLE
NOT_CONNECTED
DEV_LOCAL
UNAVAILABLE
REQUIRES_REVIEW
```

禁止为了好看显示假的：

```text
安全
正常
已受保护
```

除非代码真的验证过。

## 5.3 当前本地开发环境的诚实表达

当前 Recovery Service 已经存在独立实现，但控制通道仍可能：

```text
NOT_CONNECTED
```

所以页面应该显示类似：

```text
Recovery Service        READY / UNAVAILABLE
Trusted Control         NOT_CONNECTED
Owner Exact Approval    ENABLED
Runtime Mode            LOCAL OWNER MAINTENANCE
```

如果 Linux 独立 Supervisor 尚未真实安装：

```text
信任根状态：开发环境 / 尚未完成独立部署验收
```

不要显示：

```text
Root of Trust = VERIFIED
```

## 5.4 最近发生

展示“信任根裁决结果”，例如：

```text
Owner 批准 Gene 方向
Owner 批准准确 Candidate Hash
G0003 启动失败，拒绝接管
G0004 通过验证，完成接管
发生回滚
Recovery Required
```

这里显示的是：

```text
Lineage 中保存的可信裁决结果投影
```

不要让普通 Body 页面直接读取或写入 Root 私有数据库。

## 5.5 Root 层不提供普通操作按钮

这一层原则：

```text
以观察为主
```

V22 当前不要增加：

```text
[立即切代]
[强制回滚]
[批准 Candidate]
```

这些高权限动作继续留在：

```text
Trusted Supervisor / local-upgrade CLI / Recovery control
```

页面可以显示：

```text
“最终批准需要可信维护通道”
```

---

# 6. 第二层：基因层 Genome

## 6.1 标题

```text
L2 · GENOME
基因层
```

说明：

```text
定义当前 Generation 可以遗传的基础结构、权限边界与能力契约。
只有 Gene 发生变化，才产生新一代。
```

## 6.2 当前状态

直接显示真实 `genome/manifest.json`：

```text
Current Generation       G0004
Gene Hash                cfff952c...
Body Interface           1
Protected Paths          N
Capability Contracts     N
```

Gene Hash：

```text
默认显示前 12 位
点击展开 / 复制完整 Hash
```

## 6.3 “这一代遗传了什么”

不要直接把 manifest JSON 原样打印。

分两组：

### Protected / 遗传边界

例如：

```text
genome/**
apps/server/**
packages/**
frontend/**
supervisor/**
scripts/**
deploy/linux/**
package / lock files
```

默认折叠：

```text
受保护路径 14 项
[展开]
```

### Capability Contracts

例如：

```text
body_skill@1
- JSON → JSON
- 无网络
- 无宿主文件
- 无 Credentials
- 无 child_process
- 禁止 package install

business
- data_report@1
- review_feedback@1
- github_issue_create@1
```

这部分是最直观的“基因表达”。

## 6.4 Gene Proposal

现有：

```text
point
reason
effect
```

保留。

但放进基因层，而不是和 Dream 混在一起。

展示：

```text
待审批
已批准
已拒绝
实施中
Candidate Ready
Born
Failed
```

默认重点显示：

```text
PROPOSED
CANDIDATE_READY
```

## 6.5 Gene History

显示最近几代：

```text
G0004 ACTIVE
↑
G0003 FAILED
↑
G0002 RETIRED
↑
G0001 RETIRED
```

每代展开后：

```text
Parent
Gene Hash
Release ID
出生时间
退休时间
Failure Reason
```

不要把完整历史全部铺开。

---

# 7. 第三层：进化层 Evolution

这是目前页面最欠缺的表达。

这里不是“Gene 本身”，也不是“Body 本身”。

它表示：

> **这一代是如何观察自己、形成经验、提出变化并产生下一代的。**

## 7.1 标题

```text
L3 · EVOLUTION
进化层
```

说明：

```text
负责从身体经历中提炼记忆、形成 Gene Proposal、验证候选，并推动出生或回退。
```

## 7.2 页面内建立“进化流水线”

显示：

```text
经历
 ↓
Memory Gate / Dream
 ↓
Memory
 ↓
Gene Proposal
 ↓
Owner Direction Approval
 ↓
Gene Candidate
 ↓
Validation
 ↓
Exact Hash Approval
 ↓
Birth
 ↓
ACTIVE / ROLLBACK
```

不是装饰图。

每个节点根据当前数据亮起状态。

例如：

```text
Dream             COMPLETED
Gene Proposal     1 WAITING
Candidate         NONE
Birth             IDLE
```

## 7.3 Dream

显示：

```text
计划时间
时区
当前状态
上次运行
上次结果
本次是否有新事实
```

按钮：

```text
[整理新经历]
```

继续保留。

发生 `OUTCOME_UNKNOWN` / `FAILED` 时：

```text
明确红色显示
恢复已保存响应
```

## 7.4 Memory

最近 Memory 放进 Evolution，不再独立漂浮。

每条：

```text
要点
原因
效果
来源
Generation
```

来源用标签：

```text
Dream
Memory Gate
Owner Correction
Body Rollback
Business Outcome
Generation Birth
Security Boundary
```

## 7.5 Evolution Events

增加一个真正的“进化事件流”。

例如：

```text
16:01  Body Need 触发 Gene Proposal
15:58  Dream 完成，生成 2 条 Memory
15:31  G0004 出生成功
15:29  Candidate Hash 获 Owner 批准
15:20  Candidate Validation Passed
14:43  G0003 Birth Failed
```

限制：

```text
最近 20 条
```

按时间倒序。

---

# 8. 第四层：身体层 Body

## 8.1 标题

```text
L4 · BODY
身体层
```

说明：

```text
当前 Generation 实际工作的部分。
身体可以在基因允许的范围内自主生长和回退，但不会因此产生新一代。
```

## 8.2 当前身体

显示：

```text
Generation        G0004
Body Revision     R?
Current DB        READY
Active Skills     N
Body Needs        N
Running Tasks     N
```

## 8.3 Body Skills

现有：

```text
skill name
state
successful_runs
failed_runs
```

改成更清晰：

```text
customer_segment
ACTIVE
R3
Success 18
Failed 1
```

如果发生回退：

```text
R4 FAILED → R3 ACTIVE
```

必须能看出来。

## 8.4 Body Needs

现在 `LifeContext.overview()` 已返回：

```text
needs
```

页面当前没有重点显示。

增加：

```text
NEED
GENERATED
VALIDATING
SATISFIED
GENE_PROPOSED
VALIDATION_FAILED
```

尤其需要突出：

```text
Body Need → Gene Proposal
```

因为这是：

> 身体发现自己的边界，并请求进化。

## 8.5 Current 工作

不要把整个经营工作台重复嵌入生命页。

在 Body 层只做摘要：

```text
Active Plans
Running Tasks
Recent Business Results
Open Resource Requests
Datasets
Connections
```

并提供：

```text
[进入经营]
[查看方案]
[连接与资料]
```

切换现有 tab。

原 Business UI 继续复用，不复制组件。

---

# 9. 后端数据改造

优先扩展现有：

```text
GET /api/evolution/overview
```

不要增加大量零碎接口。

## 9.1 新返回结构

建议：

```json
{
  "trust": {},
  "genome": {},
  "evolution": {},
  "body": {}
}
```

暂时保留旧字段一版兼容，等前端切完再删除旧读取。

---

# 10. trust 数据

建议：

```json
{
  "trust": {
    "recovery": {
      "state": "REACHABLE|UNAVAILABLE|NOT_CONFIGURED"
    },
    "control": "NOT_CONNECTED|CONNECTED",
    "runtime": "LOCAL_OWNER_MAINTENANCE|LINUX_SUPERVISOR",
    "activeGeneration": "G0004",
    "evidence": []
  }
}
```

## 10.1 Recovery 检测

不要让 Body 获得 Recovery Secret。

Server 只做：

```text
GET Recovery /health/live
```

无认证健康探测。

配置：

```text
EMERGENTINC_RECOVERY_ORIGIN
```

没配置：

```text
NOT_CONFIGURED
```

## 10.2 信任根 evidence

只从 Lineage 中投影已经发生的：

```text
owner_gene_decision
generation_birth
generation_failure
generation_rollback
security boundary
```

以及本机已有的、已经被验证过的维护事实。

必须明确：

```text
这些是 Lineage Evidence
不是对 Root 私有状态的直接控制
```

---

# 11. genome 数据

`LifeContext.overview()` 增加：

```json
{
  "genome": {
    "generation": 4,
    "geneHash": "...",
    "bodyInterfaceVersion": "1",
    "protectedPaths": [],
    "capabilityContracts": {}
  }
}
```

直接来自：

```text
this.genome
```

不要从前端写死。

---

# 12. evolution 数据

返回：

```text
dream
dreamRuns
memories
proposals
generations
evolutionEvents
```

新增 `evolutionEvents`：

合并：

```text
life_events
dream_runs
gene_proposals
generations
```

整理成统一 DTO：

```json
{
  "time": 0,
  "type": "dream_completed",
  "layer": "EVOLUTION",
  "title": "...",
  "detail": "...",
  "state": "SUCCESS"
}
```

限制最近 20 条。

---

# 13. body 数据

返回：

```text
current
skills
needs
bodyCandidates
currentEvents
businessSummary
```

## 13.1 bodyCandidates

Current DB 已经存在：

```text
body_candidates
```

现在 `overview()` 没直接返回。

增加最近：

```text
20
```

项。

## 13.2 currentEvents

读取：

```text
current_events
```

只取最近 20 条。

这才是真正展示“身体最近发生了什么”。

## 13.3 businessSummary

不要前端重新计算很多东西。

服务端给简单摘要：

```json
{
  "activePlans": 0,
  "runningTasks": 0,
  "waitingResources": 0,
  "recentResults": []
}
```

仍然使用现有 Business 数据。

---

# 14. 前端组件拆分

不要继续把所有代码塞在：

```text
EvolutionPanel.tsx
```

改为：

```text
frontend/src/features/business/evolution/
├─ LifeArchitecture.tsx
├─ TrustRootLayer.tsx
├─ GenomeLayer.tsx
├─ EvolutionLayer.tsx
├─ BodyLayer.tsx
├─ LayerHeader.tsx
├─ EventStream.tsx
└─ life_types.ts
```

原：

```text
EvolutionPanel.tsx
```

可以：

```text
删除
```

或变成：

```text
export { LifeArchitecture as EvolutionPanel }
```

保证改动最小。

---

# 15. BusinessHome 最小修改

只修改导航和默认 tab。

当前：

```text
home
plans
resources
evolution
```

改为：

```text
life
business
plans
resources
```

初始化：

```ts
const [tab, setTab] = useState('life');
```

映射：

```text
生命总览 → LifeArchitecture
经营 → 原 home 内容
方案 → 原 plans
连接与资料 → 原 resources
```

原功能逻辑不要重写。

---

# 16. 页面视觉要求

本次视觉重点不是“漂亮”，而是：

> **层级必须明显。**

建议：

### 每层左侧固定层号

```text
L1
L2
L3
L4
```

### 每层有不同但克制的状态色

依赖现有 CSS variables，不需要重做主题。

不要增加大量：

```text
渐变
玻璃拟态
发光
动画
```

## 16.1 层之间必须有方向关系

建议最终：

```text
信任根
  ↓ 约束
基因
  ↓ 定义可变边界
进化
  ↓ 产生变化
身体
```

---

# 17. 每层顶部统一状态条

例如：

```text
L2 · GENOME                         ACTIVE
当前代 G0004 · Gene cfff952c… · Interface v1
```

如果异常：

```text
REQUIRES REVIEW
FAILED
NOT CONNECTED
```

一眼可识别。

---

# 18. 空状态也必须有语义

例如没有 Body Skill：

不要写：

```text
尚无动态能力
```

改成：

```text
当前身体尚未长出动态 Skill。
发生新的 Body Need 后，会在基因允许的边界内尝试生成和验证能力。
```

没有 Gene Proposal：

```text
当前没有等待遗传的变化。
Dream 或 Body 越界需求可能产生新的 Gene Proposal。
```

没有 Trust Control：

```text
独立可信控制通道尚未接入当前页面。
这里只显示可验证的只读状态，不提供高权限操作。
```

---

# 19. 不要混淆四层

本地 AI 必须遵守以下分类。

## Root

属于：

```text
Recovery
Supervisor
Owner Exact Candidate Approval
Release Switch
Rollback Authority
Protected Root Paths
```

## Gene

属于：

```text
Genome Manifest
Gene Hash
Protected Paths
Capability Contracts
Generation
Gene Proposal
Gene History
```

## Evolution

属于：

```text
Dream
Memory Gate
Memory
Candidate Lifecycle
Birth
Rollback Process
Gene Proposal 形成过程
```

注意：

Gene Proposal 的“内容”属于 Gene Layer。

Gene Proposal 的“形成过程”属于 Evolution Layer。

页面可以在两个层分别引用，但不要重复完整内容。

## Body

属于：

```text
Current DB
Body Revision
Body Skill
Body Need
Body Candidate
Business Plan
Business Task
External Work
Current Results
```

---

# 20. 特别处理：Memory 的位置

Memory 本身不是 Gene。

放在：

```text
Evolution Layer
```

因为它是：

```text
经历 → 提炼 → 影响下一步进化
```

同时在 Genome Gene Proposal 中可以显示：

```text
“该提案由哪条 Memory / Dream 产生”
```

---

# 21. 特别处理：Generation History

Generation 的身份属于：

```text
Genome
```

但：

```text
出生 / 失败 / 回滚这个过程
```

属于：

```text
Evolution
```

因此：

### Genome

显示：

```text
G0004 ACTIVE
G0003 FAILED
G0002 RETIRED
```

### Evolution

显示：

```text
G0003 birth failed
→ rollback
→ G0004 candidate
→ approval
→ born
```

这是两个不同观察角度。

---

# 22. 不在本次做的事情

禁止趁页面整改继续扩功能。

不做：

```text
新的 Gene 自动批准
新的 Supervisor 控制 API
网页直接切代
网页直接 rollback
网页直接执行 Root 命令
新的 Memory 算法
Vector DB
新的 Body runtime
新的数据库
新的 Business 功能
新的权限系统
新的 Agent
```

本次就是：

```text
把已经存在的生命机制
正确地呈现在 /GENE
```

---

# 23. 测试要求

## 前端

至少增加：

### A. 默认页面

访问：

```text
/GENE
```

登录后默认看到：

```text
L1 Root of Trust
L2 Genome
L3 Evolution
L4 Body
```

而不是先进入经营首页。

### B. 四层顺序

DOM 顺序必须：

```text
ROOT
GENOME
EVOLUTION
BODY
```

### C. Trust 不伪造

Recovery 未配置：

```text
NOT_CONFIGURED
```

不能显示 READY。

### D. Genome

确认：

```text
generation
geneHash
bodyInterfaceVersion
capability contracts
```

来自 API，而非前端常量。

### E. Evolution

Dream：

```text
FAILED / OUTCOME_UNKNOWN
```

状态必须正确显示。

### F. Body

至少显示：

```text
Body Revision
Skills
Needs
Current Events
```

### G. 原经营功能

确认：

```text
经营
方案
连接与资料
```

仍然可以进入。

原业务测试不得删除。

---

# 24. 浏览器验收

真实浏览器验证：

## `/GENE`

第一屏必须能理解：

```text
EmergentInc 当前是 G0004
它的最高信任边界是什么
它当前基因是什么
它最近正在如何进化
它当前身体正在做什么
```

用户不需要阅读代码或文档。

## 点击每层

### Root

能回答：

```text
谁在保护系统？
最后一次可信裁决是什么？
当前是否真正连接独立恢复能力？
```

### Genome

能回答：

```text
当前是哪一代？
遗传规则是什么？
什么变化正在等待成为基因？
```

### Evolution

能回答：

```text
它最近学到了什么？
做梦发生了什么？
它现在有没有正在走向下一代？
```

### Body

能回答：

```text
这一代现在正在做什么？
长出了哪些能力？
还缺什么能力？
最近哪些身体变化成功/失败？
```

满足这四点才算页面整改完成。

---

# 25. 最终页面的核心语义

最终 `/GENE` 不再只是：

```text
“经营工作台里加了一个生命 tab”
```

而应成为：

# EmergentInc 的生命控制台

用户看到的是：

```text
                  L1 信任根
             什么永远不能被绕过
                        ↓
                  L2 基因层
              这一代遗传了什么
                        ↓
                  L3 进化层
             它如何学习并产生下一代
                        ↓
                  L4 身体层
             它现在正在生长和工作什么
```

而原来的：

```text
经营 / 方案 / 连接与资料
```

就是深入观察身体实际工作的入口。

---

# 26. 实施顺序

严格按以下顺序执行。

## Step 1

只改 API DTO：

```text
evolution/overview
→ trust / genome / evolution / body
```

先写测试。

## Step 2

拆分：

```text
EvolutionPanel
→ 4 Layer Components
```

不改 Business 功能。

## Step 3

修改 `/GENE` 导航：

```text
生命总览
经营
方案
连接与资料
```

默认生命总览。

## Step 4

增加四层 Event Stream。

## Step 5

补空状态 / 异常状态。

## Step 6

运行：

```text
pnpm test
pnpm typecheck
frontend build
```

## Step 7

真实浏览器访问：

```text
http://127.0.0.1:8765/GENE
```

验证四层含义能否在第一屏被理解。

不要仅以单元测试作为 UI 完成标准。

---

# 27. 验收标准

完成后，我希望打开 `/GENE` 时第一眼看到的不是：

```text
费用
方案
数据
```

而是：

```text
当前生命：G0004

L1 信任根
独立恢复 / 最终裁决 / 最近可信结果

↓

L2 基因
Gene Hash / 遗传能力 / Gene Proposal / Generation

↓

L3 进化
Dream / Memory / Candidate / Birth / Rollback

↓

L4 身体
Body Revision / Skills / Needs / 当前经营活动
```

并且：

> **任何一个发生在系统中的生命事件，都应该能够明确归属到这四层中的其中一层。**

这就是本次整改唯一核心目标。

---

# 28. 执行结果（2026-10-01）

Step 1–7 已完成本地实现与验收：四层 DTO、组件拆分、默认导航、事件流、空 / 异常状态、自动检查及真实浏览器检查均已完成。最终完整回归为 70 个测试文件、489 个测试通过，类型检查与前端构建通过。

浏览器使用独立临时 workspace；真实实例的准确候选审批、受控升级与独立部署不在本次页面整改中执行。详情、截图及验证限制见 [实施记录](EmergentInc_GENE_四层生命架构页面整改_实施记录.md)。
