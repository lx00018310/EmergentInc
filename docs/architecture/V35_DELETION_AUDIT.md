# V35 删除审计(Deletion Audit)

> 版本:V35 · 2026-10-17
> 原则:先查调用链与测试覆盖,再删;安全或历史数据兼容约束未满足则不删。

## 1. 本轮实际删除的重复实现

| 位置 | 删除内容 | 原用途 | 替代实现 | 证据 |
|---|---|---|---|---|
| `frontend/src/features/boss/BossConsole.tsx` | 内联组件 `AttentionMessage`(约 22 行) | 事件卡的通用渲染,动作仅跳弹窗或招聘批准 | 新 `BossAttentionCard.tsx` 单卡组件:招聘批准/提案决策/恢复表单/STOP_TASK/RETRY_TASK 全部卡内完成,服务端允许动作驱动 | 前端 5 个测试文件 67 项全绿;`AttentionMessage` 无其他引用 |

## 2. 明确评估后**不删**的项与原因

| 项 | 原因 |
|---|---|
| `OwnerGoalScheduler` 旧 World 调度路径(无 worker 分支,约 130 行) | 仍有生产实例在无 worker 模式运行(`work.enableWorkers` 是显式启用);`company_legacy_adapter` 依赖其兼容语义。删除需发布契约验证,超本版范围。已登记为下一轮候选。 |
| `runTick` 内 `gateway` 旧收件箱轮询分支 | 同上,旧路径仍在使用;V34 测试 `owner_goal_scheduler.test.ts` 全部依赖该行为。 |
| `company_legacy_adapter.ts` | 恢复旧运行回执的权威入口;删除会丢历史执行核验能力。 |
| `owner_work_service.runTick` 中 BLOCKED 恢复分支的预算等待列表 | 与 worker 路径的 `company_worker_waits` 语义不同(旧任务无 waits 表),删除会破坏升级兼容。 |
| `bossAttention.sumUsdt`/指标定义 | 仍被 BossConsole 三指标使用,非重复。 |

## 3. 合并(非删除)的重复

| 重复 | 合并方式 |
|---|---|
| BossConsole 与 BossRecovery 的事件动作渲染 | `BossRecovery.VerifiedSettlement` 导出复用进 `BossAttentionCard`;BossConsole 不再自带一份审批/恢复渲染 |
| DAG 独立进度判定 `hasIndependentProgress` | 已是单一纯函数(company_goal_scheduler.ts),未新增副本;`CompanyAttentionService.stopTask` 直接调用 goals/plans 事务 API |

## 4. 调度权威检查

- 关键执行路径仍由 `CompanyGoalScheduler`(worker 模式)或 `OwnerGoalScheduler`(legacy 模式)**单一**权威调度;`CompanyAttentionService` 不派工、不抢占,只改 Task/Dispatch 状态后交回调度器。
- Goal/Task/Attempt 状态写入点未增加:STOP_TASK/RETRY_TASK 走的 UPDATE 均为 scheduler 同款受控转移(FAILED/QUEUED/FINISHED/CANCELLED),未引入新的状态机。
