# 升级测试提速记录 / Upgrade test performance — 2026-10-15

本轮将升级页面测试按依赖拆分，复用 Git 基础仓库，并将 Windows 本地候选校验的测试进程数从 1 改为 2。完整测试集合、候选哈希绑定、批准和发布步骤均保留。

This change separates upgrade tests by dependency, reuses an immutable Git fixture template, and uses two workers for Windows local candidate validation. The full test suite and candidate approval/publication checks remain in place.

## 实测 / Measurements

本机 Windows，Node.js 24.14.1、pnpm 11.19.0、Vitest 3.2.7。单进程和双进程在同一隔离快照上顺序运行，使用本地候选校验相同的精简环境、`CI=1` 和 `EMERGENTINC_CANDIDATE_MODE=1`；未启用失败重试。快照先离线安装锁定依赖并通过类型检查。

The one-worker and two-worker runs used the same isolated snapshot and candidate environment, sequentially, without retries. These are single-run local measurements, not a guarantee for future machines or workloads.

| 测试方式 / Test configuration | Vitest 总耗时 / Duration | 通过 / Passed | 原有跳过 / Existing skips |
| --- | ---: | ---: | ---: |
| 优化前正式候选 / Previous formal candidate | 670.40 秒 / s | 1021 | 4 |
| 本轮拆分、1 进程 / Optimized, 1 worker | 574.30 秒 / s | 1022 | 4 |
| 本轮拆分、2 进程 / Optimized, 2 workers | 298.21 秒 / s | 1022 | 4 |

双进程比优化前减少 **55.5%**，比同一优化快照的单进程减少 **48.1%**。`pnpm test` 命令墙钟耗时分别为 577.11 秒和 300.86 秒，包含增量 TypeScript 构建和进程启动。安装、独立类型检查及前后端构建不计入表中 Vitest 时间。

Two workers reduced Vitest time by **55.5%** against the earlier candidate and **48.1%** against the optimized one-worker run. Complete `pnpm test` commands took 577.11 s and 300.86 s, including incremental TypeScript compilation and startup. Installation, separate type checking, and application builds are excluded from the table.

## 修改和覆盖 / Changes and coverage

- `upgrade_ui.test.ts`：8 项中英文页面测试使用固定提交图，验证翻页、轮询、进度和异常提示。实际服务返回的 HTML 与被测试页面保持一致。
- `upgrade_web.test.ts`：21 项接口、认证、状态和数据库测试。
- `upgrade_git.test.ts`：27 项真实 Git 集成测试，保留合并、冲突、回退、脏工作区、分支保护、准确哈希绑定和代表性页面操作；新增真实 HTTP 接口的三页分页和本地/远程引用去重校验。
- Git 基础仓库按测试文件创建一次，再复制到每个用例的独立临时目录；分页历史通过 `git fast-import` 批量创建。用例之间不共享可写仓库。
- 原 43 组测试声明全部保留，展开后由 55 项变为 56 项。两次完整回归的测试名称和结果逐项一致：120 个文件通过、4 个文件跳过，1022 项通过、0 失败、4 项跳过。
- 原有 4 项可选进程/真实模型测试继续由原先的候选模式规则跳过；没有新增跳过。默认单项超时仍为 15 秒，既有测试显式设置的 30 秒保持原样；测试总命令上限为 15 分钟。

All original tests remain. UI cases use fixed graph responses; real Git cases retain publication and protection coverage with independent repository copies. One real pagination contract test was added. The existing four candidate-mode exclusions and all per-test limits are unchanged. The overall test command budget is 15 minutes.

## 验证和证据 / Validation and evidence

完整单/双进程回归、`pnpm.cmd typecheck`、`pnpm.cmd build`、`pnpm.cmd --dir frontend build` 均通过。基准后补充实际 HTML 送达断言，并单独复验 8 项中英文页面测试及最终类型检查。

Both full-suite runs, type checking, and backend/frontend builds passed. The final HTML delivery assertion was checked by rerunning all eight bilingual UI tests; final type checking was also repeated.

基准命令 / Benchmark commands:

```powershell
pnpm.cmd test --maxWorkers=1 --testTimeout=15000 --reporter=default --reporter=json --outputFile=../workers-1.vitest.json
pnpm.cmd test --maxWorkers=2 --testTimeout=15000 --reporter=default --reporter=json --outputFile=../workers-2.vitest.json
```

优化前基线取自提交 `673ab68e68da0a82e74f33da8175b40af26f0011` 的候选 `local-e9621912-82d7-48d2-ab6c-19bf48735666` 最近一次完整校验日志。本轮 A/B 快照包含此提交之上的未提交测试优化；源码 SHA-256 为 `6014199e099a59d6dc294bffdd653f0beffe8de3dff297a20eb972f28d7f322e`，两次回归前后相同。

The baseline is the latest completed validation of candidate `local-e9621912-82d7-48d2-ab6c-19bf48735666` from commit `673ab68`. The A/B snapshot includes the uncommitted optimizations above that commit. Its source fingerprint remained unchanged throughout both full runs.

原始计时、控制台日志和逐项 JSON 报告保存在本机 `cache/upgrade-test-performance-119bcebd-504c-4d0a-9178-bf698090525c/`；临时 release 快照已清理，证据日志保留。本轮完成代码和测试优化，发布仍通过原有候选流程进行。

Raw timings, console logs, and per-test JSON reports are stored in the local cache directory above. Only the disposable release snapshot is cleaned up. Publication continues through the existing candidate workflow.
