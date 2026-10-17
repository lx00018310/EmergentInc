# V34 one-time destructive reset / 一次性破坏性清零

**This physically deletes the specified pre-V34 instance. There is no backup, archive, migration, recycle bin, or recovery of old business.** Old orders/private links, receipts, goals, tasks, people, chat, generated code, private extensions and artifacts are lost. Blockchain transfers may remain on-chain; the new ledger must not claim them as new income.

**本命令从磁盘实际删除指定的 V34 前实例，不做备份、归档、迁移、回收站或旧业务恢复。**旧订单与私有链接、回执、目标、任务、人物、对话、衍生代码、私有扩展和产物均丢失。链上历史转账仍可能存在，新账本不得冒认为新收入。

## Identify the instance / 确认实例

Read `.env` and its `EMERGENTINC_LOCAL_EVOLUTION_CONFIG` owner config locally. Do not print secrets. The workspace must match the configured instance exactly. The script lists all external instance-state children to remove and preserves only the configured `owner-config.json`. Git source, installed source dependencies, `.env`, and unrelated deployments remain outside the deletion set.

在本机读取 `.env` 与其中 `EMERGENTINC_LOCAL_EVOLUTION_CONFIG` 指向的配置，不打印密钥。工作区必须精确匹配当前实例。脚本列明要删除的外部实例状态子路径，仅保留对应 `owner-config.json`。Git 源码、源码依赖、`.env` 和其他部署不在删除范围。

The instance for this execution is:

本次执行的实例为：

```text
D:\00_personalwork\EmergentInc元胞会社\workspace
D:\00_personalwork\EmergentInc元胞会社\owner_private\approved-runtime
```

The second directory's old releases, snapshots, candidate workspaces, recovery, logs, databases and startup pointer are instance data. Its `owner-config.json`, the repository, and separately stored SSH configuration are preserved. An independent source Git worktree is not an old runtime release and is not a reset target.

第二个目录中的旧 releases、snapshots、candidate-workspaces、recovery、日志、数据库和启动指针属于实例数据；保留其中 `owner-config.json`、源码仓库和另存的 SSH 配置。独立源码 Git worktree 不属于旧运行发布，不是清零对象。

## Execute explicitly / 显式执行

Stop the exact main service, upgrade service, workers, scheduler and payment monitor first. The script refuses matching processes, live lock PIDs, listening application/upgrade ports, or open DB/WAL/SHM handles on Windows. It rejects roots, Home/source/system targets, traversal, aliases, external links and embedded Git sources. Internal dependency junctions are unlinked without following them.

先停止对应主服务、升级服务、执行者、调度器和支付监听。脚本遇到匹配进程、存活的锁 PID、应用/升级端口占用或 Windows 上数据库/WAL/SHM 打开句柄会拒绝操作。拒绝根目录、Home/源码/系统目录、遍历、别名、外链和嵌套 Git 源码。内部依赖 junction 仅删除链接本身。

```powershell
# Read-only preview / 只读预览
node scripts/v34-reset-workspace.mjs --workspace 'D:\00_personalwork\EmergentInc元胞会社\workspace' --dry-run

# Irreversible deletion and fresh initialization / 不可逆删除并全新初始化
node scripts/v34-reset-workspace.mjs --workspace 'D:\00_personalwork\EmergentInc元胞会社\workspace' --destroy --confirm 'DELETE-BOSS-AFK-V34:D:\00_personalwork\EmergentInc元胞会社\workspace'
```

Default is dry-run. Confirmation is bound to the exact canonical path. The old workspace directory is deleted, then a new V34 instance is created at the same path with a new UUID and empty format-34 databases. Company OFF, budget unauthorized, workers/goals/orders/receipts zero. **An already initialized V34 workspace is refused even when empty.**

默认只读预览。确认文本绑定精确规范化路径。旧工作区目录先删除，再在原路径创建新 UUID、空 format-34 数据库。公司 OFF、预算未授权，执行者/目标/订单/回执为零。**已初始化的 V34 即使为空也拒绝重置。**

## Failure and normal startup / 失败与正常启动

Deletion failure keeps `<workspace>.v34-reset-in-progress`; normal startup refuses mixed data with `V34_RESET_INCOMPLETE`. No old instance is restored. Fix the reported OS/handle/path problem; do not remove the guard to bypass an incomplete deletion.

删除失败保留 `<workspace>.v34-reset-in-progress`，正常启动报 `V34_RESET_INCOMPLETE`，拒绝混合数据。不会恢复旧实例。修复已报告的 OS、句柄或路径问题，不要删保护标记绕过未完成的删除。

If deletion completed but initialization failed before creating files, retry **only from the empty/missing workspace**, using the recorded completed-deletion guard:

若删除已完成，但初始化在创建文件前失败，仅能凭已记录的删除完成保护标记，从**空或不存在的工作区**重试：

```powershell
node scripts/v34-reset-workspace.mjs --workspace 'D:\00_personalwork\EmergentInc元胞会社\workspace' --initialize-empty --confirm 'DELETE-BOSS-AFK-V34:D:\00_personalwork\EmergentInc元胞会社\workspace'
```

This retry deletes nothing and refuses a nonempty path. Partial new initialization requires inspecting and removing only its newly created empty skeleton before retry; it never permits resetting a usable V34 company.

该重试不删除任何内容，拒绝非空路径。部分新初始化失败须先检查并仅清理其新建的空骨架，然后重试；不能借此重置可用的 V34 公司。

Build and launch normally after reset. No install/start/update hook calls this destructive script:

重置后正常构建启动。安装、启动、更新钩子均不会调用本破坏性脚本：

```powershell
pnpm.cmd build
pnpm.cmd --dir frontend build
node scripts/launch-approved.mjs --open-browser
```

New installations initialize empty workspaces directly. An unmarked nonempty old workspace fails closed with `V34_DESTRUCTIVE_RESET_REQUIRED`. Future software upgrade/rollback preserves **new V34** business records and private artifacts; it does not reverse the pre-V34 deletion.

全新安装直接初始化空工作区。无标记非空旧工作区报 `V34_DESTRUCTIVE_RESET_REQUIRED`。之后的软件升级/回滚保留 **V34 新产生**的经营记录和私有产物，不能撤销 V34 前的删除。

## Browser keys / 浏览器键

On first entry the frontend removes known `emergentinc.ownerChat.history/pending/draft`, `emergentinc.runBudgetTokens`, `emergentinc.owner.action:*`, `emergentinc.tips.read.*`, session `emergentinc.recruit-intent`, `emergentinc.checkout-intent`, `emergentinc:decision:*`, and product `reward-pending:*` keys. Language and unrelated site storage are preserved. New chat/budget retries use `boss.v34.*` keys bound to the new instance ID.

首次进入时，前端精确删除以上已知旧业务键，保留语言和无关网站存储。新对话与预算重试使用绑定新实例 ID 的 `boss.v34.*` 键。
