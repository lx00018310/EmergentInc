# V35 事件动作契约(Attention Action Contract)

> 版本:V35 · 2026-10-17 · 基于 commit `8d9ed844`
> 关联:`V35_STATE_AUTHORITY.md`、《BOSS_INTERACTIVE_ATTENTION_CHANGE_SPEC.md》

## 1. 投影与动作分离

事件卡是**只读投影**:候选来自 `OwnerOverview.alerts / inbox / proposals` + 配置缺失事实,由前端纯函数 `bossAttention.projectBossAttention` 合并、评分、截取前三。投影不反写任何业务表。

动作由服务端逐次校验。前端传来的 `allowedActions`/标题不具授权效力。

## 2. 动作端点(全部复用既有权威服务)

| 动作 | 端点 | 路由到的权威实现 |
|---|---|---|
| 批准/拒绝计划、结案 | `POST /owner/proposals/:id/decision` | `OwnerProposalService.decide`(hash+幂等) |
| 招聘批准/拒绝 | `POST /owner/requests/:id/decision` | `OwnerWorkService.decide`(hash+幂等) |
| 目标暂停/停止/重开/验收 | `POST /owner/goals/:id/actions` | `OwnerGoalService.action`(revision+幂等) |
| 目标修订 | `PATCH /owner/goals/:id` | `OwnerGoalService.edit`(revision+幂等) |
| 预算 | `POST /owner/budget` | `OwnerCompanyBudget.configure` |
| 收款 | 既有 payment 路由 | `PaymentService.configureRail` |
| 未知执行放弃 | `POST /owner/execution-recovery/:id/abandon` | `CompanyRecoveryService.abandon`(hash) |
| 安全阻断确认 | `POST /owner/safety-holds/:id/acknowledge` | `CompanyRecoveryService.acknowledge`(hash) |
| 费用核验 | `POST /owner/automation/calls/:id/reconcile` | `OwnerAutomationGate.reconcileCall`(revision) |
| **STOP_TASK(新增)** | `POST /owner/tasks/:id/actions` `{action:'STOP_TASK',expectedRevision,idempotencyKey,reason}` | `CompanyAttentionService.stopTask` |
| **RETRY_TASK(新增)** | `POST /owner/tasks/:id/actions` `{action:'RETRY_TASK',…}` | `CompanyAttentionService.retryTask` |
| 查询可用动作(新增) | `GET /owner/tasks/:id/actions` | `CompanyAttentionService.actions` |

## 3. 新增动作语义

### STOP_TASK
- 前提:`actions()` 允许(task 非 REPLIED、未停止、Goal 非 STOPPED/ARCHIVED/COMPLETED)。
- 效果:Worker disconnect(进程退出由 recover 收敛);Attempt → INTERRUPTED(OWNER_TASK_STOPPED);Task → FAILED/OWNER_TASK_STOPPED;dispatch/step → FINISHED;occurrence → CANCELLED,节点 BLOCKED。
- Goal 收敛:有独立可继续节点 → READY;否则 BLOCKED。**其它 Goal 不受影响;费用预留与回执全部保留。**
- 幂等:`idempotencyKey` + `expectedRevision`(goal.revision);同一 key 重放返回原结果;已停止的 task 用新 key 再 stop → `OWNER_TASK_TRANSITION_INVALID`。

### RETRY_TASK
- 前提:Task FAILED/BLOCKED/NO_REPLY + attempt 终态 + 原因非 UNKNOWN/OWNER_TASK_STOPPED + `hasPendingOutcome=false`。
- 效果:Task → QUEUED(run_id/turn_id/reply 清空);dispatch/step → QUEUED;occurrence 恢复 RUNNING;Goal → READY。调度器随后创建**全新 fence+1 Attempt**,旧 Attempt 记录不可变。
- 保护:UNKNOWN 外部副作用/未核验费用禁止重试(`OWNER_TASK_RETRY_NOT_ALLOWED` / `OWNER_OUTCOME_REVIEW_REQUIRED`);revision 过期 → 409。
- `CompanyGoalScheduler` 已加防护:task QUEUED 但 attempt 终态时等待新派工,不按旧 attempt 二次收敛(修复 retry 死锁)。

## 4. 评分契约(前端纯函数 `attentionPriority`)

`Priority = B(阻塞 ≤35) + R(风险 ≤25) + U(时效 ≤20) + I(影响 ≤15) + W(等待 ≤5)`。

- B:公司级阻塞(预算/审查/调度失败)35;critical(含已付款订单交付、单目标执行链断)25;审批/配置 15。
- R:安全阻断(账本越权)25;外部写 UNKNOWN 15;费用 UNKNOWN 8。
- U:仅真实业务截止时间参与;本投影暂无截止字段,恒 0。**缺时间不按 1970 计。**
- I:公司级 15;影响 ≥3 目标 10;2 目标 6;1 目标 3;纯配置 0。按业务 ID 去重,不按日志条数。
- W:`floor(等待小时/6)`,上限 5;时间未知则 W=0。
- 同分排序:首次待处理时间升序 → 稳定 ID 升序。
- 事实每 5 秒刷新;排序在候选集合变化时按分数稳定重排。Milestone(无动作)不占三席位,席位空闲时展示。

## 5. 故障矩阵对应(实现状态)

| # | 场景 | 实现 |
|---:|---|---|
| 1 | ECONNRESET A + B 独立 | v35_failure_scope #1 ✅ |
| 2 | 同 Goal DAG A 败 B 续 C 等 | v35_failure_scope #2 ✅ |
| 3 | Worker 强杀收敛 | v35_failure_scope #3 ✅(含 journal 竞态修复) |
| 4 | Controller 重启回执复用 | 既有 receipt inbox + #8 ✅ |
| 5 | 非法 JSON 局部失败 | v35_failure_scope #5 ✅ |
| 6 | 手动停止只影响关联工作 | goal.action + #7 ✅ |
| 7 | 外部写 UNKNOWN 不重放 | retryTask 拒绝 + recover ✅ |
| 8 | 费用 UNKNOWN 保留预留 | v35_failure_scope #6/#8 ✅ |
| 10 | 双击/断线幂等 | goals.request 幂等表 ✅ |
| 11 | 版本冲突 | expectedRevision 409 ✅ |
| 13 | 处理后卡片补位 | boss_attention 重排测试 ✅ |
| 15 | 乱序回执 fence 防覆盖 | 既有 company_receipt_inbox ✅ |
| 16 | 双语+390×844 | i18n 词条补齐 + boss.css @media ✅ |

## 6. 安全边界(不变)

- 所有动作仍受 `assertOn/admission/budget/enforceLimits` 约束;STOP/RETRY 不改 `desired_mode`,不清 `company_admission_blocks`。
- 拒绝/终止不删除调用、账单、产物、订单记录;UNKNOWN 账单不自动结算为 0。
- UI 按钮只出现在服务端 `actions()` 允许的范围内。
