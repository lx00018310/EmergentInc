# EmergentInc V36｜公司插件与自生卡片｜本地 Codex 执行 PLAN

> **状态**：可执行设计方案，尚未修改仓库 / 尚未发布。  
> **制定日期**：2026-10-19  
> **基线仓库**：https://github.com/lx00018310/EmergentInc  
> **已核对 `main`**：`b5a9a93d70990418831db67060b502b372fe55e9`（2026-10-19，UTC）  
> **项目目标**：老板通过 `/BOSS` 对话要求“开发/显示/修改/隐藏/回滚 001 卡片”，由现有 AI 任务体系开发独立页面，注册为公司 Workspace 中的插件，按授权读取真实数据。插件故障不阻塞公司；主程序升级与兼容回滚不丢失插件和经营数据。  
> **执行者**：本地 Codex。**执行前务必以本机最新 `main` 为准复核**；本文件里的路径是已核对基线的改动定位，不要求按旧行号修改。

---

## 0. 给 Codex 的总指令（先读）

1. **最小更改**：不重写 BOSS，不换框架，不另建调度器、消息总线、数据库实例或 Agent 系统。优先复用现有 `OwnerGoalService / OwnerWorkService / CompanyToolService / CompanyArtifactService / OwnerOverviewService`、`InstanceExtensionService` 的安全约束与版本经验、现有 8766 发布/回滚机制。
2. **只改所需代码**：先完成真实“建卡 → 测试 → 注册 → 显示 → 修改 → 隐藏/恢复 → 回滚”的闭环，再考虑扩展。不要为了“未来万物皆插件”把支付、安全、任务、模型和整个前端变成插件。
3. **单一事实权威**：插件是展示/扩展能力；Goal/Task/Attempt/订单/金额账本仍由原服务写入。插件 Host 不能直接修改其 SQL 表、绕过授权、派工或结算。
4. **公司级归属**：插件资产与注册表在当前公司 `Workspace`，World/Worker 可提供数据与执行，不把卡片直接绑定成一个 World。
5. **数据不清零**：严禁执行 `v34-reset-workspace.mjs --destroy`、清空订单/账本/回执、删除旧运行实例。禁止把此需求当作 V34 再初始化。新表须无损迁移；安装、启动、升级和兼容回滚必须保留 V36 资产。
6. **外部副作用最小化**：所有新功能先在隔离测试 Workspace 验证。未经老板另行授权，不执行真实付款、外发营销、改生产配置、推送或部署。
7. **提交与验收分阶段**：每阶段有可用产物和测试。失败先局部修复，不扩散重构；每阶段记录真实改动文件、测试、未完成项和回退方式。

## 1. 已敲定的决策（不得在执行中擅自改动）

| 决策 | 最终规则 |
|---|---|
| Q1 | 本次只插件化“视察公司”；其他模块可未来接入同一接口，不迁移。 |
| Q2 | AI 可以开发 UI、数据处理及必要的后台功能，但**必须通过既有 Task/Worker/Tools 或白名单服务接口**；不能直接在主服务执行任意生成的 Node/TS 代码。 |
| Q3 | 老板明确提出的**低风险、已授权只读**卡片，测试通过可以自动启用与显示；新增敏感权限须单独授权。 |
| Q4 | **公司统一插件库**；World、Task、工具和现有业务服务只是能力/数据来源。 |
| Q5 | AI 可主动开发候选，但未获老板“显示”指令，不得自行出现在视察公司。 |
| Q6 | 当前只实现本地库；将来可导入/导出，本次不建插件市场和分享协议。 |
| P1 | 默认无数据读取权限；按资源白名单授予。插件声明权限 ≠ 插件已被授予权限。 |
| P2 | **隐藏卡片只影响 UI**；后台已获准的任务照常运行。独立的“停用插件/暂停任务”才控制运行。 |
| P3 | 敏感动作按**能力、作用域、期限**授权；不可逆高风险动作仍走原有逐次确认/幂等/回执校验。 |

### 一句必须实现的用户体验

老板说：“**开发一张营销卡片，让它出现在视察公司**” → 若明确只读且无需新敏感授权，系统使用现有 Goal/Plan/Worker 路径开发、保存、测试并显示一张新编号卡片。老板随后说：“**把 001 移除**” → 只隐藏 `001`，库中代码和后台工作不动；“**显示 001**”→ 立即恢复；“**修改 001，把摘要改为线索数**”→ 创建新版本并验证；“**回滚 001**”→ 激活上一验证通过的版本。所有操作跨重启保留。

> 注意：编号 **不预占**。只有卡片注册成功时才分配 `001`，失败候选不消耗编号也不能假装已安装。示例仅用于验收；不存在的业务数量、营收和转化率绝不能显示成真实数据。

---

## 2. 当前代码核对与实际缺口

已在上述基线核对：

| 现有位置 | 事实 | V36 处理 |
|---|---|---|
| `frontend/src/features/boss/BossCompany.tsx` | 当前直接以固定 JSX 列出目标、员工、任务、商品和订单；通过 `/api/boss/company` 读取 `OwnerOverview` | 替换成**动态卡片列表 + 空状态 + 详情视图**；原数据不迁移、不删除 |
| `frontend/src/features/boss/BossConsole.tsx` | “视察公司”通过 `modal === 'company'` 打开 | **保留入口及对话**；在弹窗内实现卡片库和详情，不新建主导航 |
| `apps/server/src/routes/owner_routes.ts` | 有 `/boss/company`、`/boss/overview`、`/owner/chat`，且聊天已有固定命令与分配逻辑 | 增加窄范围的插件读/写接口；仅针对卡片命令增加路由，别改现有普通经营意图 |
| `apps/server/src/services/owner_chat_service.ts`、`owner_work_service.ts` | 对话通过结构化 `create_task`、Goal/Plan 审批和现有 Worker 执行，带幂等记录 | 卡片开发走**这一条现存链路**，而不是新增“插件调度器” |
| `apps/server/src/services/company_tool_service.ts` | 工具受 Attempt、Goal、Worker 绑定约束，结果有工具回执 | 在这里增设**候选插件提交工具**；不得创建第二套工具回执账本 |
| `apps/server/src/services/company_artifact_service.ts` | Agent 的 `save_artifact` 产物有快照、大小/哈希验证以及 Goal 关联 | 卡片 HTML/JSON 从**已核验产物**复制入插件版本目录，不能相信 Agent 报告中的假路径 |
| `apps/server/src/services/instance_extension_service.ts` | World/Agent 私有的 `pure-ast-json@1` 扩展；支持版本与撤回 | **参考思路，不冒充通用 Web 插件运行时**；不能直接放行其现有禁止的网络、文件、密钥、进程权限 |
| `apps/server/src/boss_workspace.ts` | V34 格式 34，目录已有 `system/worlds/runtime/private/assets` | 在已有 Workspace 下懒创建插件目录，**不升级/重置 Workspace 主格式 34**（除非实际契约证明必须） |
| `apps/server/src/app.ts`、`owner_auth.ts` | `/api` Owner 登录保护；全局 CSP `frame-ancestors 'none'` | 插件独立静态资源必须有**精确路由级 CSP 例外**，不能全局放松保护 |
| `apps/server/src/services/owner_overview_service.ts` | 只读公司事实投影 | 仅建立白名单投影/数据桥；不把原 overview 无限制直接交给插件 |
| `frontend/tests/boss.test.tsx`、`apps/server/tests/*` | 已有前后端回归基线 | 添加定向插件测试，回归原 BOSS、任务、预算、收款、升级 |

### 与 V35 的边界

V35 的故障范围是 **Attempt / Task / Goal / Company**。V36 的卡片预览故障只属于**视图局部故障**，不许把错误回写为 Goal BLOCKED 或 company OFF；如果真实后台任务失败，仍由 V35 单一权威写入相应任务状态，不允许插件自建“任务状态机”。

---

## 3. V36 最小架构与对象关系

```text
/BOSS
 ├─ 老板对话（原有） ────────┐
 └─ 视察公司                 │
     ├─ 当前显示的 Card      │  001、002、... 永久编号
     ├─ 详情页 View          │  HTML/CSS/JS 自主生成
     └─ 隐藏卡片库           │  已安装但 visible=false
                              ▼
                    CompanyPluginService (新增，薄宿主)
                      ├─ Plugin Registry（现有公司 control SQLite）
                      ├─ Immutable Assets（Workspace/assets/plugins/）
                      ├─ iframe Host Bridge（只按授权投影提供 JSON）
                      └─ 启用/隐藏/回滚/版本校验
                              ▲
                  现有 Goal → Plan → Task → Worker
                              │
                   有哈希的 artifact / 工具回执
                              │
                   SUBMIT_PLUGIN_CANDIDATE（新增工具）
                              │
                    测试 / 授权校验 / 注册版本
```

### 三类概念，严格分开

- **Plugin**：功能包 `pluginId`（如 `marketing`），包含 manifest、前端静态资产、可声明的数据源与后端能力引用；**不是新的执行进程或业务状态源**。
- **Card**：编号 `cardId`（`001` 起、永不复用），可指向插件某个展示入口；有独立显示/隐藏设置。一个插件可提供多张卡片；第一版实际演示只需一张也可以。
- **View**：某张 Card 的小卡片和详情页各对应一个独立静态入口，由 AI 自由生成布局，不规定营销/财务模板；主程序只知道如何加载、安全交互和显示错误。

### 首版不增加的能力

不做 Cordis 全量迁移、热注入任意 JS 到 React 主页面、任意 npm 安装、任意 `require/import` 的 Node 插件后台、独立 HTTP 服务/端口、外部插件市场、拖拽编辑器、另一套消息总线、另一套执行/调度表。

---

## 4. 存储、编号、版本和升级契约

### 推荐落盘结构（逻辑结构，允许沿用现有持久层封装）

```text
workspace/
  system/control/control.sqlite3       # 增加插件元数据表；复用公司事务
  assets/plugins/
    marketing/
      versions/
        <sha256>/
          manifest.json
          cards/
            marketing-summary/
              card.html
              detail.html
              ...optional local assets
  runtime/plugin-data/
    marketing/                          # 插件自有计算快照；不得覆盖原业务账本
  worlds/                               # 原有 World 不动
```

**最少数据库实体（复用 `control.sqlite3`）**：

1. `company_plugins`：`plugin_id` 唯一，活动内容哈希 `active_hash`、上一个可回滚的已验版本、`enabled`、已授予的权限 JSON（与申报权限分开）、`revision`、来源 Goal/Attempt/请求 ID、时间戳；失败状态只写插件元数据，不写公司状态。
2. `company_cards`：`id INTEGER PRIMARY KEY AUTOINCREMENT`、`plugin_id`、插件内 `view_key`、`title`、`visible`、`revision`、`removed_at`（可空）。对外 ID 统一 `String(id).padStart(3,'0')`，`1000` 后自然扩展；所有 API 只接受严格规范数字 ID，不按自由文本标题猜测。
3. 如需保留“老板当前请求允许开发与自动显示”的明确凭据，**优先在既有 `owner_goal_events` 中追加规范化 `plugin_build_intent` 事件**，记录 `goalId/specificationRevision/requestKey/cardId?(更新)/visibilityIntent/已授权的只读 scope`。该事件是审计/授权依据，**不是新任务状态表**。只有确认不能安全复用时再加一张极小的请求绑定表，并在变更说明中解释原因。

技术规则：

- 插件 **文件版本不可变**：按内容哈希存 `versions/<sha>`；新版本临时目录写入、检验完整性后原子重命名；最后事务切换活动指针。SQLite 与文件系统不能跨资源做单一 ACID：重启时只把**已完整落盘且校验通过**的版本作为可激活版本，孤儿临时文件可留作诊断，不能自动激活。
- 插件 `manifest.json` 内只声明**请求的能力**；是否授权以数据库中 Owner 明确记录的 grant 为准，不能靠 manifest 自行增加。禁止直接保存真实密钥、Token 或钱包私钥。
- `company_cards` 的自增 ID 不复用。隐藏不删行；“彻底删除插件”需另行确认并保留审计信息，**本版默认仅隐藏/停用，不提供一键清理业务数据**。
- `visible=false` **不得修改** Goal、Task、Worker 的生命周期。`enabled=false` 表示插件宿主不再加载页面或提供插件自身入口；若关联运行中后台任务，需要通过原任务停止/暂停命令分别处理，禁止硬杀后伪称任务完成。
- 老板“修改 001”仅产生该卡片关联插件的新候选版本；既有页面始终可用，验证失败不切换。若插件多卡片，不能因更新一张而意外改变其他卡片；使用稳定 `view_key` 显式控制影响范围。
- 兼容升级保留 `workspace/assets/plugins`、插件相关 SQLite 表、`runtime/plugin-data`。主程序找不到某插件对应的接口版本时显示**不兼容/已停用**，保留资产，禁止静默降级到不受控版本。8766 软件发布/回滚的安全门不变。

---

## 5. 独立页面与安全数据桥（第一版必须实现）

### 页面如何自由生成

- 允许 AI 提交独立 `card.html` 与 `detail.html`，可带同目录 CSS/JS/图片（有明确大小和 MIME 白名单）。不要求业务模板或 TSX 编译；主 React 页面只负责显示编号、标题、状态以及加载独立页。
- 初版允许简单的自包含 HTML/CSS/JS，无外网依赖；建议 demo 使用纯 HTML+JS 和 Host Bridge 请求数据。
- **页面源码永不直接拼接成主 React 的 `innerHTML`，也不 `eval`、不以 TSX import 的形式动态加载。**

### iframe 必须隔离

- 使用 `<iframe sandbox="allow-scripts">`，**禁止** `allow-same-origin`、`allow-top-navigation`、`allow-forms`、`allow-popups`；这样插件脚本处于不透明 origin，无法直接获得父页面 Cookie/DOM、localStorage 或同源权限。
- 静态资源从服务端受保护、只读、按版本哈希寻址，例如 `GET /api/owner/plugins/:pluginId/versions/:hash/assets/:relativeName`。仅从该插件的该版本安全目录读取，真实路径不得由浏览器拼接；拒绝 `..`、反斜杠、符号链接、非普通文件、跨目录读、未声明文件、超大文件；限定 HTML/CSS/JS/SVG/图片 MIME，`nosniff`。
- 已核对 `app.ts` 的全局 `Content-Security-Policy: frame-ancestors 'none'`。只对**精确的插件 HTML 资源路由**给允许当前宿主嵌入的 CSP，不能放宽其他 `/api` 或 BOSS 页面；同时给插件页面单独严格 CSP（例如 `default-src 'none'; connect-src 'none'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`，根据自包含 JS/CSS 实际调整 `script-src` 与 `style-src`），不得依赖外部 CDN。
- iframe 与父页数据交互只能走 `postMessage` Host Bridge：验证 `event.source === 当前 iframe.contentWindow`、当前卡片/版本/随机挑战 nonce、消息 schema、最大体积、允许操作；`targetOrigin='*'` 仅因沙箱不透明 origin 必要，**绝不向它发送凭据、未授权数据**。页面加载切换时使旧 nonce 失效。
- 不给子页面直接调用任意 `/api/owner/*` 的能力。数据由父页/服务器按 grants 查询**最小投影**后传入，例如 `company.summary@1`、`goals.summary@1`；每个资源有字段级/条数级限制，禁止任意 SQL、任意 URL、任意路径或无界全库查询。
- 不把插件 HTML/JS 当作可信业务证据：插件显示的总额、状态只能来自服务端已核验投影；没有数据就显示“暂无真实数据”。

### 插件操作权限

- 首版 Host Bridge **只读**：如 `GET_DATA`，根据 allowlist 返回 JSON；`OPEN_DETAIL` 则由宿主处理。插件不能向 Host Bridge 传一个 URL 让其代理请求，也不能传 SQL/文件路径。
- 插件后台如需数据处理，优先复用已支持的 `pure-ast-json@1` 受限计算能力或受控 Task/Worker。需要周期任务就用现有 TaskPlan trigger；需要外部动作就走既有审批、Tool 权限、幂等及 UNKNOWN 回执处理。**不新增“每张卡片一套调度器”。**
- 如当前既有 Worker 接口无法表达某个后端能力，可以针对**一个实际插件用例**新增一个窄范围类型化 tool/adapter；不得因此开放任意 Node 执行、数据库文件读写、Shell 执行或密钥读取。
- P3 默认 A：权限 grant 应包括 `capability`、`scope`、可选过期条件、授予来源。原有不可逆高风险动作无论 grant 如何，仍由原服务要求逐次审批；不要在 V36 实现一个绕过原服务的通用 `EXECUTE_ACTION` 入口。

---

## 6. 老板对话 → AI 开发插件的最小链路

**不要新做一套自主 Agent 流程。** 现有 `OwnerChatService.route()` 已输出 `create_task`、`revise_task`；`OwnerWorkService.ask()` 负责计划/目标持久化、审批和幂等；Worker 可以 `save_artifact`，`CompanyArtifactService` 可验证产物。V36 仅补齐插件专属的“目标标记 + 提交候选 + 激活”闭环。

### 6.1 自然语言动作：两类路径

**A. 已有卡片的轻管理动作**（不耗模型，不要求公司 ON）

- 识别：`移除001卡片`、`隐藏 001`、`显示 001`、`恢复 001`（仅显示）、`回滚 001`、`停用 001 所属插件` 等带明确编号指令。
- “移除”语义固定 = `visible=false`，不删除；“恢复/显示” = `visible=true`，如插件不兼容/停用要给出清楚原因；“回滚”是版本切换，**不等于**重新显示。
- 把匹配范围限制为明确动词和严格卡片 ID；不要把普通任务语句 `停止任务 001`、含引号的历史文本、模型回答内容当作卡片命令。不存在/歧义 ID 返回准确错误；不猜测卡片标题。
- 使用当前 `/owner/chat` 的 `requestKey`/现有幂等能力，检查 `expectedRevision`；相同请求重试不重复变更，不同请求遇版本冲突返回 409。BOSS 对话给予简短真实状态反馈。

**B. 创建/修改卡片的开发动作**（走既有任务链）

1. `OwnerChatService` 的结构化意图为现有 `create_task` 或 `revise_task` 增加**一个小的插件交付标记**（具体字段名由 Codex 在现有严格校验允许字段中选择）。只在**本次老板消息明确要求插件/卡片**时接受；不能因为旧 history、网页内容、工具输出里写了“创建插件”就被授权。
2. 服务端独立校验本轮真实授权与 scope，并绑定到 Goal（`plugin_build_intent`），记录是否要求最终显示。普通 Goal 不获得 `SUBMIT_PLUGIN_CANDIDATE` 的权力。
3. 创建/修改卡片沿用原 Goal/Plan/Task 的预算与公司开关，但**不能让老板为同一个明确的低风险创建指令重复审批一次**：本轮明确 Owner 请求可作为一个严格受限的“只读卡片构建计划”授权来源；使用既有提案/批准 API 记录真实授权，不伪造批准。**该特例仅在服务端能够强制此 Goal 的工具白名单（例如读取已授权摘要、保存 artifact、提交候选、受限纯计算；禁止外部写、任意网络/文件、收款变更、APP_CODE/8766 发布）且金额在既有预算授权内时才能自动批准**；做不到上述强制隔离时，必须回退到原 TaskPlan 人工批准并在对话中明确说明，不能用 prompt 自称只读来跳过。敏感插件和普通经营计划继续走原审批。若公司 OFF，可创建待执行计划，但不得隐式开启公司；无预算不能擅自运行模型。
4. Worker 生成可运行的小卡片页、详情页、manifest，先 `save_artifact` 形成已核验产物（例如 `card.html`、`detail.html`、`plugin-manifest.json`）。
5. 新增 `SUBMIT_PLUGIN_CANDIDATE` 到 `CompanyToolService`：参数仅传**当前已核验产物的引用和目标 plugin/card 身份**，而不是由 AI 自报本地磁盘路径或直接覆盖代码；服务端验证 Attempt→Goal→批准的 Plan→版本，验证文件 hash/大小/格式，复制到隔离的不可变版本目录。**即使没有老板专属的 `plugin_build_intent`，一个已批准的普通 Goal 也最多只能提交无授权的隐藏候选，不得注册对外显示卡片、授予资源权限或自动激活**。只有存在与本轮老板指令绑定的精确授权时，才允许自动注册/修改并切换活动版本。
6. 对候选版本做最小安全、结构、内容与页面加载测试；成功后：
   - 若是**老板本轮明确创建且要求显示**、全部只读权限已在白名单内、无敏感授权缺口，则自动激活并分配新编号/更新指定编号，卡片 `visible=true`。
   - 若是 AI 自主建议开发、权限扩大、需敏感读写、测试失败或 owner 授权不明确，则只保留**候选状态**，不自动显示/不启用敏感能力，必要时进入现有关注事项等待批准。
7. 返回真实 `cardId/pluginId/activeHash` 或候选 ID、失败原因；不能把“文件已提交”当作“页面已启用”或“开发已验收”。

**并发要求**：同一个卡片同一时刻允许多个不同候选生成，但只有持有当前 `expectedRevision` 的请求能更新 active 指针；并发修改冲突时保留双方候选、拒绝覆盖，供后续重新基于最新版开发。不要无条件重试覆盖当前页面。

### 6.2 只读自动授权的具体边界

- 预先定义少量**真正安全、字段受限**的数据契约。**默认全部拒绝**，只有老板请求绑定的所需 scope 或事先明确授予的 grant 才可用。
- 页面申报 `read:orders` 不意味着自动允许读取客户敏感详情。`company.summary@1`、`orders.summary@1` 等接口要按敏感级别拆分，必要时让老板确认读取范围。
- 即使是“显示旧卡片”，若缺失现有 grant，也不能为了用户体验自动提权。
- 扩大权限/后台写操作需要单独的 Owner 许可；承诺不等于已授权。

---

## 7. 接口建议（仅最小集合，名称可按现有路由规范微调）

所有路径受现有 Owner Session 与 Origin/CSRF 校验，默认 `worldScoped:false`；按请求修订与幂等键处理状态变更。

| 接口 | 用途 | 副作用/说明 |
|---|---|---|
| `GET /api/owner/plugins/cards?visible=true` | 视察公司当前显示卡片 | 只读取 registry，不调用模型 |
| `GET /api/owner/plugins/cards` | 卡片库（含隐藏/不可用） | 返回精简 ID、名字、状态、版本，不返回原始密钥/私有路径 |
| `GET /api/owner/plugins/cards/:id` | 当前卡片元数据 | 提供插件及预览/详情资产 URL 和允许读取的投影契约，不直接包含敏感数据 |
| `POST /api/owner/plugins/cards/:id/actions` | `show / hide / rollback` | `{action, expectedRevision, idempotencyKey}`；事务化；重复请求幂等 |
| `GET /api/owner/plugins/:pluginId/versions/:hash/assets/:name` | 静态文件 | 验证当前可读的已安装版本与资源清单，独立 CSP；不提供任意目录遍历 |
| `POST /api/owner/plugins/:pluginId/data`（可由父页代理） | 受控只读数据查询 | `{cardId, version, resource, params?}`；服务端校验 owner session + grant + 资源 allowlist；不得成为开放 SQL/URL 代理 |

**第一版先不增加插件任意写 API。** 功能性后台动作经既有 Task/Worker/Tool 调用实现，且使用原审批和任务状态；如确有必要公开某一个新 action endpoint，必须是强类型、明确范围、可鉴权、可幂等、可查真实回执的单一业务动作，不能开放通用执行能力。

---

## 8. 分三个阶段执行（逐关验收）

### 阶段 A：薄宿主 + 持久化 + 页面加载（先确保 UI 和升级边界）

**改动范围**：新增一个 `CompanyPluginService`（或等价薄服务）+ 窄路由；在 `BossCompany.tsx` 替换固定列表，少量更新 `BossConsole.tsx`、`boss.css` 和双语词条；不动 Worker/Planner。

执行步骤：

1. 基线快照：记录 HEAD、dirty files、当前运行版、实例 Workspace 格式和 `system/control/control.sqlite3` 路径；准备独立测试 Workspace。不要用生产 Workspace 测试破坏操作。
2. 在控制 SQLite 增加最少插件及卡片注册表，无损初始化；复用数据库事务与 `requestKey` 幂等模式。
3. 完成独立版本目录校验/哈希/原子切换/恢复逻辑；限制文件、资源类型、容量及路径。**初始零卡片，不预装营销、财务等演示卡**。
4. 增加读取卡片库、显示/隐藏、版本回滚和安全的静态资产/数据路由。先仅通过测试/管理员开发 fixture 注入一个演示卡片，避免把演示数据写入生产初始化。
5. 将“视察公司”改成响应式卡片网格：编号 `#001`、标题、AI 自由呈现的预览 iframe；点击进入独立 `detail.html`（可在原弹窗内切换为详情视图并返回，不额外建设路由系统）。
6. 页面初始无卡片时只显示“等待老板开发”，有卡片时只显示 `visible=true`；隐藏卡片留在卡片库，只需一个低调入口。保留既有预算/收款/恢复必要入口的可达性，不能因为删去固定列表而断掉经营管理路径。
7. 实现沙箱 iframe 与双向消息校验、CSP 精确例外、前端错误隔离；插件 HTML 加载失败只在该卡片显示错误与重试/回滚入口。

**阶段 A 验收**：零卡片正确空状态；测试注册 `001` 并显示预览/详情；隐藏/显示不改后台事实；1000+ 编号无截断；iframe 无法直接访问 BOSS DOM/Owner API；数据桥只允许白名单；刷新/重启状态保留；注入错误 HTML 只影响单卡；中英及 390×844 正常。

### 阶段 B：老板对话 + AI 生成/修改的完整闭环

**改动范围**：`owner_chat_service.ts` 的极小结构化意图补充；`owner_work_service.ts` 的 Goal 绑定；`company_tool_service.ts` 增加一个候选提交工具；复用 `company_artifact_service.ts` 的验证；不造新 Agent/调度链。

执行步骤：

1. 明确区分“查看/咨询”与“开发/修改/显示/隐藏/回滚”指令。明确编号的纯管理操作优先走确定性分支；创建/修改走当前模型规划→Goal/Plan 提案→Task/Worker。
2. 实现 `plugin_build_intent` 的权限绑定，绑定本次老板请求的 Goal 与版本；未绑定的其他**已批准**任务可以提交无权限的待审候选，但无权自动安装/显示；未批准任务不能提交。自动安装时没有当前精确 Owner 授权则报 `PLUGIN_BUILD_NOT_AUTHORIZED`。
3. Agent 保存 `card.html / detail.html / manifest.json` 等真实 artifact；新增提交工具验证每个引用是否属于当前批准 Goal/Attempt（或原有显式授权的依赖证据），校验内容/hash 并只创建**候选**。如采用“无需二次审批的低风险开发”特例，必须增加服务端逐工具执行限制，不仅仅缩减模型提示词中的工具列表。
4. 编写最小独立候选校验：manifest 精确字段/大小、资源路径/MIME、页面能加载、桥接消息规范、声明资源是否在允许 scope 内。验证失败不得更新 active。
5. 显式授权且低风险的候选自动激活并显示；自主候选保存但隐藏；敏感 scope 留给既有 Owner 审批；修改旧 `001` 成功后只切换它的版本，保留前版。
6. 老板“把 001 移除/显示/回滚”通过 BOSS 聊天直接改变对应卡片状态，返回服务端已确认的结果；如果后端超时，要保留同一幂等键和“不确定”状态，不能悄悄二次创建卡片。

**阶段 B 验收**：独立测试公司中使用**真实的既有模型/任务接口或可控合成模型 fixture**，从老板话术创建第一张卡片；形成受核验 artifact；安装后 BOSS 可见；“修改 001”新增版本；隐藏/恢复/回滚均生效；普通任务不能自动安装/激活插件；AI 自主候选不自动显示；并发修订 409 不覆盖；重复同 key 只执行一次；OFF 不被卡片指令隐式改为 ON；预算规则照常生效。

### 阶段 C：真实数据/后台能力 + 升级/故障回归

**改动范围**：有限的插件数据源投影、测试、文档，不新增大框架。

执行步骤：

1. 实现首个**真实只读数据源**（推荐已存在的公司 Goals/Tasks 摘要；不暴露完整私人消息或账本），由宿主桥按 grant 提供 JSON。创建真实数据驱动的 `001`，校验“无数据时显示空、出现事实后显示变化、失败时标记过期”。
2. 验证**一个真实的后台处理流程**：通过既有已批准 TaskPlan/Worker 执行数据整理或受限纯计算，结果形成有哈希的 artifact/只读快照，并由卡片展示。后台任务与卡片可见状态解耦；**不做新的常驻插件进程**。
3. 若候选需要原有功能无法满足的具体后台动作，按照第 5 节为**这一个动作**设计类型化 Tool Adapter，并遵守权限、费用、回执/UNKNOWN、安全停止；无实际需求就不扩展此点。
4. 验证多个 World 或 Worker 的事实可汇总到一张卡片，不用为每张卡片创建 World。
5. 用隔离 Workspace 演练：重启进程；使用既有 8766 **兼容**软件发布/回滚路径（只进行无真实外部副作用的测试）；确认插件源码、注册表、编号、数据、权限和版本仍在；不兼容宿主版本拒绝激活，但不删文件。
6. 全面故障注入：非法 manifest、恶意 HTML、路径穿越、符号链接、旧版 API、不足权限、断网、读数据超时、Worker 崩溃、工具 UNKNOWN、部分版本写入中断；验证卡片级/任务级隔离，公司其他任务、订单、收款事实不变。
7. 更新 README_CN / README（英文为主，中文版对应）及简短的插件目录/如何从 BOSS 创建卡片使用说明。不要重写部署指南。

**阶段 C 验收**：卡片显示真实可追溯的公司摘要；已批准后台任务可产出数据，隐藏卡片不影响任务；敏感行为不能直接从 iframe 执行；故障局部隔离；升级与兼容回滚留存；原有 BOSS 首页、预算、订单、收款、UNKNOWN 恢复与任务闭环全部通过回归。

---

## 9. 关键自动化测试矩阵（必要，不做虚假通过）

| 场景 | 预期 |
|---|---|
| 空公司首次启动 | 无卡片，显示“等待老板开发”，不预设编号 |
| 创建卡片 | 通过已授权 Goal + Verified Artifact，成功注册才分配 `001`；安全白名单满足时老板一句话可直接开发，不能满足时明确等待计划审批 |
| 同一请求断线重试 | 幂等，不能出现两张 `001/002` 重复卡 |
| 002 创建失败 | 已有 001 不受影响；失败候选不占用下一个编号 |
| “移除 001” | 只 `visible=false`；插件源码、版本、后台任务、其他卡片仍存在 |
| “显示 001” | 原编号与原授权恢复，缺权限明确拒绝 |
| “修改 001” | 生成新版本，切换前持续显示旧版；失败无损 |
| “回滚 001” | 只切换到上一已验证、兼容且授权的版本；数据不回滚/不清空 |
| 1000 张编号 | `999` 后为 `1000`，从未重用或混淆 ID |
| 旧 iframe 偷发 `GET_DATA` | 验证版本/nonce/source，拒绝过期帧 |
| iframe 企图访问 Cookie/父 DOM/API | 沙箱/策略阻止；宿主不回传秘钥或宽泛 overview |
| 插件请求未授权订单详情 | 403/明确拒绝；不能升级 grant |
| 自主候选 | 已批准 Goal 可保存无权限候选，但不自动安装、显示或拿到编号 |
| 低风险自动批准尝试使用高风险 Tool | 服务端拒绝，不能靠模型指令限制替代权限校验 |
| 隐藏后定时后台任务 | 已获授权任务继续、成本和状态仍由原账本记录 |
| 插件异常或超时 | 卡片局部故障，原公司自动开关、其他 Task 不受影响 |
| 外部动作结果 UNKNOWN | 原 Attempt/回执/费用预留保持，不自动重试/清零 |
| 公司 OFF | 允许读库及隐藏/显示操作；不执行新的后台任务、不自动开机 |
| 主程序升级/兼容回滚 | cardId、代码、数据、grant、active 指针不消失；不兼容版本拒启不删资产 |
| 中英/手机 | 词条正确、卡片/详情可操作，390×844 无横向溢出 |

### 命令与证据

基于当前仓库的测试方式（如本地脚本发生变化，优先执行仓库最新规定）：

```powershell
pnpm.cmd typecheck
pnpm.cmd --dir frontend test
pnpm.cmd --dir frontend build
pnpm.cmd test --maxWorkers=1 --testTimeout=30000 --hookTimeout=30000
git diff --check
```

新增的定向测试建议命名：

- `apps/server/tests/company_plugins.test.ts`：持久化、编号、权限、候选提交、版本、回滚、路径校验、故障隔离。
- `apps/server/tests/company_plugin_chat.test.ts`：真实 `requestKey` 与 Goal/Plan/Tool 绑定；显式/非显式指令；版本冲突；公司 OFF。
- `frontend/tests/boss_plugins.test.tsx`：空状态、卡片库、详情、错误、iframe 通讯、手机与双语。
- 尽量**复用**原测试 fixture；不得新建复杂端到端测试基础设施才能跑一个卡片。

> 测试不能以“接口返回 200”代替真实结果。要验证 DB 实际行、磁盘哈希、iframe 不越权、已有 Task/订单/账本未变、版本切换后真实内容改变。

---

## 10. 完成定义与禁止事项

**V36 真正完成的条件**（以下都必须满足）：

- [ ] 在一间**空**公司点击“视察公司”，看到“等待老板开发”，无预置卡片。
- [ ] 在 BOSS 下达创建命令，能生成并安装实际可用的 `001` 页面（未授权时只排队/等待审批）。
- [ ] 001 展示真实只读数据，并能打开 AI 自由开发的详情页。
- [ ] “移除 001 → 显示 001 → 修改 001 → 回滚 001”全部真实生效、跨重启保持。
- [ ] AI 可独立生成候选但不会未经老板要求自行显示，敏感 scope 不会自动授权。
- [ ] 至少一条原有 Worker/Task 参与的后台数据流程被卡片消费；**不新增第二套调度/执行引擎**。
- [ ] 插件故障不导致公司 OFF、不丢账单、不影响无关任务。
- [ ] 受控升级/兼容回滚保留插件库；单项插件不兼容只停插件不删数据。
- [ ] 全部新增功能双语可用；原 BOSS 主指标/重要消息、商城、预算、支付、回执、恢复路径回归无破坏。
- [ ] README/README_CN 更新；每阶段测试证据和实际变更列表完整。

**明确禁止**：

- 让插件持有原始 Owner Cookie、钱包私钥、API Key 或全量 `OwnerOverview`；
- 将 AI 生成的 JS 直接注入主 React DOM 或服务端执行任意 TS/Node/Shell；
- 插件获得 `SQL/文件系统/网络/外部写` 无界权限；
- 修改主程序时清空旧 Workspace、数据库、Goal/Task/回执/订单；
- 卡片 hidden 自动停止业务、后台异常修改公司 desiredMode；
- 为“万能扩展”提前建设一套新插件调度器、Agent 身份体系或独立支付模块。

---

## 11. 本地执行与交付回报格式

1. 先 `git status --short`、`git log -1 --oneline`、阅读 `AGENTS.md` 与最新 README，记录与本计划基线是否有差异。**本机存在未提交修改时先保护/隔离，不得覆盖**。
2. 阅读第 2 节所列具体源码和 V35 权威边界文档，形成最小文件改动清单；除非实际编译/测试需要，不触碰无关代码。
3. 实施阶段 A，完整验证。再阶段 B，完整验证。最后阶段 C；每阶段可独立回退。建议形成顺序清晰的本地 Git 提交，除非已有不同的用户工作流要求。
4. 需要新能力时先检查现成服务和测试，能通过适配器接入绝不复制同类状态/调用链。
5. 不擅自推送、正式发布、切换生产版本或发起有成本/外部副作用的真实运行。生产发布单独走既有 8766 Owner 精确审批。
6. 如果发现不可安全自动实现的“AI 独立后台代码运行”，**不得以放开任意代码执行凑功能**。交付通过既有受控 Worker/Tools 实现的后台能力，以及明确的剩余技术限制；不因此阻塞已验证的只读卡片闭环。

交付时提供一份简洁报告：

```text
V36 执行结果
基线/最终 commit：
阶段 A/B/C：PASS / PARTIAL / FAIL（逐项真实说明）
新增文件：
修改文件：
新表/兼容规则：
主要安全边界验证：
实际运行测试与结果：
演示步骤与 cardId：
未完成事项（不得伪称已完成）：
发布说明：未发布 / 已经用户单独批准发布（附真实证明）
回退操作：
```

**最终取舍**：实现一个可靠的公司级插件宿主，让 AI 自由生成卡片与详情页、调用已授权真实数据、使用既有 Worker 完成后台工作；不要为了形式上的“万物皆插件”破坏 EmergentInc 已经建立的经营事实与安全闭环。
