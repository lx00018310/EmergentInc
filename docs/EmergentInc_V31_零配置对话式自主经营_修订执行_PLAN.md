# EmergentInc V31 — 零配置对话式自主经营 · 最小更改执行 PLAN（修订版）

> 执行对象：本地 Codex / AI 编码代理  
> 日期：2026-10-14  
> 源码核查基准：`lx00018310/EmergentInc` 的 `main` / `dc366a813c42cc51c08024c77f0a6236c13c20ff`（截至本次编写时已复核仍为 HEAD）  
> 替代文档：上一版 `EmergentInc_V31_对话式经营工作台_最小更改执行_PLAN.md`。**本文件取代上一版全部“禁止自动授信、禁止新人物默认无限能量、禁止对话直接发布商品”的约束。**  
> 基本纪律：遵守 `AGENTS.md`；优先复用、精准改动、中英文同步、以真实行为和测试验收，不因 UI 简化删减状态机。

## 0. 给本地 Codex 的首要指令

1. 执行前先读取 `AGENTS.md`，运行 `git status --short`、`git branch --show-current`、`git log -1 --oneline`；以**本机最新代码**为准。不得重置、覆盖或丢弃 V30 之后的本地更改。若已实现某项，只补差距，勿重复重构。
2. **按本版产品决策执行，不再次征询是否需要授权**：
   - 默认**静默自动授信 10,000,000 Tokens**，额度接近耗尽时自动追加一个 10,000,000 批次，持续运行；
   - **新人物 / 新 World 默认开启入口 Pixel 无限能量自动补充**；
   - **Owner 在对话中明确要求上架或修改商品时，直接更新公开商城**；不再要求进入 `/GENE` 填双语表单、也不弹二次发布确认；
   - 老板的主要操作只有：**说话、运行/暂停、处理真正不能自动解决的例外**。
3. **复杂逻辑应存在，复杂设置不应出现**。后台自动使用已有 Model、Tools、Skills、Gene 知识、World 资产与经营目标调度；拒绝为此新建大而全的编排框架、插件市场、规则 DSL、新状态机。
4. 自动额度、能量、上架是此次**明确改变的授权/默认策略**，不能以过去的人工审批习惯恢复旧设计。但认证、幂等、审计、事实核验、结果未知处理、升级维护、资金密钥等**无关的安全边界必须保留**。
5. 按 **S1 → S2 → S3** 实施和验证。允许同步改旧测试对 UI/默认值的期望，严禁删除测试来掩盖安全回归。每阶段验收后再进入下一阶段。

---

## 1. 产品定义：老板只管理意图，不管理流程

### 1.1 一句话定义

**EmergentInc 是可以被老板用自然语言经营的 AI 公司：老板给目标，系统自己决定由谁做、使用什么工具和方法、如何交付，只有真正异常才打断老板。**

老板视角的典型交互：

```text
打开 /OWNER，直接聊天。

老板：帮我调查开发者对 AI 自动化的需求，决定卖什么，做一款服务并上架。
系统：正在安排市场调研，已找到适用的 Skills 和已有知识；
      商品制作会跟随调研结果推进。需要我处理的事会集中显示。

老板：把定制服务改成 19.9 USDT，写好中英文详情，直接上架。
系统：已更新并上架「定制服务」；价格 19.9 USDT；
      [查看商品] [查看实际修改记录]

老板：先暂停。
系统：自动经营已暂停；现有用量和工作状态保留。
```

说明：第一种涉及“先研究、后上架”的**异步复合目标**，必须依赖真实调研产出继续执行，不得在研究尚未完成时谎称商品已发布。第二种是 **Owner 当前消息明确授权的即时商品发布**，校验通过即直接执行，不再多点一次确认。

### 1.2 前端只暴露四类信息

- **对话**：唯一主要输入入口，可下达短任务、长期目标、商品操作、经营查询。
- **运行开关**：ON / OFF；可见真正的运行、暂停、异常状态。
- **目标与进度**：简要展示正在做什么、真实结果、下一步；点击可暂停/停止/归档。
- **例外待办**：缺少关键资料、招聘审批、支付通道不存在、未知调用、维护审批等。

用户日常**不需要**填写 Token、轮数、Pixel 坐标、验收文件名、英文商品描述、工具名、Skill 名、人员 ID。

### 1.3 必须保持的真实边界

- **10,000,000 是内部 Token 累计授权批次，不是免费额度，也不是人民币/USDT 花费上限。** 自动续批意味着实际模型 API 费用可能持续增加。仍保留用量、已知费用和未知账单数量可查，可一键 OFF。
- Owner 手动 OFF 后，**定时器、调度器、自动续额不得偷偷使其变为 ON**；仅 Owner 再点击 ON，或在对话中明确说“继续/开始执行”才解除人工暂停。初次未配置且未主动暂停时，首次 Owner 经营指令可以自动启动。
- `OUTCOME_UNKNOWN` / `OWNER_OUTCOME_REVIEW_REQUIRED`、维护静默 `EVOLUTION_QUIESCED`、未知金额/模型计价、鉴权错误：不因自动授权绕过，不能自动重发不确定外部动作。
- 新 World “无限能量”仅是**入口 Pixel 自动补能**，不是公司 Token 无限、不是免费模型、不自动给所有 Pixel 增能。保留现有 Run 轮次/模型计费/权限与事件账本。
- **Owner 直接上架的授权只限已认证 Owner 当前消息所表达的产品动作**；不能把历史对话、检索文档、Skill 内容、人物回复当作新的上架授权。不可扩大到软件发布、删除/回滚版本、支付转账、修改钱包私钥或营销账号权限。
- V30 Core/衍生代码与数据隔离、Gene 代际审批、8766 精确 Hash 审批、支付链上核验与私钥隔离全部保持不变。

---

## 2. 已核对的实际代码事实（不是假定）

| 模块 | 现状 | V31 最小改动 |
| --- | --- | --- |
| `apps/server/src/services/owner_automation_gate.ts` | `owner_automation_control` 默认 `OFF`、`max_tokens=0`；已有持久累计账本、CAS、幂等、未知调用保护；`control()` 上限 `1_000_000_000` | 在这里**集中**实现自动初授信/自动续批；不改账本结构与计费路径 |
| `apps/server/src/routes/owner_routes.ts` | `/owner/chat`、`/owner/automation`、目标 API 已有 | 复用 Owner 鉴权链路，把自动启动逻辑和路由动作正确串联 |
| `apps/server/src/services/owner_chat_service.ts` | 路由意图 `answer / clarify / dispatch / energy / recruit` | 增加 `create_goal`、`configure_product`，识别复合指令但不放宽工具执行权限 |
| `apps/server/src/services/owner_work_service.ts` | 已有 `ask()` 请求 key 缓存和 `owner_dispatch_calls`、分派人物、招聘请求 | 在原 `ask` 中增加少量经营动作处理与结构化回执，保持重复请求幂等 |
| `apps/server/src/services/owner_goal_service.ts`、`owner_goal_scheduler.ts` | 已有持久目标、暂停/恢复、证据、调度与招聘待办 | 创建目标直接复用；复合目标按真实可完成的步骤执行，不另造一套任务系统 |
| `apps/server/src/services/public_store.ts` | `configureProduct(id, input)` 已存在；产品字段包含中英文名称/描述、USDT 价格与启用标志；`enabled` 时必须有价格和支付 rail | **直接复用**这个服务。注意：原 `addProduct()` 使用随机 ID，新品重试须单独做幂等保护 |
| `packages/persistence/src/world_registry_store.ts`、`apps/server/src/services/world_registry_service.ts` | 网关无限能量以 `world_gateway_energy.enabled` 存储，`setGatewayInfiniteEnergy()` 已有；新建 World 的路径集中在 `create()/insertWorld()` | 创建新 World 时将新网关默认设置为 enabled=1；不追溯改动老 World |
| `apps/server/src/services/world_tools.ts`、`skill_library.ts` | 已有 `LIST_SKILLS/READ_SKILL`、`LIST_GENE_ASSETS/READ_GENE_ASSET`、`LIST_WORLD_ASSETS/READ_WORLD_ASSET`、`CREATE_BODY_SKILL` 等 | **借用现有工具和知识边界**，让 agent 自己查方法与资料；不建第二套知识库 |
| `frontend/src/features/owner/OwnerConsole.tsx`、`OwnerChat.tsx` | `/OWNER` 无 hash 默认公司开关页，Boss 聊天已独立且保持草稿、requestKey | 默认打开 Boss 聊天，把开关、目标、待办合成紧凑顶部区域 |
| `frontend/src/features/qianji/QianjiChatPanel.tsx` | 聊天轮数默认 20，可改 1–20 | 不再要求日常填写，默认 20；必要时仅高级设置可改 |
| `frontend/src/Entry.tsx` | `/` 公开网站、后台页与 `Advanced` 已有 | 复用现有入口，不改网站路由体系 |

**特别纠正 Gemini 的两处代码锚点**：无限能量的有效值存于 `world_gateway_energy` 而不是 `world_gateway_state.infinite_energy`；`PublicStore.configureProduct()` 只在已有价格与支付 rail 满足条件时允许启用商品。实施必须依真实 schema，不要按 Gemini 的示意字段编造迁移。

---

## 3. S1 — 静默额度 + 自动开机 + 新人物无限能量（先打通生命循环）

### 3.1 一个中央自动额度方法，替代四处散落的前端兜底

**主要修改**：`owner_automation_gate.ts`，必要时极少修改 `owner_routes.ts` / 模型许可预留入口。

实现 `ensureAutoQuota(...)` 或等效**单一后端入口**（命名可按现有风格），要求：

1. **初授信**：没有人工暂停、处于首次可启动状态，已认证 Owner 发出可执行经营指令或点击 ON 时，自动将累计 `max_tokens` 设置为 **10,000,000**，并令 `desired_mode='ON'`。不弹确认、不要求手填。
2. **续批**：`desired_mode='ON'` 且可用额度 `maxTokens - spentTokens - reservedTokens < 200,000`，在继续安排新的模型调用或调度前，自动将累计额度**增加 10,000,000**；保留所有已经使用/预留的用量，不重置历史。若新模型调用的合理预留需求高于 200,000，应保证实际许可预留前再次校验并只补必要批次，不能用低水位规则绕过原子预留。
3. **持续运行**：即使老板不在页面，ON 状态下的既有目标调度仍会触发自动续批；不能只在前端按钮里加额度，否则后台无人看管时仍会停。
4. **原子与审计**：额度检查与更新放在事务内；并发 / 多进程不得重复授信；`revision` 正常递增，记录 `control_events.kind='owner_auto_quota_granted'`，载明旧总额度、新总额度、触发来源、批次与时刻。若采用原 `control()`，使用稳定请求键及重读 revision；不要通过无上限重试掩盖 CAS 冲突。
5. **重复请求**：网络断线重试同一 `requestKey` 不应重复创建额度批次；更不能把“失败/结果未知”误当作可以再次计费。
6. **停止条件**：人工 OFF、维护期、任何未决调用/账单、未知计价、无模型、原 `max_tokens <= 1_000_000_000` 协议上限、正在停止或其他原有硬错误：保留相应阻断与审计。达到协议硬上限时明示无法继续，**不偷偷修改上限**。
7. **读接口不能有副作用**：`view()` / `isOn()` / 状态轮询不得自动授信；只在**已授权的写入或模型预留路径**触发。重复 UI 轮询不额外增加额度。
8. **区分主动暂停**：首次 `OFF`（初始配置）可以被 Owner 的首条经营指令激活；后续 Owner 显式 OFF 不因浏览器重载、普通状态查询或后台调度而被激活。明确“继续运行”或点击 ON 时自动激活并授信。

> 这里的“静默”是**不让老板填表和二次确认**，不是隐藏账单。主屏可显示“累计已用 Tokens / 已知费用”，更多审计仍在高级信息里。默认采用 10,000,000 的连续批次，不引入新的用户配置表单或计费体系。

### 3.2 新 World 创建时默认无限能量

**主要修改**：`packages/persistence/src/world_registry_store.ts`（或 `world_registry_service.ts` 中已存在的创建事务，选择**一个**位置实施）。

- 只在**新 World 创建事务**里为 `world_gateway_energy` 初始化 `enabled=1`；优先复用既有表，禁止新增 `world_gateway_state.infinite_energy` 等不存在的列。
- 保证新人物走 `GachaService` 创建 World 时也自动生效；原有 World 状态和人工关闭无限能量的设置完全保留。
- 只补入口，不改所有 Pixel 的 energy、核心 Ledger 或 Run 权限。入口失活/网关切换依然遵守已有边界。
- 不增加“新人物诞生后再手动打开无限能量”的额外前端步骤。

**S1 验收（至少）**：空库首次 Owner 指令后授权总额度正好 10M 且 ON；额度不足自动仅追加一个 10M 批次并继续；OFF/未知调用/维护期绝不续批；多人并发不能重复续额；新 World `gatewayInfiniteEnergy(worldId)===true`，旧 World 原值不变；服务器重启后账本、暂停状态与策略不丢。

---

## 4. S2 — 对话直接执行业务：建目标、派工、上架商品

### 4.1 只扩展现有意图路由，不引入万能动作解释器

**主要修改**：`owner_chat_service.ts` + `owner_work_service.ts` + 少量响应类型。沿用 `answer / clarify / dispatch / energy / recruit`，新增：

```ts
// 示例意图，最终格式以精确校验为准。
{ kind: 'create_goal', title: string, objective: string, filename?: string }
{ kind: 'configure_product', productId?: string, createNew?: boolean,
  nameEn: string, nameZh: string, descEn: string, descZh: string,
  priceUsdt?: string, enabled: boolean }
```

路由原则：

- “帮我看一下有什么产品” → `answer`，不产生写入。
- “调查市场/让营销人员做个方案” → 现有 `dispatch` 或长期 `create_goal`，按语义决定；不得把一次聊天都当成无限目标。
- “给我建立一个持续经营目标……” → 直接 `create_goal`，**服务端**补齐默认验收 `manual`（带真实业务结果和来源证据要求），直接调用现有 `OwnerGoalService.create()`，交既有 `OwnerGoalScheduler` 推进。无需老板再按“确认设立”。
- “把定制服务修改成 19.9 USDT，补全中英文，立即上架” → 直接 `configure_product`，服务端校验后**实际保存并启用**；无需老板再进入设置页或确认。
- “我想上架点什么”但产品、目标对象或价格无法确定 → 只问**一个真正必要**的问题。若老板明确授权“你决定卖什么和定价并上架”，允许根据已有业务知识和技能自主拟定，但不得编造收益/客户/评价/能力承诺。
- 模型返回的 `personId` / `productId` / `filename` / 价格/开关都必须由后端验证，**不能**把模型原始 JSON 直接作为数据库操作或任意工具名执行。
- 用户消息中的 `rounds=10` 仍原样遵循，默认 20；语言切换不改变持久数据和动作语义。

### 4.2 对话建目标：内部直接落库，不需额外确认

- 保留 `OwnerWorkService.ask()` 原有 `owner_dispatch_calls(request_key, payload_hash, state, response_json, ...)` 请求幂等缓存。
- 由服务器生成 `OwnerGoalService.create()` 的完整结构：`title`、`objective`、`acceptance: { kind:'manual', description:'按真实业务成果和可追溯证据核验；不得仅凭草稿宣称营收或需求成立' }`、`idempotencyKey`。该 key 应从原始 Owner 请求 key **稳定派生**，网络重试不能创建第二个目标。
- 目标创建完成后通过既有目标 API/周期调度正常执行；**不要从 `OwnerWorkService` 再手动 dispatch 相同工作**造成重复运行。若调度器尚未开始，返回“已创建、等待调度”，不能回报“已经执行完成”。
- 若没有合适人物，沿用现有 `requestRecruit()` 待办，招聘审批保留；不擅自虚构雇员。
- `artifact`/`confirmed_payments` 仍由现有细化验收和支付真实证据机制处理。默认 manual 仅意味着“无需老板配置复杂参数”，**不是自动宣称达成**。
- 失败重试或服务崩溃恢复时，应通过原幂等键和既有目标数据核对实际状态，不能“猜应该创建成功”。

### 4.3 对话直接发布商品：真实写入，不再发布确认

**主要修改**：`owner_work_service.ts`、`owner_routes.ts` 的依赖注入位置、`public_store.ts` 必需的最少幂等支持；禁止另造商城/产品系统。

1. **注入已存在的 `PublicStore` 实例**到执行 Owner 对话动作的服务（参照现有 `registerPublicRoutes` 依赖注入）；绝不通过 HTTP 请求本站公共接口绕过既有服务与认证。
2. 服务端将模型字段映射到现有 `PublicStore.configureProduct(id, { product_enabled, product_name_en, product_name_zh, product_description_en, product_description_zh, product_price, product_currency:'USDT' })`。中英文由 AI 自动生成，但实际发布前保留 `PublicStore.productSettings()` 的格式/价格/双语/支付轨道检查；发布后重新读取商品以确认真实状态。
3. **明确上架指令即授权执行**。仅允许通过已认证 Owner 主入口当前消息发起；不要求 `[确认上架]`、不弹审批卡，也不让 Pixel/Skill/历史记录伪造 Owner 发布指令。
4. 若是**更新已存在商品**，服务端在当前已有产品目录中解析真实 `productId`；不让模型靠猜测覆盖其他商品。同一请求重复写相同属性是可恢复的，仍需返回实际商品状态。
5. 若是**新增商品**，需最小化解决原 `addProduct()` 随机 ID 重试重复的问题：给 Owner 对话动作生成**稳定 productId 或幂等创建**，仅为该受控路径增加必要逻辑；同一 `requestKey` 重试不得新增第二个商品。不要扩展为通用审批工作流。
6. 若支付 rail 未配置，现有 `PublicStore` 不允许 `enabled:true`：**保存为未启用商品草稿**，返回真实的 `未上架/缺少收款通道` 待办。不得忽略校验、假装可付款或自动填写收款地址；后续配置 rail 后可由 Owner 明确指令再上架。
7. 若 Owner 已明确价格则精确保留，不允许 AI 私自更改；只有用户明确授权代为定价时才可由 AI 根据可取得的资料决定，并在回执中明确价格。不得把 USDT 当作可用任意代币，不能编造“USDC 收款已开通”。
8. 返回真实动作回执：`productId`、实际 `enabled`、实际 `price`、公开商品链接/可访问入口、更新时刻或实际持久事件标记；前端展示“已发布”必须来自**后端读回**，不是模型自由文本。失败、草稿、待配置状态有明显区别。
9. 保存/发布期间发生超时或服务器重启时，先读取真实产品状态、对照请求指纹，能证明已完成则返回相同结果；**结果仍未知时挂待核实，绝不盲目重复外部动作**。与现有 `OUTCOME_UNKNOWN` 思路一致。
10. 对话上架权限**严格限定为现有公开商城商品的创建、编辑、启用/停用**，不顺便开放微信发帖、改支付 rail、修改网站密钥、支付转账、代码版本发布等操作。

### 4.4 复合经营目标：轻编排，真使用 Tools + Skills + 知识库

**不建新的“万能 Agent 编排器”**，在现有链路中把资料检索与执行要求串起来：

```text
Owner 当前指令
  → OwnerChatService.route：区分查询 / 一次派工 / 持续目标 / 商品操作
  → OwnerWorkService.ask：校验授权、落持久意图并调用现有服务
  → OwnerGoalScheduler：已有角色匹配 / 真实任务运行 / 缺人发起招聘待办
  → WorldRuntime + ToolRegistry：在本 World 有权限的工具执行
  → LIST_SKILLS / READ_SKILL：优先学习已存在的方法
  → LIST_GENE_ASSETS / READ_GENE_ASSET：读取当前已批准的公共知识
  → LIST_WORLD_ASSETS / READ_WORLD_ASSET：使用允许访问的 World 共享资料
  → 真正的产物、回执、证据、阻塞 → /OWNER 汇报
```

最小改动要求：

- 优先只调整既有 `OwnerGoalScheduler` 下发任务的**指令组织**和 `WorldRuntimeManager` 已有 system prompt / tools 目录，让执行者遵循“先检索可用 Skill/资料、再选工具、实际执行、保留证据、报告真实状态”的次序。
- 现有 Markdown Skills 是**工作方法参考，不赋予新增权限**；已有 Body / Gene 资产、私有扩展及工具依照各自当前范围使用。不新增一份通用“知识库表”或索引服务。
- 角色选择先沿用现有角色/职责匹配与调度，不要求老板指定 Pixel/人物；缺少人才沿用招聘待办，不擅自越权招聘。
- **“先研究、再发布”的跨时序动作是本期必须打通的一个最小闭环**，但不能因为 Owner 早先说了“上架”就无限制地授权后续任意商品/价格发布。具体要求：
  1. 只对 Owner 当前一句话**明确交代了“先做 A，结果满足条件后上架商品 B”**的复合目标建立持久的、范围极窄的**商品发布意图**，绑定原 `requestKey`、`goalId`、具体商品或新增商品意图、授权价格/自主定价标记、启用条件、状态与真实发布结果。优先用现有 Goal/Dispatch 持久能力；若无法可靠表示，则允许**一张最小关联表**，不得建通用动作 DSL。
  2. 由已有 `OwnerGoalScheduler`/任务续接点在真实工作回复后读取已产出的结构化商品资料（如 JSON 交付物），验证 schema、来源、商品约束与当前有效授权，再调用**同一个受控 Owner 商品写入服务**。不能从自由文本里随意猜测价格、身份或上架对象。
  3. 只在前置研究/制作步骤达到**能证明实际交付物已生成且满足授权条件**时推进上架；草稿存在与哈希正确只能证明文件产出，不代表市场需求真实成立。若前置条件要求不可自动核验的市场事实，就停止于待办，而不是编造结论。
  4. 持久状态至少区分 `PENDING / PUBLISHED / BLOCKED / OUTCOME_UNKNOWN` 或等效状态，支持停机重启和同一授权仅执行一次。商品已上架后应根据实际读回值反馈，不能重复上架或凭借旧授权发布另一款商品。
  5. 手动 OFF、目标停止/归档、授权被撤销、支付 rail 缺失、商品版本变化或未知外部结果时，不执行后续上架。仅做**商品这一个明确案例**的连续编排，其他外部动作不顺势开放。
- 一旦资料不足、商品经营承诺不可核验、支付 rail 缺失、目标需要人工证据判断或结果未知，转为**一个具体、可行动的待办**；不应为了自动化强行完成。
- **不允许在研究阶段结束前假报上架**；不能把草稿文件存在、文字结论或待办当作真实市场成功、付款或商品已发布。

**S2 验收**：一句话建持久目标且自动排队；一句话将已有定制服务修改为 19.9 USDT 并在已有 rail 时公开生效；中英文自动生成；新增商品重试不重复；无 rail 时只保留草稿且明确未上架；显式暂停阻断背景继续执行；既有招聘与真实证据逻辑不回退；复合目标能够在已有权限范围内按“研究 → 产出产品资料 → 检验 → 受限上架”续接；先决条件不具备则停在真实待办，不虚报完成。

---

## 5. S3 — `/OWNER` 变成唯一日常入口，`/QIAN` 变成人物聊天

### 5.1 单屏 Owner 工作台，不拆现有底层页面

**主要修改**：`OwnerConsole.tsx`、`OwnerCompany.tsx`、`OwnerChat.tsx`、`OwnerGoals.tsx`、`owner.css`。

```text
┌────────────────────────────────────────────────────────────────────┐
│ EmergentInc         [● 运行中 / 点击暂停]      [EN/中] [高级 ▾]    │
│ 当前目标  [市场调研 · 推进中] [商品销售 · 已上架]  [查看全部]       │
│ 待我处理  [缺少收款通道]  [人员招聘待批]           [查看待办]     │
├────────────────────────────────────────────────────────────────────┤
│ 老板：上架一个 AI 定制服务，19.9 USDT，中英文你帮我写。           │
│ 系统：已在公开商城上架。价格 19.9 USDT。  [查看商品]              │
│                                                                    │
│ 老板：再让营销人员做一份客户需求分析。                             │
│ 系统：已创建目标并排队。会自主选择已有 Skills 和可用知识。         │
│                                                                    │
│ [说出想实现的生意或要处理的事情……                      ] [发送]  │
└────────────────────────────────────────────────────────────────────┘
```

- `/OWNER` 无 hash 默认直接进入 Boss 对话（保留 `?goal` / `?report` 深链和全部旧 `#owner-*` 路由）。最新代码已恢复独立 Boss 聊天页，**只改默认入口与顶部信息排布，不重做整套布局**。
- 顶栏只有可工作的 ON/OFF：点击 ON 直接自动授信并开启；点击 OFF 严格保持人工暂停。用实际 `observedState` 区分“运行中/暂停中/异常/等待资源”，不能只由 `desiredMode` 猜。
- **移除主界面的 Token 额度输入框**，不在建目标/发消息/运行轮数/人物入口等地方让老板设置技术参数。可在高级详情中只读查看额度与真实花费；无需暴露自动续批确认页。
- 把 `OwnerOverview` 已有目标、待办、异常聚合成首屏紧凑横幅（只显示 2–3 项及数量），点击复用 `OwnerGoals` / `OwnerInbox` 现有交互；不建重复状态表，不重复显示 DOM id。
- “新增目标”默认只需要一句话；高级验收类型继续存在于折叠设置以保留老用户能力，不要求先填 5 项参数。
- Owner 聊天支持 `Enter` 发送，`Shift+Enter` 换行，保留 `Ctrl/Cmd+Enter`，检查 IME 输入法合成态；消息 pending `requestKey`、草稿与网络失败重试保留。
- 对话展示后端实际返回的 `createdGoal` / `configuredProduct` 和可点击详情，不把模型生成的“已完成”当执行结果。
- `/QIAN`、`/YUAN`、`/GENE`、`8766` 继续隐藏于原 `Advanced`，维护与四层生命架构原样可访问。

### 5.2 `/QIAN` 去工程参数化

**主要修改**：`QianjiChatPanel.tsx`、`QianjiProfilePanel.tsx`、`WorldSummary.tsx`。

- 人物详情首屏显示名称、职责、简介、正在做什么、最近答复、真实营收（若确有记录）；不要展示一长串机能参数。
- 日常发消息不要求填写轮数：**默认 20 轮**。在高级设置保留 1–20 轮的修改能力，保证需要时可以明确说/手动设为 10 轮。
- 入口 Pixel 切换、机能规格、能量工程参数移入“高级运行信息”，但不删除原功能，也不掩盖需要人工介入的异常。
- 保留人物原有幂等发送和阻塞/恢复提示，双语 UI 同步。

**S3 验收**：首次开启或首次说经营目标不出现额度表单；对话直接可建目标/派工/上架；开关可暂停所有后续自主调用；一眼可见目标、待办、真实花费；旧管理页面及深链仍可用；人物默认无限能量、聊天默认 20 轮但可在高级设置改 10 轮。

---

## 6. 严格不做的事：避免为了“简单”反而重造系统

- 不引入 LangGraph、Temporal、独立事件总线、向量数据库、新 AI Agent 平台、宏大的 Tool Registry 重构或通用流程 DSL。
- 不重写现有 `OwnerGoalScheduler`、`OwnerGoalService`、模型许可账本、收款链识别、Gene/Body 四层数据结构和 V30 资产隔离。
- 不为每个人物再建独立 Token 配额；仍是已有**公司统一累计 Token**，自动按 10M 批次加总。
- 不将 World 无限能量等同于无限真钱预算；不修改已有 Pixel 分配/奖惩账本。
- 不让任何 Pixel 获得“任意外部发布权”；此次直发仅 Owner 已授权的站内商品路径。
- 不让 AI 绕过缺失的支付 rail、发布虚假的订单成功，或接触不需要的热钱包私钥。
- 不允许因聊天指令自动通过 8766 软件发布、删除版本、Gene 提案审批、招聘或权限变更等与本次商品发布无关的审批。
- 不迁移已有 World 的能量设置，不清空已有 Owner 目标、聊天记录、产品、账本和版本资产。

---

## 7. 重要测试矩阵与验收门槛

### 7.1 后端与持久化

| 场景 | 必须验证 |
| --- | --- |
| 纯新实例 | 初始 `OFF/0`，首次 Owner 可执行经营指令后 `ON/10_000_000`；无需手工额度表单 |
| 自动续批 | ON 且剩余额度低于阈值/不够预留时只增加必要 10M 批次；重复或并发请求不重复加额 |
| 手工关闭 | OFF 后后台调度不续额、不继续发新的调用；重启/刷新仍 OFF；Owner 明确恢复后可再自动授信 |
| 异常 | UNKNOWN、维护静默、计价未知、停止中仍阻断；不重发结果未知调用 |
| 费用与历史 | `spentTokens`、`reservedTokens`、审计记录和历史运行跨重启不重置；协议上限仍有效 |
| 世界创建 | 新 World 默认 `gatewayInfiniteEnergy=true`；老 World 原值不变；手动关闭后持续保持关闭 |
| 经营目标 | 一次对话直接创建；同请求重试仅一个目标；scheduler 只调度一次；证据与 manual 验收真实保留 |
| 站内商品 | 已有 rail 时 Owner 指令可直接启用，读回价格/中英文；无 rail 时未启用并给待办；新商品失败重试无重复 |
| 真实授权 | 用户询问/历史记录/Skill/Pixel 自述不能触发商品写入；没有明确商品授权的自主目标不擅自发布 |
| 复合任务 | 先调研后上架，具有持久受限发布意图，真实产物符合授权条件时自动续接发布；条件不足待办；不声称未完成步骤成功 |

### 7.2 回归重点文件

- `apps/server/tests/owner_global_automation.test.ts`、`owner_automation_rollback.test.ts`：新 10M 默认行为、CAS、连续额度、人工 OFF、UNKNOWN、并发。
- `apps/server/tests/owner_work.test.ts`、`owner_goals.test.ts`、`owner_goal_scheduler.test.ts`：对话新增目标、真实调度、重试不重复。
- `apps/server/tests/public_store.test.ts`、新增或相关 Owner→Product 路由测试：商品发布/回滚语义、价格、双语、无 rail、鉴权、产品幂等。
- `apps/server/tests/qianji_service.test.ts`、`qianji_chat.test.ts` 与 persistence 对应测试：新人物无限能量与老数据不变。
- `frontend/tests/owner_console.test.tsx`、`owner_chat.test.tsx`、`owner_goals.test.tsx`、`qianji_panels.test.tsx`：默认入口、开关、对话实际结果、输入快捷键、高级设置。
- `frontend/tests/public_entry.test.tsx`：`en.ts` 与 `zh-CN.ts` 键集合严格一致。

**注意：旧测试中“默认 OFF/0”“上架必须二次人工确认”“新 World 无无限能量”等与新产品决策冲突的断言应有针对性地更改；UNKNOWN、幂等、资金链与核心隔离测试不得因产品重定义被删掉。**

**必跑命令**（Windows PowerShell，仓库根目录）：

```powershell
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4
pnpm.cmd --dir frontend build
```

若本仓库 Vitest 版本不支持 `--maxWorkers=4` 的具体调用方式，先核对 CLI 并用支持的等价命令；不得跳过全量测试。另需以**本地真实实例**（有/无支付 rail）做一次手工 E2E，单元测试通过不能替代实际站内产品可见性验证。

### 7.3 四条一眼能判断是否完成的手工演示

1. **零配置开机**：全新实例打开 `/OWNER`，输入“给我建立一个经营目标：调研 AI 定制服务”，不用填任何技术表单，后台自动授信 10M 并真实建目标、启动调度。
2. **持续自主执行**：ON 状态中低于阈值，自动续 10M 并继续；点击 OFF 则停止新增调用。模拟 UNKNOWN 时，不能自动继续。
3. **新人物即能工作**：招募并经现有招聘审批后创建新人物，入口自动无限能量；日常给人物发送消息不用设置轮数。老人物设置不被偷偷改写。
4. **对话直接上架与复合续接**：已配置真实可用 rail 的实例上，说“把定制服务定为 19.9 USDT，做中英文介绍并立即上架”，公开 `/` 商品实际可见、可走现有收款流程；重复同一请求不产生两个商品。再验证“先调查并准备商品资料，再把这款服务上架”的授权目标能在产物符合条件后继续发布；若支付/证据条件不具备则停待办，不假装上架。

---

## 8. 分阶段交付、文档与完成判定

| 阶段 | 交付范围 | 通过后再做 |
| --- | --- | --- |
| **S1** | 中央静默自动额度 10M / 自动续批 / 自动 ON 规则 / 新 World 默认无限能量；保护原账本 | S1 后端+持久化专项测试 |
| **S2** | 对话创建持续目标、真实自动派工、AI 双语商品直发；薄层 Tools / Skills / Gene/World 知识编排；必要的异步受限授权续接 | S2 业务+幂等+鉴权专项测试 |
| **S3** | `/OWNER` 对话首屏与简洁状态/待办、去额度表单；`/QIAN` 工程信息折叠；中英文同步 | UI 测试+全量测试+真实实例 E2E |

交付时更新英文 `README.md`、中文 `README_CN.md` 中受影响的**用户体验和部署后首用说明**：新用户通过 `/OWNER` 说一句话即可开始；默认自动累计授信 10M Token 且可自动续批，**模型 API 调用会产生实际成本**；手动 OFF 可以暂停；新 World 默认入口无限能量；已配置真实收款通道后支持 Owner 对话直接发布商品。不要顺手重写与本次无关的 README 内容。

提交结果至少包含：实际改动文件与理由、是否需要小型 schema 变更、每阶段测试结果、人工 E2E 过程、核心数据在升级与重启后的保留情况、最终 `git diff --stat`。按本地工作区要求提交，**不得清理未提交的其他工作**。

### 最终完成定义

**老板打开 `/OWNER` 就能说话、让 AI 自动安排人物与技能工作、设立目标、直接上架有真实收款能力的商品；系统自动处理 10M Token 授信续批与新人物入口能量，老板日常只需要运行/暂停和处理无法自动解决的例外。所有执行必须有可核实结果，不通过删除底层约束换取“看起来顺滑”。**

---

## 9. 给本地 Codex 的直接开工指令

> 执行 `docs/EmergentInc_V31_零配置对话式自主经营_修订执行_PLAN.md`，它覆盖此前 V31 方案。先核对当前分支与未提交改动，遵守 `AGENTS.md`。按 S1、S2、S3 逐步实施。此次已明确授权：后台默认静默 10,000,000 Token 累计授信与自动续批、新 World 默认入口无限能量、Owner 对话直接发布站内商品（无需二次确认）。必须保留人工 OFF、未知结果、维护暂停、账本/CAS/幂等、支付 rail、V30 资产分离和 8766 独立发布审批。优先复用 OwnerGoalScheduler、PublicStore、现有 ToolRegistry/Skills/Gene/World 资产，不建立新 Agent 框架。全部中英文同步、测试和真实实例 E2E 通过后报告结果。
