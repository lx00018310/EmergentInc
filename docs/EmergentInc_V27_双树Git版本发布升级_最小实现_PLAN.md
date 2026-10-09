# EmergentInc V27 — 双树 Git 版本发布升级页面·最小实现 PLAN

> 给本地 Codex 的执行文档 · 2026-10-09  
> 实施位置：`http://127.0.0.1:8766/`（独立 Owner Upgrade Service）  
> 代码基线：GitHub `lx00018310/EmergentInc` 公开 `main` 最新核对提交 `43790ffd8240456527540a1728075811057475ed`（V25，2026-10-07）。执行前**先拉取/核查本地 HEAD**，如果 V26 已落地，基于最新代码最小适配；不假定 V26 已合并。  
> 核心原则：**只改发布维护的读写入口和界面，沿用现有可信冻结、验证、准确哈希审批、全 World 切换、回退。**

## 0. 先读结论：V27 只解决什么

Owner 希望在 8766 页面看到**左右两幅像 VS Code Git Graph 一样的节点连线图**：

- **左侧：当前/历史已批准运行版本树（Release Lineage）**。显示实际运行的 Generation、Release、关联源代码提交、何时发布/回退、状态。左侧的“当前”只由 Workspace + 可信 Supervisor/已批准 Release 决定，**不能用 Git `main` 的 HEAD 假装当前运行版本**。
- **右侧：开发分支提交图（Git Commit Graph）**。显示本地已有 `main`、`feature/*`、其他本地分支及已获取的远端跟踪分支；节点是 commit SHA，线是 Git parent 关系。可以点击分支/具体 commit，查看提交说明和相对 `main` 的改动。
- **连接动作：从右侧选定一个提交 → 冻结并校验对应的代码 → Owner 查看差异/准确候选哈希 → 明确批准并发布 → 发布成功后左侧增加已批准版本节点，同时安全地将相应提交同步到 Git `main`。**

**注意四个不同的身份：**产品版本 V27、Git commit SHA、批准候选 `candidate_hash`、代际 Generation `Gxxxx`，严禁混用。当前软件升级继续遵守现有规则：经批准的软件代码变更会进入新 Generation；Body Revision 本身不形成新 Generation。

### 0.1 最小范围定义（必须遵守）

1. **保留** 8766 作为独立进程与独立登录；沿用已有 `/api/upgrades` 的 `prepare / approve / apply / recover` 语义；保留原 CLI 能力和 `/OWNER` 现有跳转。
2. 仅新增 Git 分支/提交**只读查看**与“选择一个已提交 SHA 作为候选代码源”能力；发布时**只自动支持 fast-forward (`--ff-only`)** 合入 `main`。分叉/冲突需要开发者在工作区处理后重新选择、重新校验；V27 不自动 rebase、cherry-pick、冲突解决、强推、删分支。
3. 最初只支持**本机现有 Git 仓库中的对象**（包括已经 fetch 过的远端跟踪分支）。不在页面自动 fetch/pull/push GitHub，不配置凭据。
4. UI 尽量复用 `resources/upgrade-web.html` 里的原生 HTML/CSS/JS、现有双语字典；不要引入 React、额外 UI 包、Git Graph 依赖或新的数据库。
5. **同一网页按钮不是无条件的单步合并。** 必须经过准备/验证、详细检查、准确哈希确认、发布成功和主分支安全同步。中途失败必须清晰提示，不准显示虚假“已合并/已发布”。

## 1. 仓库现状与应复用的接口

执行前重新打开下面文件并核对：

| 文件 | 现有事实 | V27 修改原则 |
| --- | --- | --- |
| `resources/upgrade-web.html` | 当前为“当前运行版本 + 版本标签准备表单 + 候选卡片 + 批准发布”单页；含中文/英文 | 改为双树布局，保留登录、日志、校验、审批、回退恢复入口 |
| `scripts/upgrade-web.mjs` | 8766 Fastify 服务，loopback-only，独立 Owner cookie、来源检查，`/status` 只读公开投影，`/api/upgrades` 执行固定命令 | 新增只读 Git Graph API + 扩展有界 `prepare/publish`，**绝不接收通用 Shell/Git 命令** |
| `scripts/version-upgrade.mjs` | `prepare` 只能冻结执行该脚本的干净 Git checkout 的 `HEAD`；记录 `source_commit`，交给现有 Generation Supervisor | 在兼容旧参数前提下支持受限、精确 SHA 的准备流程 |
| `scripts/local-release.mjs` | 冻结完整版本，避免把 `.env`、私钥、Workspace 带入发布目录，并计算真实冻结哈希 | 复用，不把 commit SHA 当作完整 Release 内容哈希 |
| `scripts/v23-generation.mjs` / `supervisor/generation_supervisor.ts` | 已有 submit / validate / approve / birth / rollback / recover，准确哈希批准、全 World 切换 | **禁止重写生命升级与发布事务** |
| `supervisor/local_world_runtime.ts` | 已有 install、typecheck、测试、构建、烟测和运行切换 | 继续是实际发布校验的唯一可信路径 |
| `apps/server/tests/upgrade_web.test.ts` | 已测试独立认证、来源检查、准确哈希、互斥、失败 | 在此加 Graph/选 SHA/双向同步回归 |
| `docs/版本升级入口.md` | 已描述 8766 及旧 CLI | 补充 V27 用法与回退语义 |

**现状的重要区别：**现有候选只来自当前 checkout `HEAD`，不会从界面选任意分支构建；因此只重画页面不足以满足功能，需要给 `prepare` 增加一个**精确 SHA 的隔离构建入口**。

## 2. 最终页面（桌面优先，视觉接近 VS Code Git Graph）

```text
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│ EmergentInc / Publish Control       Running G0012 · Release xxx      [中文/EN] [返回 OWNER] │
├─────────────────────────────────────────────┬──────────────────────────────────────────────────┤
│ 已批准版本 / LIVE RELEASE TREE              │ 开发分支 / DEVELOPMENT GIT GRAPH                 │
│                                             │                                                  │
│ ● G0012  CURRENT     release-xx             │ ● main   a12b3c4  stable base                   │
│ │   source: a12b3c4                         │ │                                                │
│ ● G0011  PUBLISHED   release-yy             │ ├────● feature/skills  e56f789                 │
│ │   source: 9988776                         │ │    │                                            │
│ ● G0010  ROLLED BACK release-zz             │ │    ● 123abcd  add SKILL.md                     │
│ │   source: 1122334                         │ └────● feature/ui  987abcd                     │
│ ● G0009  HISTORICAL ...                     │                                                  │
│                                             │ [选中提交] e56f789                              │
│                                             │ [查看文件差异] [准备并验证为候选版本]           │
├─────────────────────────────────────────────┴──────────────────────────────────────────────────┤
│ Review：目标提交、包含的其他 commits、文件差异、目标 Gxxxx、准确 candidate hash、校验记录   │
│ [ ] 我已核对准确代码和校验结果                   [批准并发布] [查看日志 / 恢复]                 │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

显示规则：

- **两个并列“图视图”**，不是左右两个普通下拉列表；每个提交/版本有圆形节点、分叉折线、短 SHA、标题和标签。右侧的 Git Graph 由 commit parent 关系绘制，左侧由 Generation 的父代/继承关系绘制。
- 两侧树**可以独立滚动**，选中节点时显示对应右侧/底部详情；不必绘制跨屏动态连线，显示明确“此发布版本源自右侧 commit SHA”的关联即可。
- 左侧 CURRENT 高亮，历史 ROLLED_BACK / FAILED / RETIRED 用视觉区分但不从历史删除；Gene-only Generation 的 source SHA 可以是 `N/A`，不伪造提交。
- 右侧展示 `main`、本地和已获取的远端跟踪分支引用；提交详情包含作者、时间、完整 SHA、父提交、分支标记、提交消息、差异文件清单。
- 候选状态按现有 `VALIDATED`、`APPROVED`、`BORN` 等真实状态显示；`准备`只生成候选，不切运行版本。
- 显示主分支 `main HEAD` 和实际发布 `ACTIVE RELEASE` **两个单独数值**。如果偏离，醒目标注“代码仓库与运行版本不同步”，不能把两者合称当前版本。
- 中英文页面同样可用；窄屏两栏依次纵向排列，仍保留完整操作。

### 2.1 点击右侧节点后的审核信息

必须显示：

1. `branch/ref` 及本次**固定 source commit SHA**（不接受点击后偷偷变动的 branch HEAD）。
2. 相对 `main` 的 ahead / behind 关系、是否具备 fast-forward 条件；若选中 SHA 之前还包含其他未进入 main 的提交，**明确显示此次会包含所有这些提交**，不暗示只合单个 commit。
3. 文件差异概览（增/改/删、数量、文件名）；详细 diff 可以先只展示有界文本或跳转本地 Git 工具，不要求做 IDE 级 diff 编辑器。
4. 检验通过后：生成的 `candidate id`、`source_commit`、`candidate_hash`、`candidate_release_hash`、`base_generation`、验证输出及失败原因。
5. Owner 勾选明确确认后才可点击“批准并发布”；任何 SHA / base generation / candidate hash 改变都需要重新确认。

## 3. 真实发布语义（不可妥协）

### 3.1 只允许有界 fast-forward

V27 最小版规定：选定的提交必须是 `main` 当前提交的后代；并且选择后到执行前 `main` 指针与所审批的预期值一致。

```text
main A ─ B                     → 可以选择 feature C 或 D
         └─ feature C ─ D      → 验证 D 后 fast-forward main 到 D

main A ─ B ─ X                 → 不允许自动合入
         └─ feature C ─ D      → 提示“分支已分叉，请本地处理合并后重新校验”
```

对于不能 FF 的情况，右侧仍正常展示和查看 diff，但**禁止准备成“可直接发布并同步 main”的候选**，或者准备后明确 BLOCKED，绝不能悄悄发生 merge/rebase。若后期确需非 FF 合并，作为 V28 独立讨论，不在 V27 加复杂合并引擎。

### 3.2 不等同于“提交即发布”

```text
右树点选固定 SHA
    ↓
验证：repo/commit 存在、main 是其祖先、当前源与目标合法
    ↓
隔离 worktree 构建（不污染正在写代码的 worktree）
    ↓
冻结完整候选 Release + 运行现有 validate / smoke / tests
    ↓
Owner 核对差异、提交范围、candidate_hash 并确认
    ↓
原有 approve → apply / birth（切换 World 与 ACTIVE RELEASE）
    ↓
确认真实 ACTIVE RELEASE + 健康检测通过
    ↓
以 FF 方式安全同步 main（再次校验预期 ref / 工作区）
    ↓
左树标记 PUBLISHED/CURRENT，右树 main 更新；记审计日志
```

**为何 Git `main` 同步放在部署成功后？** 避免发布失败却提前把未经成功上线的提交推进主分支。但这不是跨 Git 和 SQLite 的单事务，必须在界面真实显示部分成功状态，绝不伪装原子操作。

**失败情况必须明确分级：**

- `prepare/validate` 失败：仍在原运行版本；`main` 不动；右侧保留失败候选和日志。
- `apply` 失败：沿用 Supervisor 现有回退/恢复；不推进 `main`；保留运行和业务事实。
- `apply` 成功但 Git 同步失败（例如 `main` 被别人推进、工作区变脏）：实际 Release 已生效，界面显示 **“发布成功；main 待同步（NEEDS_GIT_SYNC）”**，必须通过受控恢复步骤修复，不能自动重试、不重置/强推 `main`。
- 进程在 Git 同步前/后中断：根据**实际 Active Release、候选哈希、main SHA**重新对账；不可仅用 `job.state=running` 猜测成功。
- 用户主动回退：**保留 Git 提交历史，不强制 reset main**；左侧变更实际运行状态，右侧显示 `main` 可能领先运行版本，提示如需代码回退需后续正常 `revert` 提交再发布。不得丢失业务数据。

### 3.3 被检验和被发布的内容必须一致

- 准备阶段不能从“右边选中的 SHA”显示摘要，却实际冻结另一个 checkout 的文件。
- 只从**被钉住的 SHA**生成隔离源码快照；在隔离环境执行必需的依赖安装/构建，再交由现有 `freezeLocalRelease` / `GenerationSupervisor.validate` 完整检查。不要将 `.env`、私钥、Workspace、`node_modules` 中含非发行必要的东西混入候选。
- 现有 `manifest.generation` 为发布时计算的代际元数据，可在冻结候选时按照旧流程更新；因此源 commit SHA 和冻结 Release 哈希不是相同对象。审批必须仍针对**最终冻结候选准确哈希**。
- 确保 `source_commit` 真实可追溯、在整个准备/验证/批准/发布期间不可被分支名变化重解释。Agent 修改源码时也不能替换已审批冻结目录。

## 4. 后端最小改造清单

### A. Git Graph 只读服务（先实现）

优先只在 `scripts/upgrade-web.mjs` 中增加轻量辅助函数，必要时抽一个 `scripts/upgrade-git.mjs`（如果逻辑超过维护成本再拆文件）。

- 登录后 `GET /api/upgrade/graph`：返回**有界**数据，例如 `refs`（本地/远端跟踪）、`commits`（SHA、parents、标题、作者、时间）、`releases`（Gxxxx、parent、releaseId、state、关联源 SHA）、`active`、`mainHead`、`dirty`、`job`。
- 登录后 `GET /api/upgrade/commits/:sha`（或同等只读接口）：安全返回一个 SHA 的详细提交信息、相对 main 的更改文件列表、FF 可行性及来源范围。只接受 40/64 位合法 Git 十六进制 object id 并验证对象类型 `commit`；不要接受 URL/path 作为 Git 参数。
- 读取 Git：使用 `execFile`/`spawn` 固定子命令与参数数组（例如 `git for-each-ref`、`git log --all --topo-order --parents`、`git merge-base`、`git diff --name-status`）；只读查询必须设置超时与输出数量上限。首屏默认 100～200 个提交，提供“加载更多”可选；无须无限图。
- 左树来源：信任 `system/lineage` 的 Generation/parent/ACTIVE 事实及现有演化库 `owner_release.source_commit` 记录；对于找不到 SHA 的旧代显示“来源未知”，不能臆测。
- Git 图与候选数据均**只能从当前可信本地仓库、已冻结候选和数据库得到**；不得由客户端传文件路径。
- 继续保持现有 `GET /status` 为 **无需登录、受限且只读**的 Owner 首页状态投影。Git 分支名、完整日志、差异、私有路径不加入公开 `/status`。

### B. 支持按精确 SHA 准备（最重要的功能改动）

扩展 `POST /api/upgrades {action:"prepare",version,reason,sourceCommit}`，兼容不传 `sourceCommit` 时的旧方式。扩展可信 `version-upgrade.mjs prepare` 的固定参数模式，**不接受 shell 命令或任意目录**。

建议实现（不要额外建设 CI/CD 框架）：

1. 服务端验证 `sourceCommit` 是本地已存在、可从允许的本地/远端跟踪分支到达的**确定 commit 对象**。
2. 获取 `mainHeadAtPrepare`，校验 FF 条件；同时保存所选分支标签（仅供显示）和提交范围。
3. 在维护服务**私有的临时目录**创建 `git worktree add --detach <安全目录> <完整 SHA>`（位于运行 Workspace 之外；不得覆盖/修改 Owner/Agent 原工作目录）；退出时清理临时 worktree。
4. 隔离环境按现有 Node.js 24 + pnpm 流程安装锁定依赖、构建 TypeScript 和前端，再由现有冻结函数从这份源码冻结 Release；**不能直接使用另一个工作区当前 `dist/` 的构建结果**。
5. 原样复用 `submit-owner-release` 与 `validate`；候选 metadata 至少绑定 `source_commit`, `main_head_at_prepare`, `candidate_hash`, `candidate_release_hash`。如果现有 Supervisor 契约不适合追加 Git metadata，可写在 Owner 维护目录的**不可变独立 manifest + sha256**，并在批准/发布前再次比对，不为此重构 Gene 协议。
6. 主分支 HEAD、候选代码快照、或基代发生不允许的变化时拒绝操作，让用户重新准备。严禁为方便发布而 `git reset --hard`、`checkout -f`、清理用户工作区。

**边界提醒：**使用 Git worktree 和临时独立构建目录是为了防止“主服务运行中、Agent 正在改代码、Owner 也在写代码”的相互踩踏，不代表允许对正在变化的开发目录直接取未提交文件。

### C. 批准、发布与 `main` 同步（复用旧链路）

- `POST /api/upgrades {action:"publish",id,hash}` 继续先走旧 `approve`→`apply`，保持 Owner cookie、same-origin、准确候选哈希匹配、基代校验、操作互斥。
- 发布**开始前**加 Git preflight：`main` HEAD 未偏离批准时记录的 expected SHA；确认可 FF；不存在正在 merge/rebase 的异常工作区；如果 `main` 被 checkout 在任何工作区，**仅当该工作区干净且能安全做 `git merge --ff-only` 时才自动同步**。不能保证工作区安全时发布前就禁止“一键完整发布”，提示本地手动完成 main 整理。
- 发布成功后在受控维护进程内重新确认实际 active Release / Generation 对应这个已批准候选，再同步 `main`。对于未被 checkout 的主分支可考虑受控 CAS 更新 `refs/heads/main`；对于已 checkout 的主分支，应使用正常的安全 FF 流程维护工作树和索引，**不能只移动 ref 导致工作树与 main 不一致**。
- 当 `main` 在其他工作区被开发者占用，或存在并发 Git 操作，**fail closed**：不修改其工作区、不强行解锁、不清理文件、不把 `main` 移到指定位置。必要时要求 Owner 将 main 留在干净的专用维护 worktree，再重试。
- 强制唯一操作 job；对接已有 `upgrade-web-job.json`，最少新增 `sourceCommit`、`expectedMainHead`、`gitSyncState`、`activeReleaseId`/`error` 等状态，记录部分成功；页面轮询展示真实阶段（`PREPARING`、`VALIDATING`、`AWAITING_APPROVAL`、`APPLYING`、`GIT_SYNC`、`SUCCEEDED`、`NEEDS_GIT_SYNC`、`FAILED`）。需要时用现有 `recover` 对账，而不是重复批准或再次执行 publish。
- V27 不实现自动 `push` 到 GitHub。**本地 `main` FF 不等于远端 `origin/main` 已推送**；页面显示远端可能未更新。

> 核心不变量：**Git 历史不是运行事实源；运行事实以已批准冻结 Release/Lineage 为准。Git `main` 是经控制同步的源代码分支。**

## 5. 前端最小改造清单

只修改 `resources/upgrade-web.html`（过长时允许拆出 `resources/upgrade-web.js`、`resources/upgrade-web.css`，不要新造第二套前端工程）。

1. 保留原登录页、中文/英文切换、回 OWNER、job 日志、恢复按钮。
2. 增加桌面双栏 Git graph，使用 SVG + CSS 原生圆点、线段、分叉轨道（可复用开源 Git Graph 的视觉布局思路，**不照搬源代码、商标和许可素材**）。数据由安全 API 提供，客户端只负责绘制；图是 Git **DAG**，不要按普通树把 merge parent 关系丢失。
3. 左面板按真实 Generation 父代关系排列、突出当前 ACTIVE；右面板显示分支彩色轨道、提交节点、branch/tag 标签，支持展开单个 commit。
4. 点击右侧提交显示差异与准备按钮；候选卡片移入下方“发布审核”区；同一个 commit 不自动替代已准备且未失效的候选。
5. 审批按钮默认禁用。必须满足全部：认证、候选 VALIDATED、当前基代匹配、准确 hash 未变化、FF 条件仍成立、无维护任务占用、Owner 勾选确认。
6. 对非 FF 分支显示原因和本地处理建议；只读图仍正常展示，不试图自动合并。
7. CSS：白底/淡冷灰、细线、技术控制台气质，保持可读性；不做复杂过渡、3D、动画或插件商城。右图可适度横向滚动。

## 6. 测试与回归（必须实际执行）

优先在 `apps/server/tests/upgrade_web.test.ts` 延展测试，另加一个小的隔离 Git 临时仓库 fixture（`git init`/`git commit` 生成确定历史），不要调用用户真实 Git 仓库进行写入。

### 6.1 图展示

- 线性 `main`、一个 feature 分支、两个 feature 分支、一个 merge commit：图的 `parents` 和 refs 不丢失。
- 同一提交存在多个 branch 标签正常显示。
- 左侧读取真实 ACTIVE/RETIRED/FAILED/ROLLED_BACK；Gene-only 代不伪造 commit。
- 缺少 Git 仓库时显示“Git 数据不可用”；8766 仍可查看已批准 Release 状态和 recover。
- Git 图 API 未登录返回 401；旧 `/status` 不暴露提交详情、隐私路径或日志。

### 6.2 选择、准备、审批、发布

- 从干净、可 FF 的 feature 提交准备，验证 `source_commit` 是选中 SHA（不是 root HEAD）；冻结出的源文件内容确实来自该 SHA。
- 在其他 worktree 创建未提交改动：不应把改动冻结进被选 commit 的候选；不清理、不覆盖原 worktree。
- main 与 feature 已分叉：不允许自动 FF，同步不能通过暗中 `merge/rebase/cherry-pick` 规避。
- 点击旧的 SHA/错误 candidate hash、在验证后 main 前进、基代前进、代码来源哈希变化：全部返回明确冲突，不改正式运行版本。
- approve 仍走既有 Owner exact hash；同一 job 并发请求第二次返回 409。
- 注入 validate 失败、apply 失败、同步 main 失败、维护进程中断：检查日志和“部分成功”状态，不发生虚假成功；不会覆盖付款、订单、World 及历史谱系。
- main checked-out 且 dirty、main 占用工作区、外部 Git 提交：没有 Git reset/force update；危险情况下 fail closed。
- 已发布再 rollback：左树真实当前版本更新，Git main 历史不回写、不强制重置。
- CLI 旧 `status/prepare/show/approve/apply/rollback/recover` 工作流不退化；8765 的 OWNER/QIAN/YUAN/GENE 不受影响。

### 6.3 交付前必须跑

```powershell
pnpm.cmd typecheck
pnpm.cmd test --maxWorkers=4
pnpm.cmd --dir frontend build
```

另外，针对 8766 在**隔离 Workspace + 临时 Git 仓库**中进行一次真实流程演练（两棵图加载 → 选择非 main 的精确 commit → 准备/校验 → 审批 → 发布成功 → 左树出现新 CURRENT + main 安全 FF → 中断/回退仍可恢复）；不使用实际钱包/生产数据库。若真实进程验收无法运行，明确记录“未验证”，不要声称通过。

## 7. 执行顺序与每阶段验收

| 阶段 | 要做的最少事情 | 可交付结果 |
| --- | --- | --- |
| **S1 · 展示** | 安全读取 Git DAG、Generation lineage，重画 8766 双栏节点线图 | 左树是实际发布历史；右树看到真实分支/commit，并可点选查看详情；不改变任何代码/运行状态 |
| **S2 · 选定源码并准备** | 从选定精确 SHA 的独立 worktree 构建、冻结、走旧校验和候选审批前展示 | 右树选定一个非当前 checkout 的已提交版本，也能成为真实 `VALIDATED` 候选 |
| **S3 · 批准与纳入** | 在原 approve/apply 上增加 Git FF preflight、安全 main 同步和部分成功对账 | 成功后左侧新增发布节点且实际运行新 Release、右侧 main 包含选中 SHA；所有冲突/失败可诊断和安全恢复 |

每阶段结束先跑对应测试，再进入下一阶段；不要顺势扩建项目级 Git 平台、权限系统或通用代码审查平台。

## 8. 明确不做

- 不修改 Pixel/World 决策、消息、能量、Skills、Body、Gene 进化机制；V27 不依赖 V26 落地。
- 不把 8766 移进 8765 `/OWNER`；`/OWNER` 仍仅提供状态与跳转入口。
- 不新增数据库、不改支付表、不迁移 Workspace（如现有升级链路产生新 Generation，沿用旧流程）。
- 不提供任意 Git 命令面板；不支持 UI 上创建/删除/重写分支、强推、强制 checkout、合并冲突自动修复。
- 不自动执行任意提交中的 Git hooks、测试脚本以外的外部程序；现有冻结验证中必须保留依赖/脚本安全边界。
- 不用第三方 Git 图形库替换整个维护页；不做复杂 CI/CD、远程多机部署或 Linux 发布系统重写。
- 不更改 Supervisor 的 Root of Trust、准确 hash 审批权限与回滚数据保护机制。

## 9. Codex 的交付格式

1. **先扫描**最新本地 repo，并输出真实差异：哪些 V27 条目已经存在，哪些仍缺失；有已有实现则复用，按最小 diff 修改。
2. 按 S1/S2/S3 分次提交；不要在一个工作树中同时与当前运行实例或其他 Agent 竞争写同一文件。Root/Upgrade 敏感文件只由 Owner 的本地 Codex 维护，不交给 Body Pixel 自修改。
3. 更新 `docs/版本升级入口.md`，附简要安全说明；如用户文档涉及发布入口，同步更新英文 `README.md` 与中文 `README_CN.md`。
4. 输出验证记录：测试命令及结果、实际未覆盖项、修改文件列表、首次运行步骤、失败/回退操作。
5. 提交信息建议：`V27 feat(upgrade): dual-tree git graph and reviewed source promotion`。**仅完成本地代码和隔离测试，不要替 Owner 在真实 8766 上审批/发布。**

## 10. 一句话验收标准

> Owner 打开 8766，左边看真实已批准运行版本谱系，右边看 Git 分支与提交图；从右边选择一个可安全 fast-forward 的提交，查看变化并批准准确候选后，系统通过现有 Supervisor 发布、左边显示新的实际运行版本、Git main 安全包含该提交。验证失败、分叉、并发、回退或同步失败都如实显示且不破坏现有 Workspace。

### 参考资料

- EmergentInc `scripts/upgrade-web.mjs`：https://github.com/lx00018310/EmergentInc/blob/main/scripts/upgrade-web.mjs
- EmergentInc `resources/upgrade-web.html`：https://github.com/lx00018310/EmergentInc/blob/main/resources/upgrade-web.html
- EmergentInc `scripts/version-upgrade.mjs`：https://github.com/lx00018310/EmergentInc/blob/main/scripts/version-upgrade.mjs
- EmergentInc `docs/版本升级入口.md`：https://github.com/lx00018310/EmergentInc/blob/main/docs/%E7%89%88%E6%9C%AC%E5%8D%87%E7%BA%A7%E5%85%A5%E5%8F%A3.md
- VS Code Git Graph（参考图形信息架构）：https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph
- 官方 Git `merge --ff-only`：https://git-scm.com/docs/git-merge
- 官方 Git `worktree`：https://git-scm.com/docs/git-worktree
