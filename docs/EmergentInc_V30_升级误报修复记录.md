# V30 升级误报修复 / Upgrade failure correction

日期：2026-10-13。源码基准：`197dd00`，分支 `develop`。

## 已核实的原因 / Verified cause

17:20:24–17:20:50，准备 V29 提交 `c5f2347` 时，依赖离线安装成功，随后 Gene 继承复检报 `CUSTOM_GENE_PATCH_NEEDS_REBASE`。

现役 `G0023` 的非资产 Gene 与批准来源提交 `86b133e2892db1e4f14e153df86a41b785ed3867` 一致（仅忽略发布流程设置的 generation）。本次不存在未批准的 Gene 定制。

旧复检把冻结候选目录作为 Git 查询目录。该目录位于仓库的 `cache/.../releases/...` 子目录，`git ls-tree ... -- genome` 按当前子目录解释路径，返回空清单。程序用空清单比较现役 Gene，误判为定制。首次检查在 detached worktree 根目录执行，因此通过，复检才失败。

The offline install succeeded. The frozen candidate was a repository subdirectory, so Git resolved the old `genome` query relative to that subdirectory and returned an empty list. Comparing that list with the unchanged approved Gene caused a false customization error.

## 最小修复 / Minimal change

- 历史批准来源由可信维护仓库读取；`ls-tree --full-tree` 固定使用仓库根路径。冻结候选可以位于仓库内或仓库外，文件校验仍针对候选自身。
- 失败和中断的操作统一先显示“升级失败 / Upgrade failed”，保留具体错误、校验日志和恢复入口。处理中、准备成功及待批准发布的状态保留各自含义。
- 真实的未批准 Gene 修改仍被拒绝；批准来源、资产哈希、License、历史版本及实时账本检查继续生效。

Approved history is read from the trusted maintenance repository with root-relative Git paths. Failed and interrupted operations display “Upgrade failed” while retaining their reasons and logs. Active operations and successful preparation keep their existing status. Genuine custom Gene changes remain blocked.

## 验证 / Verification

- 对同一实际失败候选 `local-cd0e68c9-c53f-4d7a-8df4-ed61952ba0aa`，修复前只读复检稳定重现误报，修复后通过；没有改写该候选或现役 Release。
- `approved_gene_inheritance.test.ts` 与 `upgrade_web.test.ts`：75 项通过，覆盖嵌套候选、仓库外候选、新 Core 契约变化、真实定制拒绝及中英文失败/中断/处理中/成功状态。
- `multi_world_generation.test.ts`、`generation_supervisor.test.ts` 与 `prepare_app_code.test.ts`：40 项通过，检查既有升级/回退状态机和维护代码保护边界。本次相关回归共 115 项通过。
- `pnpm typecheck`：通过。

The same failed V29 candidate passes the corrected read-only Gene check. This verifies the reported blocker; it is not a full preparation, validation, approval or deployment of that candidate. The active generation remains G0023.

本次未重新准备、批准或发布实际候选，未切换主服务；现役仍为 G0023。维护页从本地读取页面，准备命令每次启动新进程，刷新维护页后重新准备即可使用本次修复。
