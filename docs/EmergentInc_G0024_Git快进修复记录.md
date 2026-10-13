# G0024 Git 快进修复记录 / Git fast-forward correction

日期：2026-10-13。源码基准：`0cf9fd3`，分支 `develop`。

## 原因与最小修复

G0024 已发布并运行源码 `0cf9fd3b86b23769daa86c4128820e2ee6ac09eb`，发布日志记录 `GIT_SYNC_PENDING: GIT_SYNC_DIRTY_WORKTREE`；本地 main 仍为 `86b133e2892db1e4f14e153df86a41b785ed3867`，且满足快进条件。

`fastForwardMain()` 错误地先要求调用目录干净。实际 main 未检出，更新其引用不会改变 develop 的文件与暂存区，却因 develop 上的 README 草稿被拦截。

修复只移除这项无关检查：main 有检出工作区时，继续检查该工作区并执行 `merge --ff-only`；main 未检出时，继续使用预期旧 SHA 的 `update-ref` 比较并交换。准备后的 main 移动、分叉及 main 自身未提交改动仍被拒绝。

维护页面根据发布候选的准确 Git 目标与实测 main 位置显示同步结果；刷新提交图时同时刷新提示。历史操作日志及原 `needs_git_sync` 记录保留，不因人工补齐而改写历史。

The sync check now protects main's own checkout without blocking unrelated development edits. An unchecked main is updated atomically against the recorded old SHA. The page recognizes when main reaches the exact published target and refreshes the notice with the Git graph, preserving the original operation log.

## 验证与本机处理

- `upgrade_web.test.ts`：69 项通过，覆盖独立 main 工作区、未检出的 main、develop 暂存/未暂存/未跟踪文件保留、main 改动/移动/分叉拒绝、发布后并发变化，以及中英文同步提示。
- `pnpm typecheck`：通过。
- 只读核验实际 G0024 的批准记录、完整冻结 Release 哈希及各 Current 身份，确认批准源码与 Git 同步目标均为 `0cf9fd3`。
- 已将本地 main 从 `86b133e` 快进至 `0cf9fd3`，前后 develop 的 HEAD、分支、暂存清单与两个 README 内容哈希一致。
- 已重载独立 8766 维护服务，使后续发布使用修复逻辑；主服务健康检查通过，现役仍为 G0024。

Local main now matches the approved G0024 source. The development branch and existing README drafts were preserved. The maintenance service was reloaded; the running business release remains G0024.
