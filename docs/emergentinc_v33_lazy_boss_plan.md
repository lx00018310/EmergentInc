# EmergentInc V33 · Lazy Boss 终极执行 PLAN
## 表面彻底剃骨 · 内核零重写 · 锚定「做任何事情去赚钱」

> **给本地 Codex / Claude Code / AI 编程代理的直接可执行任务书。请严格按本文件顺序落地代码与测试，不要只输出分析。**
> **适用仓库**：`https://github.com/lx00018310/EmergentInc`
> **核对基准**：`main` @ `a45aef958d336984ba0bc0065cbdca0b464719e6`（`feat(budget): 统一公司金额预算并移除个人与任务额度`）
> **核心刀法**：**“表面彻底剃骨，内核一字不动；一切围绕搞钱闭环。”**

## 0. 产品重构铁律（乔布斯刀法与核心定位）

本次 V33 升级旨在彻底解决原项目 **“冗余、普通、耦合、没用”** 四大痛点，将系统包装并收敛为 **Lazy Boss & Living AI Company**：

1. **表面彻底剃骨（砍掉一切自嗨黑话，前台只留 4 个概念）**
   - 老板眼里的主界面只允许存在 4 个概念：**Lazy Boss（只管说话拍板）**、**EmergentInc（AI 公司协调器）**、**Tasks（正在干的赚钱活）**、**AI Teams（干活的 AI 员工）**。
   - 在 `/OWNER` 主导航、主画布、空状态和 README 主叙事中，**彻底抹掉 `QIAN（千机阁）`、`YUAN（元胞工作间）`、`GENE（基因中心）`、`Pixel（元胞坐标）` 等底层技术隐喻**。
   - `/OWNER` 顶部导航固定为四个页签：**`Lazy Boss` | `AI Company` | `AI Teams` | `Settings`**。
   - 点击 **`AI Teams`** 不再粗暴跳出到古风 `/QIAN` 页面，而是在 `/OWNER` 壳内直接渲染清爽现代的 **AI 员工与团队能力页（`OwnerTeamsView.tsx`）**；原 `/QIAN`、`/YUAN`、`/GENE`、`:8766` 升级入口统一收进 `Settings -> Engine Internals（底层引擎与高级入口）`，同时保持原 URL 路由 100% 可访问以兼容既有测试。
2. **内核一字不动（零数据库迁移、零调度器重写）**
   - 严禁修改 `control.sqlite3`、`payment.sqlite3`、`lineage.sqlite3`、`v9_core.sqlite3` 的表结构。
   - 严禁重写 `OwnerGoalScheduler`、`OwnerWorkService`、`OwnerAutomationGate`、统一公司金额预算（`owner_company_budget`）及链上收款监听。
   - 所有新视图（Goal 上下文、Tasks 极简卡、AI Teams 动态关联、Message Flow 粒子事件）全部通过前端纯函数投影层（`ownerFlowProjection.ts` 与 `ownerFlowEvents.ts`）从现有 `/api/owner/overview` 数据无损派生。
3. **锚定「做任何事情去赚钱（Do Anything to Make Money）」**
   - **搞钱 ROI 顶栏（Money & Outcome Bar）**：在 `AI Company` 画布顶部并列展示：**当前赚钱目标（Goal 切换器 + Ongoing/One-off 标签）** ｜ **投入成本（已结算 ¥ / 可用预算 ¥）** ｜ **真实回款（已核验链上 USDT 收入 / 独立站成交单数）** ｜ **最新可变现交付物（直达商城商品或证据文件）**。
   - **Lazy Boss 空白态「3 条一键搞钱启动器」**：在聊天框空白时提供 3 个一键上膛的搞钱指令卡片（自动造品上架收 USDT、每日海外引流内容运营、预算内自主策划首单变现），消除“面对空白输入框不知如何赚钱”的无力感。
   - **规划提示词商业结果约束**：微调 `apps/server/src/services/owner_chat_service.ts` 的 `route()` 系统提示词，要求 AI 拆解任何赚钱目标时必须落到**可售卖商品配置（`product.json`）或可验证交付物（`save_artifact`）**，拒绝空洞文字汇报。

## 1. 核心数据模型与确定性投影规则

### 1.1 Goal ≠ Task ≠ AI Team 映射表

| 界面概念 | 底层唯一数据源 | 身份键与生命周期 | 展示与操作规则 |
| :--- | :--- | :--- | :--- |
| **Goal（经营目标）** | `OwnerOverview.goals[]` (`OwnerGoal`) | `goal.id` + `goal.specificationRevision` | 位于 `AI Company` 顶部作为观察上下文；展示真实核验收入、交付物数量与 `Ongoing / One-off` 模式；切换 Goal 仅过滤当前画布，绝不触发后端 pause/stop |
| **Task（极简任务卡）** | `OwnerOverview.taskPlans[].nodes[]` (`CompanyTaskNodeView`) + 关联 `work.tasks[]` | `(goalId, goalRevision, planRevision, node.key)` | 位于画布第 3 列；默认展示不超过 6 个活跃/待决策节点，其余折叠为 `+N`；卡片只显示**任务简名 + 五档确定性进度 + 去重问题上标 `①`** |
| **AI Team（执行团队）** | `OwnerOverview.people[]` + `plan.nodes[].personId` + `work.tasks[]` | 任务期动态关联 `(goalId, nodeKey) -> personId[]` | 位于画布第 4 列及 `AI Teams` 页签；单人显示“独立执行”，多人显示协作组，未分配显示“待分配”，任务完成后自动释放临时连线，绝不伪造虚拟员工 |
| **Legacy / 独立派工** | 无 `taskPlans` 的旧 `OwnerGoal`、无 `goalId` 的 `work.tasks`、`legacyBusiness` | 原记录 `id` | 当某个 `OwnerGoal` 无 `CompanyTaskPlan` 时，将其关联的 `work.tasks` 或单步本身投影为兜底 Task 节点；孤立历史任务收进 `Settings` 或“未归属历史工作”折叠区 |

### 1.2 Task 极简卡片：五档确定性进度算法（Deterministic Stage Progress）

废除“算不出内部子步骤就全显示 `—`”的退化表现，同时**严禁采信 LLM 自报百分比**，严格依据数据库持久化状态计算 `progressPercent: number | null` 与 `stageLabel`：

| 档位 | 显示百分比 | 判定条件（按优先级从高到低匹配） | 状态文案（中 / 英） |
| :--- | :--- | :--- | :--- |
| **第 5 档：已核验交付** | **`100%`** | `node.state === 'COMPLETED'`（针对 `interval / daily / weekly / continuous` 周期节点，当前轮未处于新一轮 `RUNNING / WAITING_RESOURCE / BLOCKED`） | `已核验完成` / `Verified complete` |
| **第 4 档：已交稿待核验** | **`80%`** | 关联的最新 `OwnerWorkTask.state === 'REPLIED'`，或存在针对该 `goalId` 的 `PENDING` 状态 `close_task` 提案，或 `node.latestEvidence.length > 0` 且正在等待结案核验 | `已交稿待核验` / `Delivered, awaiting check` |
| **第 3 档：执行中** | **`50%`** | `node.state === 'RUNNING'`，或关联的 `OwnerWorkTask.state === 'RUNNING'` 且对应 `OwnerPerson.running === true` | `正在执行` / `Executing now` |
| **第 2 档：已派单 / 等资源** | **`25%`** | 存在关联的 `OwnerWorkTask.state === 'QUEUED'`，或 `node.state === 'WAITING_RESOURCE'`（如等待招募批准），或 `OwnerWorkTask.state === 'RUNNING'` 但人员当前未运行 | `已派单准备中` / `Assigned & queued` |
| **第 1 档：待启动** | **`0%`** | `node.state === 'WAITING'` 且尚未生成当前批次派工（等待前置 `dependsOn` 节点或定时触发窗口） | `等待启动` / `Waiting to start` |
| **兜底档：未知/旧结构** | **`—`** (`null`) | 仅用于完全没有 `CompanyTaskPlan.nodes` 且无关联 `OwnerWorkTask` 的遗留草稿记录 | `进度待定` / `Progress pending` |

**周期性 Task（Ongoing Occurrences）防造假规则**：
- 若节点 `trigger.kind !== 'once'`，卡片副标题显示 `第 N 轮` / `Run #N`（取自 `node.occurrences`）。
- 当新一轮触发开始（`node.state === 'RUNNING'` 或新派工进入 `QUEUED`）时，进度条立即按本轮实际状态显示 `25%` 或 `50%`，**绝不沿用上一轮的 `100%`**。

### 1.3 问题上标（Owner Blocker Badge `①`）提取与去重算法

只统计**真正需要老板拍板且尚未解决**的事项，自动重试或普通运行日志绝不产生上标：

1. **数据源提取**：
   - `proposals[]` 中 `state === 'PENDING'` 的公司提案（`task_plan` 计划审批、`close_task` 结案审批、`budget` 预算提案），归属键：`proposal:${p.id}`，绑定 `p.goalId`。
   - `inbox[]` 中包含 `requiresApproval: true` 的待审项（如 `recruit` 招聘审批、`plan`、`resource`、`gene`），归属键：`inbox:${item.id}`。若招聘请求关联了某 `goalId` / `nodeKey`，绑定到对应 Goal/Task；否则归入全局关注。
   - `alerts[]` 中的阻塞项（`goal:${goalId}`、`product-intent:${goalId}`、`task:${taskId}`、`automation:quota`、`automation:review`），归属键：`alert:${a.id}`。
   - `node.state === 'BLOCKED'` 或 `node.state === 'WAITING_RESOURCE'`，若尚未被上述 `inbox / proposals / alerts` 覆盖，归属键：`node-block:${goalId}:${node.key}`。
2. **严格去重规则**：
   - 同一招聘或计划若同时出现在 `proposals[]`、`inbox[]` 和 `alerts[]` 中，按底层业务实体 ID（如 `goalId + proposal.kind` 或 `recruitRequestId`）合并为 **1 个问题计数**。
   - 计数为 `0` 时不渲染上标；计数为 `1..9` 时渲染 `①..⑨`（及 `aria-label` 无障碍数字）；点击上标弹出简明原因与证据摘要，并提供一键ボタン **`Go to Lazy Boss to resolve` / `去 Lazy Boss 对话处理`**（点击后切换到 `#lazy-boss` 并在输入框预填处理上下文或直接聚焦对应提案卡）。

## 2. 真实 Message Flow 路由与粒子规范

### 2.1 四列固定拓扑

```text
[搞钱 ROI 顶栏：Goal 选择器 | 模式 (Ongoing/One-off) | 已花成本 ¥ | 已赚收入 USDT & 订单 | 待老板拍板总数]
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│    Lazy Boss     │  ⇄   │   EmergentInc    │  ⇄   │    Tasks × N     │  ⇄   │   AI Teams × N   │
│    TALK ONLY     │      │   Coordinator    │      │  名称 + 进度 + ① │      │ 真实员工 / 协作组 │
└──────────────────┘      └──────────────────┘      └──────────────────┘      └──────────────────┘
[底部可验证实时事件流：仅记录真实落库事件，可点击跳转证据]
```

### 2.2 六类真实消息粒子定义

| 消息类型 | 粒子流向 | 前端唯一可信触发条件（基于轮询快照 Diff 与 `activity[]`） |
| :--- | :--- | :--- |
| `COMMAND` | `Lazy Boss → EmergentInc` | 新 `OwnerGoal` 创建、`specificationRevision` 增加、或老板刚刚通过对话提交了批准/控制指令 |
| `ASSIGN` | `EmergentInc → Task → AI Team` | `CompanyTaskNodeView` 从 `WAITING` 进入 `RUNNING/QUEUED`，或新增关联 `OwnerWorkTask` 绑定了 `personId` |
| `PROGRESS` | `AI Team → Task` | 关联 `OwnerPerson.running` 处于活跃执行、任务进度档位提升（如 `25% → 50% → 80%`）或新增中间产物 |
| `HANDOFF` | `AI Team A → AI Team B` | 后置节点 `nodeB.dependsOn` 包含前置节点 `nodeA.key`，且 `nodeA` 刚达到 `COMPLETED`（有真实 `latestEvidence`）、`nodeB` 被唤醒并分配给另一位真实 `personId` |
| `BLOCKER` | `Task / Team → EmergentInc → Lazy Boss` | 新增未解决的 `PENDING` 提案、`WAITING_RESOURCE`、`BLOCKED` 或 `alerts[]` 阻塞项 |
| `RESULT` | `Task → EmergentInc → Lazy Boss` | 节点达到 `100% (COMPLETED)`、产出新验证文件证据、商品成功上架（`Product updated`）或收到新链上付款（`Payment received`） |

**防伪造铁律**：
- **首次挂载只画静态拓扑**：页面初次加载（或切换浏览器标签页返回）只记录当前快照基线 `seenEventIds` 与节点状态快照，**绝不把历史 `activity[]` 当作实时粒子播一遍**。
- **轮询增量触发**：仅在后续 5 秒轮询发现新 `activity.id` 或节点状态发生实质跃迁时，沿对应 SVG `<path>` 发射单个粒子（单次飞行时长 `900ms`，同屏粒子上限 `12` 个）。
- **空闲与低动画尊重**：当公司处于 `STOPPED / PAUSED / IDLE` 且无新事件时，SVG 连线保持柔和静态虚线，零粒子运动；当系统开启 `prefers-reduced-motion: reduce` 或 `document.visibilityState === 'hidden'` 时，立即暂停粒子动画，仅更新文本状态。

## 3. 精确到文件的改造清单与实施细节

### 3.1 文件变更总览

| 操作 | 文件路径 | 核心职责与改动说明 |
| :--- | :--- | :--- |
| **新增** | `frontend/src/features/owner/ownerFlowProjection.ts` | 纯函数：将 `OwnerOverview` 投影为 `Goals`、五档进度 `Tasks`、动态 `AI Teams`、去重 `Blockers` 及 `MoneyROI` 指标 |
| **新增** | `frontend/src/features/owner/ownerFlowEvents.ts` | 纯函数与状态对比器：管理首次快照基线、轮询增量 Diff，生成 6 类真实 `FlowMessageEvent`（含真实 `HANDOFF` 校验） |
| **新增** | `frontend/src/features/owner/OwnerCompanyFlow.tsx` | `AI Company` 默认主画布组件：含顶部「搞钱 ROI 顶栏」、四列 SVG 消息流图、Task 极简卡、底部可验证事件条 |
| **新增** | `frontend/src/features/owner/OwnerTeamsView.tsx` | `AI Teams` 现代团队视图组件（替代直接跳 `/QIAN`）：展示真实员工卡片、当前负责的赚钱任务、招聘审批与创建入口 |
| **新增** | `frontend/src/features/owner/owner-flow.css` | Atomic Lattice 白底点阵画布样式、四列响应式布局、SVG 连线与粒子动画、极简卡片与上标样式 |
| **修改** | `frontend/src/Entry.tsx` | 当路径为 `/OWNER` 时，隐藏顶部旧的 `OWNER + Advanced (QIAN/YUAN/GENE)` 外部导航条，把顶栏完全交给 `OwnerConsole` |
| **修改** | `frontend/src/features/owner/OwnerConsole.tsx` | 升级为四导航（`Lazy Boss` \| `AI Company` \| `AI Teams` \| `Settings`）；默认落到 `AI Company`；兼容旧 hash 与深链 |
| **修改** | `frontend/src/features/owner/OwnerChat.tsx` | 强化 `Lazy Boss · Talk Only` 体验：空白态增加「3 条一键搞钱启动器」；移除底部冗余的 `<OwnerWork>` 列表展示 |
| **修改** | `frontend/src/features/owner/OwnerDashboard.tsx` | 作为 `Settings` 页签主体：保留预算配置、审批全集、商品/订单、收入图表、扩展与历史，并在底部新增 `Engine Internals`（收纳 `/QIAN`、`/YUAN`、`/GENE`、`:8766` 链接） |
| **修改** | `apps/server/src/services/owner_chat_service.ts` | 在 `route()` 系统提示词中增加 1 句变现结果导向约束（优先拆解为可售卖商品 `product.json` 或可验证产物文件） |
| **修改** | `frontend/src/i18n/en.ts` & `frontend/src/i18n/zh-CN.ts` | 同步新增所有 V33 导航、ROI 顶栏、五档进度、搞钱启动器、团队页及 Settings 文案，确保双语 100% 对齐 |
| **修改** | `frontend/tests/owner_console.test.tsx` & `owner_dashboard.test.tsx` | 保持既有回归全部通过，并新增 `frontend/tests/owner_company_flow.test.tsx` 覆盖 V33 全部投影、去重、导航与动画边界 |
| **修改** | `README.md` & `README_CN.md` & `docs/guides/OWNER_GUIDE.md` | 更新为 `Lazy Boss & Living AI Company` 主叙事（英文优先，中英同步），弱化旧玄学概念，突出搞钱闭环 |

### 3.2 新增 `frontend/src/features/owner/ownerFlowProjection.ts` 详细规范

该文件必须为 **100% 纯函数（无 DOM / React 依赖）**，导出以下核心结构与函数：

1. **`projectCompanyFlow(data: OwnerOverview, selectedGoalId?: string): CompanyFlowProjection`**：
   - **`goals: ProjectedGoal[]`**：
     - 遍历 `data.goals ?? []`，关联 `data.taskPlans?.find(p => p.goalId === g.id && p.goalRevision === g.specificationRevision)`。
     - 派生 `goalMode: 'ongoing' | 'one_off' | 'unknown'`：若已存在 `plan` 且任一 `node.trigger.kind !== 'once'`，则为 `'ongoing'`；若 `plan` 所有节点均为 `'once'`，则为 `'one_off'`；若尚无 `plan`，则为 `'unknown'`。
     - 选择当前观察的 `activeGoal`：若传入 `selectedGoalId` 且存在于 `goals` 中则选中；否则优先选第一个处于 `'RUNNING' | 'READY' | 'WAITING_APPROVAL' | 'WAITING_RESOURCE' | 'BLOCKED'` 的 Goal；若都已结束则选最近更新的 Goal。
   - **`moneySummary: MoneyROISummary`**：
     - `authorizedCny`: `(data.budget?.totalMicros ?? 0) / 1_000_000`
     - `spentCny`: `(data.budget?.spentMicros ?? 0) / 1_000_000`
     - `availableCny`: `(data.budget?.availableMicros ?? 0) / 1_000_000`
     - `verifiedRevenue`: 按币种聚合 `data.revenue ?? []` 的已核验真实总额（如 `USDT` 合计金额与笔数）。
     - `publishedProductCount`: `data.storefront?.products.filter(p => p.enabled).length ?? 0`
     - `paidOrderCount`: `data.storefront?.orders.filter(o => o.status === 'PAID').length ?? 0`
   - **`tasks: ProjectedFlowTask[]`**：
     - 针对当前 `activeGoal`：
       - 若存在对应的 `CompanyTaskPlanView`，按 `plan.nodes` 顺序映射每个逻辑节点。
       - 复合稳定键：`id = "${goal.id}:r${goal.specificationRevision}:p${plan.planRevision}:${node.key}"`。
       - 关联该 Goal 下的 `work.tasks`（通过 `personId` 或执行顺序匹配）以辅助判断第 2/3/4 档进度。
       - 按 §1.2 五档确定性规则计算 `progressPercent: 0 | 25 | 50 | 80 | 100 | null` 及 `stageKey`。
       - 若 `activeGoal` 尚无 `CompanyTaskPlanView`（如旧任务或刚立项待批计划），但有关联的 `work.tasks`，将关联 `work.tasks` 映射为 Task 卡；若连 `work.tasks` 也没有，生成一个代表目标本身的阶段卡（如等待批准计划显示 `0%` + 问题上标 `①`）。
     - 排序与折叠：优先排 `blockerCount > 0`、`RUNNING`、`QUEUED` 的节点，其次排最近完成节点；导出 `visibleTasks`（前 6 项）与 `hiddenTaskCount`（超出部分 `+N`），同时保留完整 `allTasks` 供展开查看。
   - **`teams: ProjectedFlowTeam[]`**：
     - 基于当前 `activeGoal` 下的 `tasks` 实际关联的 `personId` 与 `data.people` 组装。
     - 每个被分配了至少一个当前 Goal 任务的真实 `OwnerPerson` 生成一个 Team 节点（若同一节点或相邻依赖由多人协作，标记协作关系；若单人负责，标记 `mode: 'solo'`；若某 Task 尚无 `personId` 或处于招聘等待，生成一个虚线占位状态卡 `unassignedCount`，绝不编造假名字）。
   - **`blockers: ProjectedBlocker[]`**：
     - 按 §1.3 规则从 `proposals`、`inbox`、`alerts` 及节点 `BLOCKED / WAITING_RESOURCE` 状态提取并按底层实体去重。
     - 区分 `taskBlockers`（精确挂在某 Task 卡右上角的上标数字）与 `globalBlockers`（挂在顶栏与 `Lazy Boss` 节点上的全局待拍板事项，如公司预算耗尽、版本维护或未绑定特定节点的提案）。

### 3.3 新增 `frontend/src/features/owner/ownerFlowEvents.ts` 详细规范

1. **快照基线与去重器 `FlowEventTracker`**：
   - 维护 `initialized: boolean`、`seenActivityIds: Set<string>`、`prevTaskStates: Map<string, { state: string; progress: number | null; occurrences: number }>`、`prevGoalIds: Set<string>`。
   - **首次调用 `ingest(overview, projection)`**：
     - 将当前 `overview.activity.map(a => a.id)` 全部写入 `seenActivityIds`，记录所有 Task 与 Goal 当前状态，`initialized = true`，返回空数组 `[]`（**确保首次加载、刷新页面或切换 Goal 时零假粒子播放**）。
   - **后续轮询调用 `ingest(overview, projection)`**：
     - 识别 `overview.activity` 中不在 `seenActivityIds` 内的新事件，以及 `projection.tasks` 中状态/进度发生真实跃迁的节点：
       - 新 Goal 或新 `task_plan` 提案生成 → 产出 `COMMAND`（`boss -> company`）。
       - Task 从 `0%` 进入 `25% / 50%` 且有真实 `personId` → 产出 `ASSIGN`（`company -> task -> team`）。
       - Task 处于 `50%` 且对应人物 `running === true`，或进度从 `25% -> 50% -> 80%` → 产出 `PROGRESS`（`team -> task`）。
       - 前置节点 `A` 刚变为 `100%` 且存在真实 `latestEvidence`，同时依赖 `A` 的节点 `B` 进入 `25% / 50%` 且 `personA !== personB` → 产出 `HANDOFF`（`teamA -> teamB`）。
       - 新增未解决的 `ProjectedBlocker` → 产出 `BLOCKER`（`task/team -> company -> boss`）。
       - Task 刚变为 `100%`、或新增 `Payment received` / `Product updated` 活动 → 产出 `RESULT`（`task -> company -> boss`）。
     - 每次最多返回 12 条新粒子事件，防止网络恢复时动画拥塞。

### 3.4 修改 `frontend/src/Entry.tsx` 与 `frontend/src/features/owner/OwnerConsole.tsx`

1. **`Entry.tsx` 瘦身**：
   - 当路径匹配 `/^\/owner\/?$/i` 时，不再在 `OwnerConsole` 上方额外渲染旧的 `<nav className="owner-page-switch">OWNER | Advanced (QIAN / YUAN / GENE)</nav>`，避免出现双层顶栏和 `QIAN / YUAN / GENE` 黑话暴露。
   - 将 `<LanguageSwitch />` 优雅集成进 `OwnerConsole` 顶栏右侧；非 `/OWNER` 的后台路径（直接访问 `/QIAN`、`/YUAN`、`/GENE` 时）仍保留原返回 `/OWNER` 的顶栏以确保既有测试兼容。
2. **`OwnerConsole.tsx` 四导航与深链兼容**：
   - 定义四页签类型：`type OwnerTab = 'lazy-boss' | 'ai-company' | 'ai-teams' | 'settings'`。
   - **路由与旧深链解析函数 `parseOwnerLocation()`**：
     - `#lazy-boss` 或旧 `#owner-chat` → `'lazy-boss'`
     - `#ai-teams` → `'ai-teams'`
     - `#settings` 或旧 `#owner-dashboard`、`#owner-activity`、`#owner-company-budget`、`?report=...`、`?automationReview=true` → `'settings'`
     - 默认无 hash/search、或 `#ai-company`、或旧 `#owner-goals`、或 `?goal=<id>` → **`'ai-company'`**（若 URL 带 `?goal=<id>`，同时将 `selectedGoalId` 设为该 `id`）。
   - **顶栏结构**：
     - 左侧品牌：`EmergentInc` + 副标 `Lazy Boss`。
     - 中间四个一级导航链接（带 `aria-current`）：
       1. `Lazy Boss`（副标 `Talk Only`，若全局或当前有待老板拍板事项，显示醒目上标）
       2. `AI Company`（副标 `Message Flow`）
       3. `AI Teams`（展现真实 AI 员工与协作，不再暴露 `QIAN` 字样）
       4. `Settings`（预算、商品订单、历史与底层引擎入口）
     - 右侧：语言切换 `<LanguageSwitch />` + 公司运行状态徽章 + `Start company / Pause company` 按钮 + `Refresh` 按钮（完全保留原 `/api/owner/automation` 幂等控制逻辑与 `owner_dashboard.test.tsx` 测试契约）。
   - **重要兼容细节**：
     - `OwnerChat` 组件保持挂载并通过 `hidden={tab !== 'lazy-boss'}` 切换显示，确保切换页签时**绝不丢失正在输入的草稿、本地历史和未决 `requestKey`**。

### 3.5 新增 `frontend/src/features/owner/OwnerCompanyFlow.tsx`（AI Company 默认主画布）

组件由上至下分为三个清晰区域：

1. **顶部：搞钱 ROI 顶栏（Money & Outcome Bar）**
   - **Goal 选择器**：下拉框切换当前观察的 `OwnerGoal`（显示标题 + `[Ongoing]` / `[One-off]` 徽章 + 当前状态）。若公司尚无任何 Goal，显示清晰引导：“还没有经营目标。去 Lazy Boss 说出你想怎么赚钱。”并提供一键切换按钮。
   - **核心搞钱指标卡（4 格紧凑指标）**：
     - **已验证收入（Verified Revenue）**：显示链上已确认收入（如 `0.00 USDT` 或实际金额）及独立站已付款订单数。
     - **独立站商品（Live Products）**：显示已上架商品数（带直达 `/` 商城链接）。
     - **公司预算（Company Budget）**：显示 `可用 ¥X.XX / 已花 ¥Y.YY`（若未授权预算，显示醒目提示按钮直达 Settings 预算设置或 Lazy Boss）。
     - **需老板拍板（Needs Boss）**：显示去重后的总待办数 `①`；点击直接切到 `Lazy Boss` 处理。
2. **中部：四列 Atomic Lattice 消息流画布（Message Flow Canvas）**
   - 背景采用克制的白底圆点矩阵（`radial-gradient(#cbd5e1 1px, transparent 1px)`，`background-size: 20px 20px`）。
   - 底层铺设响应式 SVG 画布，绘制四列之间的平滑贝塞尔曲线（`Boss ⇄ EmergentInc ⇄ Tasks ⇄ Teams`），并在有真实增量事件时沿路径渲染流动粒子 `<circle>`。
   - **第 1 列 `Lazy Boss · TALK ONLY`**：显示老板头像/标识、当前待拍板问题总数，以及 **`Speak to EmergentInc` / `向公司下达指令`** 按钮（点击切换到 `Lazy Boss` 页签并聚焦输入框）。若有待审批的 `CompanyProposalCard`（如计划批准、结案批准），可在此直接点击批准或去对话处理。
   - **第 2 列 `EmergentInc · Coordinator`**：显示公司引擎状态（`RUNNING` / `IDLE` / `PAUSED` / `MAINTENANCE`）、当前调度的活跃节点数与在岗 AI 员工数。
   - **第 3 列 `Tasks × N`（极简任务卡列表）**：
     - 每张卡片严格只展示三要素：
       1. **任务简名**（`node.title`）+ 周期标记（若为周期任务则标 `↻ #N`）
       2. **右上角问题上标**（如 `①`，仅在该 Task 有未决阻塞/审批时渲染，点击展开阻塞原因并可跳 `Lazy Boss`）
       3. **进度条与五档百分比**（`0%` / `25%` / `50%` / `80%` / `100%` + 对应阶段简述）
     - 点击任意 Task 卡片可在画布下方或抽屉中查看该节点的真实交付物证据（复用 `TaskEvidence` 下载链接与 SHA256 校验）及指令详情。
     - 超过 6 个节点时显示 `+N more tasks` 展开按钮。
   - **第 4 列 `AI Teams × N`（动态团队列）**：
     - 展示当前 Goal 下实际参与的 AI 员工节点（显示姓名、职责标签、`Executing now / Standby` 状态点，以及与左侧对应 Task 的连线高亮）。
     - 单人执行标 `Solo execution / 独立执行`；多人参与同一 Goal/链路标 `Collaborative team / 协作团队`；若某任务缺人待招聘，显示虚线框 `Awaiting recruitment approval / 等待招募审批`。
3. **底部：可验证实时事件流（Verified Event Tape）**
   - 展示最近 6～10 条与当前 Goal 相关的真实持久化事件（附精确时间戳、事件类型徽章与原始记录跳转链接），满足无障碍阅读与审计追溯。

### 3.6 新增 `frontend/src/features/owner/OwnerTeamsView.tsx`（乔布斯式 AI Teams 页面）

当老板点击顶部第 3 个页签 **`AI Teams`** 时，在 `/OWNER` 内直接渲染现代化的 AI 员工花名册与能力中心：

1. **顶部摘要栏**：显示在岗 AI 员工总数、当前正在执行任务的员工数、待审批的招募提案数。
2. **待批准招募区（若有 `work.requests` 处于 `PENDING`）**：直接在顶部展示招募审批卡（说明缺什么角色、为什么要招、招来干什么具体任务，支持一键批准/拒绝，复用既有 `recruit_approve / recruit_reject` 接口）。
3. **AI 员工能力卡片网格（遍历 `data.people`）**：
   - 每张卡片展示：**员工姓名**、**职责定位（`role`）**、**当前状态徽章（`Executing now` / `Standby`）**、**擅长特征标签（`behaviorProfile`）**。
   - **当前手头活计**：列出该员工当前绑定的 Goal 与 Task 名称及进度百分比。
   - **累计工作统计**：展示进行中任务数、待跟进数、已提交待验收回复数。
   - **深度工作台入口（弱化收納）**：卡片右下角提供低调的次级链接 `Open agent workspace / 打开员工工作台`（链向 `/QIAN?qianji=${person.id}`），既让老板在 `/OWNER` 内一站式看清所有团队，又保留了进入底层详情的通路。

### 3.7 修改 `frontend/src/features/owner/OwnerChat.tsx`（内置 3 条一键搞钱启动器）

1. **空白态「一键搞钱启动器（Money-Making Starters）」**：
   - 当 `missionControl === true` 且 `messages.length === 0` 时，除了简短说明外，渲染 3 个可点击的快捷指令卡片（点击后将对应文案填入输入框 `draft` 并聚焦，老板可微调或直接按回车发送）：
     - **卡片 1 · 造品上架收款（Digital Product Storefront）**：
       - 中文：`帮我调研当前高需求的技术或商业痛点，制作一份高价值数字指南商品并直接上架到公开商城，定价 19.9 USDT。`
       - 英文：`Research a high-demand technical or business pain point, create a digital guide product, and publish it to our storefront at 19.9 USDT.`
     - **卡片 2 · 持续引流变现（Ongoing Growth & Conversion）**：
       - 中文：`每天早上 09:00 分析我方商城商品卖点，产出一篇高转化海外推广文案与落地页优化方案，持续帮公司获取客户。`
       - 英文：`Every day at 09:00, analyze our storefront products and produce a high-conversion marketing post and landing page optimization plan to attract customers.`
     - **卡片 3 · 预算内首单冲刺（First-Revenue Sprint）**：
       - 中文：`盘点公司现有 AI 团队与技能，为我策划并执行一套最快能赚到第一笔真实收入的闭环方案，完成可交付产物后向我汇报。`
       - 英文：`Audit our existing AI team and skills, then plan and execute the fastest closed-loop strategy to earn our first verified revenue.`
2. **移除底部冗余的 `<OwnerWork work={work} />`**：
   - 原 `OwnerChat.tsx` 第 131 行在聊天框下方硬塞了 `<OwnerWork work={work}/>`（把所有派工记录、招聘请求和代码报告全堆在聊天框底下），这严重破坏了 `Lazy Boss · TALK ONLY` 的纯粹性。将其从 `OwnerChat.tsx` 移除（因为审批已内嵌在对话消息卡中，且 `AI Teams` 与 `Settings` 已完整承载对应视图）。

### 3.8 修改 `frontend/src/features/owner/OwnerDashboard.tsx`（收敛为 Settings 与高级中心）

1. `OwnerDashboard` 继续保留其全部现有子模块（以保证所有直接渲染 `<OwnerDashboard />` 的既有单元测试 100% 通过），并在 `OwnerConsole` 中挂载在 **`Settings`** 页签下。
2. 在 `OwnerDashboard.tsx` 底部新增一个折叠面板 **`Engine Internals & Advanced Entrypoints` / `底层引擎与高级入口`**：
   - 收纳通往 `/QIAN`（Talent Roster / 人物档案）、`/YUAN`（Cell Runtime / 运行工作间）、`/GENE`（Evolution & Storefront Config / 演化与站点配置）以及 `http://127.0.0.1:8766`（Software Upgrade / 版本发布服务）的入口链接。
   - 这样既实现了主界面 100% 剃骨去黑话，又做到了高级能力零丢失。

### 3.9 微调 `apps/server/src/services/owner_chat_service.ts`（强化搞钱结果导向）

在 `apps/server/src/services/owner_chat_service.ts` 第 37–45 行的 `route()` 系统提示词中，追加一句明确的结果导向原则（不改变 JSON schema 与安全边界）：
- 在 `明确的任务应生成计划，人物与资源由AI协调。` 后补充：`当老板提出赚钱、营收、开店、变现或业务增长目标时，必须将计划节点拆解为可实际产出的数字商品草稿、站内商品配置（product.json）或可核验的商业交付物，严禁只规划空洞的口头分析步骤。`

## 4. 实施阶段与验证步骤（Checklist）

### 阶段 1 · 纯函数投影与事件引擎（P0 核心）
- [ ] 创建 `frontend/src/features/owner/ownerFlowProjection.ts`，实现 `projectCompanyFlow()`、五档确定性进度计算、`Ongoing / One-off` 判定、Team 动态组装与 Blocker 严格去重。
- [ ] 创建 `frontend/src/features/owner/ownerFlowEvents.ts`，实现 `FlowEventTracker` 快照基线初始化与 6 类真实事件（`COMMAND` / `ASSIGN` / `PROGRESS` / `HANDOFF` / `BLOCKER` / `RESULT`）增量识别。
- [ ] 编写单元测试验证：同名 Goal/Task 不混淆、五档进度准确、周期任务新一轮不沿用旧 100%、首次加载不播历史粒子、无真实交接证据不播 `HANDOFF`。

### 阶段 2 · 四导航、AI Company 主画布与 AI Teams 视图（P0/P1 界面剃骨）
- [ ] 创建 `frontend/src/features/owner/owner-flow.css`，实现 Atomic Lattice 点阵白底、四列布局、SVG 连线与粒子动画、响应式窄屏折叠及 `prefers-reduced-motion` 降级。
- [ ] 创建 `frontend/src/features/owner/OwnerCompanyFlow.tsx`，实现顶部「搞钱 ROI 顶栏」、四列节点画布、Task 极简卡与证据抽屉、底部可验证事件条。
- [ ] 创建 `frontend/src/features/owner/OwnerTeamsView.tsx`，实现 `/OWNER` 内置的现代化 AI 员工能力与招募中心。
- [ ] 更新 `frontend/src/features/owner/OwnerChat.tsx`，加入 3 条「一键搞钱启动器」并在 `missionControl` 模式下保持纯对话界面。
- [ ] 更新 `frontend/src/features/owner/OwnerDashboard.tsx` 与 `OwnerConsole.tsx`、`frontend/src/Entry.tsx`，完成四导航（默认 `AI Company`）、旧 hash/search 深链兼容及顶栏去黑话改造。
- [ ] 更新 `frontend/src/i18n/en.ts` 与 `frontend/src/i18n/zh-CN.ts`，确保所有新增键值中英文完全对齐，无硬编码遗漏。

### 阶段 3 · 提示词微调、测试回归与文档收口（P2 交付）
- [ ] 微调 `apps/server/src/services/owner_chat_service.ts` 的 `route()` 提示词，强化商业变现产物导向。
- [ ] 更新 `frontend/tests/owner_console.test.tsx`、`frontend/tests/owner_dashboard.test.tsx`（适配默认页签与保留的兼容选择器），并新增 `frontend/tests/owner_company_flow.test.tsx`。
- [ ] 更新 `README.md`（英文主叙事）、`README_CN.md`（中文说明）与 `docs/guides/OWNER_GUIDE.md`，统一为 `Lazy Boss & Living AI Company` 叙事。
- [ ] 在仓库根目录依次执行以下验证命令并确保全部通过：

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm --dir frontend test
pnpm --dir frontend build
pnpm test
git diff --check
```

## 5. 验收红线（10 秒乔布斯测试）

改造完成后，打开 `/OWNER` 必须同时满足以下 6 条硬标准：

1. **零玄学黑话污染**：主界面上看不到任何 `QIAN / 千机阁 / YUAN / 元胞 / GENE / 基因 / Pixel` 字样，只有 `Lazy Boss | AI Company | AI Teams | Settings`。
2. **3 秒看清搞钱账本**：在默认的 `AI Company` 顶栏一眼看到当前赚钱 Goal、已花人民币成本、已赚链上 USDT 收入与已上架商品数。
3. **Task 极简且进度真实**：每张 Task 卡片只有名称、五档真实进度条（`0% / 25% / 50% / 80% / 100%`）和去重后的问题上标 `①`，绝无满屏状态码和折叠表单。
4. **动静分明的生命感**：有真实派单、推进、交付或阻塞时，SVG 路由线上有克制的粒子流动；公司空闲或暂停时画面安静稳定，绝不跑假流量。
5. **老板只需动嘴**：点进 `Lazy Boss` 有 3 条一键搞钱启动器，下达目标、批准计划、处理阻塞和结案全部可以在纯对话内闭环。
6. **既有安全与测试零退化**：统一公司金额预算、未决调用阻断、链上收款、版本升级服务（`:8766`）以及全套前后端测试 100% 绿灯通过。
