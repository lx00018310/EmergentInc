# EmergentInc V22（V2.2）执行 Plan
## 目标：让系统第一次真正“活过一代”

> 仓库：`lx00018310/EmergentInc`  
> V22 基线提交：`f69c1c026b56b4f28ce7eb809b9cc628650a3291`（`V21 rebuild`）  
> 执行者：本地 AI / Codex  
> 原则：**最小更改、复用 V21、先跑通生命循环，不提前实现终局自治。**

---

# 0. V22 的核心定义

本版本先统一术语，后续代码必须按这里实现，不要自行扩展定义。

## 0.1 一代（Generation）

**只有基因发生变化，才产生新一代。**

以下两种情况会产生下一代：

1. Dream / Pixel 提出的基因变异提案，经 Owner 批准并实际形成基因变化。
2. Owner 主动要求修改基因，并实际形成基因变化。

身体层无论增加多少技能、函数、工具，都仍属于同一代。

因此：

```text
Generation = Gene Version
Body Revision != Generation
```

建议编号：

```text
G0001
G0002
G0003
```

同一代内部身体变化：

```text
G0001 / Body R0
G0001 / Body R1
G0001 / Body R2
```

---

## 0.2 出生（Birth）

一个新的 Gene Candidate：

```text
形成候选
→ 通过可信验证
→ Owner 批准准确候选
→ 当前代数据完成整理
→ 部分数据迁移到新 Current DB
→ 新 Release 启动
→ Health Check 通过
→ 正式成为 ACTIVE Generation
```

此时才算“出生”。

---

## 0.3 生长（Growth）

**身体层完全自主。**

身体可以在 Genome 允许的边界内：

- 发现自己缺少某种能力；
- 自己生成代码；
- 引入一个外部 skill 作为候选；
- 建立新的纯计算工具；
- 修改已有 Body Skill；
- 测试；
- 激活；
- 失败后自动回退。

身体生长：

```text
不改变 Generation
不需要 Owner 每次批准
不得修改 Genome / Root of Trust
```

---

## 0.4 死亡（Death）

区分三种情况：

### Body Revision 死亡

新的身体能力运行失败：

```text
R3 失败
→ 自动回退 R2
→ R3 标记 ROLLED_BACK
→ Generation 仍然是 G0001
```

### 新一代夭折

G0002 候选无法通过验证或无法正常启动：

```text
G0002 = FAILED / STILLBORN
G0001 继续 ACTIVE
```

### 上一代退休

G0002 成功接管：

```text
G0001 = RETIRED
G0002 = ACTIVE
```

历史与经验不随身体死亡而删除。

---

## 0.5 V22 的核心原则

> **身体可以回退，记忆不能回退。**

代码、Body Skill、Current DB 都允许回退。

但已经沉淀到 Lineage / History 中的：

- 重要经历；
- 失败原因；
- 成功经验；
- Owner 纠偏；
- Gene Proposal；
- Generation 历史；

不能因为代码回滚而消失。

---

# 1. 对 V21 最新代码的判断

V21 已经提供了 V22 所需的大部分“胚胎”，不要推倒重做。

当前 `f69c1c...` 已经具备：

- 独立 `business` 运行模式；
- Owner 登录与权限边界；
- workspace 单实例锁；
- 独立 `business.sqlite3`；
- 方案 / Grant / Task / Schedule / Operation / Cost / Order / Payment 的持久化；
- Unknown Outcome / Recovery 语义；
- `/health/live` 与 `/health/ready`；
- Linux `systemd` 模板；
- `/srv/emergentinc/current` Release 运行形态；
- Rootless Docker Sandbox；
- Automation Candidate：
  - submit；
  - validate；
  - hash；
  - approval；
  - activate；
  - rollback；
- 独立 `AutomationSupervisor`；
- 数据库一致性备份工具。

这些全部复用。

V22 **不要重新设计 Business 主链**。

---

# 2. V22 总体架构

V22 收敛为五个部分：

```text
┌──────────────────────────────────────┐
│  Root of Trust                      │
│  不随普通代码自修改                  │
│  Release / Gene / Rollback 最终裁决  │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│  Genome                             │
│  一代的遗传基础                      │
│  核心权限 / 接口 / 不变量 / 核心代码 │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│  Body                               │
│  当前代可自由生长部分                │
│  Skills / Functions / Pure Tools    │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│  Current DB                         │
│  当前身体正在使用的工作状态          │
└──────────────────┬───────────────────┘
                   │  selective memory
                   ▼
┌──────────────────────────────────────┐
│  Lineage / History DB               │
│  跨代经历 / 经验 / 经营事实 / Gene史 │
└──────────────────────────────────────┘
```

另外：

```text
Dream
=
Current + 最近重要事实
→ 提炼 Memory
→ 提出 Gene Proposal
```

---

# 3. Root of Trust：V22 只做最小可信根

V22 不建设复杂“宪法系统”。

只建立一个系统无法自行绕开的最小根。

## 3.1 新增独立 Evolution Supervisor

新增模板代码，例如：

```text
supervisor/
├─ generation_supervisor.ts
├─ release_builder.ts
├─ migration_runner.ts
└─ protocol.ts
```

部署后必须复制到：

```text
/opt/emergentinc-supervisor/
```

生产权限：

```text
owner: root
app user: read = no / write = no
```

应用用户 `emergentinc`：

```text
不能修改 supervisor
不能修改 systemd
不能直接切换 /srv/emergentinc/current
不能直接写 releases/
```

实际 Release、Generation 的切换只能由 Supervisor 完成。

仓库里的 `supervisor/` 只是安装模板。

**以后即使 EmergentInc 修改了仓库中的 supervisor 源码，也不会自动改变已安装的 Root of Trust。**

---

## 3.2 Root of Trust 第一版只负责五件事

```text
1. 判断修改属于 Body 还是 Gene
2. Gene Candidate 验证
3. Owner 对准确 Gene Candidate Hash 的批准
4. Generation Birth / Release Switch
5. 失败时恢复上一代
```

除此以外不要继续扩张 Root。

---

# 4. Gene 与 Body 的工程边界

V22 必须第一次把两者真正分开。

## 4.1 Genome

Genome 代表：

- 身份；
- 权限边界；
- 基础工具契约；
- 数据库生命规则；
- Body 执行接口；
- Generation 规则；
- Dream / Memory 规则；
- 安全边界；
- 基础 Runtime。

新增：

```text
genome/manifest.json
```

至少包含：

```json
{
  "schema_version": 1,
  "generation": 1,
  "body_interface_version": "1",
  "protected_paths": [],
  "capability_contracts": {}
}
```

不要把具体业务策略写进 Genome。

---

## 4.2 V22 默认视为 Gene 的内容

至少包括：

```text
genome/**
apps/server/src/runtime_config.ts
apps/server/src/owner_auth.ts

新的：
apps/server/src/services/life_context.ts
apps/server/src/services/dream_service.ts
packages/persistence/src/lineage_store.ts
packages/persistence/src/current_store.ts
packages/persistence/src/migrations/lineage_schema.ts
packages/persistence/src/migrations/current_schema.ts

Root / Evolution 协议
数据库迁移规则
基础权限规则
基础 capability contract
```

以及：

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
deploy/linux/**
```

第一版依赖和运行环境变化一律按 Gene Change 处理。

原因：

Body 不能通过修改 npm scripts、依赖、数据库 schema 等方式绕过 Genome。

---

## 4.3 Body

V22 不允许 Body 任意改整个 Monorepo。

身体层通过 **动态 Body Skill** 生长。

Body Skill 是：

```text
JSON input
→ sandboxed code
→ JSON output
```

存放在当前 Generation 的身体目录：

```text
workspace/
└─ generations/
   └─ G0001/
      └─ body/
         └─ skills/
```

Body Skill 可以：

- 数据整理；
- 分类；
- 计算；
- 文本结构转换；
- 特定业务函数；
- 当前场景专用逻辑。

第一版 Body Skill：

```text
禁止直接网络
禁止读 credentials
禁止任意宿主文件
禁止 child_process
禁止 Docker socket
禁止 package install
```

如果 Body 发现：

> “我需要新的网络权限 / 新数据库 schema / 新基础接口 / 新依赖”

则不能自己突破。

应形成：

```text
Gene Proposal
```

---

# 5. 两层生命数据：第一版直接落地两个物理数据库

这一项 V22 必须实现，不留到以后。

## 5.1 Lineage DB

路径：

```text
workspace/
└─ lineage/
   └─ lineage.sqlite3
```

它是**跨 Generation 存活**的数据。

现有：

```text
workspace/ledger/business.sqlite3
```

迁移为 Lineage DB 的基础。

不要重写现有 Business Store。

执行：

```text
business.sqlite3
→ SQLite online backup
→ lineage.sqlite3
→ 在原 Business Schema 基础上升级 Schema
```

保留原 `business.sqlite3` 备份直到 V22 完整验收完成。

---

## 5.2 Lineage DB 中继续保留

V21 已有的长期事实继续保留：

- Business Settings；
- Plans / Revisions；
- Grants；
- Operations；
- Cost Entries；
- Events；
- Orders；
- Payments；
- Feedback；
- Datasets；
- Connections metadata。

这些已经发生的业务事实不能因为 Generation 回退而消失。

---

## 5.3 Lineage DB 新增表

### generations

```text
id
generation_no
parent_id
gene_hash
release_id
state
born_at
retired_at
failure_reason
```

状态只做：

```text
BIRTHING
ACTIVE
RETIRED
FAILED
ROLLED_BACK
```

---

### memories

```text
id
generation_id
pixel_id nullable
kind
point
reason
effect
importance
source
source_ref
created_at
```

这里不保存大段自由文本。

Memory 第一版统一：

```text
要点 point
原因 reason
效果 effect
```

---

### dream_runs

```text
id
generation_id
from_cursor
to_cursor
status
input_hash
output_hash
created_at
finished_at
```

---

### gene_proposals

```text
id
generation_id
source
point
reason
effect
state
created_at
owner_decided_at
candidate_hash nullable
target_generation_id nullable
```

状态：

```text
PROPOSED
APPROVED
REJECTED
IMPLEMENTING
CANDIDATE_READY
BORN
FAILED
```

---

# 6. Current DB：每一代有自己的当前身体状态

路径：

```text
workspace/
└─ generations/
   ├─ G0001/
   │  └─ current.sqlite3
   ├─ G0002/
   │  └─ current.sqlite3
   └─ ...
```

任意时刻应用只打开：

```text
1 个 lineage.sqlite3
+
1 个 ACTIVE Generation 的 current.sqlite3
```

这就是前面讨论的“两份数据库同时加载”。

---

## 6.1 Current DB 第一版只保存真正的“当前身体状态”

不要把 V21 Business Schema 再复制一遍。

只增加：

### current_meta

```text
generation_id
body_revision
gene_hash
release_id
created_at
```

### pixel_working_state

```text
pixel_id
state_json
carry_forward
updated_at
```

### objectives

```text
id
pixel_id
content
state
carry_forward
updated_at
```

### body_skills

```text
skill_id
name
active_change_id
interface_version
state
successful_runs
failed_runs
updated_at
```

### body_needs

```text
id
pixel_id
need
evidence
state
created_at
updated_at
```

不要在 Current DB 创建另一套订单、账本、费用或付款系统。

---

# 7. Generation 切换时的“部分迁移”

V22 不做“完整复制数据库”。

建立一个明确的：

```text
GenerationMigrator
```

只迁移白名单。

## 7.1 默认迁移

从 G0001 Current DB 到 G0002：

### 迁移

- `objectives` 中仍然 OPEN 且 `carry_forward=1`；
- `pixel_working_state` 中 `carry_forward=1`；
- 与新 `body_interface_version` 兼容的 ACTIVE Body Skills；
- 明确标记为跨代继续的 Body Need。

### 不迁移

- 临时 scratch；
- 已失败候选；
- 已结束 objective；
- 临时错误；
- cache；
- debug 信息；
- 已处理 dream 输入；
- 已退休 Body Skill。

---

## 7.2 Body Skill 跨代继承

如果：

```text
old.body_interface_version == new.body_interface_version
```

则 ACTIVE Skill 可以继承。

如果接口版本改变：

```text
skill = REVALIDATION_REQUIRED
```

不能直接执行。

---

## 7.3 Business 事实不需要迁移

因为它们已经在：

```text
lineage.sqlite3
```

例如：

- 一笔付款；
- 已发生费用；
- 已发送 GitHub Issue；
- Owner 批准历史；

都不会因为 Generation 切换重新复制。

这样能避免：

```text
回滚代码
=
回滚真实世界
```

这种错误。

---

# 8. Body Growth：让身体真正开始自己长

V21 的：

```text
RootlessSandbox
AutomationSupervisor
automation_validation
```

直接作为 Body Growth 的基础。

不要重新做一套 sandbox。

---

## 8.1 AutomationSupervisor 最小改造

当前只管理一个固定 automation profile。

V22 改为支持：

```text
多个 skill slot
```

例如：

```text
csv_summary
customer_segment
text_cleaner
proposal_ranker
```

一个 slot 同时只有一个 ACTIVE version。

---

## 8.2 Body Candidate 的状态

```text
NEED
→ GENERATED
→ VALIDATING
→ ACTIVE
```

失败：

```text
VALIDATION_FAILED
```

运行时失败：

```text
ACTIVE R3
→ runtime failure
→ rollback R2
→ R3 = ROLLED_BACK
```

---

## 8.3 Body 层不再要求 Owner 逐次 approve

当前 `AutomationSupervisor.approve()` 的 Owner 语义不要直接删除。

新增独立 Body 路径：

```text
validateBodyCandidate()
→ policyAutoActivate()
```

仅当以下全部成立：

```text
属于 Body Skill
未触碰 Gene
RootlessSandbox 验证通过
接口契约匹配
测试通过
资源限制通过
```

才允许自动激活。

Gene Candidate 仍然必须 Owner Approve。

---

## 8.4 Body Skill 候选格式

建议：

```json
{
  "skill_id": "customer_segment",
  "purpose": "...",
  "source": "...",
  "tests": [
    {
      "input": {},
      "expected": {}
    }
  ]
}
```

测试用例是**数据**。

不允许模型自己写一段测试程序然后宣布自己通过。

可信 Harness：

```text
加载 candidate source
→ 输入 tests.input
→ 得到 result
→ supervisor 比较 expected
```

---

## 8.5 身体主动产生 Need

增加：

```text
BodyGrowthService
```

输入：

```text
pixel_id
need
evidence
```

任何 Pixel 都可以提出身体 Need。

V21 business 当前仍主要是一个经营 Pixel，但接口从第一版就保留 `pixel_id`，以后多 Pixel 不需要重做数据结构。

BodyGrowthService：

```text
Need
→ 判断是否属于 Body 边界
→ 如属于 Body：
    生成 Candidate
    验证
    自动激活
→ 如超出 Body：
    转 Gene Proposal
```

---

# 9. “找 Skill”与“写 Skill”统一走 Candidate Pipeline

Body 可以：

```text
自己写代码
```

也可以：

```text
从外部找到一段 Skill Source
```

但不能直接安装。

统一：

```text
source
→ Candidate
→ Sandbox
→ Tests
→ Activate
```

V22 不实现：

```text
npm install arbitrary-package
pip install
执行外部 install.sh
执行未知 binary
```

这些属于未来 Gene / Trust Boundary 问题。

---

# 10. Memory：不是所有事情都即时写历史

V22 不建设“全量事件全部进入记忆”的系统。

Memory 只来自两条路径：

```text
必要时即时沉淀
+
Dream 周期整理
```

---

# 11. 即时 Memory Gate

增加：

```text
MemoryGate
```

第一版只允许少数明确事件立即形成 Memory。

至少：

### 1. Body 自动回滚

```text
point: 某 Skill R3 运行失败并回退到 R2
reason: ...
effect: 后续使用 R2；该失败模式应避免
```

### 2. Generation Birth / Rollback

成功出生或新一代夭折必须记住。

### 3. Owner 明确纠偏

Owner 明确指出系统判断错误、方向错误或权限边界问题。

### 4. 经证据确认的重要经营结果

例如：

- 外部客户真实付款；
- 明确退款；
- 已确认重大失败。

不能把文案生成、Issue 数量等当成经营成功。

### 5. Security Boundary Event

例如：

```text
Body 请求越过 Gene Boundary
Sandbox policy mismatch
受保护路径修改尝试
```

---

# 12. Dream：低频整理当前生命经历

新增：

```text
DreamService
```

---

## 12.1 Dream 触发

V22 第一版只做：

```text
每天 1 次
+
Generation Birth 前强制 1 次 Final Dream
+
Owner 可手动触发
```

不要第一版做多个复杂 Cron。

时间通过配置：

```text
EMERGENTINC_DREAM_TIME
EMERGENTINC_DREAM_TIMEZONE
```

默认可以使用：

```text
03:00
Asia/Shanghai
```

---

## 12.2 Dream 输入

只读取：

```text
上次 Dream 之后
```

发生的：

- Current DB 中重要状态变化；
- Body Need；
- Body Skill activation / failure；
- Owner Feedback；
- 已确认 Business Outcome；
- Generation / Gene 相关事件。

不要把：

```text
整个数据库
所有日志
全部文件
```

直接塞给模型。

---

## 12.3 无新事实，不调用模型

沿用 V21 已经建立的原则：

```text
No new facts
=
No model call
```

---

## 12.4 Dream 输出

严格 JSON。

### Memory

```json
{
  "point": "要点",
  "reason": "为什么值得记住",
  "effect": "它以后会影响什么"
}
```

### Gene Proposal

```json
{
  "point": "建议把什么上升到基因层",
  "reason": "为什么",
  "effect": "进入基因后会产生什么效果"
}
```

第一版 Gene Proposal 就保持这三项。

不增加复杂评分体系。

---

## 12.5 Dream 不能修改 Gene

流程：

```text
Dream
→ Gene Proposal
→ PROPOSED
→ 等待 Owner
```

绝不能：

```text
Dream
→ 修改 Genome
```

---

# 13. Gene Proposal：第一阶段的人类审批模式

这部分严格采用本次对话确定的三阶段路线中的第一阶段。

V22：

```text
Pixel / Dream 可以提案
Owner 决定是否允许
```

后续版本再考虑：

```text
系统自己审批
```

V22 不做。

---

## 13.1 Gene Proposal 来源

两种：

```text
source = dream
source = owner
```

Owner 主动要求 Gene Change 时同样创建 Proposal 记录。

这样以后回看历史时，可以知道：

```text
哪次变化来自系统
哪次变化来自人类
```

---

## 13.2 V22 不自动生成完整 Gene Patch

为了控制范围：

**V22 不要求 EmergentInc 自己自动完成核心 Gene Code 编写。**

第一阶段流程：

```text
Dream / Owner
→ Gene Proposal
→ Owner 批准方向
→ 本地 Codex / 人类形成 Gene Candidate Patch
→ Generation Supervisor 验证
→ Owner 批准准确 Candidate Hash
→ Birth
```

这与当前阶段“人参与基因突变”一致。

未来再把：

```text
Gene Proposal → Gene Candidate
```

也交给系统自动完成。

---

# 14. Generation Supervisor：出生流程

新增：

```text
scripts/generation-supervisor.mjs
```

调用安装在：

```text
/opt/emergentinc-supervisor/
```

中的可信实现。

---

## 14.1 Gene Candidate 必须绑定

至少绑定：

```text
base_generation
base_release
proposal_id
patch_hash
gene_hash
candidate_release_hash
```

Owner 批准的是：

```text
准确 candidate hash
```

而不是一句：

```text
“我同意升级”
```

---

## 14.2 Birth 流程

固定顺序：

```text
1. 获取 Evolution Lock

2. 检查当前 ACTIVE Generation

3. 验证 Proposal 已批准

4. 验证 Candidate 基于当前 Active Release

5. 验证未修改 Root of Trust

6. typecheck

7. test

8. build

9. 对 lineage.sqlite3 做 SQLite online backup

10. 对当前 Generation current.sqlite3 做快照

11. 执行 Final Dream

12. 创建：
    G0002 = BIRTHING

13. 创建：
    generations/G0002/current.sqlite3

14. GenerationMigrator 执行部分迁移

15. 用“候选 workspace”启动 Candidate
    - 使用 lineage backup
    - 使用 G0002 current DB copy
    - 禁止真实 external write
    - 禁止真实 paid model call

16. /health/live

17. /health/ready

18. 停止正式 G0001

19. 原子切换：
    /srv/emergentinc/current
    → G0002 release

20. ACTIVE generation pointer
    → G0002

21. 启动正式服务

22. live + ready + smoke check

23. 成功：
    G0002 = ACTIVE
    G0001 = RETIRED

24. 失败：
    current symlink → G0001
    active generation → G0001
    启动 G0001
    G0002 = FAILED / ROLLED_BACK

25. 将 Birth Result 写入 Lineage Memory
```

---

# 15. Candidate 验证绝不能碰正式业务副作用

Candidate Smoke Test 使用：

```text
Lineage DB backup
+
Current DB candidate copy
+
禁用真实 Connection
+
禁用真实模型付费调用
```

不能出现：

```text
为了测试新一代
→ 真发 GitHub Issue
→ 真调用客户
→ 真产生付款
```

候选验证只检查：

- DB 能打开；
- migrations 正常；
- Server 能启动；
- health；
- Owner auth；
- Business overview；
- Current + Lineage 双库读取；
- Body Skill registry；
- Dream schema；
- Genome manifest；
- 核心测试。

---

# 16. Generation Rollback

如果 G0002 正式启动后立即失败：

```text
代码 → G0001
Current DB → G0001 current.sqlite3
Lineage DB → 不回滚
```

这是非常重要的规则。

也就是说：

```text
时间可以退回岔路口
但系统记得自己走过那条错误的路
```

---

## 16.1 Rollback 后

如果 G0002 已经产生一些未整理 Current 数据：

不要为了 Dream 阻塞紧急回滚。

先：

```text
冻结 G0002 current.sqlite3
记录 hash
完成回滚
```

然后增加：

```text
POST_ROLLBACK_DREAM_REQUIRED
```

系统恢复稳定后，再从冻结的 G0002 Current DB 中提炼失败经验。

---

# 17. LifeContext：Pixel 每次运行时加载什么

新增：

```text
LifeContext
```

Pixel / Business Agent 每次工作时组合：

```text
Genome Context
+
Current State
+
Relevant Memories
+
Task / Environment
```

不是把整个 History DB 全加载。

---

## 17.1 V22 Memory Retrieval

第一版不要上：

- Vector DB；
- Embedding；
- RAG 平台。

先简单：

```text
按：
pixel_id
kind
importance
generation
时间

取最多 N 条
```

例如：

```text
MAX_MEMORY_ITEMS = 20
```

以后数据真的大了再升级检索方式。

---

# 18. Current → History 的正式机制

最终形成：

```text
Current DB
     │
     ├─ MemoryGate
     │    └─ 极少数关键事件立即写 Memory
     │
     └─ Dream
          ├─ Memory
          └─ Gene Proposal
```

在 Generation Birth 时：

```text
Final Dream
+
Partial Migration
```

因此：

- Current 保留丰富、琐碎、短期状态；
- Lineage 保留真正跨代有价值的事实与经验。

---

# 19. V21 数据迁移步骤

这一部分必须先做并独立验收。

## Step 1

停止服务。

## Step 2

运行当前已有：

```text
scripts/business-maintenance.mjs
```

检查：

```text
business.sqlite3
```

integrity。

## Step 3

online backup：

```text
business.sqlite3
→ lineage/lineage.sqlite3
```

## Step 4

校验：

- SHA；
- 表数量；
- 记录数量；
- Orders；
- Payments；
- Operations；
- Costs；
- Plans。

## Step 5

Lineage Schema：

```text
Business Schema V1
→ Lineage Schema V2
```

只添加生命相关表。

不要重建已有 Business 表。

## Step 6

创建：

```text
G0001
```

其 gene hash 来自当前 V22 初始 Genome。

创建：

```text
generations/G0001/current.sqlite3
```

## Step 7

将 `G0001` 标记 ACTIVE。

此时：

```text
V21 现有事实
=
G0001 的祖先历史
```

---

# 20. 代码改造清单

## 新增

建议：

```text
genome/manifest.json

packages/persistence/src/lineage_store.ts
packages/persistence/src/current_store.ts
packages/persistence/src/migrations/lineage_schema.ts
packages/persistence/src/migrations/current_schema.ts

apps/server/src/services/life_context.ts
apps/server/src/services/memory_gate.ts
apps/server/src/services/dream_service.ts
apps/server/src/services/body_growth_service.ts
apps/server/src/routes/evolution_routes.ts

supervisor/generation_supervisor.ts
supervisor/release_builder.ts
supervisor/generation_migrator.ts
supervisor/protocol.ts

scripts/generation-supervisor.mjs

deploy/linux/emergentinc-evolution.service
deploy/linux/evolution-environment.example
```

---

## 修改

重点只改：

```text
apps/server/src/main.ts
apps/server/src/app.ts
apps/server/src/services/business_service.ts

packages/persistence/src/business_store.ts
packages/persistence/src/index.ts

packages/protocol/src/types/business.ts

apps/server/src/services/automation_supervisor.ts
packages/tools/src/business/automation_validation.ts

frontend/src/features/business/
```

不要大范围重构旧 Legacy。

---

# 21. Owner 页面只增加一个最小 Evolution 区域

不要做复杂“生命可视化”。

第一版只显示：

```text
Current Generation
Current Body Revision
Active Body Skills
Recent Memories
Pending Gene Proposals
Generation History
```

Gene Proposal：

```text
要点
原因
效果

[批准方向]
[拒绝]
```

注意：

这里批准的是：

```text
Proposal Direction
```

真正 Release Candidate 形成后，对准确 Candidate Hash 的最终批准仍走 Trusted Supervisor Channel。

第一版可以继续使用 CLI。

不要为了做漂亮 UI 降低 Root of Trust 的可信边界。

---

# 22. V22 明确不做的事情

为了防止本地 AI 过度设计，以下全部排除：

- 不上 Kubernetes；
- 不换 Postgres；
- 不做微服务拆分；
- 不合并 legacy 与 business；
- 不删除 legacy；
- 不做自动 Gene 审批；
- 不做 Gene 自动代码生成闭环；
- 不做 Vector DB；
- 不做 Embedding Memory；
- 不做复杂 Memory Score；
- 不做遗传算法；
- 不做多个 Dream Agent；
- 不做 Agent 投票修改 Genome；
- 不开放任意 Shell；
- 不让 Body 修改 package manager / DB schema；
- 不让 Body 直接拿外部账号 credential；
- 不让 Candidate 测试产生真实外部副作用。

V22 只完成：

> **一套可以真正出生、生长、死亡，并保留记忆的最小生命循环。**

---

# 23. 自动测试要求

必须增加以下测试。

## A. Generation 定义

Body Skill 更新：

```text
Generation 不变化
Body Revision +1
```

Gene Hash 改变并成功 Birth：

```text
Generation +1
```

---

## B. 两库隔离

验证：

```text
Current DB rollback
```

不会删除：

```text
Lineage Memory
Business Cost
Order
Payment
Generation History
```

---

## C. Partial Migration

构造：

```text
carry_forward = 1
carry_forward = 0
```

出生下一代后：

```text
只有 1 被迁移
```

---

## D. Body 自动进化

```text
Need
→ Candidate
→ Sandbox pass
→ Auto Activate
```

不需要 Owner Approve。

---

## E. Body 失败回退

```text
R2 ACTIVE
R3 Activate
R3 Runtime Failure
→ R2 Restore
```

同时生成一条 Memory。

---

## F. Body 越界

Body Candidate 试图：

```text
修改 Genome
使用网络
挂载 host
读取 private
调用 child_process
```

必须拒绝。

---

## G. Dream 无新事实

```text
no new facts
→ 0 model call
```

---

## H. Dream Gene Proposal

Dream 输出：

```text
point / reason / effect
```

只能进入：

```text
PROPOSED
```

不能修改 Genome。

---

## I. Gene 未批准

Candidate 再好：

```text
没有 Owner Candidate Hash Approval
→ 不能 Birth
```

---

## J. Successful Birth

```text
G0001 ACTIVE
→ Gene Change
→ G0002 candidate
→ Final Dream
→ Partial Migration
→ Candidate Validation
→ Release Switch
→ G0002 ACTIVE
→ G0001 RETIRED
```

---

## K. Failed Birth

模拟：

```text
G0002 health fail
```

结果：

```text
G0001 ACTIVE
G0002 FAILED
Lineage 中存在 G0002 失败 Memory
```

---

## L. Memory 不回滚

```text
G0002 出生
→ 产生重要 Memory
→ G0002 rollback
```

结果：

```text
代码回 G0001
Current 回 G0001
Memory 仍然存在
```

---

# 24. Linux 实机验收

V22 不能再用 Windows mock 作为最终通过依据。

必须在真实 Linux Server 做一次。

---

## 24.1 权限

确认：

```text
emergentinc
```

无法写：

```text
/opt/emergentinc-supervisor
/srv/emergentinc/releases
/etc/emergentinc
systemd unit
```

---

## 24.2 Rootless Docker

真实检查：

```text
rootless
seccomp
cgroup v2
memory limit
CPU limit
PID limit
network none
no host mount
no credentials
```

V21 已有的 Sandbox 验证全部在 Linux 实机再跑一次。

---

# 25. V22 最终端到端实验

这是本版本最重要的验收。

不要只看单元测试。

完整执行一次：

```text
① G0001 启动

② Pixel 发现缺少一个简单的数据处理能力

③ BodyGrowthService 产生新 Skill

④ Sandbox 验证

⑤ Skill 自动激活

⑥ G0001 Body Revision：
   R0 → R1

⑦ Skill 实际执行成功

⑧ Dream 运行

⑨ Dream 写入至少 1 条 Memory

⑩ Dream 或 Owner 产生 1 条 Gene Proposal：
   point
   reason
   effect

⑪ Owner 批准 Proposal

⑫ 本地 Codex / 人工实现 Gene Candidate

⑬ Supervisor 验证 Candidate

⑭ Owner 批准准确 Candidate Hash

⑮ Final Dream

⑯ Current DB Partial Migration

⑰ G0002 Candidate 启动验证

⑱ G0002 正式接管

⑲ G0001 RETIRED

⑳ 在 G0002 中能够读取：
   - 当前状态
   - G0001 的 Memory
   - 跨代 Business Facts
```

然后再做一次故障实验：

```text
构造 G0003 启动失败
→ G0002 自动恢复
→ G0003 FAILED
→ G0003 为什么失败被 Lineage 记住
```

完成以上两条，才允许宣布：

# “EmergentInc 已经活过一代。”

---

# 26. 推荐实施顺序

## Phase 1：生命数据层

完成：

```text
Lineage DB
Current DB
G0001
LifeContext
Partial Migration
```

验收后再继续。

---

## Phase 2：身体生长

完成：

```text
Body Need
Body Skill
Sandbox Validation
Auto Activate
Body Rollback
```

这一阶段不能修改 Gene。

---

## Phase 3：Memory + Dream

完成：

```text
MemoryGate
Daily Dream
Final Dream
Memory
Gene Proposal
```

Gene Proposal 仍然必须人工审批。

---

## Phase 4：Generation Birth / Death

完成：

```text
Root Supervisor
Gene Candidate
Candidate Hash Approval
Release Validation
Birth
Retire
Rollback
```

最后进行 Linux 端到端实验。

---

# 27. 本版本最终状态

V22 完成以后，EmergentInc 应该达到：

```text
Root of Trust
    ↓
Genome G000N
    ↓
Body 自主生长
    ↓
Current DB 记录这一代正在发生什么
    ↓
MemoryGate + Dream
    ↓
Lineage DB 形成跨代经验
    ↓
Gene Proposal
    ↓
Owner 审批
    ↓
新的 Genome
    ↓
Generation G000N+1
```

最终最重要的不是“自动部署成功”。

而是下面这条链第一次真实成立：

> **这一代活着 → 长出新的身体能力 → 经历成功与失败 → 形成记忆 → 提出遗传变化 → 新一代出生 → 上一代死亡/退休 → 经验继续存在。**

这就是 V22 的唯一核心目标。
