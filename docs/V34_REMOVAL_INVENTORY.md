# V34 removal inventory / 删减与销毁清单

## Baseline / 基线

- Source / 源码：`c24d8987d8b8028bf3e830e234cc60538a86eaf8`，加本会话尚未提交的 V33 与 README 修改。
- Instance / 实例：`D:\00_personalwork\EmergentInc元胞会社\workspace`。
- External instance state / 外部实例状态：`D:\00_personalwork\EmergentInc元胞会社\owner_private\approved-runtime`。
- Preserve / 保留：源码 Git、根目录 node_modules、`.env`、`owner-config.json`、`owner_private/vps_ed25519*`。
- Destroy / 销毁：整个旧 workspace；外部实例的 releases、snapshots、candidate-workspaces、recovery、空 git-worktrees、数据库、日志、请求、旧启动指针。旧发布副本内的依赖链接只删除链接本身，不沿链接遍历。
- Browser cleanup / 浏览器清理：`emergentinc.ownerChat.history`、`emergentinc.ownerChat.pending`、`emergentinc.ownerChat.draft`，以及本产品 `emergentinc.owner.action:*` 动作重试记录。V34 使用新的实例专属 `boss.v34.chat.*` 键。
- Execution status / 执行状态：旧实例已物理销毁，原路径 V34 新实例已启动并核验；未创建旧业务备份或归档。

## Dependency decisions / 依赖判定

| Old workflow / 旧工作流 | Callers and data / 调用与事实源 | V34 disposition / 判定 |
| --- | --- | --- |
| Gacha / 抽卡 | gacha routes/service/image/repository；招募处理器 | REPLACED：确定性的最小 Worker 创建，保留招募决定的 hash 与幂等 |
| Meetings / 会议 | meeting routes/service，会议 UI | DELETE：任务、消息和交付物取代会议 |
| Character editing / 人物编辑 | qianji narrative/profile UI，叙事修改接口 | DELETE：Worker 仅保留执行职责与稳定身份 |
| Pixel map / 地图与人工能量 | pixels UI，人工 reward/gateway 接口 | DELETE UI/API；运行执行 ID 和调用结算核暂留 |
| Prompt workshop / 提示词工坊 | prompts UI，prompt routes | DELETE：保留模型执行所需 PromptBuilder |
| Tool/environment workbench / 工具环境台 | tools/environment UI 和查询接口 | DELETE UI/API；ToolRegistry、权限与审计暂留 |
| QIAN hall/chat / 人物大厅聊天 | App、hall、qianji UI，独立聊天接口 | DELETE UI/API；内部任务消息网关暂留 |
| YUAN manual run / 人工运行台 | App、engine/run UI，run 人工接口 | DELETE UI/API；崩溃恢复与 UNKNOWN 结算暂留 |
| Gene business evolution / Gene 经营进化 | BusinessHome、promotion、dream/body 生命周期 | DELETE 经营工作流；软件发布哈希、审批与回滚核暂留 |
| Business workbench / 多标签经营台 | business service/routes/store、plans/tasks/schedules | DELETE：Owner Goal/Task 为唯一经营事实源 |
| OWNER dashboards / 老板多看板 | dashboard/taskboard/activity/work UI | REPLACED：Boss 三指标、最多三消息、唯一对话 |
| V33 flow/teams / 四列流与团队台 | OwnerCompanyFlow、OwnerTeamsView、projection/events | DELETE：本会话已有实现由 V34 明确替代 |

以上 12 项为独立工作流基线；最终比例按实际拆除结果记录，不以隐藏按钮计数。
The 12 rows are the workflow baseline; final counts require actual removal, not hidden buttons.

## Necessary kernel / 必要运行核

- `owner_goal_scheduler` / `owner_work_service` / `owner_automation_gate`：授权目标、派工、持久化恢复、UNKNOWN 防重与人工 OFF。
- `owner_company_budget`：共享 CNY 预留与实际结算，首次未授权。
- `WorldRuntimeManager` / 内部 Pixel ID：现有工具执行、调用回执、文件隔离的依赖；不作为产品入口。
- `PaymentService` / `PaymentMonitor` / `PublicStore`：订单隐私、链上最终性、回执去重、已核验收入。
- 发布 generation/current 身份及 8766：代码完整性、精确审批和新 V34 数据连续性；不恢复旧经营历史。

## Code reduction / 代码删减结果

- Boss pages: OWNER/QIAN/YUAN/GENE → `/BOSS`, **4 → 1, down 75%**. The public store and the separate trusted publication service remain.
- 老板页面由 OWNER/QIAN/YUAN/GENE 四个入口缩为 `/BOSS` 一个，**下降 75%**；保留公开商城和独立受控发布服务。
- All **12/12 old independent workflows** in the matrix above were removed or replaced. This is workflow reduction, not a claim that half the repository LOC was deleted.
- 上表 **12/12 项旧独立工作流**均实删或由新闭环替代；不以全仓 LOC 减半作为指标。
- Git baseline: **182 deleted tracked files / 25,737 lines**. The removal manifest additionally includes 6 uncommitted V33 files created and retired during this session: **188 files / 26,568 pre-deletion lines**.
- Git 基线实删 **182 个跟踪文件 / 25,737 行**；另含本会话先创建后淘汰的 6 个未提交 V33 文件，删除清单共 **188 文件 / 删除前 26,568 行**。
- Reviewable scope: **83 modified, 182 deleted, 22 added files**, excluding the two user-supplied plan documents. See [complete changed-file list](V34_CHANGED_FILES.json) and [pre-deletion inventory](V34_REMOVED_FILES.json).
- 可核对范围：**修改 83、删除 182、新增 22 文件**，不把用户提供的两份 PLAN 计入改造；完整路径见上述机器清单。

The remaining historical `v23-*`, generation/Current, Body/Pixel identifiers are used only by the trusted software publisher, execution isolation, pure programs and evidence recovery. They do not load pre-V34 data or provide retired product workflows. The V23 real-release rollback test was removed; V34 process publication/rollback replaces it.

暂留的 `v23-*` 文件名、generation/Current、Body/Pixel 内部 ID 只服务受信软件发布、执行隔离、纯程序和证据恢复，不加载 V34 前数据，不恢复旧产品流程。旧 V23 实际版本回退测试已删除，由 V34 真实进程发布/回滚测试取代。

## Verification / 验证

- `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm typecheck`, frontend tests **34/34**, frontend production build and `git diff --check`: passed.
- 上述依赖安装、类型检查、前端 **34/34** 回归、生产构建和差异空白检查通过。
- The frozen candidate reran the complete suite successfully (**627 passed**; nested process and opt-in tests skipped there). The additional projection regression passed separately. The actual V34 process integration passed with real restart, G0002 publication and G0001 rollback, retaining a new goal, Worker artifact, verified synthetic receipt, paid order, pending order, CNY ledger and manual OFF. No additional model call occurred during restart/publication/rollback.
- 冻结候选完整回归 **627 项通过**（其内部跳过嵌套进程及显式启用测试）；新增投影回归另行通过。真实 V34 进程集成通过重启、发布 G0002 和回滚 G0001，保留新目标、执行者产物、合成核验回执、已付款/待付款订单、CNY 账本及人工 OFF，期间没有额外模型调用。
- Reset safety: **9/9**, including real process locks, exact target confirmation, source/system/Home denial, junctions, no archive, deletion failure guard, fresh initialization retry and new-instance reset refusal.
- 重置安全测试 **9/9**，覆盖实际进程锁、目标确认、源码/系统/Home 禁止目标、junction、无归档、删除失败保护、空目录初始化重试及拒绝二次重置新实例。
- Browser: English/Chinese at **1280px and 390px**, three metrics, at most three messages, one conversation input, disabled inspection, no horizontal overflow, modal Escape and old-route redirect passed. Screenshots are local verification artifacts outside the source tree.
- 浏览器中英双语 **1280px / 390px** 检查通过：三指标、最多三消息、唯一对话框、禁用视察、无横向溢出、Escape 关闭弹窗、旧地址跳转；截图作为源码外的本地验证产物保存。

Two opt-in tests remain intentionally unrun: real paid model verification (requires an explicit CNY budget) and the extended three-commit Git publication rehearsal. Model/chain responses in the completed process test are synthetic, not actual commercial income. Earlier failures exposed and corrected dispatch reentrancy, ordinary-launch maintenance flag inheritance and Windows Fetch-blocked random ports; successful verification above follows those corrections.

两项显式启用测试未运行：真实收费模型验证（须明确 CNY 额度）和扩展的三次 Git 提交发布演练。已完成进程测试使用合成模型/链上证据，不代表实际商业收入。此前失败定位并修复了派工重入、普通启动继承维护暂停标志、Windows 随机分配 Fetch 禁用端口；上述成功结果均在对应修复后获得。

## Destructive reset / 实例销毁

The target-bound `--destroy --confirm` command completed successfully. It physically removed **330,073 files, 26,258 links and 68,437 directories**, a logical file size of **4,182,247,318 bytes**, then initialized the original workspace path. No old business backup/archive exists. Source, dependencies, `.env`, owner deployment config and SSH files were preserved; deployment file hashes match before/after.

绑定目标的 `--destroy --confirm` 已成功执行，物理删除范围为 **330,073 文件、26,258 链接、68,437 目录**，逻辑文件大小 **4,182,247,318 字节**，随后在原路径初始化。未创建旧业务备份/归档；源码、依赖、`.env`、Owner 部署配置与 SSH 文件保留，部署文件哈希前后相同。

New instance **`1a72ec26-06ff-4800-a4af-5a906f12839b`**, initialized `2026-10-16T12:18:55.103Z`, format **34**, active generation **G0001**. Company **OFF**, budget unauthorized with total/spent/reserved **0**, no Workers, goals, tasks, chat calls, model permits, orders, invoices, receipts, revenue or memories. Published products **0**. Model credentials remain configured; receive-only rails require fresh configuration.

新实例 **`1a72ec26-06ff-4800-a4af-5a906f12839b`**，初始化时间 `2026-10-16T12:18:55.103Z`，格式 **34**、活跃代 **G0001**。公司 **OFF**，预算未授权、总额/支出/预留均 **0**；执行者、目标、任务、聊天调用、模型许可、订单、发票、回执、收入和记忆均为零。上架商品 **0**。模型凭据继续有效；只收款通道须重新配置。

`/BOSS` on **8765** and the trusted publisher on **8766** are healthy. Retired compiled Gacha/business/meeting/Gene-promotion modules are absent from the frozen release. A second reset attempt was correctly refused with `V34_RESET_NEW_INSTANCE_FORBIDDEN`. See [live instance evidence](V34_INSTANCE_VERIFICATION.json), [exact reset commands](guides/V34_RESET.md) and the local screenshots linked in the evidence file.

**8765** 的 `/BOSS` 与 **8766** 受控发布服务均健康；冻结发布中没有旧抽卡、Business、会议、Gene-promotion 编译模块。再次尝试 reset 已正确返回 `V34_RESET_NEW_INSTANCE_FORBIDDEN`。实时实例证据、精确清零命令和本地截图见上述链接。
