# EmergentInc V29 — Autonomous Goal Operating System
## 自主经营目标系统 · 全局运行开关 · 持续运行与定额轮次执行 PLAN

> 交付对象：本地 Codex / 实施 AI\
> 项目：`lx00018310/EmergentInc`\
> 设计基准：2026-10-13 拉取公开 `main`，HEAD `86b133e2892db1e4f14e153df86a41b785ed3867`（2026-10-12 16:37:25 UTC）。执行前**重新核对本地 HEAD 和现有改动**，以本地真实代码为准。\
> 目标版本：**V29**\
> 主原则：**用户管理经营目标，不管理 Pixel / 人物 / Run / Skill / 轮次细节；一个总开关控制 AI 自主推进。**\
> 实施方式：分阶段增量改造，复用既有 World Runtime、RunService、OwnerWorkService、Skills、业务审批及 8766 可信升级链路，不新造 Agent Runtime。

---

## 0. 需求的准确解释与本版架构选择

**用户希望：**

1. 经营目标像任务列表一样长期存在，能创建、编辑、暂停、继续、终止、归档/删除、查看详情和结果；所有目标可在同一页管理。
2. 一个**公司总开关**：打开后 AI 自动选择可运行的目标，自主分工、推进、复查、更新进度；关闭后停止**所有 AI 自主推进**，不再触发新的任务、模型调用或外部动作。
3. 打开后有两种模式：`持续运行` 与 `运行 N 轮`（例如 10,000 轮）；达到轮数、费用或安全边界时自动停下。多个目标共享总轮次，而非每个目标各跑 N 轮。
4. Owner 主要看目标达成程度与真实结果。日常无需进入 QIAN / YUAN / GENE / 8766，不被迫学习底层术语；只有风险、资金、外部发布或不可自动恢复的问题才出现在待办。
5. 无人值守、刷新页面、断网、服务重启后必须保持一致，不得重复计费、重复发布或虚报目标完成。

**核心区分：**

- `经营目标 Goal`：Owner 看见和管理的**长期业务对象**，例如“获得 3 位真实咨询客户”。
- `目标推进 Step/Dispatch`：目标拆出的内部任务，由现有 OwnerWorkService/人物/Skills 执行。
- `Run`：某 World 一次受限执行，现有 `RunService` 负责；**不是 Goal 本体**。
- 现有 `Execution.kind='mission'`：World 内部隔离的执行作用域，**不是** Owner 层经营目标；V29 新 `owner_goal` 通过关联表联系它们，禁止直接把两者概念或生命周期合并。
- `全局开关`：仅控制 **AI 自主执行平面**，不停止 8765 公共网站、客户下单、付款监听/确认、订单回执、管理查询、8766 独立维护与审计落盘。界面必须明确这一区别。若外部已经受理操作，暂停不能撤销其真实效果。

### 0.1 推荐的最简产品形态

```text
OWNER / Boss
┌────────────────────────────────────────────────────────────┐
│ 我的 AI 公司                          待办 2     动态     │
│                                                            │
│ [● 公司运行：关 / 开]   模式：[持续运行 ▾ / 指定轮数]        │
│                         指定轮数：[10000]                    │
│ 本次已开始 325 / 10000 轮   今日已知费用 ¥X / ¥Y          │
│   当前安全状态：运行中 / 停止中 / 已暂停 / 费用阻止         │
├────────────────────────────────────────────────────────────┤
│ 经营目标                                      [+ 新增目标]  │
│                                                            │
│ 获得 3 位真实咨询客户        推进中 · 已核验 1/3            │
│ [暂停] [停止] [编辑] [详情] [归档]                          │
│                                                            │
│ 上线 AI 定制服务商品页       已完成 · 有交付证据            │
│ [详情] [归档]                                             │
│                                                            │
│ 建立客户自动答复流程        等待对外发布授权               │
│ [详情] [暂停]                                             │
├────────────────────────────────────────────────────────────┤
│ [描述新的经营目标，比如：验证一项定制服务能否卖给 3 人…]  │
└────────────────────────────────────────────────────────────┘
```

**视觉约束：**沿用现有 Owner 浅色设计；目标列表是主角。避免增加四层架构概念、人物控制面板、Git 树或 KPI 仪表盘到首页。已有 `#owner-inbox` 只显示人必须决定的事项，`#owner-activity` 只显示事件/结果，不破坏 V28。

### 0.2 用户路径

1. **新建目标**：一句自然语言 → 系统形成简短目标卡（目标、可核验验收标准、默认建议执行路径、需要的最低资源）→ Owner 仅对**目标及授权边界**作一次确认。缺少关键条件时只询问 1 个必要问题；其余使用保守建议并允许后改。
2. **设置预算并打开公司运行**：第一次使用要求确认全局用量/费用边界。后续不需要逐一运行人物。
3. **系统自主推进**：根据现有人物的职责、已有 Pixel Skills、World 能力和当前阻塞自动分工；工作循环按持久化目标事件运行。
4. **Owner 看结果**：进度、下一步、是否需要 Owner、证据；不应把“人物已回复”“代码已提交”显示为商业成功。
5. **Owner 例外处理**：待办按 V28 同意/拒绝/详情；代码发布仍去 8766 强确认。

---

## 1. 最新代码核查结论（禁止无视现有能力重写）

| 现有能力 / 路径 | 已确认行为 | V29 改造方式 |
|---|---|---|
| `frontend/src/features/owner/OwnerConsole.tsx` | Boss / Inbox / Activity 三个互斥标签，Boss 为对话及六项状态表 | **只调整 Boss 主内容**，保留 Inbox/Activity、语言、导航与原聊天入口 |
| `apps/server/src/services/owner_work_service.ts` | `owner_work_tasks`、调度 `tick()`、自动派人物、招聘申请、任务回复；一个派工最多 5 人，每次 Run 最多 20 轮、100000 Run Tokens | 将长期目标的推进映射为小批次 `dispatch`，任务与目标关联；**不解除单次 Run 限制** |
| `apps/server/src/services/owner_chat_service.ts` | 模型负责识别 `dispatch/answer/energy/recruit`；已有真实人物职责路由 | 复用能力来生成受约束的下一步计划，不能直接执行不受控模型输出 |
| `apps/server/src/services/run_service.ts` | `start`、`requestStop`、`requestSuspend`、`resumeInterrupted`、`run_checkpoints`、预算、结果未知阻塞；最新提交增强重启后续跑 | 复用检查点与安全停机机制；`10,000` 是**跨多次 Run 的额度**，不是一次 `start({rounds:10000})` |
| `apps/server/src/services/world_runtime_manager.ts` | `open()` 和 `resumeInterrupted()` 可自动恢复中断 Run；`quiesceAll()` 安全排空 | 挂入持久化全局执行许可，**全局 OFF 时严禁自动续跑**，且不得破坏 8766 升级 quiesce 语义 |
| `packages/protocol/src/types/execution.ts`、`packages/persistence/src/repositories/execution_repository.ts` | 已有 `mission` 作用域、不可变快照、预算和轮次记账 | 能用则复用，新增 Owner Goal 与 existing Execution 映射；不要创建第二套底层 execution 引擎 |
| `apps/server/src/services/business_service.ts` | 自带自动调度、方案、定时任务、模型调用和外部动作 | 自动任务也必须受全局 Gate 约束，不能只关闭 OwnerWork 调度而遗漏该路径 |
| `apps/server/src/services/owner_overview_service.ts` | 聚合人物、进度、Gene、资源、业务与异常 | 增加 `goals` 与总开关摘要，尽量复用原投影和事件 |
| `apps/server/src/services/skill_library.ts` | `LIST_SKILLS/READ_SKILL`，个人 Body + 已批准公共 Gene | Goal 内让人物按需复用技能；不要向用户暴露 Skill 配置 |
| `scripts/upgrade-web.mjs`、`supervisor/*` | 独立 8766 代码审批、冻结、健康检测、回滚 | **不迁入 OWNER**；V29 自动执行必须与部署互斥 |
| `apps/server/src/services/release_maintenance_client.ts`、`owner_work_service.ts` | 现有 Pixel 可通过受限接口发起回退/删除，部分路径不要求逐次 Owner 确认 | V29 评审时必须收紧目标自动运行权限：默认禁止**自主删除代码版本**；回退按预授权恢复策略处理，非预授权须 Owner 决策 |

**特别提示：**旧 `docs/guides/OWNER_GUIDE.md` 仍有手工 Run 指南，不应当作新用户产品入口；V29 完成后改为高级运维文档。当前 HEAD 只是 GitHub 公共提交，执行方应先核对本地可能未提交的 V26/V27/V28 改动。

---

## 2. V29 最重要的产品语义

### 2.1 总开关：采用持久化的“期望状态 + 实际状态”

- `desired_mode`: `OFF` | `ON`；由 Owner 明确设置并写入 DB，**初次部署默认 OFF**。
- `run_mode`: `CONTINUOUS` | `BOUNDED`。
- `requested_rounds`: 仅 `BOUNDED` 有效，正整数，例如 `10000`。上限由验证策略控制；不通过修改单次 Run 上限实现。
- `observed_state`：`STOPPED` | `STARTING` | `RUNNING` | `IDLE` | `STOPPING` | `BLOCKED` | `LIMIT_REACHED` | `ERROR`，由真实运行状态计算，**不能把按钮 ON 当成已在运行**。
- `ON + 无可执行目标`：显示“运行已开启，当前无可执行目标”，进入等待，不自动创造虚假工作、不为闲转调用模型、不消耗轮数。
- `BOUNDED` 达到额度：自动切换 `desired_mode=OFF`、`LIMIT_REACHED`，下一次启动必须再次由 Owner 授权。
- `CONTINUOUS`：只是“持续尝试推进合格目标”，**不是无限预算、无限模型调用或无限运行速度**；受额度、节流、人工审批和安全阻塞约束。
- 保留可编辑的当次全局轮数总量；修改已启动批次的总额必须经 Owner 明确操作和 DB 版本校验，不悄然重置已消耗计数。

### 2.2 “一轮”的统一定义

**一轮 = 已开始的一个 World Run 的真实调度轮次；不能等同于一次 LLM 调用、一次任务或一次业务成功。**

- `10,000 轮` 是**所有可运行 Goal 的总额度**；由调度器切成现有安全范围内的小 Run（建议首版每批 1–5 轮，最大 20）。
- `used_rounds`：按真实、唯一的 `(run_id, round)` **已开始**轮次计数，包括中断轮次（与现有 scoped Execution 的口径一致）；不能只按成功轮次计数，否则中断可无限重试且超限。
- `completed_rounds`：独立显示已经完整结束的轮次；辅助观察，不决定上限。
- 同一轮的模型步骤、预算结算、报告也不得多次记账；闲置且没有真实 Run 启动时不扣轮数。
- 派发前先在 DB **保留**可用轮数；Run 确认开始时更新已使用；未开始的保留量在明确没有新 Run 的情况下可释放；启动/重启冲突时先对账，再派发。
- 对新控制平面，若首版无法安全做跨 World 的逐轮记账，**先每次仅派发 1 轮**保证可证实的精确上限，之后再优化成分批 5/20 轮。不可通过批量派发近似记账导致 10,000 变成 10,020。
- 进度提示必须写成 `本次已开始 325/10000 轮`，避免错误宣称“完成 325 次目标”。

### 2.3 目标生命周期

```text
DRAFT -> READY -> RUNNING -> (READY / WAITING_APPROVAL / WAITING_RESOURCE / PAUSED)
                            -> (COMPLETED / BLOCKED / FAILED / STOPPED)
DRAFT/READY/RUNNING/... -> ARCHIVED (逻辑归档，保留证据)
PAUSED -> READY（只在全局 ON 且目标恢复时被调度）
BLOCKED -> READY（必须先修复阻塞，有依据，禁止自动清空未知结果）
STOPPED -> READY（由 Owner 显式重新开启，可选择继续目标或复制新目标）
COMPLETED -> READY（仅通过 Owner 显式重开目标或创建新修订）
```

- **Goal 状态**与 **Global 状态**分别保存。例如目标 `READY`、全局 `OFF` 时展示“目标待运行·公司已暂停”，不要把 Goal 永久改成 `PAUSED`。
- **暂停目标**：保留目标与证据，可恢复继续；如果正执行该目标，优先在安全边界停止本目标进一步派工。
- **停止目标**：终止当前目标的自主继续计划，不再自动恢复；已实际产生的订单、费用、外部动作不会被撤销。
- **删除目标**：UI 可称“删除”，实际执行 `ARCHIVED`（软删除），从默认列表移除，可从归档恢复；任务、运行、费用和审计永久保留。不做物理级联删除。
- **编辑目标**：名称/说明/验收标准/预算作为新 `revision` 保存；旧任务/批准与旧快照绑定，不能自动套入更高预算或新目标。改变目标时待完成步骤重新评估，不回放旧外部动作。
- **自动更新目标**：只自动更新子任务、进度、证据、下一步建议；**不得自动修改 Owner 原定目标、预算上限、对外权限、验收标准**。
- `COMPLETED` 必须由**确定性验收规则**和可追溯证据支持；LLM 的“已完成”仅是待验证报告。

### 2.4 高质量的进度展示

每张 Goal 卡只显示五个核心信息：

1. **目标是什么**。
2. **真实状态**：推进中、等待审批、已暂停、已完成、因错误阻塞等。
3. **核验进度**：`1/3 条有效咨询`，没有结构化衡量项时显示“已完成 X 项有证据的阶段，成果待核验”，**不编百分比**。
4. **下一步**：“测试新渠道”“等待 Owner 允许发布”等，可点击详情查看负责人、步骤、证据。
5. **操作**：`暂停/继续`、`编辑`、`停止`、`详情`、`删除（归档）`；合理合并至“⋯”菜单避免满屏按钮。

高级详情再显示关联人物、World、Runs、Skills、Git 候选、预算明细、里程碑、证据与历史决议。

---

## 3. 安全边界（完成前不得全量打开总开关）

### 3.1 全局 OFF 的定义必须可信

停机流程：

```text
Owner OFF 指令
  -> 原子写 desired_mode=OFF + control revision + 审计
  -> Gate 即刻禁止新目标分配、新 Run、新付费模型任务与新外部写操作
  -> 对所有正在运行的受管目标发 requestSuspend()，等待正在执行的安全步骤落地
  -> 对账未决操作/预留/日志/检查点，保留 STOPPING 与真实在途数量
  -> 仅当全部相关 Run 及可控付费任务确实停稳才显示 STOPPED
```

- 使用现有 `RunService.requestSuspend()` 而非强杀进程；在无法安全中止的外部调用期间显示 `STOPPING（x 项收尾）`，**禁止假显示“已暂停”**。
- `requestStop()` 已有 `USER_STOPPED` 语义且会关闭自动续跑资格；全局暂停应优先复用保留检查点的 `requestSuspend()`，而非用它模拟永久终止。
- OFF 之后**不再发起新的模型调用和工具调用**；已经发送给第三方的请求可能完成，必须完成回执/费用记账或标记 `OUTCOME_UNKNOWN`，不得补发。
- 关开关时 **不要停止 8765 HTTP 服务、公开商店、订单接单/查询、链上只读确认、支付账本、Owner 登录、审计或 8766 恢复服务**。这些属于服务存活，不属于 AI 自主执行。
- 运行时排空超过合理等待（比如既有 30 秒边界）应显示“停止中/需要核实”并禁止重新开启；不能强行把未知结果写成成功、失败或零费用。
- 已经开启的浏览器不会拥有唯一真实状态；全局状态以服务端 SQLite 为准，所有登录客户端同步。

### 3.2 所有入口共享同一个 Gate（首要安全验收）

不仅是 `GoalScheduler`，至少检查并挂载到：

- `OwnerWorkService.start/tick/dispatch`：停止新派发和新任务 Run。
- `WorldRuntimeManager.open/resumeInterrupted`、`RunService.start`：**进程重启且 OFF 时不能自动继续旧 Run**；人工手动启动也不能绕过全局 OFF（如需紧急专用恢复，必须是维护通道独立权限）。
- QIAN 人物聊天自动启动 Run 的入口及 `/YUAN` 手动 Run 入口：OFF 时只允许只读检查与编辑 Goal；不能绕过总开关继续执行。
- `BusinessService.start/tick`、定时复盘与自动模型任务、Dream 自动触发路径：OFF 时不继续 AI 自主工作。计划已授权的定时任务也不能绕过。
- 自动能量恢复引发的 `run.start`；其他自动任务生产者及重试队列都应做入口审计。
- 任何发起外部写动作的调用还需要原业务批准链；全局 ON **不是发布许可**。

防止 TOCTOU：在**准备派工、真正开始 Run、执行需授权外部动作前**重新检查持久化 `gate revision` 与目标版本/状态。尽量使用事务检查，不靠前端按钮禁用防竞态。

### 3.3 全局默认防失控

- **默认 OFF**。第一次 ON 必须有用户明确给出的费用/Token 边界，不设置不启用。支持易懂的预算模板，但不能把默认模板偷偷视为 Owner 已授权。
- 至少 3 个硬限制：**全局费用或 Token 授权额度、单 Goal 限额、单次 Run 限额**；连续模式仍受这些额度约束。已有 Run/Execution/业务预算继续有效，不能互相代替。模型定价/用量未知时 fail closed 或标记待核实，不许按 0 元继续运行。
- 费用来自现有真实 UsageMeter / BusinessStore / Run 结算数据，避免不同账本重复计算；展示“已知费用”和“待核实预留”分开。无法在调用前严格估算法币上限时用 Token 预留做硬闸门，明确金额属于估算而非支付承诺。
- 首版**并发最多 1 个自主 Goal 执行片段**（不影响公共客户接入）；先做公平轮转，验证稳定后才扩大并发。
- 目标无进展 / 重复空回复 / 只读循环 / 基础设施错误时加入冷却退避（例如连续 3 次无有效新证据转 `BLOCKED`），禁止自动无限烧 Tokens。现有 `READ_LOOP_THRESHOLD_REACHED` 必须继续生效。
- 目标优先级可选，默认公平轮转，不让一个长期目标永久占住 10,000 轮；目标可进入 `WAITING_APPROVAL` 等待其他目标推进。
- 自动产生的人物招聘只形成审批请求；**不**因目标持续运行就自动增殖付费 Agent。
- **风险与权限表**：内部查询、分析、技能读取、生成草稿可自动；经过明确预算与范围授权的已有方案可在限制内执行；对外内容发布、扩额、Gene 晋升、源代码发布、重要代码/版本删除、修改凭据和不可逆外部动作必须使用已有可信审批边界。
- **特别整改项**：既有受限 Pixel 版本回退/删除路径需核查。V29 Goal 自主调度不得静默触发版本删除；回退只可在 Owner 预先批准的精确恢复策略下自动进行；没有策略必须走独立 Owner 确认。严禁把全局 ON 等价为 blanket root 授权。

### 3.4 外部与支付安全

- 禁止因重启/暂停/恢复自动重发 GitHub Issue、订单、邮件、链上操作或模型结果未知调用。使用既有幂等键、已发送回执和审计证据；不确定结果进入待办。
- 如果目标因费用问题暂停，Owner 确认费用后才能重新运行；不得悄悄充值无限能量来规避预算。`Infinite Energy` 仍不得绕过实际费用与 Run 预算。
- 付款监听、订单落盘和真实收入记录在公司总开关关闭时继续工作；**不能把收款交互当作 AI 的外部执行权限**。
- 升级维护请求 `quiesceAll` 必须高于 Global ON。维护前停止自主调度并排空；升级后按持久化授权与健康检查决定是否继续，不能忘记全局 OFF 状态。

---

## 4. 最小新增的数据模型（复用已有 SQLite，不新建数据库）

优先在 `system/control/control.sqlite3` 中通过现有持久化模式演进；禁止把 Goal 存在前端 `localStorage`、仓库 Git 文件或一个聊天记录里。

### 4.1 推荐结构（字段可按实际现有仓库调整命名）

```ts
type GoalStatus =
  | 'DRAFT' | 'READY' | 'RUNNING' | 'WAITING_APPROVAL'
  | 'WAITING_RESOURCE' | 'PAUSED' | 'BLOCKED' | 'FAILED'
  | 'COMPLETED' | 'STOPPED' | 'ARCHIVED';

type OwnerGoal = {
  id: string;
  revision: number;             // compare-and-swap，防覆盖
  title: string;                // 人类可读
  objective: string;            // Owner 真实目标，不被 AI 自动改写
  acceptance: unknown;          // 可核验验收条件；保留结构化 JSON
  status: GoalStatus;
  priority: number;             // 默认 0
  maxTokens: number;            // 用户授权
  maxCostMicros?: number;       // 已知币种费用限制，需清楚对应口径
  deadlineAt?: number;
  nextAction?: string;
  lastEvidenceAt?: number;
  verifiedProgress?: unknown;   // 来源为验收服务，不直接信任 Agent 文本
  createdAt: number;
  updatedAt: number;
  archivedAt?: number;
};

type GlobalAutomation = {
  desiredMode: 'OFF' | 'ON';
  runMode: 'CONTINUOUS' | 'BOUNDED';
  requestedRounds: number | null;
  startedRounds: number;
  completedRounds: number;
  reservedRounds: number;
  maxTokens: number;
  maxCostMicros?: number;
  revision: number;
  updatedAt: number;
};
```

建议表：

- `owner_goals`：目标及**当前**修订、状态、摘要/预算；验收声明与版本快照。
- `owner_goal_events`：不可变历史（新增、修改、停、继续、决定、证据、验收、费用阻塞、错误），用于 Activity 与审计。
- `owner_goal_steps`：目标的内部推进片段，`goal_id + goal_revision + step_key` 唯一；持有下一步、状态、执行者、预期证据、冷却时间、attempts。
- `owner_goal_dispatches`：`goal_step_id ↔ owner_work_tasks.id ↔ Run/Execution` 的稳定映射，避免大改现有 `owner_work_tasks` 表。
- `owner_automation_control`：唯一一行全局期望状态、运行模式、额度、revision。
- `owner_round_permits`：全局轮数许可/保留/消费的独立账，唯一约束 `(run_id, round_no)`；必须可在服务重启后与 Run 检查点对账。

首版**不要**为每个目标新建 World、复制所有 Pixel、复制 Gene 或重新初始化任务账本。Goal 是轻量控制面，不是新的生命层级。

### 4.2 持久化约束

- 所有更新事务化，`expectedRevision` 校验，使用唯一 `idempotencyKey` 防重复请求；前端网络重试沿用同键。
- 编辑 Goal 后旧事件、旧授权、旧 Run 和不可变证据依然归属于旧修订。
- 目标生命周期不得删除收款、模型费用、外部操作、审计、当前/历史记忆。
- `owner_goal_events` 只沉淀**事实**；不能从模型自述生成“已获客/已收款”的真实事实。
- 迁移对现有 Workspace **向后兼容**；预先备份，SQLite 原有表不丢失；新功能默认关闭；老 Owner 派发记录保留可查询。

---

## 5. 可直接供本地 AI 落地的实施阶段

### P1 — Goal 管理最小闭环（必须先完成）

**涉及：**

- `packages/protocol/src/types/owner.ts`：Owner Goal 和 Global Control 类型；避免混入现有低层 `Execution.kind='mission'`。
- `apps/server/src/services/owner_goal_service.ts`（新增）：SQLite CRUD、revision/CAS、目标状态与事件。
- `apps/server/src/routes/owner_routes.ts`：增加 Owner 认证下的目标 API。
- `apps/server/src/services/owner_overview_service.ts`：聚合 Goals 简表和安全状态。
- `frontend/src/features/owner/OwnerConsole.tsx`：Boss 第一屏改成总开关位置 + 目标列表 + 一句新增目标；保存原聊天为辅助入口。
- `frontend/src/features/owner/OwnerGoals.tsx`、轻量 `OwnerGoalCard.tsx`（可合并成单文件）；复用 `owner.css` 与现有 `i18n`。

**API（可按原 API 前缀实现）：**

```text
GET   /api/owner/goals                         # 列表/可选归档
POST  /api/owner/goals                         # 新增草稿/目标
GET   /api/owner/goals/:id                     # 详情，关联证据
PATCH /api/owner/goals/:id                     # 编辑，expectedRevision
POST  /api/owner/goals/:id/actions             # pause/resume/stop/archive/restore
GET   /api/owner/automation                    # 全局真实/期望状态
POST  /api/owner/automation                    # OFF / ON + mode + limits
```

- `POST/PATCH/actions` 全部要求 Owner 会话、schema 验证、幂等键、版本校验；不接受任意命令/路径/URL/SQL/模型返回的 handler 名。
- **这阶段可先不执行目标**，但 CRUD、状态与事件必须真实持久；先用测试确认状态机，**绝不把假运行状态展示成成功**。
- 目标自然语言输入的简单提取可重用当前 Owner 路由；创建初期不应自动消耗模型、授权预算或招聘。

**P1 验收：**多个目标可新增、编辑、暂停、终止、归档、恢复，刷新或重启不丢数据；旧 OWNER 页面、审批和公开站点不回归。

### P2 — 全局 Gate 与可靠调度闭环（核心）

**新增薄层**：`OwnerAutomationGate`（持久化许可）+ `OwnerGoalScheduler`（选目标并复用现有派工），不增加第二个模型运行时。

**建议最小调度伪流程：**

```text
onStart:
  load persisted global intent
  reconcile running/unknown Run + goal_step mappings + reserved permits
  NEVER resume autonomous work when desired_mode == OFF

onTick:
  if not Gate.isOn() or upgradeQuiesced: return
  if cost ceiling or round ceiling reached: persist OFF / BLOCKED and return
  if a previous goal step is running: observe actual Run, do not enqueue duplicate
  if no eligible Goal: IDLE + backoff, no model call
  goal = chooseFairEligibleGoal()
  step = deriveNextStepFromEvidenceOrExistingPlan(goal)
  if requiresHumanApproval(step): create Inbox item; mark goal WAITING_APPROVAL; return
  if missingResource(step): mark WAITING_RESOURCE; return
  reserve bounded global permits + budget for this exact goal revision/step
  dispatch via existing OwnerWorkService or scoped Execution as applicable
  persist stable task/run IDs and wait for real completion
  collect report + source evidence
  verify acceptance; update Goal status/progress/events
  schedule next step only if truly unfinished, Gate ON and still within budgets
```

**必须重用：**`OwnerWorkService` 的人物角色路由和持久化任务；`RunService` 最新检查点、消息范围与预算保护；现有 `Execution` 时要尊重成员 binding/工具范围/隔离条件；`BusinessService` 的商业行为许可；Skills 的按需读取。

**Gate 接入顺序：**

1. 在控制库写入全局状态，先单元测试权限判断和乐观锁。
2. 对 `OwnerWorkService` 新派工、`RunService.start`、`WorldRuntimeManager` 自动重启续跑等入口做统一防绕过检查。
3. 审计 `BusinessService` 自动调度、Dream 定时、QIAN/UI 人工开 Run、Energy 唤醒等路径；优先注册同一个 Gate；不要遗漏独立的业务调度器。
4. 关开关时禁派工 → 请求安全挂起 → 对账 → 通知前端状态；全局开关再开后只恢复**仍可合法恢复**的任务。
5. 独立维护 `quiesce` 优先级始终最高，维护过程不被全局 ON 唤醒。
6. 再开启持续与 10,000 轮额度运行；初版单片段并发 1，轮次许可与检查点严格一致。

**调度策略：**

- 首版**公平循环**，高优先级先选但不可永久饥饿其他目标；同一 World 只能有其许可的一个目标 Run。
- 每次新步骤均使用与目标、修订、步骤相关的稳定幂等键，不按时间生成每次重试的新授权。
- 没有任务、模型不可用、超预算、无证据进展、未知外部结果都进入可解释状态，不做高速空循环。
- 因目标完成而结束只停目标，不关闭全公司；当 BOUNDED 全局轮数用尽才停止全公司。
- 单目标停止不会使其他 Goal 的状态错乱。全局停止必须影响**所有**自主推进路径，包括此前直接从 Owner Chat 派发的任务，不可留下后台偷偷执行的旧队列。

**P2 验收：**开总开关确实能自动推进 2 个以上目标；关闭后各路 AI 不再创建新 Run/模型调用/外部写；在途安全落盘；BOUNDED 10000 跨多次最多按许可实际开始 10000 轮；全局 OFF 重启时不会意外恢复；ON 重启遵守检查点且不会重复外部动作。

### P3 — 结果验收、例外待办和商业稳定性

**改造：**

1. 提供 `GoalOutcomeEvaluator`（轻量服务，不是新的 LLM Agent）。按不同目标类别从现有 `business_events`、订单/已确认支付、外部咨询核验、交付文件哈希、Run 证据等投影。没有证据就只显示进展或待核实。
2. 目标卡显示**验收的结果**、下一步、阻碍、已消耗 Tokens/费用、最后活动时间；“人已回复/方案已写”只标记阶段，不能自动标记 `COMPLETED`。
3. `owner-inbox` 增加 Goal 关联项：缺少必需材料、外部发布授权、预算扩额、代码发布审批、结果核实。保留 V28 对已可安全决策项目的“同意/拒绝/详情”；不能安全一键处理的仍为告警。
4. `owner-activity` 将 Goal 重要事件聚合为人类语言：“目标 A 完成一次市场访谈摘要”“目标 B 因费用不足暂停”“目标 C 收到真实已核验询盘”；原始技术日志放详情。避免同一件事出现 8 条低层事件刷屏。
5. 支持**运行报告**：按目标列出本次运行的有效新证据/成本/待办/终止原因；不为生成报告再做无上限模型调用。
6. 兼容 `/QIAN`, `/YUAN`, `/GENE`, `8766`，为高级用户留深链接，不让初学者承担专业页面导航成本。
7. 重新写 `README.md` 英文主导、`README_CN.md` 中文、`docs/guides/OWNER_GUIDE.md`：主路径必须为“部署 → 新建目标 → 授权边界 → 打开开关 → 查看结果”；高级运维迁移到附录。

**P3 验收：**用户不用点人物或 Pixel 也能设置 2 个业务目标并自动推进；能看到真实证据进度；至少一种有证据的目标可完成、一种信息不足待核实、一种风险操作进入待办；所有页面功能仍可用。

---

## 6. 测试矩阵：尤其要做真实故障注入

| 场景 | 必须达到的结果 |
|---|---|
| 空目标时全局 ON | `IDLE`，不空跑、不消耗模型 Tokens、轮数不减少 |
| 2 个目标 + BOUNDED 7 轮 | 总已开始轮数 ≤ 7，至少公平分配，某目标暂停后其剩余轮数供其他目标 |
| BOUNDED 10000 轮 | 多批执行，不突破单 Run 原有限制，不重复计轮，精确在上限停 |
| OFF 时后台还存在 QUEUED Owner task | 不领取、不生成新 Run；关/开与目标可执行性分别检查 |
| OFF 时模型调用已发出 | 标记停止中；不再发新调用，既有回执/费用和不确定性保留 |
| OFF + 进程被杀 + 重启 | 全局仍 OFF，旧检查点不偷偷自恢复执行 |
| ON + 进程被杀 + 重启 | 安全检查通过再继续；不重新发送之前未知结果的外部动作 |
| 重复点击 ON / 网络重试 | 幂等，无多个轮数批次、无重复任务或预算授权 |
| 两个浏览器同时编辑目标与预算 | 旧 revision 返回 409，不覆盖新数据或审批 |
| 暂停/停止/归档正在进行中的 Goal | 新步骤停止，在途操作审计保留；其他目标继续 |
| 未知模型费用、未知 GitHub 外发结果 | 停在 BLOCKED / 待核实，不自动重复调用或写操作 |
| 达到每日/全局/Goal 预算边界 | fail closed，显示明确原因，不能靠无限 Energy 继续 |
| 无进度循环 | 触发退避/阻塞；不得持续无收益消耗 Token |
| 外部客户下单及收款确认发生在 OFF | 订单与支付服务照常工作、数据保留；不启动 AI 自主营销 |
| 8766 发布前 quiesce 与切换 | 运行 Gate 不与维护抢锁；升级健康后遵守真实期望状态 |
| Agent 提交代码、要求回退/删除 | 不能绕过独立发布审批或擅自删除版本；对外行为有既有授权 |
| Agent 声称“已成交”、缺失真实收款证据 | Goal 不可标为真实成交完成 |
| 旧 Workspace / 历史 Owner 派工 | 升级无数据破坏、旧记录继续可查，回退需要按兼容策略处理 |
| 中英文切换、窄屏、无 JavaScript 错误 | 不丢目标、状态与草稿；可用键盘操作，提示可读 |

建议新增：

```text
apps/server/tests/owner_goals.test.ts
apps/server/tests/owner_global_automation.test.ts
apps/server/tests/owner_goal_scheduler.test.ts
apps/server/tests/owner_goal_recovery.test.ts
frontend/tests/owner_goals.test.tsx
```

应增加原 `owner_work.test.ts`、`owner_console.test.tsx`、`business.test.ts`、`local_upgrade.test.ts` 的必要回归用例。尽量使用隔离临时 Workspace + mock ModelProvider + 可控虚拟时间；**不触碰真实钱包、真实付费 API、真实业务库或生产版本**。

### 6.1 一次可演示的 E2E 验收

```text
Owner 新建 Goal-A：「输出 1 份可检查的 AI 定制服务市场研究摘要」
Owner 新建 Goal-B：「整理已有商品页并给出改进方案」
Owner 为每个目标确认验收与独立 Token 额度，并设置全局预算
Owner 选择「运行 10 轮」→ 开启
    系统自动选择人物/技能 → 分批开始 Run → 形成文件与证据
    两个 Goal 都出现可追溯的实际活动
    总已开始轮数恰好最多 10，达到上限自动 OFF
Owner 再开「持续运行」→ 关闭
    画面立即 STOPPING，安全结束后 STOPPED
    重启服务仍 OFF；两个 Goal 保留进度，不重复外部写
Owner 选择归档 Goal-A → 默认清单移除，可在归档查回历史
```

---

## 7. 指定实施边界：不要顺手重写

**本次应做：**持久经营目标、单一全局执行 Gate、目标与现有任务/Run/证据映射、总轮数、预算停止、可靠暂停/恢复、Owner 目标列表与例外 Inbox。

**本次不做：**

- 不改四层 Root / Gene / Evolution / Body 的定义，不改变一次 Gene 变更是一代的规则。
- 不创造独立于现有 Worker/Run 的第二种 AI 执行器、事件总线或复杂 BPMN 平台。
- 不将每个 Goal 固定为新 World/人物，也不让 Goal 自动复制私有 Body 到公共 Gene。
- 不引入 Temporal、LangGraph、Redis Queue 或新的消息中间件作为 V29 的前置依赖；**学习其状态机、检查点、审批分离思想即可**。
- 不把软件升级、Root 变更、凭据、钱包签名、版本删除开放为普通 Goal 自动工具。
- 不增加无上限并发、无限额度、任意自我修改代码、完全自动对外发布。
- 不删除 `/QIAN`、`/YUAN`、`/GENE`、`8766` 或原有审计与恢复机制。
- 不以模型回答为完成证明，不以业务网站在线为财务盈利证明。

---

## 8. 开发完成后必须提交的报告

本地 Codex 交付：

1. 改动路径列表、关键数据结构、全局 Gate 所有挂载点（逐项说明如何防遗漏）。
2. P1/P2/P3 验收项及对应测试结果，特别是**全局 OFF、10,000 轮额度、断电重启、未知外部结果、8766 升级**。
3. 新增/修改 API 清单，状态机和“已开始轮数”记账依据。
4. 使用隔离 Workspace 的手工 E2E 截图或日志摘要，不把测试数据写成真实客户经营结果。
5. README（英文）及 README_CN（中文）更新。
6. 尚未解决的安全边界及未满足的需求明确列出，**不能以 TODO 假装已经实现**。

## 9. V29 的最终交付标准

> **一个普通使用者只要会描述目标、确认预算和切换运行开关，就能让 EmergentInc 自主协调人物、Pixel 与 Skills，推进多个经营目标；系统能够诚实地说明实际结果、费用、阻碍与证据，任何时刻都能安全停下并从检查点恢复。**

这才是 V29 的成功定义，而不是后台自动产生了多少 Run、多少对话或多少代码提交。

---

## 参考资料与设计依据

1. EmergentInc GitHub 主分支（代码核查）：https://github.com/lx00018310/EmergentInc/tree/86b133e2892db1e4f14e153df86a41b785ed3867
2. Nielsen Norman Group — 10 Usability Heuristics： https://www.nngroup.com/articles/ten-usability-heuristics/ —— 使用人类语言、看得见的状态、可退出、错误预防。
3. GitHub Docs — Disable/enable workflows： https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows —— 停止自动触发不等于删掉历史任务。
4. OpenAI Agents SDK — Human-in-the-loop： https://openai.github.io/openai-agents-js/guides/human-in-the-loop/ —— 暂停执行、保存状态、精准审批与恢复，服务器校验所有权与一致性。
5. LangGraph — Persistence/Durable execution： https://langchain-ai.github.io/langgraph/concepts/durable_execution/ —— 检查点、恢复和长期存储分离。
6. LangGraph — Thinking in LangGraph： https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph —— 持久状态、按错误类别处理、按需人类干预，避免存储可重算冗余状态。

**设计选择：**吸收这些机制，不引入它们的运行时依赖；最大限度复用 EmergentInc 现有数据库、Run 预算、Owner API 与隔离 Supervisor。

## 执行记录 / Execution record

2026-10-13：P1/P2/P3 开发候选已实施。最终完整回归 946 项通过、2 项可选进程测试跳过；TypeScript 检查及前端构建通过。改动、Gate 挂载点、证据、未运行验收和实际边界见 [V29 实施记录](./EmergentInc_V29_实施记录.md)。未部署、未连接真实付费模型或钱包。

The P1/P2/P3 development candidate is implemented. The complete suite passed 946 tests with two opt-in process tests skipped; type checking and the frontend build passed. See the implementation report for evidence and limits. No deployment or live model/payment acceptance was performed.
