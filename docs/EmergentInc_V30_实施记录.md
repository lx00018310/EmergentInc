# EmergentInc V30 实施记录 / Implementation Report

日期：2026-10-13。源码基准：`c5f2347d0e4c340420a7268c7b403e7ff99abc48`，分支 `develop`。交付为开发候选，不部署、不运行真实付费模型、不操作真实钱包。

## 本地基线与实施顺序

V29 已在本地源码完整落地并提交。实际部署实例的独立只读核验结果为 `G0023`、Release `local-def1443e-b328-4fe8-83be-f61bfb0c935e`、已批准 Gene 资产 0、尚无 `owner_goals` 表。部署批准记录的 Core SHA 为 `86b133e2892db1e4f14e153df86a41b785ed3867`，Release hash 为 `d29fc96c5a68567fc61569846e57ceb1d97d290836c5834b1544399cec240656`。实际部署的 Release 完整性、维护批准及 Current 身份检查通过。本次没有修改、重启或升级这个 Workspace；V29/V30 行为使用隔离数据验证。部署版本与开发源码不混同。

按 S1 → S2 → S3 执行。S1 的 Gene 继承及既有发布回归先通过，再接入 S2 纯扩展；S2 沙箱/权限/CAS 回归通过后接入 S3 兼容与候选隐私检查。

## S1：官方 Core 候选继承公共 Gene

`freezeLocalRelease()` 增加一个可选、可信的 prepare hook，执行顺序为复制白名单 → hook → 原有离线依赖安装 → 全量哈希。默认调用行为保持。`version-upgrade.mjs` 的 HEAD 与 `--commit` 入口在同一公共 prepare 分支使用该 hook；实际 ACTIVE 来源取 `approvedWorldRelease()`，不以 Git main 代替运行版本。

新 helper 只读 ACTIVE Release、Lineage 与批准源快照，交叉核对资产、历史版本、原提名、Owner 分享/隐私/License 审查、BORN proposal 及 generation。SHA-256、版本、kind、License 或来源缺失均停止。只把公共批准资产复制到新私有候选，保留所有已批准历史文件；索引只选择核实的现役版本。

同 ID 的不同现役版本、同版本不同哈希、大小写别名及 License/kind 差异报 `GENE_ASSET_UPSTREAM_CONFLICT`；不自动降级或选一方。未批准 Body 草稿不导入。新 Core 的 manifest 不被旧 manifest 覆盖，仅按既有发布流程设置目标 generation。

候选中的 `instance-compatibility.json` 记录继承 fingerprint 和 Core 的非资产 Gene 基线哈希，并纳入完整 Release 哈希。以后发现非资产 Gene 定制时，停止并报 `CUSTOM_GENE_PATCH_NEEDS_REBASE`。历史 Release 没有来源元数据时，只在可核对批准来源提交，或其非资产 Gene 与输入 Core 一致时自动处理；来源无法确定时保留原 Release、停止自动继承。

验证和发布前再次检查基线及继承资产。旧候选缺少继承清单且实例已有批准 Gene 时要求重新准备；目标文件检查始终以实时批准账本为准，不信任候选自行缩短的清单；相同 catalog 字段的顺序不构成冲突。新的继承不是新的一次 Gene 晋升；普通 Gene patch 仍从 ACTIVE 构建，不重复导入。新公共能力仍按原方向批准与准确候选哈希批准形成 Generation。

## S2：World 私有纯扩展

只新增文件包装服务，不增加 Agent、调度器、数据库或插件宿主：

```text
worlds/<worldId>/extensions/<id>/versions/<sha256>.json
worlds/<worldId>/extensions/<id>/active.json
worlds/<worldId>/extension-data/<id>/   # 用户独立数据，解释器不能访问
```

版本文件冻结规范 manifest、来源 World 和创建 Pixel；内容身份以 SHA-256 为准，semver 仅为显示标签。相同 actor 的同一提交幂等。安全小写 ID、Windows 保留名、文件大小、普通文件和每级路径/软链接均校验。

`pure-ast-json@1` 使用既有 `compilePureSkill`/`runPureSkill`，没有 eval、vm、动态 import、联网、磁盘、SQL、支付、密钥或包安装权限。至少两个 JSON 自检，继续使用原有 65536 字节、20000 步等解释器限制。`requiredContracts` 与候选实际能力匹配，`dataSchemaVersion` 只声明，不授权迁移或数据访问。

支持的程序可按准确 `expectedRevision` + `expectedHash` 激活，写临时文件后原子 rename。停用及回退只改指针、保存 previous hash，不删除版本/数据。相同完整操作键可重试，旧 revision 不覆盖新指针。World 锁和同步文件写保证单进程内无交叉覆盖。

不支持的宿主程序按受限单文件 manifest 候选存档，不加载、不激活；不宣称能接管任意多文件 Node/React 应用。私有程序优先走扩展通道；Markdown Skill 保留原格式/作用域；真正 Core 修改继续走 `SUBMIT_APP_CODE`。

工具为 `LIST_EXTENSIONS`、`RUN_EXTENSION`、`SUBMIT_EXTENSION`、`SET_EXTENSION_STATE`，World/actor 从可信上下文取得。另一 World 不可列出/读取/运行源 World 的扩展。新增两种内部写工具只加入 V29 原 Gate 的明确白名单，没有放宽外部发布、维护、凭据或钱包授权。Execution 的现有工具 scope 仍适用。

Owner 从目标详情查看对应 World 扩展、创建者、版本、内容哈希、契约、实际启用状态和阻断原因，并可显式启停/回退。不增加主导航，不改变 V29 目标调度。扩展更新不创建 Generation。

## S3：只读兼容预检与候选隔离

验证后、准确哈希批准前生成兼容摘要并绑定候选哈希；发布 quiesce 后再次检查。既有资产集合或版本变动要求重新准备候选；旧 World 候选若没有兼容摘要，则不能直接复用旧 VALIDATED/APPROVED 批准，必须重新准备。不能用旧批准静默覆盖。Supervisor 主切换/迁移/失败恢复状态机保持原顺序。

| 类别 | 检查与处置 |
| --- | --- |
| Gene | 哈希、内容、能力契约和公开纯程序自检；不满足则整个发布阻断 |
| Body | 原 Current 的 active candidate、源码文件/账本哈希、接口与纯解释器契约、自检；不满足默认阻断 |
| Markdown | 使用原 Skills 作用域读取/校验，记录目录诊断；原私有文档不移入 Git/Gene |
| 私有扩展 | 不可变文件、启用指针、哈希、requiredContracts、自检；可定位不兼容仅阻断该扩展，保留原文件、数据及用户意图 |
| V29 | 摘要记录目标数量/状态预算哈希及原控制意图；保留 Gate 兼容保护，不重建目标系统，不清除未知费用或恢复记录 |
| 支付 | 复用原已知支付 Schema/实例事实兼容保护，不能靠丢账本降级 |
| Core patch | 旧 `code-candidates`/APP_CODE 报告原样保留，8766 提示 `CORE_PATCH_REBASE_REQUIRED`；不自动 rebase |

纯解释器与工具作用域辅助模块也纳入 Root 保护；其既有算法未重写。只读预检运行的是已安装可信解释器，对扩展源码按数据解释；不把候选/私有宿主程序 import 进 Supervisor。候选解释器/API 冒烟在原独立子进程中完成，使用清理后的环境。

V23 World 候选 smoke 改用最小模拟 Lineage/Current/World/Goal fixture，默认 OFF。它不复制生产客户行、`live`、模型响应、扩展数据或凭据。原始发布快照继续在可信维护目录，实际数据由已安装迁移器处理。候选 smoke 额外验证纯扩展激活、执行、停用、A/B 隔离和 OFF；原公共 Gene 冒烟继续执行。

没有新建“数据都兼容”的泛化承诺：不兼容关键 Schema/支付/账本/必须继承 Gene 时仍须阻断并设计独立迁移。旧 V22 单库路径保留其既有维护流程，本次隐私 fixture 改造针对 V23 World 布局。

## 修改理由与更小替代

- S1 仅在公共 prepare 增加一个 hook 和一个 helper；无需重写打包或 Git 同步，也不事后改已批准 Release。
- S2 沿用解释器和 ToolRegistry，只加文件版本/指针；未引入数据库表、外部依赖、插件 Host 或通用数据能力。
- S3 必须触及 Supervisor 的 validate/birth 检查点：仅在烟测里提示会过晚，无法阻止不兼容候选取得准确批准。新增摘要字段可缺省，旧记录仍可查。
- 必须替换原 World smoke 的整库/live 复制，否则新候选会看到不必要的真实私有数据。没有改变真实数据快照与失败恢复逻辑。
- 将既有 Gene 目录读取/哈希函数抽为轻量 `gene_catalog.ts` 并保留原服务导出。首次完整回归的 Root 依赖边界断言暴露了整服务静态导入问题，现仅复用受保护的目录/路径/Skill 读取、World fixture 构造与纯解释器模块，避免把整个 WorldRuntimeManager 链导入 8766。
- 仅保护新增扩展宿主服务并给两种内部写工具明确许可；未修改 RunService、RoundScheduler、支付/账本 Schema 或 V29 调度器。

## 新 API

| 方法 / 路径 | 行为 |
| --- | --- |
| `GET /api/worlds/:id/extensions` | 元数据和有效兼容状态，不返回源码 |
| `POST /api/worlds/:id/extensions` | 用当前已激活 Pixel 存档 manifest，返回 hash/支持状态 |
| `POST /api/worlds/:id/extensions/:extension/actions` | 按准确指针和幂等键 activate/disable/rollback |
| `POST /api/worlds/:id/extensions/:extension/run` | 全局许可开启后执行显式 JSON，返回 origin/World/hash/version/result |

全部继承现有 Owner 会话、Origin 与维护门控。工具不接受其他 World 或宿主路径参数。

## 隔离升级演示与哈希

以下全部为隔离测试数据。Git 仓库、私有程序和客户字段均为 fixture；没有真实客户或交易。

`multi_world_generation.test.ts` 使用实际 Supervisor、Lineage、Current、World、GenePromotion 和 Extension 服务，进程适配器为测试 double。包含两个 World、已批准 `shared_count`、私有扩展、独立数据、私有 Markdown Skill、旧 Core 报告、暂停目标、未知费用行、42-token 恢复点、一次隔离 Git 上游提交/分离 worktree、批准升级和回退。

```json
{
  "upstreamCommit": "829d1e644ff3ff6d8dc0dd2071b61e9247c635a8",
  "geneContentHash": "0ece3f4cb212acfb3b3c91ac947456d60d8607e976cb07dfa6b54d4bc113678f",
  "extensionHash": "8ab7979682c430136f9a533e9a9bac6b94f702d1af913aba8e033824f9f52fec",
  "privateFileHashesBefore": [
    "4d6f893c3c43aa2b2194fbcf0458581dbda4fb65414d72678beaee0e546cc79d",
    "d7192fa67fcad71c2849922cd7dfa3d80251e2632ad4175df7f0d529ccefbe3e",
    "62169f5e4dbf89e54b28521955855f100e8a72f6ce392f60dbdee981aed7faa0",
    "f40c16bf6b090c5662418d98c35964d9d2cb89cde13dc55c65f2021d2a3dc391",
    "8ab7979682c430136f9a533e9a9bac6b94f702d1af913aba8e033824f9f52fec"
  ],
  "privateFileHashesAfter": [
    "4d6f893c3c43aa2b2194fbcf0458581dbda4fb65414d72678beaee0e546cc79d",
    "d7192fa67fcad71c2849922cd7dfa3d80251e2632ad4175df7f0d529ccefbe3e",
    "62169f5e4dbf89e54b28521955855f100e8a72f6ce392f60dbdee981aed7faa0",
    "f40c16bf6b090c5662418d98c35964d9d2cb89cde13dc55c65f2021d2a3dc391",
    "8ab7979682c430136f9a533e9a9bac6b94f702d1af913aba8e033824f9f52fec"
  ],
  "worlds": 2,
  "goalStatePreserved": true,
  "automation": "OFF",
  "unknownCallsPreserved": 1,
  "checkpointTokens": 42,
  "rollback": "G0002"
}
```

哈希数组顺序：扩展数据、Markdown Skill、旧 APP_CODE 报告、active 指针、不可变扩展。升级后及回退后都逐文件核对；Gene/扩展继续计算，B World 看不到 A 扩展，原业务账本 fixture 行保留。候选模拟 Workspace 没有原 extension-data。

真实子进程升级/兼容回退由 `world_process_generation.test.ts` 补充，包含公开订单/收款、暂停 Goal、OFF、私有扩展及数据的跨重启检查。它与上面的隔离 Git 演示是不同证据，不声称已在本机实际 G0023 执行上游部署。

## 最终测试回执

- `pnpm.cmd typecheck`：通过，含服务端与前端检查。
- `npm.cmd --prefix frontend run build`：通过；保留既有 Vite 大 chunk 提示。
- `pnpm.cmd test --maxWorkers=1`：完整回归退出码 0；116 个测试文件通过、2 个可选文件跳过；962 项通过、2 项跳过，总计 964 项，耗时 1104.98 秒。日志 `cache/v30-tests-complete-final.log`。
- 上述完整回归包含真实进程升级/回退（616.67 秒）、候选完整验证及合约 smoke、63 项维护页回归、13 项 Core 源码通道回归、V29 10000 轮计数与 SIGKILL 恢复。
- 首轮完整回归有两项失败：Root 依赖保护断言，以及候选完整子回归未在原命令窗口内完成。轻量受保护目录模块拆分后，重跑完整回归通过；没有跳过这两个失败项。
- 完整回归后补充旧候选/缩短清单/旧批准缺失兼容摘要的拒绝规则；最终针对性验证结果：4 个文件 89 项通过（`cache/v30-final-boundaries.log`）；再补充缺失兼容摘要的旧批准候选拒绝规则，4 个文件 48 项通过（`cache/v30-delivery-regression.log`），最终 typecheck 通过。它只收紧 Owner Core 候选继承检查；已通过的真实进程 Gene 发布路径没有改变。没有把新增两项用例说成已包含在此前 964 项完整回归中。
- 英文/中文扩展组件测试通过；实际浏览器默认 1280 宽预览中 `scrollWidth=1280`，无横向溢出，浏览器 error/warn 日志为空。截图为本地 `cache/v30-owner-extensions-zh.png`，仅有明确标记的隔离模拟数据。临时 HTML 和 Vite 服务已清理。
- `git diff --check`：通过。

两项跳过均为既有可选测试：`owner_version_process.test.ts` 需要真实历史 Release（`EMERGENTINC_TEST_V23_RELEASE`），`upgrade_web_process.test.ts` 需要显式完整维护页面进程演练（`EMERGENTINC_TEST_UPGRADE_WEB=1`）。它们不能记为通过。

English validation summary: TypeScript and the frontend production build passed. The complete suite passed 962 tests with two pre-existing opt-in process tests skipped, including the real process upgrade/rollback and synthetic contract smoke. Additional legacy/truncated-inheritance and missing-compatibility-approval regressions were added afterward and checked separately; it is not counted as part of the earlier complete suite.

## 剩余边界

- 支持的是声明式纯 JSON 程序，不支持任意 Node/React 宿主模块、UI slot、网络插件、状态数据库或扩展内 Schema 迁移。
- `extension-data` 保留原位，需用户随整个 Workspace 独立备份；不被 Release 携带，不授权解释器自动读写。
- 非资产 Gene 定制与历史 Core 源码差异需要显式重检/rebase；有来源不明或 hash/License 冲突时停止自动准备。
- 兼容依据是准确内容哈希、已知契约和测试；不能据 semver 承诺任意第三方代码或破坏性 Schema 更新兼容。
- 最小模拟 fixture 与清理环境减少候选收到的数据，不等同于操作系统容器隔离。完整 Core 候选仍依赖既有可信 Owner 发布链；任意宿主程序不能通过私有扩展自动进入这个链路。
- Linux 尚未实际运行；Windows 路径、保留名、junction/软链接、原子指针和离线依赖路径在本机验证。不能把 Windows 结果写成 Linux 验收。
- 本机生产实例未升级；无真实付费模型、钱包、客户或生产收款验收。可选历史 Release/完整维护页面进程演练须另具前置条件。

English summary: Core Git, approved Release/Generation and private extension hashes are distinct identities. Approved public Gene is inherited before final hashes; conflicts fail closed. Private pure extensions stay in each World with CAS pointers and no host/data access. Compatibility is checked before exact approval and again before switching. World smoke uses synthetic data, and production snapshots stay trusted. Unknown outcomes and V29 OFF are preserved. Host applications, arbitrary Core patches, destructive schema changes and Linux acceptance are outside the verified scope.

## 改动路径

- `README.md`
- `README_CN.md`
- `apps/server/src/app.ts`
- `apps/server/src/routes/world_routes.ts`
- `apps/server/src/services/app_code_policy.ts`
- `apps/server/src/services/gene_catalog.ts`
- `apps/server/src/services/gene_promotion_service.ts`
- `apps/server/src/services/instance_extension_service.ts`
- `apps/server/src/services/owner_automation_gate.ts`
- `apps/server/src/services/skill_library.ts`
- `apps/server/src/services/world_runtime_manager.ts`
- `apps/server/src/services/world_tools.ts`
- `apps/server/src/world_bootstrap.ts`
- `apps/server/tests/approved_gene_inheritance.test.ts`
- `apps/server/tests/instance_extensions.test.ts`
- `apps/server/tests/multi_world_generation.test.ts`
- `apps/server/tests/world_process_generation.test.ts`
- `docs/EmergentInc_V30_Core与衍生资产分离_最小更改执行_PLAN.md`
- `docs/EmergentInc_V30_实施记录.md`
- `docs/guides/OWNER_GUIDE.md`
- `frontend/src/features/owner/OwnerExtensions.tsx`
- `frontend/src/features/owner/OwnerGoals.tsx`
- `frontend/src/i18n/en.ts`
- `frontend/src/i18n/zh-CN.ts`
- `frontend/tests/owner_extensions.test.tsx`
- `genome/manifest.json`
- `resources/upgrade-web.html`
- `scripts/inherit-approved-gene.mjs`
- `scripts/local-release.mjs`
- `scripts/upgrade-web.mjs`
- `scripts/version-upgrade.mjs`
- `supervisor/candidate_harness.mjs`
- `supervisor/generation_supervisor.ts`
- `supervisor/instance_compatibility.ts`
- `supervisor/protocol.ts`
