# EmergentInc V30 — Core 与实例衍生代码 / 数据分离：最小改造执行 PLAN

> 交付对象：本地 Codex（执行），Owner（验收）\
> 设计日期：2026-10-13\
> 已核查公开仓库：`https://github.com/lx00018310/EmergentInc`\
> 公开主分支基线：`86b133e2892db1e4f14e153df86a41b785ed3867`（2026-10-13 北京时间 00:37）\
> **注意：V29 正由本地 AI 实施。真正执行 V30 前必须先以本地最新 HEAD、未提交改动、V29 实际落地结构为准重新核查；不能按本 PLAN 的旧文件行号机械修改。**

## 0. 本版只解决什么问题

项目是开源的。每个人部署 EmergentInc 后，都可能让 Pixel 自己开发程序、技能和业务，产生客户数据、目标、流水、记忆和源代码。官方 Git 更新时：

1. **Core（开源主程序）** 可以更新到新的 Git 提交和经过批准的 Release；
2. **Instance-owned Assets（实例私有衍生资产）** 不因更新而覆盖、消失、自动推入官方 Git；
3. **Data（持久业务数据）** 不因版本切换、回退、重新部署而失去事实记录；
4. 兼容时自动继续运行，不兼容时**保留原始文件和数据、禁用受影响执行并报告原因**，绝不悄悄删除、重跑未知外部副作用或假称兼容。

**本版成功的定义不是“所有任意代码永远兼容”，而是“有明确的持久化归属、声明式兼容契约、可验证升级、不兼容可阻断、数据可追溯”。**

### 三个必须分清的版本

| 名词 | 归属 | 生命周期 |
|---|---|---|
| Git Core commit | 开源仓库 Git（例如 `main` SHA） | 官方源码升级；不得携带本地经营资料 |
| Approved Release / Generation | 现有 8766 + Supervisor 冻结发布 | 原有准确候选哈希审批；经批准 Gene 变化形成新 `Gxxxx` |
| User Extension version | 实例 Workspace 中的用户自有扩展 | 独立更新 / 禁用 / 回退；**不应因普通 Body 扩展更新创建新 Generation** |

一个 Release 可以来自 Core Git，也可以来自可信 Gene / Core 补丁发布。三者**不可混为同一版本号**。

## 1. 对当前实现的精确判断（先复核）

### 1.1 已有，直接复用

- `scripts/local-release.mjs`：`freezeLocalRelease()` 复制 Core 白名单，排除 `workspace`、`.env`、SQLite、密钥等，并冻结全量哈希；**不要重写打包机制**。
- `scripts/version-upgrade.mjs`、`scripts/upgrade-web.mjs`：8766 可以指定 Git SHA、用 detached worktree 构建候选并安全同步 `main`；沿用既有准备→验证→准确哈希批准→发布。
- `supervisor/generation_supervisor.ts`：发布前快照、迁移各 World 的 Current、候选烟测、启动健康检查、失败恢复；保留原事务和签核语义。
- `supervisor/generation_migrator.ts`：已按 Current 数据库记录，把已验证的 Body Skill 候选复制到下一代；**不另造 Body 技能引擎**。
- `packages/tools/src/business/pure_skill.ts`：`pure-ast-json@1` 安全执行器，禁止网络、文件、宿主对象和子进程；首版衍生**可执行**扩展复用它。
- `apps/server/src/services/skill_library.ts`：已有 Markdown `SKILL.md` 风格知识技能，Body 私有 + Gene 公用；保留作用域和访问规则。
- `apps/server/src/services/gene_promotion_service.ts`：Gene 提名与来源哈希已经落 Lineage；继续使用原有 Owner 审批和 Generation 机制。
- `apps/server/src/services/app_code_service.ts`、`scripts/prepare-app-code.mjs`：提交受保护的 Core 源码补丁报告，必须经发布批准才运行；**不要删除旧报告和已有候选**。
- 核心业务、支付、World 数据当前保存在 Workspace 的独立 SQLite / `live` 目录，不应纳入 Release。

### 1.2 尚有的真正缺口

**缺口 A — Git 升级未明确继承实例 Gene 资产**：
`version-upgrade.mjs` 从 Git checkout 冻结候选；用户在以前 Generation 审批并写入旧 Release `genome/assets/` 的公用资产，不一定存在于新 Core Git checkout。若不处理，新 Release 的有效 Gene 目录可能遗漏旧资产。旧磁盘文件未必被删除，但**运行时不可见就是功能回退**。

**缺口 B — AI 应用源码仍然绑定 Core**：
`SUBMIT_APP_CODE` 可修改 `apps/server/src`、`frontend/src` 等源代码，经 `prepare-app-code.mjs` 作为新 Release 发布。这是“改进内核”，不是“独立实例扩展”。直接修改 Core 文件的 CRM / 页面 / API，在后续上游修改同一文件时必然可能冲突。

**缺口 C — 缺少衍生程序独立运行契约**：
现有 Body Skill 覆盖安全纯计算和文档 Skill，却没有可供任意实例私有业务代码统一声明版本、数据 Schema、兼容条件与升级检查的扩展包装层。不能把任意 TS/React 插件直接 `import()` 到可信进程。

**缺口 D — V29 新数据需要一并纳入**：
V29 的 Goal、全局运行开关、调度检查点、预算等若已实现，必须持久化在实例 Workspace，升级后维持原意图；正在安全停止时不能误恢复成“运行中”。

## 2. 推荐结构：存储分离，而不是增加第五生命层

```text
Git checkout / immutable approved Release       # 官方代码、受信任代码
  apps/ packages/ frontend/ genome/ ...
       │ 仅经 8766 / Supervisor 更新
       ▼
Instance Workspace （既有路径；不提交 Git、不包含于 Release）
  system/
    control/ control.sqlite3                      # 原有实例组织 / Owner 信息
    lineage/ lineage.sqlite3                      # 原有代际 / Gene 来源 / 审计
    payment/ ...                                  # 原有收款事实
    extensions/                                   # V30 可选：跨 World 的已批准实例扩展索引
  worlds/<worldId>/
    ledger/v9_core.sqlite3                        # 现有账本/消息/执行检查点
    live/                                         # 现有 Pixel 心智、文档、原始产物
    generations/Gxxxx/current.sqlite3             # 原有 Current，按代迁移
    generations/Gxxxx/body/skills/                # 原有 Body Skill，继续维护
    code-candidates/                              # 原有 APP_CODE 候选：长期保留
    extensions/<extensionId>/                     # 新增：独立实例扩展（按需）
      versions/<sha256>.json                      # 不可变程序 + manifest；只支持已有安全引擎
      active.json                                 # 当前启用版本指针，原子写
    extension-data/<extensionId>/                 # 用户数据；独立备份、Schema 版本
Maintainer stateDirectory / releases             # 现有 8766 维护数据库与不可变 Release
```

重要原则：用户私人产物（World 本身的 Body Skill / 资料）不需要为了 V30 全部搬迁。**迁移越少越安全**；V30 只为新的独立扩展提供规范目录，历史数据原位保留。

### V30 最小扩展类型

- `extension@1` **只接受现有 `pure-ast-json@1` 引擎可安全验证并运行的程序**，输入/输出 JSON、受限计算，不开放网络、磁盘、数据库直连、支付、进程、密钥。
- 文档型 Skills 继续沿用 `LIST_SKILLS` / `READ_SKILL`，不另造 Markdown 插件格式。
- 由外部 API、浏览器页面、任意 Node/React 程序组成的完整应用：**此版本只做候选存档/显示“不支持独立加载”，不声称自动兼容、不执行任意宿主代码**。未来需要时以新的、明确授权的插件 Host / UI Slot 协议扩展。

示例 `workspace/worlds/<worldId>/extensions/customer-analysis/versions/<hash>.json`：

```json
{
  "schema": 1,
  "id": "customer-analysis",
  "version": "1.0.0",
  "engine": "pure-ast-json@1",
  "requiredContracts": ["pure_skill@1"],
  "dataSchemaVersion": 1,
  "source": "export default (input) => ({ count: input.rows.length })",
  "tests": [
    {"input": {"rows": []}, "expected": {"count": 0}},
    {"input": {"rows": [1]}, "expected": {"count": 1}}
  ]
}
```

以上仅示意；实际文件 ID / 内容哈希按既有编码与不可变候选惯例严格校验；源代码必须适配纯解释器支持的语法。`active.json` 必须包含当前内容哈希和启用状态，不允许通过写入任意路径加载程序。版本号只是显示标签，**身份以 SHA-256 和明确契约为准**。

## 3. P0 — 先修 Gene 继承：最高优先级、改动最少

> **这是决定普通 Git 更新会不会丢掉用户经批准的公共能力的关键修复。P0 必须先于新的扩展界面。**

### 3.1 只在「候选准备」阶段合并，不改 Git、不改已冻结 Release

在 `scripts/version-upgrade.mjs` 的 prepare 公共分支中（包含指定 `--commit SHA` 和当前 HEAD 两种入口）：

1. 通过现有 `approvedWorldRelease()` 取得**当前真实 ACTIVE Release**、`Gxxxx` 和 Workspace；不要相信 `main` SHA 等同运行版本。
2. 先从 Git checkout **复制未构建源码到新的私有候选目录**；如果复用 `freezeLocalRelease()`，应在最终求哈希 / 提交候选前注入继承资产（可将冻结动作扩展为可选的可信 prepare hook，**不要修改已经签名/校验过的 Release**）。
3. 使用现役 Release 的 `readGeneCatalog()`，并交叉核验 Workspace Lineage 中 `gene_assets` / `gene_asset_versions` 的批准来源、版本、内容哈希；只继承已确立为公用 Gene 的资产，**不从任意 Body 草稿或未批准提名导入**。
4. 合并候选 Git `genome/assets/index.json` 与实例批准资产清单；复制需要的不可变 `genome/assets/<id>/<version>.json`。保持 Git 中原有受信任资产，不用旧 `manifest.json` 覆盖新版的 `protected_paths`、`capability_contracts`、`body_interface_version`。
5. 同 ID、同版本、不同哈希 -> `GENE_ASSET_UPSTREAM_CONFLICT`，中止准备并说明 id / 版本，不静默择一。上下游对同一 ID 有不同现役版本且无法确定安全优先级 -> 停止并由 Owner / 本地 Codex 显式处理；绝不自动降级。
6. 必须确保**已批准的历史版本文件**及来源记录可供审计；运行活跃索引以核实后的版本为准。旧资产不可用、哈希错、License/许可不满足 -> 阻断。
7. 在合并完毕后执行现有 build/typecheck/test/smoke 和 `readGenome` / Release 全量哈希；候选哈希必须**覆盖注入后的全部内容**，Owner 只批准这个最终哈希。
8. ACTIVE、原 Workspace 和 Git worktree 均不发生修改；候选失败允许丢弃临时构建物，但不能改变活跃资产。

**实现取舍**：如果 `freezeLocalRelease()` 当前同时做复制、依赖安装、返回哈希，就添加**一个可选可信 pre-finalize hook**（默认行为完全不变），在安装及最终哈希确定前完成 Gene 合并；不要事后篡改已经记录的 candidate hash。对于一般 Gene patch 的 Supervisor 流程，本来就以 ACTIVE Release 为基础，避免重复导入。

### 3.2 发布前再查一次是否变化

- 再校验基线 Generation、approved Release、资产版本/哈希，防止准备期间别的 Gene 晋升生效。
- 资产清单、冲突、兼容状态作为 8766 **只读候选摘要**的一部分展示（可以先显示统计和错误，不重构 Git 双树图）。
- 关键兼容项失败，候选不能进入 `VALIDATED` / `APPROVED`。
- 不因“继承文件”自动再发一次 Gene 审批；这是把已经批准的资产带到新的软件 Release。**新发生的 Gene 变化仍按现有批准与代际规则处理**。

### 3.3 边界条件（务必实现测试）

- 历史上对 `genome` 其他文件做过定制修改，**不能一概认为它们等于资产目录**；不在已批准资产账本内的修改禁止自动合并，给出 `CUSTOM_GENE_PATCH_NEEDS_REBASE`（若无法识别具体来源，报告“不支持自动继承”并保留旧 Release）。
- 某些官方版本可能改变 `body_interface_version`、删除旧 `pure_skill@1` 契约；此时保留文件、阻止自动激活不兼容扩展，不得绕过验证。
- 不能因为候选检验失败就把原始 Gene 文件写回 Git 源码树。

## 4. P1 — 最小用户扩展机制：沿用现有解释器

### 4.1 仍保留“两条代码通道”

| 通道 | AI 希望实现什么 | 交付路径 | 发布规则 |
|---|---|---|---|
| Core patch（保留旧机制） | 修复主程序 Bug、改变受保护模块、改公共 UI/协议 | `SUBMIT_APP_CODE` → APP_CODE Report → 8766 | 原准确 hash 审批 + 完整 Release 及 Generation，不能绕过 |
| Instance extension（新增默认） | 用户私有业务逻辑、数据变换、纯计算程序及 Skill | V30 `SUBMIT_EXTENSION`（或复用最短既有 Body Tool/服务）→ Workspace 独立版本 | 符合许可与隔离时可独立验证/激活；Body 更新**不创建 Generation** |

**路由策略**：不靠模型自己判断“受保护源码能否直接改”。受保护路径的修改请求仍只能进入现有 Core 通道；任何涉及宿主 Node、前端路由、网络、支付、数据库迁移的代码不得伪装成 `pure-ast-json@1` 扩展。不能自动转换的旧 `APP_CODE` 报告原样保留并标记 `CORE_PATCH_REBASE_REQUIRED`。

### 4.2 先做薄的 `ExtensionStore`，不建设第二套 Agent 引擎

实现最小服务，例如 `apps/server/src/services/instance_extension_service.ts`，职责严格限于：

1. **保存**：合法 World ID、扩展 ID、语义版本和声明式文件；路径必须在该 World 自有 `extensions` 目录内，拒绝软链接/路径穿越/特殊文件。源代码版本写入不可变 `versions/<sha256>.json`，重复相同提交幂等。
2. **验证**：用既有 `compilePureSkill()` 和 `runPureSkill()` 验证至少两个自检；校验接口、文件大小、执行步数、输入输出和 manifest；无额外 `eval/vm/dynamic import/npm install`。
3. **激活**：受现有权限规则约束；原子更新 `active.json`（临时文件 + rename），保存 previous hash 用于回退；如果已有当前活跃版本，禁止无条件覆盖和并发错序。
4. **执行**：读取指定扩展的不可变快照，检查 ACTIVE 指针及所声明契约再调用安全解释器；独立返回结果，不得取得宿主进程文件系统或原始 DB 连接。
5. **禁用 / 回退**：只改启用指针；旧扩展文件和业务数据不删除。逻辑删除默认为归档/停用，真正物理清理另需独立 Owner 授权及备份。
6. **查看**：Owner 能看到扩展来源 World、创建 Pixel、版本、SHA、所需能力、激活状态、阻断原因；不需要在 V30 增加新的主要导航页面。

建议优先通过现有 `WorldRuntimeManager.configureTools` 的可控 ToolRegistry 接入 `LIST_EXTENSIONS` / `RUN_EXTENSION` / `SUBMIT_EXTENSION`（具体可合并或复用已有 Tool，须审计现有注册及鉴权逻辑），**不要直接向 Pixel 暴露文件写入 / 动态模块加载**。OWNER 可从目标详情查看当前扩展，但不为 V30 重构 V29 Mission UI。

### 4.3 不允许对数据做的事

- `extension-data/` 仅作为用户拥有的数据文件/后续扩展存储入口；**首版 pure extension 不自动获得读写这个目录的能力**。需要输入数据时走现有已授权数据能力，作为 JSON 显式传参。
- 首版不添加通用 SQL 执行能力、不建立多个数据库连接池、不允许 extension 任意联网、调用支付或发营销内容。
- 将来若扩展需要状态，必须通过单独的受限 KV/Schema API 并再设计幂等和迁移；不要利用“扩展持久化”名义绕过 Core ACL。
- **V29 目标、进度、预算、调度与总开关**继续由 V29 自己的持久化服务管理，V30 只保证新 Core 兼容性校验，不创造平行的 Mission DB。

## 5. P2 — 升级兼容与回退：以「不丢」为底线

在现有候选验证管道新增一个**只读 Instance Compatibility Preflight**（可用一个小型独立工具函数/模块复用；不要引入完整插件管理平台）。

### 5.1 检查哪些东西

| 类别 | 执行策略 |
|---|---|
| 已批准 Gene 资产 | P0 已注入候选；版本、内容、来源哈希全部一致，无冲突才能发布 |
| Body Skill | 复用 `GenerationMigrator`；检查 active candidate 源文件存在、hash 与存储记录一致，并可用候选版本执行器识别；不兼容则发布阻断或标明受影响 Skill 后由 Owner 决策（默认阻断） |
| Markdown Skills | 文件继续留在 World `live/artifacts`；验证仍能按作用域读取；不将私有文档写入公共 Git / 公共 Gene |
| Workspace 经营数据 | 现有数据库与 live 不打包、不清空；使用当前 migration/快照方式检测新版本能启动和读到数据；严禁直接用未验证新代码碰生产库 |
| V29 Goals/Run checkpoints | 在本地 V29 真正落地后检查 Goal 数量、状态、预算、全局总开关及待办、恢复点；关闭状态不能被重启重置；未知外部结果不能重发 |
| V30 Extensions | 检查文件 hash、engine 和 requiredContracts；只对适配 `extension@1` 的安全程序自动启用，版本不兼容时保持原数据并禁用执行、报告原因 |
| APP_CODE 源码补丁 | 不能假设上游 Git 可自动合并；保留旧报告/补丁/批准 Release，显示 `CORE_PATCH_REBASE_REQUIRED`，由本地 Codex 针对新 Core 再生成、测试并重新批准 |

### 5.2 兼容是契约，不是字符串版本碰运气

- 用 `genome/manifest.json` 的 `capability_contracts` 与 `body_interface_version` 识别当前候选实际能力；`requiredContracts` 不满足就明确阻断，**不能仅因 semver 看似新就执行**。
- 对不破坏旧契约的官方升级继续支持已声明 API；若必须破坏，逐项显式迁移或停用。支持的范围由测试用例和版本契约界定，不能承诺所有自定义 Node/前端源码自动兼容。
- 测试必须在**可信候选 Workspace / 数据库快照或经过脱敏的最小 fixture**中完成；不要将真实客户私有文件不加选择地复制进可读取的候选构建目录。
- 禁止修改已经冻结/验证的 Release；新的合并候选必须重新生成完整 Release hash、Gene hash 和准确审批 hash。

### 5.3 升级后的状态规则

- Success：现有服务健康且 Gene / World / 运行资产验证通过，旧数据路径仍在，EXT 可运行。
- Compatible but inactive：扩展原先被 Owner 手动禁用，则升级后仍禁用，不可自作主张启用。
- Incompatible：保留原文件、旧版本和数据，**只禁止不兼容扩展执行**；若不兼容涉及关键支付/账本、Core migration、必须继承的 Gene 能力，则整个发布直接阻断。
- Rollback：退回旧代码指针和可兼容的 Current；保留账本、订单、真实收款、审计、扩展文件和 V29 经营目标事实；对于无法回读新版 Schema 的旧 Core，维持现有回退阻断规则而不是强制降级。
- V29 的全局开关 OFF 时，升级后仍 OFF，后端不能在服务重启时将其解释为继续执行。

## 6. 代码修改地图（先少后多）

**优先修改 / 新增（最小推荐集合）**：

| 文件 | 主要改动 |
|---|---|
| `scripts/version-upgrade.mjs` | 官方 Git Core 候选 prepare 时调用“现役 Gene 继承”小函数；统一 HEAD 和 `--commit` 两条路径 |
| `scripts/local-release.mjs` | 如有必要新增兼容的候选构建 pre-finalize hook，默认旧行为不变 |
| **新增** `scripts/inherit-approved-gene.mjs`（名称可调整） | 仅读取现役 Release + Lineage 资产来源；哈希校验、确定性 merge、冲突即失败 |
| `scripts/upgrade-web.mjs` / `resources/upgrade-web.html` | 在现有候选摘要轻量显示“继承 n 项、冲突/风险 n 项”，不重做 V27 双树 |
| **新增** `apps/server/src/services/instance_extension_service.ts` | 薄层 extension 文件注册、验证、原子启用/停用及安全执行 |
| `apps/server/src/services/world_runtime_manager.ts` 或现有 World 工具注册点 | 接入少量 extension 工具/Owner APIs，严格按 World 身份和已批准工具 scope 校验 |
| `supervisor/candidate_harness.mjs` 或已存在的 validate hook | 加入只读兼容性冒烟与脱敏 fixture，防止不兼容静默发布 |
| `docs/guides/OWNER_GUIDE.md`、`README.md` / `README_CN.md` | 说明 Core 与实例资产分离、用户扩展与 Core Patch 两条通道及兼容边界 |

**尽量不改**：`GenerationSupervisor` 主发布状态机 / 多 World 切换算法；`RunService` / `RoundScheduler`；账本/付款核心 Schema；Root of Trust / 权限边界；既有 Body Skill / Gene 提名审批；V29 Mission Scheduler。若必须修改，先论证为什么现有 hook 不够，提供回归测试。

注意：`scripts/version-upgrade.mjs`、`scripts/local-release.mjs`、`scripts/upgrade-web.mjs`、`supervisor/*`、`apps/server/src/services/app_code_policy.ts` 等属于高信任路径。仅由本地 Owner / Codex 在 Git 中修改并正常发布；**不得向 Pixel 授予对这些文件的写入权限**。

## 7. 实施顺序：三阶段，但每阶段都可单独验收

### S1（最高优先级）：上游 Git 升级不漏 Gene

- [x] 检查 V29 是否已落地；确认当前 ACTIVE G、Release、主程序 SHA、Workspace、现有 Gene assets。
- [x] 写只读资产差异对比函数 / 单元测试，含同 ID 不同 hash 的冲突策略。
- [x] 在官方 Core Git prepare 流程调用可信 merge，再安装 / 校验 / 计算完整 hash；不碰源码工作树。
- [x] 测试经 Owner 已批准的 Gene Skill / Knowledge 在上游升级后仍可见、可执行；原版本/来源可追溯。
- [x] 用隔离假仓库 / 临时 Workspace 演示“升级失败，旧 Release 和数据完全不变”。

**S1 交付**：现有系统经批准的公用 Gene 资产不再依赖其文件是否出现在 Git 新提交里。

### S2：让新生成的用户业务程序默认不改 Core

- [x] 创建小型 ExtensionStore + 极小 manifest；源程序不可变、版本指针原子更换。
- [x] 复用 `pure-ast-json@1`；新增扩展至少 2 个测试案例验证，错误不改变 ACTIVE。
- [x] 对 Pixel / Owner 暴露明确的扩展提交通道与列表/执行/禁用能力，复用现有工具边界。
- [x] 原有 `SUBMIT_APP_CODE` 继续用于真正的 Core 修正；旧报告不迁移、不删除。
- [x] 样例：用户 A 的 World 创建客户分析扩展 v1，用户 B 无法列出 / 使用 A 的扩展，官方 Git 更新后 A 的扩展仍保留且可执行。

**S2 交付**：不修改 `apps/` / `frontend/` 的实例程序有独立版本，并保持与 World 的权限隔离。

### S3：上游升级的兼容性前置检查

- [x] 新增已批准 Gene / Body / EXT / 数据版本的只读预检汇总。
- [x] 冻结候选后在测试 Workspace 执行原有 Typecheck / Test / Build / Smoke + Extension 合约检查。
- [x] 兼容时自动通过；可定位不兼容且非关键的 Extension 时保持其文件与数据、报告并禁用；关键不兼容阻止发布。
- [x] Owner 在 8766 能看见“继承了什么、不能运行什么、是否会影响数据”；签核绑定最终 hash。
- [x] 对升级中断 / 回退 / V29 OFF 状态进行测试，确保不自动重发未知结果的外部操作。

**S3 交付**：发布器从“只验证核心程序”升级到“验证核心程序能否接管本实例已有资产”。

## 8. 强制回归测试清单

建议在已存在的 `apps/server/tests`、独立 `scripts` 测试和 `frontend/tests` 中按就近原则补测，重点覆盖：

1. 没有 Gene 资产的旧实例，prepare 路径完全兼容；旧 CLI/8766 调用仍工作。
2. `main` HEAD 与指定 SHA 的官方升级都执行相同 Gene 继承。
3. 已批准资产 1 个、多个、不同版本：内容哈希一致、加载正常；未批准提案绝不被继承。
4. 上游同 ID 同版本不同内容；上游同 ID 较高版本冲突；篡改的 Gene 文件、缺失源：均 fail closed，不改变 LIVE。
5. Agent Core Patch 仍按准确 hash 发布；保护路径不能作为 Extension 提交；历史 APP_CODE 报告和文件保留。
6. Extension：首次创建 / 幂等重复提交 / 改动冲突 / 并发激活 / 旧版回退 / 主动禁用 / 非法 ID / 软链接 / 路径穿越 / 任意 Node 或网络代码拒绝。
7. 跨 World：A 用户扩展不被 B World 枚举/读取/执行；共享只能走既有 Gene 审批。
8. 数据：升级前后原有账本行数、订单、收款凭证、Body Skill、Markdown Skill、经营资产不减少，安全快照校验无异常。
9. V29：经营目标 ID、状态、预算、执行次数、全局开关 OFF、等待恢复的 Run 及结果未知记录跨升级保留；旧进程不得重启任务。
10. 中断：冻结候选中断 / 预检失败 / 切换失败 / 启动健康失败 / Git 同步失败；可恢复原状态，不能“成功发布但不显示同步异常”。
11. 回退：不恢复过时账本覆盖新收款；新 Schema 不能被旧代码读取时，拒绝危险回退；扩展及其数据仍原样存在。
12. 兼容不同平台：Windows、Linux 路径及大小写、权限、原子替换、隐藏文件、安全文件名、离线依赖安装。
13. 验证 Release Hash / Gene Hash / Candidate Hash 在注入继承文件后正确重算并仍适用 Owner 精确审批。
14. 候选烟测中不暴露 `workspace/private`、钱包凭证、客户隐私或真实支付权限。

建议运行（依据本地实际 package scripts 调整）：

```bash
pnpm typecheck
pnpm test --maxWorkers=4
pnpm build
pnpm --dir frontend build
```

另需针对 **隔离临时 Git 仓库 + 测试 Workspace** 的升级、回退和扩展兼容集成测试，禁止直接在生产数据库上执行破坏性演练。

## 9. 不应做（V30 禁区）

- 不把 `workspace/`、已批准的用户 Gene 资产、客户数据、私钥或生成的私有程序直接 `git add` 到官方主分支。
- 不允许为了兼容任意程序而执行任意 JS/TS/Python 宿主代码，或关闭原有 Sandbox / Root / Owner 审批。
- 不在 V30 将所有现役 Body Skill、客户资料、经营数据库搬到新表或新目录。
- 不新增第二个 Git 版本管理体系；Core 按原 V27 发布流程，实例扩展由内容哈希与自身版本管理。
- 不修改原来的 `Gxxxx` 代际语义；Body/实例扩展更新不是 Gene 换代。
- 不允许基于“升级成功”自动恢复 Owner 明确停止的 V29 经营执行。
- 不作“任意 Core 补丁自动 rebase 且肯定兼容”的承诺。旧补丁需原样保存、冲突明确可见，人工解决后重新验证并批准。
- 不把 `extension-data` 作为扩展对全盘任意读写权限；有状态插件能力以后再单独设计。

## 10. Codex 最终输出格式（本地执行后）

必须交付：

1. **改动清单**：列出实际修改/新增文件、修改原因，区分 S1/S2/S3，解释为什么没有更小的替代。
2. **行为对照**：原版官方 Git 更新后 Gene 如何保留；V30 新扩展如何独立；旧 APP_CODE 补丁如何在新版 Core 冲突时处理。
3. **隔离演示**：至少 1 个已批准 Gene、1 个已验证私有 Extension、1 份业务数据、2 个 World、1 次上游更新，提供升级前后哈希与不丢失证据。
4. **测试回执**：准确列出完成的 typecheck/test/build/smoke/临时仓库升级测试；失败需显式写出，不能含糊标注全绿。
5. **V29 兼容结果**：目标/总开关运行状态、停止语义、运行检查点、余额/预算是否在新版本保持；若本地 V29 尚未完成，标为 `BLOCKED_BY_V29` 并给出后续测试而非编造结果。
6. **剩余边界**：列出不支持自动继承的任意宿主应用、Core 源码差异、数据库 Schema 破坏性升级，明确需单独迁移。

### 最终验收（全部必须满足）

> 更新到新的官方 Core Git 提交后：
> - 用户 Workspace 的真实业务数据、World、Body Skill 与用户生成代码**仍然存在且哈希不变**（合理按代生成新的 Current 例外，原历史不覆写）。
> - 已批准的 Gene 公用能力被完整继承；不能继承则**不发布**而非静默丢失。
> - 新的受限实例 Extension 在兼容时继续运行；不兼容时保留数据、明确报告、禁止不安全执行。
> - 既有 `APP_CODE` 修改内核的链路仍受准确哈希审批；遇到上游代码冲突时不暗中覆盖。
> - 发布失败可复原到原来 ACTIVE 的 Core，所有支付、经营、目标和审计事实保持。
> - 没有新增与 V29 冲突的第二套调度、Run、任务或数据库主系统。

**排序原则：先 S1 修真正的数据/能力遗漏风险，再 S2 做最小扩展独立化，最后 S3 补齐统一兼容检查。每一步不满足验收，不开启下一步。**

---

### 技术参考（理念，不要求安装新依赖）

- Home Assistant：Core 与用户自定义 integrations/manifest 分离 — https://developers.home-assistant.io/docs/creating_integration_manifest/
- Odoo：核心运行与独立 addons 路径、模块生命周期 — https://www.odoo.com/documentation/18.0/developer/reference/backend/module.html
- n8n：应用运行环境与持久数据卷区分 — https://docs.n8n.io/hosting/installation/docker/
- EmergentInc 当前源码：https://github.com/lx00018310/EmergentInc


## 执行记录 / Execution record

2026-10-13：S1/S2/S3 开发候选已完成。源码基准为 V29 `c5f2347`；实际部署的只读核验为 G0023 / Core SHA `86b133e`，没有部署或修改该实例。

完整回归 962 项通过、2 项既有可选测试跳过；提交前补充的旧候选继承/兼容摘要拒绝规则分别完成 89 项和最终 48 项针对性回归。TypeScript 检查、前端构建、实际进程升级/回退和候选合约 smoke 通过。详细代码边界、隔离 Git 演示哈希、测试区分及未验证范围见 [V30 实施记录](./EmergentInc_V30_实施记录.md)。Windows 已本地验证；Linux 和真实生产升级不计作通过。

The S1/S2/S3 development candidate is implemented. The complete suite passed 962 tests with two existing opt-in tests skipped; subsequent legacy-candidate guards passed focused regressions. Type checking, frontend build and real-process upgrade/rollback passed. The actual G0023 deployment was only inspected. See the implementation report for the isolated evidence, precise test scope and remaining limits.
