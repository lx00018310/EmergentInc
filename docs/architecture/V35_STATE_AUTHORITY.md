# V35 状态权威与故障范围表

> 版本：V35 · 2026-10-17 · 基于 commit `8d9ed844`（main）
> 本文先于代码修改提交；所有后续故障边界修改以本表为依据。若后续调查发现某项能力已可靠实现，只补测试，不重复实现。

## 1. 实际读写链（已核对 8d9ed84 源码）

```
Goal → TaskPlan(节点/触发) → Dispatch(owner_goal_dispatches) → Task(owner_work_tasks)
  → Attempt(company_execution_attempts, fence/lease) → Worker(独立进程+journal)
  → Receipt(company_receipt_inbox / company_worker_receipts) → Accounting(owner_model_permits/owner_money_reservations)
```

- 调度入口 `OwnerGoalScheduler.run()`：有 worker 时委托 `CompanyGoalScheduler.tick()`（单次 `await work.tick()` + 逐目标回执收敛 + 逐项派工）；无 worker 时走旧 World 路径。
- 执行事实唯一写者：`CompanyExecutionService.receipt()/applyContiguous()`（fence + sequence + revision 条件更新）。
- Worker 进程事实：`CompanyWorkerAdapter`（fork + journal 恢复 + `company_worker_launches` 状态）。
- 账本唯一写者：`CompanyModelLedger`（预留/结算），`OwnerCompanyBudget` 管共享额度。

## 2. 状态归属表（真相 → 唯一写入者 → 其他模块允许的操作）

| 真相 | 唯一写入者 | 其它模块只允许 |
|---|---|---|
| Goal 状态/修订 | `OwnerGoalService.action()/edit()/state()` | Scheduler 查询、投影读取、事件追加（goals.event） |
| TaskPlan 节点状态 | `OwnerTaskPlanService.complete()/claim()/reviseInternal()` | Scheduler 调用其事务 API，不直接 UPDATE owner_task_nodes*（例外：owner_work_service recruit 决策改 WAITING_RESOURCE、legacy 调度器 BLOCKED/WAITING 已存在，属既有受控写点，沿用不扩散） |
| Dispatch/Step | `CompanyGoalScheduler.finish()/dispatch()`、OwnerGoalScheduler 同构 | 只读投影 |
| Task | `CompanyExecutionService.applyContiguous()`（回执驱动）、worker 调度循环内的 QUEUED/BLOCKED 转移 | 只读 |
| Attempt/Fence/租约 | `CompanyExecutionService.claim()/receipt()/adoptAfterExit()`；`CompanyWorkerAdapter.recover()` 经 execution API | Worker 只上报回执 |
| 费用预留/结算 | `CompanyModelLedger` + `OwnerCompanyBudget` | 任何执行/恢复路径不得直接改 owner_money_reservations |
| Worker 进程 | `CompanyWorkerAdapter.start()/disconnect()/recover()` | Gate 只能 disconnect |
| BOSS 待办/评分 | 只读投影（`OwnerOverviewService` + 前端纯函数） | 禁止反写业务表 |

## 3. 故障作用范围规则（P1 验收标准）

| 范围 | 触发 | 允许效果 | 禁止 |
|---|---|---|---|
| ATTEMPT | ECONNRESET→UNKNOWN、模型断线、单次 worker 崩溃、无效 JSON | 该 Attempt 收敛为 BLOCKED/FAILED + 原因；Task 同步；相关 permit 保留 | 公司 desiredMode 改变；全局 halt；其它 Task 停止 |
| TASK / TASK_BRANCH | 节点失败、依赖缺失 | 本节点及真实下游等待；同 Goal 其它独立节点继续调度 | 把 Goal 整体锁死为 BLOCKED（同 Goal 仍有可调度节点时） |
| GOAL | 授权过期、目标级停止 | 本目标停/等，其余目标继续 | 影响其它目标 |
| COMPANY | 人工 OFF、预算不可满足、账本越权（halt）、维护、DB 不可用 | 禁止新派工；保留全部事实 | 被普通单任务失败触发；被自动恢复隐式改回 ON |

## 4. 已核对的安全机制（V34 已实现，V35 只补测试/收敛，不重写）

1. `company_execution_attempts` 三条唯一索引（task claim / worker claim / task active attempt）+ `UNIQUE(task_id,fence)` → 双派工在 DB 层被拒。
2. `receipt()` 的 fence/sequence/payload_hash 幂等收件箱；终态后 `OWNER_ATTEMPT_TERMINAL`。
3. `recover()` 要求进程 birth/pid 验证 + journal spec_hash 一致才 adopt；未验证不允许二次启动（`OWNER_PREVIOUS_WORKER_STILL_ALIVE`）。
4. UNKNOWN 调用：`scopeBlocked` 只按 world/goal 作用域阻塞（worker 走 attempt 级 `OWNER_OUTCOME_REVIEW_REQUIRED`），全局不 OFF。
5. `halt()` = admission block 'safety'，独立于 desired_mode；恢复不隐式改 desiredMode。
6. 预算等待：`company_worker_waits` 记录 required_micros；恢复由 worker 循环检测后 QUEUED。
7. `OwnerGoalScheduler.start()` catch → `admission.block('scheduler','OWNER_SCHEDULER_FAILED')`，可诊断全局保护（合法）。

## 5. 本轮确认的缺陷（P1-2 修改点）

| # | 缺陷 | 位置 | 修法 |
|---|---|---|---|
| D1 | `runWorkerTick` 派工 catch 中单任务失败 → `gate.goals.state(goalId,'BLOCKED',reason)`，使同 Goal 独立 DAG 分支无法继续 | owner_work_service.ts:382 | 派工异常仅落 Task BLOCKED；Goal 状态交给 CompanyGoalScheduler 的 hasIndependentProgress 判定 |
| D2 | `applyContiguous` 任何非 started/completed 回执（含 INTERRUPTED）直接把 Goal 置 BLOCKED | company_execution_service.ts:112-115 | 仅在无法归属时收敛；独立分支判定交给 scheduler；此处在无 Plan 情形保留（旧路径），有 Plan 的 Goal 交由 CompanyGoalScheduler 收敛（其 hasIndependentProgress 已支持 READY）。实现：仅当无 TaskPlan 时才置 BLOCKED |
| D3 | `runTick` 外层逐任务 catch 已存在（合理），但 DB 损坏类错误与普通业务错误未分类：SQLite 异常会逐任务重复失败但不阻断 | owner_work_service.ts:334-339 | 分类：`SQLITE_*`/SQLITE_ERROR 前缀→停轮询+schedulerError（可诊断全局保护）；其余局部 BLOCKED 继续 |
| D4 | Worker `apply()` 中 save_artifact 之外的 controller tool 无外部结果时仅标 TOOL_OUTCOME_UNKNOWN（正确），但 Goal 层恢复卡片动作缺“继续此任务”（P2 补齐） | P2 范围 | 新增注意力动作路由 |
| D5 | Legacy `runTick` 无 worker 路径同样把 task 失败直接映射 Goal BLOCKED（:110）——保留旧路径行为（无 worker 时代码即将退役），仅当 CompanyGoalScheduler 生效时确保新规则 | — | 不动旧路径（P3 删除候选） |

## 6. 事件待办投影现状

`OwnerOverviewService.bossOverview()` 复用 `OwnerOverview.alerts/inbox/proposals`；前端 `projectBossAttention` 按 critical/decision/milestone 排序截取 3 条。

P3 将按《BOSS_INTERACTIVE_ATTENTION_CHANGE_SPEC.md》补 B/R/U/I/W 评分（0-100）与 5 分钟稳定重排；服务端只补 `alerts` 缺失的 `incidentId/allowedActions` 等字段，不建新表。
