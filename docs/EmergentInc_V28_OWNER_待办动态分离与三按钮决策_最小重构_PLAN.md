# EmergentInc V28 — OWNER 待办/动态分离与三按钮决策 · 最小执行 PLAN

> 交付对象：本地 Codex / 开发 Agent  
> 基线核查：GitHub `lx00018310/EmergentInc` 公开主分支 `43790ffd8240456527540a1728075811057475ed`（V25，2026-10-07）；V26 / V27 可能尚未推送，**执行前以本地最新代码和实际已批准 Release 为准**，先核查差异并增量改造，勿覆盖 V26 / V27。  
> 目标版本：**V28**  
> 原则：最小更改、真实执行、可追溯、零虚构按钮；不改 Pixel / World / Gene 的运行定义。  
> 本文件为执行指导，不代表已修改仓库或完成测试。

---

## 0. 先说清楚预期效果

`/OWNER` 页面将当前“待办 + 动态同时显示的双栏”改成**两个互斥视图**：

- `/OWNER#owner-inbox`：**只显示待办视图**（真正待 Owner 决策的条目），不渲染动态列表。
- `/OWNER#owner-activity`：**只显示动态视图**（已发生的事件、提示和状态变化），不渲染待办列表。
- 页面标题、必要的总览状态、Owner Chat 可继续作为两种视图共用的顶部区域；**两个列表内容必须互斥**。不为此另造路由系统。
- 默认首次进入 `/OWNER` 或未知 hash → `#owner-inbox`；从动态切回待办不丢失数据，也不重复提交动作。
- 每条**真正可决策**的待办必须有且仅有三个一级入口：**同意、拒绝、详情**。同意和拒绝按钮旁或下方必须**直接可见**具体后果，不能藏在 `<details>` 才能看到；详情直达关联对象。
- 用户点击“同意”或“拒绝”后**立即发起一次对应已授权的真实操作**，不再要求展开卡片、勾选 checkbox 或二次确认；执行期间防双击、完成后刷新、出错时保留条目并明确报错。

**重要定义：**“有问题需要查看”不一定等于“已经具备可安全一键批准/拒绝的决策”。为了不虚构操作，V28 将待办限定为已有真实正反决策接口的事项；运行恢复、外部结果未知、软件发布等不得硬套“同意/拒绝”。这些异常仍必须在两视图共用的显著风险提示区和动态中可见，带直达详情链接，绝不可静默隐藏或假装已解决。未来真正具有安全、对称且受控的决策接口，再准入待办。

## 1. 已核查的现状及最小改动面

| 当前文件 | 实际情况 | V28 要改的点 |
|---|---|---|
| `frontend/src/features/owner/OwnerConsole.tsx` | 统一拉取 `/api/owner/overview`，5 秒轮询；Owner Chat 在上方，`OwnerInbox` 与 `OwnerActivity` 双栏同时显示 | 增加 hash 驱动的互斥 tab，保留现有轮询与 Chat |
| `frontend/src/features/owner/OwnerInbox.tsx` | 每条有详情；仅部分 item 附带提案，需展开 `<details>` 才能进一步操作 | 统一展示同意/拒绝/详情三入口以及各自效果 |
| `frontend/src/features/owner/OwnerActionCard.tsx` | 通用动作卡还要手动勾选再按 Confirm；包含人际群发、业务、资源动作 | **只对 Inbox 的直接按钮**改为单击执行；保留 Owner Chat 中原有高风险确认路径，不连带删除 |
| `frontend/src/features/owner/OwnerActivity.tsx` | 单纯展示动态时间线 | 独立动态视图；保持只读，不混入待办按钮 |
| `frontend/src/api/owner.ts` | 已封装 `executeOwnerAction`，业务方案与资源调用既有 API，聊天有重试键 | 复用执行器，按需追加 Gene 方向决策；不写万能 action dispatcher |
| `packages/protocol/src/types/owner.ts` | InboxItem 的 `actions?` 可缺失；Run、外部异常、升级也混入 Inbox | 增加最小的正反后果文本；统一待办的可执行性约束，保留旧 ActionProposal 类型以兼容 Owner Chat |
| `apps/server/src/services/owner_overview_service.ts` | 混合 Gene、Plan、Resource、Run、External、Upgrade；Gene/Run/External/Upgrade 多数没有正反动作 | 在投影阶段区分 **可决策待办** 与 **需人工核实告警**；Gene 补齐方向决策提案 |
| `apps/server/src/routes/evolution_routes.ts` | `POST /evolution/proposals/:id/decision` 支持 `APPROVED/REJECTED`；批准 Gene 方向可触发后续构建，但**不是直接发布** | 复用既有处理路径；以最小守卫校验当前提案与 generation，避免陈旧页面误操作 |
| `frontend/src/features/business/BusinessHome.tsx` | `/GENE?view=plans&id=`、`?view=resources&id=` 已有 tab 切换与滚动锚点；Gene proposal 展示在生命层的可展开 `<details>` | 确保详情 URL 真能展开并聚焦唯一对象，最少补 `?view=life&id=` 的 Gene 定位 |
| `frontend/src/features/owner/owner.css` | `.owner-columns` 为双栏布局 | 改成单个内容区 + tab + 三按钮横排/移动端堆叠 |
| `frontend/tests/owner_console.test.tsx` 及服务端 Owner 测试 | 旧测试断言 Inbox、Activity 同时展示 | 更新并增加互斥、即时决策、陈旧请求、深链接、回归测试 |

**接口/安全边界不得变更：**主服务仍是 8765；8766 是独立可信升级服务，未经其明确审批及准确候选哈希校验，不得让 `/OWNER` 直接发布；不增加任意 shell/Git/writefile API；不改现有业务准入、预算、回退、World 隔离规则。

---

## 2. 目标页面交互：单视图，而不是双栏

```text
/OWNER
┌──────────────────────────────────────────────────────────────────┐
│ OWNER Mission Control        当前代 Gxxxx  |  需要处理 N  | 状态 │
│ [待办 N]  [动态]                                        中文 / EN │
├──────────────────────────────────────────────────────────────────┤
│ （共用的 Owner Chat：维持现有位置与独立确认规则）                  │
├──────────────────────────────────────────────────────────────────┤
│ #owner-inbox 时：                                                │
│  方案：批准本次客户调研预算                                        │
│  同意后：授权该版本预算与列出的任务，可能触发真实外部写入           │
│  拒绝后：终止该待审批方案，不运行该版本                           │
│  [同意]    [拒绝]    [详情]                                     │
│                                                                  │
│ #owner-activity 时：                                             │
│  只展示时间线 / 来源 / 时间 / 详情链接                            │
│  （上述待办卡在此模式完全不渲染）                                 │
└──────────────────────────────────────────────────────────────────┘
```

### 2.1 标签导航与 Hash 规则

1. 两个 button/tab：`待办 (N)`、`动态`，使用 `role="tablist"`、`role="tab"`、`aria-selected`、`role="tabpanel"`，键盘可操作；单 tabpanel 即可，只渲染选中组件。
2. 可分享 URL：`/OWNER#owner-inbox` 与 `/OWNER#owner-activity`。初始化读取 hash；切换时更新 hash，响应 `hashchange` / 浏览器后退前进；未知 hash 安全回落待办。
3. Hash 不当作服务器授权信息，`/api/owner/overview` 不用因为切 tab 重新设计请求；原有 5 秒轮询保持。
4. 切换时保留 Chat 内容和总体摘要，不得把 Owner Chat 消息混到 Activity；两个栏目切换后的滚动/焦点要可用。
5. 多语言：中英 tab、按钮、后果说明、空态、处理中、失败状态均完整翻译。保留项目现有 i18n 模式，不新引国际化库。
6. 页面 DOM 的 `id="owner-inbox"`、`id="owner-activity"` 只用于互斥面板/锚点；原 `.owner-inbox` / `.owner-activity` CSS 类保留，防止现有样式和测试回归。不要在隐藏面板里继续保留可操作按钮。

### 2.2 待办卡的固定信息与三入口

每张卡固定显示：

- 标题、来源人物/World、时间、优先级、简短事实摘要。
- **同意效果**：具体到目标、版本、预算、是否可能对外发送/修改、后续状态。
- **拒绝效果**：具体到终止/撤销/拒绝范围，影响哪些关联任务。
- 三个直观可点击控件：`同意`、`拒绝`（button），`详情`（安全的同源链接；必要时合法的独立 8766 链接用于**告警**，不是待办）。

建议最小类型增量（具体可按现有类型风格调整，不做大规模迁移）：

```ts
// 只准入具有成对真实动作的 Inbox 项；不在前端凭 type 猜接口。
interface OwnerInboxItem {
  // 保留原字段 id / type / title / summary / priority / createdAt / source / href
  actions: OwnerActionProposal[];  // 在待办投影中恰好两个可执行正反提案
  approveEffect: string;           // 服务端生成真实的“同意之后”效果
  rejectEffect: string;            // 服务端生成真实的“拒绝之后”效果
}
```

可以保留 `actions?` 以减少其他类型改动，但**OwnerInbox 只接受 actions 可验证为一对、效果文案非空的条目**。不允许以 `open_details`、`qianji_chat` 伪装同意/拒绝。

按钮的 proposal.id 必须绑定明确目标及期望修订号/hash/代际；**点击使用当前卡片原始绑定快照**，服务器再次校验。错误提示不允许显示为“成功”。

---

## 3. 决策语义矩阵：每个按钮到底做什么（核心验收）

| 类型 | 同意：一键执行的真实操作 | 拒绝：一键执行的真实操作 | 详情 | 关键约束 |
|---|---|---|---|---|
| **经营方案 `plan`** | `POST /api/business/plans/:id/approve`，精确绑定 `revision + hash`；授权**该版本**约定的预算、任务、排期和允许的外部动作。服务可能随后调度执行 | `POST /api/business/plans/:id/revoke`，精确绑定 `revision + hash`；停止该待审批版本，不再批准其任务 | `/GENE?view=plans&id=<planId>` | 显示预算、计划目标、外部写入可能性、授权期限；不可将“批准”描述成“已完成销售” |
| **资源请求 `resource`** | `POST /api/business/requests/:id/decision`，`decision:'provided'`；仅**确认已经真实存在**且通过现有服务器检查的 dataset/connection 等资源，待齐备时允许任务继续 | 同接口 `decision:'reject'`；现有实现会 revoke 关联计划，必须直接写清**会停止整份方案**而非仅放弃一条资料 | `/GENE?view=resources&id=<requestId>` | 带 `planId + revision` 并明确 note；若资源未提供、无可验证证据、`task:` 恢复类请求，**同意不可伪造为已提供**，转入人工核实/详情区，不放入可双向一键处理的 Inbox |
| **Gene 方向提案 `gene`** | `POST /api/evolution/proposals/:id/decision`，`decision:'APPROVED'`；**仅批准方向**，按现有流程可能创建后续 Candidate；绝不表示已发布/已换代 | 同接口 `decision:'REJECTED'`；拒绝该 Gene 方向，停止其当前推进 | `/GENE?view=life&id=<proposalId>` | 决策前服务端校验该提案仍在当前 Generation、状态仍 `PROPOSED`；调用既有 `beforeProposalDecision` / `onProposalApproved`，不跳过资产隐私与权限审查 |
| **运行异常 `run`** | **V28 不提供虚假的一键同意**，因恢复选择与账务、未知外部动作有关 | **V28 不提供虚假的一键拒绝**；不将拒绝误写成“问题解决” | `/YUAN?world=<id>`，尽量锚定 Run/Recovery | 从 Inbox 改为显著未解决告警 + Activity，现有恢复入口继续人工核验 |
| **外部结果未知 `external`** | **不直接认定已发生**，因为核实需要外部证据、金额或状态 | **不直接认定未发生**，不可自动重试外部写入 | `/GENE?view=business`，尽量定位 operation/task | 保留未决状态、审计和风险提示；不得自动重试或“拒绝即删除” |
| **软件升级 `upgrade`** | **不在 /OWNER 中直接审批或发布**；坚持 8766 的准确候选 hash 审批链 | **不在 /OWNER 中伪造拒绝发布操作** | `http://127.0.0.1:8766/`（实际使用已配置可信升级 Origin） | 从可决策 Inbox 移到显著发布提示/Activity；真实批准和回退仍在独立升级服务 |
| **任务恢复 `task:`** | 只有确认该任务为可安全重试的纯数据任务且现有接口满足条件后，才可另行补一对完整决策；**V28 不扩范围** | 不得以拒绝资源假装任务恢复完成 | `/GENE?view=resources&id=<requestId>` | 维持原专用恢复表单，不自动重发 GitHub 等外部操作 |

**一键的定义**：对于第一批准入的 `plan`、**可核验** `resource`、`gene`，点击按钮只触发一次网络请求，无额外确认弹窗、复选框或抽屉。**它不等于保证业务执行已经完成**。需区分“动作请求已被接受”“决策成功提交”“后续任务已完成”。

**风险显示不可省略**：经营方案同意会授权预算及可能触发外部写入；Gene 方向同意只影响提案方向，后续候选审批仍独立；资源拒绝会终止整个相关计划。所有效果文字必须与真实代码相符，不能简单写“同意后开始执行”。

---

## 4. 后端投影最小收敛（不新增任务状态机）

### 4.1 只把具备正反执行能力的记录送进 `inbox`

在 `OwnerOverviewService.overview()` 中：

1. `plan`：沿用已存在的两条 action proposal；补效果说明，确认待审批状态、新鲜 revision/hash。
2. `resource`：沿用正反 proposal；在确认资源具有可信的现有“已提供”证据/可验证路径后才纳入**直接决策**待办。`task:` 和无法核实的资源保留在告警区域与动态，不得因为隐藏而丢失。
3. `gene`：为 `PROPOSED` 的当前代提案补两条类型明确的 `gene_proposal_approve` / `gene_proposal_reject` proposals，绑定 `id + generationId + expectedState='PROPOSED'`；带 reason/effect 供详情及概述展示。
4. 其他 `run`、`external`、`upgrade` 不再混入“每条都必须能作对称决策”的 Inbox。
5. `summary.inboxCount` = **真正的待决策数**，不能把无操作的提醒凑成待办。

### 4.2 未决风险不能被过滤消失

用最小方式从既有真实投影保留异常：

- 在 `OwnerOverview` 追加轻量 `alerts?: {id;kind;severity;title;summary;href;createdAt}[]`，最多合理数量（比如 20），不新增 DB；由原有 `run`、`external`、`upgrade` 及不可立即批准的资源/任务产生。
- 两种 tab 上方共享一个小型、**显著且可点**的“需要人工核实 N 项”区域（非行动按钮的第二个 Inbox）；严重/结果未知状态持续显示，附对应详情链接。
- 同一事件可在 Activity 时间线表示历史变化，但**仅 Activity 不足以代表未解决的告警**；告警应随底层未解决状态持续存在，解决后自动消失。
- 未配置/断开的业务或升级数据源必须报告不可用，不得显示“0 条待办 / 一切正常”。
- 不为这些告警建立新审批接口、自动恢复、标记已解决或“稍后提醒”数据库。

### 4.3 Gene 批准的陈旧保护

优先给现有 `/api/evolution/proposals/:id/decision` 加**向后兼容**的可选期望条件（仅 V28 新按钮传入）：

```json
{
  "decision": "APPROVED",
  "expectedGeneration": "Gxxxx",
  "expectedState": "PROPOSED"
}
```

服务端在变更前校验：提案存在、状态符合、绑定当前有效 generation，审批来源仍经过原有 owner-auth / 权限边界；不允许通过自报的 ID/状态提升权限。对现有 GENE 页面原请求保持兼容，不改变其业务逻辑。**若现有 decideProposal 已具备同等原子检查，直接复用，不重复造状态机。**

核查既有路由是 `decideProposal` 后调用 `onProposalApproved`，若后续候选准备失败，必须确保 UI 不把它误报成完全未批准；最小做法是返回/读取最新提案状态并准确呈现部分完成，不隐式重试；如已有可靠事务/恢复机制，复用它。

### 4.4 执行后真实刷新

- 服务端维持原有 API 结果；前端只在后端成功回应时标示“已同意/已拒绝”，随后 `fetchOwnerOverview` 刷新，条目因状态改变自然从 Inbox 消失；记录可在 Activity 查看。
- HTTP 超时/连接断开属于**结果未知**：不自动重试；重新拉取当前版本状态核验，必要时引导“详情”。
- 请求失败、状态变更冲突（409）、权限失效（401/403）时卡片仍存在或按最新状态更新，显示可理解原因，绝不能乐观移除。
- 点击时禁用该行两种决策，避免并行相反决策；首次响应未返回前禁止再次点击。同一对象多个浏览器的竞态由服务端状态 + revision/hash 校验挡住。

---

## 5. 前端实现顺序（尽量只动现有组件）

### S1 — 两个互斥标签页

**改动：**`OwnerConsole.tsx`、`OwnerInbox.tsx`、`OwnerActivity.tsx`、`owner.css`，必要时 i18n 文件。

1. 新增 `activeTab: 'owner-inbox'|'owner-activity'` 状态及 hash 同步辅助函数（内联即可）。
2. 在原来 `<div className="owner-columns">` 的位置放 tab 导航及**一个**内容面板：activeTab 决定渲染 OwnerInbox 或 OwnerActivity。
3. 保持 OwnerChat、总体状态、五秒轮询不变。可以默认看待办，动态按需切换。
4. 处理无数据、源不可用、告警、移动端和中英文。

**S1 验收：**打开两个 hash URL 只显示对应的一个列表；浏览器返回键正确；无重复卡片和空白列表错位。

### S2 — 三按钮 + 真实执行

**改动：**`OwnerInbox.tsx`、`frontend/src/api/owner.ts`、`packages/protocol/src/types/owner.ts`、`owner.css`，必要时 `OwnerActionCard.tsx` 只抽取公用小函数而不改变 Chat 审批体验。

1. 每个待办直接显示：事实摘要、同意效果、拒绝效果、`同意/拒绝/详情` 三个一级入口；禁止旧的 nested `<details>`/checkbox 作为待办执行前置条件。
2. `OwnerInbox` 通过确定的 proposal.action.type 映射两种按钮；不允许前端根据文案、源字符串拼造请求。
3. 一键调用现有 `executeOwnerAction(proposal)`；新 Gene action 只追加两种有限 union + 固定已授权 API 映射；**不要**在 executeOwnerAction 中开放任意 URL、任意 method 或任意脚本。
4. 每行单独 busy/error/success 状态；服务器失败显示错误并继续允许详情检查；轮询更新时要防止重复点击已变更条目。
5. 缺少成对 action 的记录由后端改投 alerts；前端 dev/test 发现异常投影时显式报错，不渲染假按钮或吞掉记录。

**S2 验收：**点击同意或拒绝直接真实 POST，成功刷新并从待办移除；详情不 POST，跳转到目标详情。

### S3 — 投影、深链接、专项回归

**改动：**`OwnerOverviewService`、已有 Gene 路由、`BusinessHome.tsx` / `GenomeLayer.tsx` 等**必须的最少量**文件、相关测试、文档。

1. 待办仅返回真正可决策事项；告警单独暴露，严重异常持续可见。
2. Gene 当前 `PROPOSED` 提案获得正反按钮及必要的 generation stale guard，使用原审批流程。
3. 详情直达：
   - Plan：`/GENE?view=plans&id=...`，已有 `owner-detail:<id>` 锚点可复用。
   - Resource：`/GENE?view=resources&id=...`，已有 `owner-detail:<id>` 锚点可复用。
   - Gene：`/GENE?view=life&id=...`，最小补：进入 life 后将相应 Gene Proposal `<details>` 自动展开并 `scrollIntoView`，**不可仅开 GENE 主页**。
   - Run：`/YUAN?world=...` 定位该 World，若 YUAN 已支持具体 Run/Recovery ID 则附上；否则至少选中世界并突出待核实区，不能跳到错误 World。
   - 外部结果未知：`/GENE?view=business&id=...` 需把对应 operation/task 聚焦，若该页目前无 `id` 锚点，补最小 DOM id + 数据就绪后滚动。
   - Upgrade：继续打开独立 8766；不要让 8765 页面持有其真实审批凭据。
4. 修正 /OWNER 的 i18n 文案，移除“所有异常都在 Inbox”这类与新设计矛盾的旧文字；维护文档说明。
5. 不动 V27 双 Git 树页面；不要将 V27 的 Git 提交审批放进普通 OWNER 的即时决策，二者是不同权限域。

---

## 6. 测试矩阵（必须覆盖）

| 分类 | 场景 | 必须通过的结果 |
|---|---|---|
| Hash 分流 | `/OWNER`、`#owner-inbox`、`#owner-activity`、非法 hash、返回前进、刷新 | 默认待办；两视图**互斥**，URL 与选中 tab 同步 |
| 持续轮询 | 5 秒更新、切换 tab、组件卸载、网络短断 | 不重复请求/不丢数据；数据源失败不显示健康假象 |
| 待办卡 | Plan / Resource / Gene 各有三入口，中英切换 | 效果说明可见；无额外 checkbox/二次确认；两个正反按钮不同时执行 |
| 方案同意 | 最新 revision/hash、计划含预算或对外任务 | 点击一次调用原 approve；真实 state 更新；不会直接声称外部任务已完成 |
| 方案拒绝 | 最新 revision/hash | 点击一次调用 revoke；不再可批准该修订；状态及时更新 |
| 资源同意 | 真实已存在的 dataset/connection | 仅验证真实资源，通过才解除等待；缺失时不伪造提供成功 |
| 资源拒绝 | 关联计划、其他同计划请求 | 必须明确说明并验证“整份计划被终止”，不能只隐藏这一张卡 |
| Gene 同意/拒绝 | 当前代、未决提案 | 只决定方向；拒绝不进入后续推进；同意不会绕过候选哈希发布 |
| 失效操作 | 另一会话已操作、代际变化、revision/hash 改变 | 返回冲突，拒绝旧操作；刷新后的状态真实 |
| 失败/未知 | HTTP 500/409/403/超时、断网、执行后服务端响应丢失 | 不谎报成功、不自动重复外部副作用；保留/刷新证据 |
| 风险提示 | Run 未结算、GitHub 执行结果未知、升级待发、task 恢复 | 没有假“同意/拒绝”，但**告警仍可见**并可跳转到真实处理位置 |
| 深链接 | Plan / Resource / Gene / 具体 operation / World | 页面打开后对象选中、展开、滚动至对应记录；数据尚在加载时不会丢定位 |
| 审批边界 | 非 Owner session、World actor 请求、8766 Release | 不可冒用 OWNER，不能在 OWNER 绕过独立升级与 Root 边界 |
| 兼容性 | Owner Chat 原有动作卡、V27 升级 UI、V26 Skills、旧 `/GENE` 操作 | 保留旧接口和审批流程，不破坏现有功能 |
| 可访问性 | 键盘 tab、aria-selected、焦点提示、移动端 | 不会出现两份重复可操作列表；控件名称清晰 |

**建议运行（依据实际仓库脚本）：**

```powershell
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4
pnpm.cmd --dir frontend build
```

若现有 Windows 环境仍限制 worker 数量，使用仓库现有经过验证的测试命令；最终交付记录写清跑了哪些测试、哪些未跑、为何未跑。专项优先 `frontend/tests/owner_console.test.tsx`、`apps/server/tests/owner_actions.test.ts`、`apps/server/tests/evolution_api.test.ts` 和 Owner 投影/路由对应测试。

---

## 7. 验收用例（由本地 Codex 实际演示）

**A. 页面分流**：打开 `/OWNER#owner-inbox`，只能看见待办卡，看不见 Activity 时间线；切到 `/OWNER#owner-activity`，只能看见时间线，看不见待办操作卡。浏览器刷新、后退仍一致。

**B. 业务方案**：准备一个真实 `AWAITING_APPROVAL` 方案。卡上先看清“同意后的预算/动作风险”“拒绝后的终止范围”；点击“同意”，只发一次 approve 并进入业务实际状态；再准备另一条点击“拒绝”，实际 revoke。

**C. Gene**：用当前代 `PROPOSED` 的真实提案检查“同意”仅为批准方向、“拒绝”终止方向，详情自动定位该提案；验证点击不会直接触发版本发布。

**D. 风险边界**：模拟 `CALL_OUTCOME_UNKNOWN` 或有未结算外部副作用的 Run，不能用按钮假确认/假放弃；公共告警仍显著，详情可以找到证据。

**E. 状态竞争**：两个浏览器打开同一待办，A 同意后 B 拒绝必须失败或反馈已处理；页面不能展示两个决策都成功。

完成标准：**三类可判定事项的三按钮真实可用；两个 Tab 互斥；异常不丢失；既有 Root/发布/审批边界不退化**。

---

## 8. 明确不做（防止过度设计）

- 不改变四层生命架构、Pixel 意识、调度器、模型 Prompt、繁殖规则、Gene 代际定义。
- 不增加新的 Owner Inbox 持久化队列、消息总线、任务状态机、复杂组件库。
- 不把所有 Run/外部不确定性压成“同意继续 / 拒绝结束”，不一键重试未知外部写入。
- 不在 OWNER 中实现任意 Git 操作、合并、发布、回滚；8766 与 V27 保持独立。
- 不要求为了三按钮给 Owner Chat 群发移除已有二次确认（本次仅限 Inbox）。
- 不为本次 UI 改造统一重构所有业务 API，不改变 URL 的原有其它参数。
- 不新增数据库迁移，除非现有真实状态缺失使得最小安全闭环无法完成；若必须新增，先说明原因且限制在单一用途，优先不做。

## 9. 给 Codex 的执行指令

1. **先读取本地最新 HEAD 和未提交状态**；对照上述基线，核查 V26 / V27 是否已进入本地，不得重置或覆盖。
2. 先完成 S1 再完成 S2，最后 S3；每阶段跑对应测试，按最小变更迭代。
3. **以真实 API 的操作后果为准**校正 `approveEffect/rejectEffect`；若与计划假设不符，先检查现有业务代码，不要编造成功路径。
4. `OWNER` 普通待办必须恰好三入口；对不具备成对真实决策的对象，显著归类为未决告警而非伪按钮，且保持详情可达。
5. 汇报修改文件、核心 diff、测试结果、前后界面对照、真实可操作的样例、未解决限制。
6. 按原项目已有的“构建 → 测试 → 候选冻结 → Owner 批准 → 正式发布”流程上线；**改源代码不等于已发布到运行版本**。

**V28 一句话定义：OWNER 从“需要到处找入口的双栏信息板”，变成“待办与动态分离、每条真实待办一键同意/拒绝、详情直达”的控制台。**
