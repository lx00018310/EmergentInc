# V22 修订计划实施记录

日期：2026-09-30。执行依据：[修订版主 Plan](EmergentInc_V22_生命循环执行_PLAN.md)。

## 基线与 Git

Owner 要求覆盖原提交 `1303a4a458ce58fc484fcb06a31b01f3235f807b`。既有四阶段实现、四类 Review 修复与计划文档已合并为 `f0907e4443e49070f9a31e9f1e1cdf384d63d4cf`，父提交仍为 `21e2635`。使用绑定旧远端 Hash 的 force-with-lease 推送，已核实本地与 origin/main 一致。

该提交包含的是先前工作。Owner 随后要求补齐本机受控升级并保留人物和运行记录，完成后提交推送全部源码与文档改动。`.env`、测试日志、数据库和快照不入库。

## P0：基线、分层与副本迁移演练

已完成只读盘点及 Core → Lineage 副本合并演练。没有启动正式 Run、模型调用或外部动作，没有迁移正式数据、更新代际指针或修改 Current 的 Gene Hash。

### 本机数据证据

| 数据库 | 用户版本 | 表数 | 总记录数 | quick_check / 外键错误 |
| --- | --- | --- | --- | --- |
| ledger/v9_core.sqlite3 | 0（版本另存 schema_meta） | 44 | 107 | ok / 0 |
| lineage/lineage.sqlite3 | 2 | 20 | 3 | ok / 0 |
| generations/G0001/current.sqlite3 | 1 | 7 | 1 | ok / 0 |
| ledger/business.sqlite3 | 不存在 | — | — | 未创建 |

盘点只输出表结构、计数、主键、引用和指定未决状态计数，不输出人物、消息、模型响应或凭据内容。不存在的数据库只记 MISSING，不初始化空库。已知 Run、模型、预留、消息、工具及 business Operation 未决谓词的计数为 0；这不替代后续正式切换前重新盘点其他领域的待处理状态。

SQLite online backup 与报告保存于忽略目录 `cache/v22-p0-snapshot-20260930/`。副本合并产物位于 `cache/v22-p0-dry-run-20260930/`，逐表校验报告为 `cache/v22-p0-dry-run-report.json`。

| 源快照 | SHA-256 |
| --- | --- |
| Core | 1d91c23302b709e4373454c6b9ddf6e743c10d9c2f5ab7e69932c9354c710420 |
| Lineage | 8eb524ae184ffbb369db240d2aac363aa74210b952e93fe6829d714320c2c4f7 |
| Current | 3e730ec593ce65059d697ebc5d1cddec04e1f7e9ccc225c3b289930b965c63e6 |

副本合并使用当前真实 CoreStore schema，在新的 Lineage 副本中创建 Core 表。44 张表逐表校验全部原字段与记录内容 Hash；原有 20 张 Lineage 表另逐表比对，外键及 quick_check 通过。脚本拒绝已有目标目录、同名源/目标表和未知字段，不在冲突时覆盖记录。

### 数据归属决定

不能把旧元胞表机械拆入两个数据库。`CoreStore.settleAndStoreModelResponse` 需要预算结算、响应保存、消息推进的单一事务；新的两库结构应保留该原子性。

| 既有表/数据 | 目标与恢复规则 |
| --- | --- |
| global_budget、pixel_accounts、reservations、model_calls、owner_chat_calls、gacha_model_calls、tool_executions、effects、ledger_entries、recovery_decisions | 原 ID/未知结果/账务事实保留于 Lineage；不随 Current 回退。Run token/能量和 business 货币预算仍需明确适配，不能直接相加 |
| runs、messages、executions、execution_participants、execution_evidence、missions、mission_participants | 原始记录和效应处理事实保留于 Lineage，使模型结算和消息推进继续同库事务；Current 只放本代可继续工作引用与短期上下文。旧租约/已处理消息不重放 |
| qianji_profiles、qianji_bindings、qianji_narrative_revisions、qianji_chat_turns、qianji_meetings、qianji_meeting_participants、qianji_meeting_messages、qianji_approval_requests、qianji_conclusions | 身份、绑定及沟通/决定证据进入 Lineage，保留逻辑 ID；本代活跃引用由 Current 管理，跨代检查有效性 |
| qianji_draws、gacha_pity、gacha_images、recruitments、trials、trial_candidates | 保留人物产生与试炼事实于 Lineage；是否继续正在运行的试炼需显式迁移判据，不自动重新抽取或扣费 |
| products、product_missions、customer_feedback、deliveries、revenue_contributions、narrative_artifacts、external_revenues、external_refunds、external_reward_requests、owner_action_requests、world_events | 原始事实进入 Lineage，不伪装成新的已授权 business 订单/付款或经验；需要语义映射时留来源证据 |
| schema_meta | 保留旧 schema 版本证据；正式升级时由受控迁移器记录新版本，不靠猜测字段覆盖 |
| 现有 business_*、generations、memories、dream_runs、gene_proposals、life_events | 延用现有 Lineage；business 调度职责需在 P2 接入唯一 Run 主链，不能同时派发相同任务 |
| current_meta、pixel_working_state、objectives、body_skills、body_needs、body_candidates、current_events | 延用 Current；后续扩展真实源码候选、前后端引用及受控跨代续接 |
| live 下的世界、环境、元胞文件和交付物 | P2 增加按 Generation 的访问/来源适配；本次未搬迁文件。凭据留在 private，不进入候选或遗传内容 |

将原始事实存入 Lineage 不等于把所有行变成 Memory。当前状态投影不形成第二套预算/效果权威；正式切换时旧 v9_core 退出写入。副本可复制成功只证明物理/结构迁移可行，不证明调度、授权或业务语义已经接好。

### 代码分层与依赖方向

| 层 | 现有/新位置 | 本阶段处理 |
| --- | --- | --- |
| Root | 已安装 supervisor、固定验证器/控制入口；新增 apps/recovery | Recovery 不导入 server、Store、模型或 Body；Gene Patch 明确禁止改 apps/recovery |
| Gene | protocol 基础约束、persistence、runtime 强制调度/效应规则、能力代理及预算核验 | 保留；后续拆出可变局部策略，不能删除 Run/消息/协作 |
| Body | frontend 的实际产品组件、server 的具体业务实现/工具/流程 | 仍在旧目录中；P1/P3 需要提取 R0 与隔离源码产物，当前未解除 protected_paths |
| 文档/产物 | README、docs、构建输出 | 目标不纳入 Gene 内容；历史旧算法纳入 frontend README；本次 V2 切换排除 README/测试/显示代号，实际 Body 源码仍受保护 |

Hash 算法、Body 目录和共享运行接口升级需作为受控变更；本次没有直接更新现有 workspace 的 Gene Hash。新开发代码改变了受保护源码，不能把旧生产 workspace 直接当成无需升级即可启动的验收环境。

## P1：独立恢复服务基础部分

已新增 `apps/recovery/`，只依赖 Node 内置模块，无第三方依赖。已纳入工作区 TypeScript 构建与 lockfile。

已实现：

- 独立进程、`/GENE` 静态页面、专用 Owner 认证、8 小时会话、限速、退出。
- 固定 Host/Origin 校验，POST CSRF 校验，Host-only/HttpOnly/SameSite Cookie，生产 Secure，CSP 与禁止嵌入。
- 仅探测配置中固定的 Body 健康地址；不转发 Owner Cookie，不跟随跳转，限制超时/响应大小，只返回白名单诊断字段。
- Body 不在线、Current 损坏、没有前端 bundle 时仍可登录和诊断。恢复 Host 不打开任何业务数据库，不抢业务 workspace 锁。
- 可信控制执行器未连接时页面明确只读，没有伪造成功的恢复/审批按钮。
- Supervisor 拒绝普通 Gene Patch 改写恢复服务。

**P1 尚未完成：**固定权限控制通道、Body 版本恢复、可信准确审批、`/QIAN`/`/YUAN` 同一公开入口壳、不同 origin 的真实 Body UI 消息桥及浏览器故障验收均待实现。当前独立端口只用于基础部分验证，不能当成最终三地址产品整合。

### 本地启动独立诊断服务

从根目录运行；口令由操作者设置为至少 32 字符的随机值，必须与可变 Body 的口令分开。不要在仓库中保存真实口令。

```powershell
npm.cmd run build
$env:EMERGENTINC_RECOVERY_SECRET = '<独立随机恢复口令，至少32字符>'
$env:EMERGENTINC_RECOVERY_ORIGIN = 'http://localhost:8766'
$env:EMERGENTINC_BODY_ORIGIN = 'http://127.0.0.1:8765'
node apps/recovery/dist/main.js
```

打开 `http://localhost:8766/GENE`。现有 Body 脚本未改端口，不自动停止用户正在使用的实例。Recovery 不读取项目 `.env`，Body 与 Recovery 必须使用不同 Cookie host，不能只换同一个 host 的端口。

### 验证状态

已通过类型检查，以及恢复/盘点/代际监管相关测试。真实进程测试使用编译后的 Recovery 与独立模拟 Body 后端，实际终止 Body 进程后再检查登录会话和诊断；损坏 Current、缺失前端资源的场景没有初始化新库。该证据不等于真实浏览器隔离或 Linux 权限验收。

全量回归最终通过：67 个测试文件、464 个测试；类型检查、Recovery 页面脚本语法及差异检查通过。首轮 4 worker 下一个已有代际迁移测试触及 5 秒超时，相关测试单独运行通过；改用 2 worker 全量复核后全部通过，未修改超时或断言。日志保存在忽略目录 `cache/v22-p0-p1-tests.log`。

P2–P5 尚未实施，P1 的控制通道、入口/消息桥与浏览器隔离继续待做；Linux 实机验收继续暂缓。

## 本机受控升级与启动恢复

### 原因与范围

G0001 的 Lineage 和 Current 保存的 Gene Hash 一致，指针与接口也一致；开发源码变化导致源码 Hash 不同，触发 `ACTIVE_GENOME_MISMATCH`。本次补充的是 Owner 主动执行的 Windows 本机维护工具，不是系统自主 Gene 批准，也不开放网页切代或放宽现有 Hash 校验。

该最小流程适用于没有未决外部效果、没有待整理生命事件的本机初始状态。存在未处理生命事实时明确要求先完成 Final Dream；存在未知调用、费用、活跃 Run 或其他进程占用时拒绝升级。不能把这一工具解释为所有运行状态的通用迁移器。Linux 继续使用独立安装的可信 Supervisor。

### 流程与约束

1. `prepare` 取得 workspace 锁，只读核对当前代/指针/接口、旧元胞未决状态和新 manifest 代号。
2. 对 Lineage、旧 Current、旧元胞 Core 库做 online backup；备份 `live` 与旧 Body 文件。保存完整性、表内容指纹与备份 Hash。
3. 另建新 Current，沿用已有白名单迁移器；在复制双库上启动真实编译后端，验证 Owner 认证、健康、生命接口及候选副作用禁用。
4. 冻结准确候选 Hash，绑定旧代、源码 Hash、编译产物、数据指纹、准备好的 Current 与验证结果。`apply` 要求准确 Hash 和 Owner 的明确维护原因，过时源码/数据会拒绝。
5. 记录授权与 BIRTHING 意图，再创建新代、复制 Current、切换指针。升级标记阻止普通启动器在切换中途抢占；只允许带一次性 token 的暂停启动进程。
6. 正式 workspace 上的后端先暂停业务；健康、准确 Generation/Gene Hash、登录与前端资源通过后，原子更新 Lineage 中的 ACTIVE/RETIRED 状态，再恢复业务派发。
7. 启动失败保留失败 Current、提案与记忆，恢复升级前指针；不覆盖 Lineage。进程中断可显式 `recover`，数据库已提交而日志未更新的情况不会误回退。

旧代 Hash 不被覆盖，旧库、人物和 Run 不被清空。失败时恢复的是升级前代际状态；历史 G0002/G0004 收据没有冻结代码，因此恢复还依赖对应旧源码。本次新增的发布均保留完整冻结版本；恢复指针后启动器只选择与该代匹配的批准发布，没有冻结旧版本时明确拒绝启动。

### 命令

先检查改动、测试并构建，使 `genome/manifest.json` 中的目标代号与下一代一致。以下使用新的操作 ID；不要重用已有 ID 或自动从启动器调用：

```powershell
npm.cmd run typecheck
npm.cmd test -- --reporter=dot --maxWorkers=2
npm.cmd --prefix frontend run build
node scripts/local-upgrade.mjs prepare workspace local-owner-upgrade
# 审阅输出及 workspace/runtime/local-upgrades/local-owner-upgrade/record.json
node scripts/local-upgrade.mjs apply workspace local-owner-upgrade '<准确candidateHash>' '<Owner明确维护原因>'
```

`apply` 成功后服务已经在后台运行，无须再双击启动脚本。需要正常重启时先停止该服务，再使用原启动方式。候选准备和正式启动使用明确的既有 workspace，不自动换成空库。

升级被中断时，确认占用 workspace 的旧进程已经停止，再运行：

```powershell
node scripts/local-upgrade.mjs recover workspace local-owner-upgrade
```

该命令拒绝正在运行的进程锁，不会猜测 PID 并杀死其他程序。恢复记录的状态和原因要检查后再继续；不要手工删除 pending 标记来绕过互斥。

### 实际执行证据

- 操作 ID：`local-20260930-g2-v2`，状态 `COMMITTED / RUNNING`，服务地址 `http://127.0.0.1:8765`。
- 准确候选：`4a70ea5d71a3ee4e8317ce8d69455d1cc6fd1c3da2c0ae6b81c79d9c78f76d1a`。
- G0001：RETIRED，原 Hash `08fba6fc8c7b73b8627b3cb45d9dad6bceb2163754a1e8fa82ae0b04e75e31e6` 保留。
- G0002：ACTIVE，Hash `aa88ba661b20312cbdc53502b8e413c0f70f05d077708b7be585f9a14fa5889c`；真实健康响应与该 Hash 一致。
- 旧元胞库全量表内容指纹不变：3 位人物、5 次 Run、12 条消息、12 次模型调用记录保留，`live` 内容指纹一致。
- G0001 Current 仍保留；Lineage 保留原记忆，并新增 Owner 升级提案、准确候选绑定与出生记录。
- 升级前无待整理生命事件，Final Dream 记录为 `NO_NEW_FACTS`；升级后 business Operation 与费用条目均为 0。
- 备份、候选副本、授权记录及服务日志均在 `workspace/runtime/local-upgrades/local-20260930-g2-v2/`，不进入 Git。

首次准备在备份完成后因本机 Node 的 `fs.cpSync` 在中文目录下异常退出；指针和正式数据未切换。单独复制探针复现，改为逐项检查普通文件并使用 `copyFileSync`，同时将升级测试目录改为中文路径。Node 官方有相关非 ASCII 路径修复记录：[nodejs/node #61950](https://github.com/nodejs/node/pull/61950)。失败准备目录保留作证据，不自动删除或覆盖重试。

本次没有把旧元胞数据接入 business 页面；数据保存与 P2 的界面/运行链统一是不同验收项。当前后台仍是既有 business 模式，不能把成功启动解释为整个修订计划完成。

最终本机验证：68 个测试文件、471 个测试全部通过；类型检查、前端构建、差异检查通过。新增升级用例涵盖准确批准、保留数据、过时输入、占用锁、启动失败、创建 Current 前中断、数据库提交/日志更新间中断、未整理事实及缺失 token。前端仍有既有大 chunk 提示；SQLite 实验性提示和 jsdom canvas 提示没有被抑制。

## 页面归位：QIAN / YUAN / GENE

Owner 最新确认：整个经营工作台放到 `/GENE`，包含预算、方案、资料、连接、结果和生命管理；`/QIAN`、`/YUAN` 恢复人物与元胞界面。本决定替代此前把工作台组件拆入 Body 两页的位置安排。

已完成：

- `OwnerEntry` 按 URL 选择页面；`/` 登录后进入千机阁，session.mode 不再把所有地址替换成工作台。`/gene/` 规范为 `/GENE`。
- Body 与工作台分别按需加载；正常登录为“登录元胞会社”，Gene 登录保留“登录经营工作台”。工作台保留原有全部功能，并能返回千机阁。
- 默认业务启动同时装配原 Run/World/Qianji 服务，注册人物、世界、招募、会议、Run 和经营/生命接口；没有仅换前端后留下 404。
- 候选/升级暂停状态同样阻止 Body 写入和 Run 启动；候选模式不加载正式模型或图片凭据。真实候选烟测增加人物、世界、Run API 与 Body 副作用门禁。
- 修复旧启动路径在 `listen` 后注册 `onClose` 导致 Fastify 拒绝启动的问题；关闭/暂停生命服务时会停止并等待正在运行的 Run。
- 本机维护工具识别有准确候选和终态日志佐证的既往成功/失败 Owner 升级收据，保留这些结构化事实，不伪造一次模型 Dream。其他未整理工作事实、未知费用/效果仍阻止维护升级。
- 同步根 README、前端 README、主 Plan 和 V22R 指向；前端启动说明已纠正为 Node/Fastify。

### 升级中的数据保护与结果

G0003 正式暂停启动时，旧 CoreStore 初始化会无条件更新 `global_budget.updated_at`。严格指纹核验捕捉到这一非业务写入，G0003 被标记 FAILED，指针恢复 G0002；没有删除失败记录或复用代号。

已将预算初始化改为存在时不写入，补充重复打开 Core 库不改变金额及时间戳的测试。逐表确认唯一差异是本次启动写入的时间戳后，恢复该字段的备份值；人物、Run、预算数值、预留、消息和模型调用记录均未改变。

随后完成 G0002 → G0004 受控升级：

- 操作：`local-20260930-g4-routes`，状态 COMMITTED / RUNNING。
- 准确候选 Hash：`6b2c3615cb4f3a09dd0fdb115107d4bb91c91f154f330a93b366233348a8a4bc`。
- Gene Hash：`cfff952c307a8672d28763831b3d16d38248aac6e2dbe3d41460c8a8ab5f63db`。
- G0001/G0002 及其 Hash 保留，G0003 的失败历史保留，G0004 ACTIVE。
- 重启与浏览器检查后，旧元胞库全量内容指纹一致；3 位人物、3 个元胞、5 次 Run、12 条消息和 12 次模型调用记录保留。

### 验证

类型检查、前端构建、69 个测试文件/480 项测试全部通过。真实 Edge 浏览器登录并检查：

| 地址 | 实际页面与行为 |
| --- | --- |
| `/QIAN` | 千机阁与千机名录显示原有 3 位人物，没有经营工作台标题 |
| `/YUAN` | 原元胞界面和返回千机阁按钮，世界/Run API 均 200，没有经营工作台标题 |
| `/GENE` | 完整经营工作台，方案、连接与资料、生命页可用，显示 G0004，并能返回千机阁 |

浏览器没有 pageerror。截图在忽略目录 `cache/QIAN-verified.png`、`cache/YUAN-verified.png`、`cache/GENE-verified.png`，测试日志在 `cache/v22-three-routes-final-tests.log`。只进行了登录、读取和页面切换，没有提交付费任务。

本轮完成页面及接口共存，尚未完成经营任务与多 Pixel 的统一预算/调度、真实 Body 源码生长、自动 Gene 候选或完整工作台的独立进程故障隔离。三个产品地址目前仍由同一个应用进程提供，独立 Recovery Host 只是已有的诊断原型；Linux 实机验收继续暂缓。


## 稳定启动修复：冻结批准版本

### 重复故障的根因

G0004 保存 Hash `cfff952c…`，开发目录新增四层生命控制台后变为 `918a5ec7…`。这是有效源码变更，严格校验拒绝启动符合设计。旧维护工具只批准当前 checkout，却仍从可变 checkout 启动；启动脚本又每次重新构建，后续修改必然再次触发不匹配。旧算法还把换行符、测试、README 和代号变化计为 Gene 变化。

### 修改与边界

- 受控准备先复制代码和编译产物，在新发布目录执行 `pnpm.cmd install --offline --frozen-lockfile --ignore-scripts`。发布不复制 `.env*`、私有目录、数据库或原 `node_modules`；依赖工作区链接须完全位于发布内。
- 准确候选绑定冻结发布完整 Hash。副本烟测和正式暂停启动都运行该发布；批准前后复查完整性，发布被改动时拒绝执行。
- `.bat`、`.ps1` 和 `launch-approved.mjs` 根据活动指针、Lineage、Current、Owner 收据与完整发布 Hash 选择版本；正式日常启动不重建开发目录，不批准新源码，也不在损坏发布时降级到 checkout。首次空生命库单独冻结初始版本。
- `gene_hash_version=2` 显式启用稳定 Hash；保留 V1 算法。V2 排除 README、测试和 manifest 显示代号，统一有效 UTF-8 文本换行；运行代码、依赖、契约、Prompt 和二进制仍参与 Hash。Body 源码隔离尚未完成，没有提前移除其保护。
- 启动、冻结和升级命令列为 Root 维护范围，普通 Gene Patch 不能改写这些入口。Windows 同一管理员账户下提供完整性核验，不声称已经实现 Linux 权限隔离。

现有本机数据需要一次受控升级以安装冻结发布。之后编辑源码、重建、修改说明或重新检出，不再影响已批准版本的正常重启；需要启用新功能时仍须走批准流程。未决生命事实仍要求 Final Dream，未知效果或活跃 Run 仍阻止升级。本次不会自动模拟 Dream 或清空记录。

### 验收目标

自动测试覆盖 V1 兼容、换行和非运行文件稳定性、真实代码变化、准确批准、过时输入、发布篡改、私有配置排除及外部链接拒绝。另在本机正式 workspace 验证受控升级、重复真实进程重启和三个页面，比较原 Core 全表及 live 指纹。
### 实际结果（2026-10-01）

- 操作 `local-20261001-g5-frozen-v3`：COMMITTED / RUNNING，G0004 → G0005。旧代和旧 Hash 原样保留。
- Gene Hash：`08bdb52a7fa91c54be483749746806768cdba5cfda36090e72e23bb88730e976`。
- 准确候选 Hash：`4ba0a36473175401231396d618c27cbc37302b8895d48826c04b9980d9510e79`。
- 冻结发布 Hash：`287d6d48601edc9329d71f64efa9c737020f9c6f7d96d23819af885759fe09d4`。
- 旧 Core 全表指纹 `80352258…`、G0004 Current 全表指纹 `96c036cc…`、live 内容指纹在升级及两次重启后均不变。保留 3 位人物、3 个元胞、5 次 Run、12 条消息与 12 次模型调用。
- 实际插入临时未发布 Gene 源码，使开发 Hash 变成 `a1c0d10e…`，重新运行后端构建，再连续两次启动已批准发布。两次 `/health/ready` 都报告 G0005 和批准 Hash；临时文件已移除，源码 Hash 恢复一致。
- 独立空 workspace 在 8767 端口首次冻结并启动 G0001，停止后再次启动同一批准初始发布，通过。该验收实例已停止，正式 8765 服务继续运行。
- Edge 登录与读取 `/QIAN`、`/YUAN`、`/GENE` 通过，三个原接口 200，无 pageerror。`/GENE` 显示当前 G0005 与四层生命控制台，经营、方案、连接与资料仍可访问；返回千机阁正常。
- 最终 71 个测试文件 / 496 项测试全部通过；类型检查、前端构建、差异检查通过。SQLite 实验性提示和既有 chunk 大小提示仍存在，未通过隐藏提示代替修复。
- 首两次准备因发布复制规则发现问题而拒绝：`runtime` 目录排除误删 `packages/runtime`，以及把 `.tsbuildinfo` 当作执行产物核验。已保留正确运行包、排除构建元数据，并给本机冻结与原 ReleaseBuilder 添加断言；当时正式数据和指针尚未改变。失败准备目录保留，没有创建失败新代或复用操作 ID。

证据位于忽略目录：`cache/stable-launch-final-tests.log`、`cache/stable-launch-before.json`、`cache/stable-launch-after.json`、`cache/approved-restart-server.log`、`cache/initial-launch-server.log` 及 `cache/*-frozen-verified.png`。准确授权、备份、发布与升级日志在 `workspace/runtime/local-upgrades/local-20261001-g5-frozen-v3/`，不提交私有配置或运行数据。

本次结论：重复 `ACTIVE_GENOME_MISMATCH` 的启动流程缺陷已修复，严格校验继续有效。自迭代执行链和完整 `/GENE` 进程隔离仍按主 Plan 待完成；Linux 实机验收继续暂缓。
